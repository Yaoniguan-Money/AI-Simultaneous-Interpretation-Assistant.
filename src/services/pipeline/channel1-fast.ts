import type { ASRProvider } from '../asr/types';
import type {
  LLMProvider,
  SharedContext,
  TranslatedSentence,
  TranslationRequest,
  TranslationResult,
} from '../llm/types';
import { SentenceSegmenter } from './sentence-segmenter';
import { AudioRingBuffer } from '../../utils/audio-ring-buffer';

/** 管线配置 */
export interface PipelineConfig {
  /** 翻译历史保留句数，用于修正检测的上下文回溯 */
  historySize?: number;
}

/** 默认配置 */
const DEFAULTS = {
  HISTORY_SIZE: 5,
  /** 环形缓冲区容量——8 个 chunk × 128ms ≈ 1s 缓冲深度 */
  RING_BUFFER_CAPACITY: 8,
  /** 强制交付阈值（毫秒）——ASR 连续发 interim 超此时间未发 final，
   *  取最新 interim 作为伪 final 送入分段器，避免长句长时间无翻译 */
  FORCE_DELIVERY_MS: 3000,
} as const;

/** 翻译结果回调 */
export type TranslationCallback = (result: TranslationResult) => void;

/** ASR interim 结果回调——实时将识别中的原文推送给 UI 展示 */
export type InterimResultCallback = (text: string) => void;

/** 管线错误回调 */
export type PipelineErrorCallback = (error: Error) => void;

/**
 * Channel 1 快通道管线编排器
 * 协调音频→ASR→句子切分→LLM翻译的完整数据流
 * 通过构造函数注入 ASR 和 LLM 接口，不绑定任何具体供应商
 */
export class FastChannelPipeline {
  private readonly segmenter = new SentenceSegmenter();
  private readonly historySize: number;
  private readonly ringBuffer = new AudioRingBuffer(DEFAULTS.RING_BUFFER_CAPACITY);
  private translatedSentences: TranslatedSentence[] = [];
  private translationCallbacks = new Set<TranslationCallback>();
  private interimCallbacks = new Set<InterimResultCallback>();
  private errorCallbacks = new Set<PipelineErrorCallback>();
  private active = false;
  /** 消费锁：防止并发 consumeNext 调用——环形缓冲区已解决音频丢弃问题，此锁仅防并发内部状态冲突 */
  private processing = false;
  /** 上次收到 ASR final 结果的时间戳——用于检测长时间无 final 的 interim 洪水 */
  private lastFinalTimestamp = 0;
  /** 最新一条 interim 文本，长时间无 final 时作为伪 final 送入分段器 */
  private latestInterimText = '';

  constructor(
    private asr: ASRProvider,
    private llm: LLMProvider,
    private getSharedContext: () => SharedContext,
    config: PipelineConfig = {},
  ) {
    this.historySize = config.historySize ?? DEFAULTS.HISTORY_SIZE;
  }

  /** 注册翻译结果回调，返回取消注册函数 */
  onTranslation(callback: TranslationCallback): () => void {
    this.translationCallbacks.add(callback);
    return () => { this.translationCallbacks.delete(callback); };
  }

  /** 注册 ASR interim 结果回调，返回取消注册函数——实时展示识别中的原文 */
  onInterimResult(callback: InterimResultCallback): () => void {
    this.interimCallbacks.add(callback);
    return () => { this.interimCallbacks.delete(callback); };
  }

  /** 注册错误回调，返回取消注册函数 */
  onError(callback: PipelineErrorCallback): () => void {
    this.errorCallbacks.add(callback);
    return () => { this.errorCallbacks.delete(callback); };
  }

  /** 启动管线 */
  start(): void {
    if (this.active) return;
    this.active = true;
  }

  /** 停止管线并清理全部状态 */
  stop(): void {
    this.active = false;
    this.ringBuffer.clear();
    this.segmenter.reset();
    this.translatedSentences = [];
    this.lastFinalTimestamp = 0;
    this.latestInterimText = '';
    /** 释放外部资源：ASR WebSocket 连接和 LLM 进行中的 HTTP 流 */
    this.asr.dispose();
    this.llm.dispose();
  }

  /** 话题切换时重置翻译记忆，不停止管线 */
  resetContext(): void {
    this.translatedSentences = [];
  }

  /**
   * 接收音频数据——非阻塞入队，异步消费
   *
   * 环形缓冲区替代了旧版的「处理中则丢弃」策略：
   * 音频先入 ringBuffer 队列，consumer 从队列取数据逐条处理。
   * @param audio PCM 16kHz 16bit mono 音频数据
   * @param timestamp 音频时间戳（毫秒）
   */
  processChunk(audio: Uint8Array, timestamp: number): void {
    if (!this.active) return;
    if (!audio || audio.length === 0) return;

    this.ringBuffer.enqueue(audio, timestamp);
    /** 触发异步消费——不使用 await，消费循环自行管理生命周期 */
    this.consumeNext().catch((e) => this.handleError(e));
  }

  // ---- 消费循环 ----

  /**
   * 从环形缓冲区取出一条 chunk，执行 ASR→分句→翻译流水线
   * 处理完成后递归调用自身消费下一条（异步递归，await 释放栈帧无栈溢出风险）
   */
  private async consumeNext(): Promise<void> {
    if (!this.active) return;
    /** 消费锁：同一时刻只允许一个 consumeNext 协程在处理 */
    if (this.processing) return;

    const item = this.ringBuffer.dequeue();
    if (!item) return;

    this.processing = true;
    try {
      /** 第一步：ASR 识别 */
      const asrResult = await this.asr.recognize(item.data);

      /** 拉取 ASR 供应商的 interim 队列（如有），分发给 UI 实时展示 */
      this.drainAndDispatchInterim();

      if (!asrResult.text) return;

      if (!asrResult.isFinal) {
        /** interim 结果：保存最新文本，推送 UI 展示原文，不进入分句器 */
        this.latestInterimText = asrResult.text;
        this.interimCallbacks.forEach((cb) => cb(asrResult.text));
        /** 长时间无 final 则强制交付——取最新 interim 作为伪 final 送入分段器 */
        if (
          this.lastFinalTimestamp > 0 &&
          Date.now() - this.lastFinalTimestamp > DEFAULTS.FORCE_DELIVERY_MS
        ) {
          await this.forceDeliverInterim(item.timestamp);
        }
        return;
      }

      /** 记录 final 到达时间，重置强制交付状态 */
      this.lastFinalTimestamp = Date.now();
      this.latestInterimText = '';

      /** 第二步：语义分句——仅 final 结果参与 */
      const sentences = this.segmenter.push(
        asrResult.text,
        item.timestamp,
        true,
      );

      /** 第三步：逐句翻译 */
      for (const sentence of sentences) {
        if (!this.active) break;
        await this.translateSentence(sentence);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.processing = false;
      /** 继续消费：在处理期间可能有新数据入队的 chunk */
      this.consumeNext().catch((e) => this.handleError(e));
    }
  }

  /**
   * 尝试从 ASR 供应商拉取 pending interim 结果并分发给 UI
   * 通过 duck-type 检查 drainInterimResults 方法存在性，供应商无关
   */
  private drainAndDispatchInterim(): void {
    const asr = this.asr as { drainInterimResults?: () => { text: string }[] };
    if (typeof asr.drainInterimResults !== 'function') return;

    const interimList = asr.drainInterimResults();
    if (!interimList || interimList.length === 0) return;

    for (const r of interimList) {
      if (r.text) {
        this.interimCallbacks.forEach((cb) => cb(r.text));
      }
    }
  }

  /**
   * 强制交付当前 interim 文本为伪 final（修复 B4：长句憋字）
   * 当 ASR 长时间只发 interim 不发 final 时（连续说话无自然停顿），
   * 取最新 interim 文本送入分段器，避免中文字幕长时间空白。
   * 触发条件：上次 final 距今超过 FORCE_DELIVERY_MS（3s）。
   */
  private async forceDeliverInterim(timestamp: number): Promise<void> {
    const text = this.latestInterimText;
    this.latestInterimText = '';
    this.lastFinalTimestamp = Date.now();
    if (!text) return;

    const sentences = this.segmenter.push(text, timestamp, true);
    for (const sentence of sentences) {
      if (!this.active) break;
      await this.translateSentence(sentence);
    }
  }

  /** 刷新缓冲，翻译剩余未交付的文本 */
  async flush(): Promise<void> {
    const remaining = this.segmenter.flush();
    if (remaining && this.active) {
      await this.translateSentence(remaining);
    }
  }

  // ---- 内部 ----

  /** 翻译单个句子，流式产出结果并通知回调 */
  private async translateSentence(text: string): Promise<void> {
    const request = this.buildTranslationRequest(text);
    let finalResult: TranslationResult | null = null;

    let isFirstToken = true;
    try {
      for await (const result of this.llm.translate(request)) {
        /** 首个流式 token 携带原文文本，供字幕层展示英文（修复 B3：译文条目丢失 original 字段） */
        const enriched: TranslationResult = isFirstToken
          ? { ...result, originalText: text }
          : result;
        isFirstToken = false;
        /** 流式中间结果实时通知（打字机效果） */
        this.translationCallbacks.forEach((cb) => cb(enriched));
        finalResult = enriched;
      }
    } catch (error) {
      this.handleError(error);
      return;
    }

    /** 记录到翻译历史，用于后续句子的修正检测 */
    if (!finalResult) return;

    const tokenIndex = finalResult.tokens.length > 0
      ? finalResult.tokens[finalResult.tokens.length - 1].index
      : this.translatedSentences.length;

    this.translatedSentences.push({
      index: tokenIndex,
      original: text,
      translation: finalResult.translation,
    });

    /** 限制历史长度，防止上下文窗口膨胀 */
    if (this.translatedSentences.length > this.historySize) {
      this.translatedSentences = this.translatedSentences.slice(-this.historySize);
    }

    /** 修正独立通知，与翻译结果区分，字幕层可据此触发修正动画 */
    if (finalResult.corrections.length > 0) {
      const { translation, corrections } = finalResult;
      this.translationCallbacks.forEach((cb) =>
        cb({ translation, corrections, tokens: [] }),
      );
    }
  }

  /** 构建翻译请求，注入共享上下文和翻译历史 */
  private buildTranslationRequest(text: string): TranslationRequest {
    return {
      text,
      context: this.getSharedContext(),
      previousSentences: [...this.translatedSentences],
    };
  }

  /** 统一错误分发 */
  private handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.errorCallbacks.forEach((cb) => cb(err));
  }
}
