import type { ASRProvider } from '../asr/types';
import type {
  LLMProvider,
  SharedContext,
  TranslatedSentence,
  TranslationRequest,
  TranslationResult,
} from '../llm/types';
import { SentenceSegmenter } from './sentence-segmenter';

/** 管线配置 */
export interface PipelineConfig {
  /** 翻译历史保留句数，用于修正检测的上下文回溯 */
  historySize?: number;
}

/** 默认配置 */
const DEFAULTS = {
  HISTORY_SIZE: 5,
} as const;

/** 翻译结果回调 */
export type TranslationCallback = (result: TranslationResult) => void;

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
  private translatedSentences: TranslatedSentence[] = [];
  private translationCallbacks = new Set<TranslationCallback>();
  private errorCallbacks = new Set<PipelineErrorCallback>();
  private active = false;
  /** 翻译中标记——翻译期间 ASR 结果暂存至队列，而非丢弃 */
  private translating = false;
  /** 翻译期间暂存的 ASR 结果，翻译完成后按 FIFO 顺序统一排空处理 */
  private pendingResults: Array<{
    text: string;
    timestamp: number;
    isFinal: boolean;
  }> = [];

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
    this.segmenter.reset();
    this.translatedSentences = [];
    this.pendingResults = [];
    /** 释放外部资源：ASR WebSocket 连接和 LLM 进行中的 HTTP 流 */
    this.asr.dispose();
    this.llm.dispose();
  }

  /** 话题切换时重置翻译记忆，不停止管线 */
  resetContext(): void {
    this.translatedSentences = [];
    this.pendingResults = [];
  }

  /**
   * 处理一段音频数据
   * 第一步（始终执行）：发送音频到 ASR，保证 RTASR 连接不进入空闲超时
   * 第二步（翻译空闲时）：分句 + LLM 翻译，翻译期间新到结果暂存至队列
   * @param audio PCM 16kHz 16bit mono 音频数据
   * @param timestamp 音频时间戳（毫秒）
   */
  async processChunk(audio: Uint8Array, timestamp: number): Promise<void> {
    if (!this.active) return;
    if (!audio || audio.length === 0) return;

    try {
      /** 第一步：始终发送音频到 ASR——即使正在翻译也不阻塞 */
      const asrResult = await this.asr.recognize(audio);
      if (!asrResult.text) return;

      /** 翻译中暂存结果，避免并发进入分句器——翻译完成后统一排空 */
      if (this.translating) {
        this.pendingResults.push({
          text: asrResult.text,
          timestamp,
          isFinal: asrResult.isFinal,
        });
        return;
      }

      /** 翻译空闲，立即处理当前结果并排空待处理队列 */
      await this.processASRResult(asrResult.text, timestamp, asrResult.isFinal);
    } catch (error) {
      this.handleError(error);
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

  /**
   * 串行处理 ASR 结果：分句 → 逐句翻译 → 排空翻译期间积累的待处理结果
   * 设置 translating 标记防止并发进入分句器，保证分句器内部状态一致性
   */
  private async processASRResult(
    text: string,
    timestamp: number,
    isFinal: boolean,
  ): Promise<void> {
    this.translating = true;
    try {
      await this.translateSentences(
        this.segmenter.push(text, timestamp, isFinal),
      );

      /** 排空翻译期间积累的待处理结果 */
      while (this.pendingResults.length > 0 && this.active) {
        const pending = this.pendingResults.shift()!;
        await this.translateSentences(
          this.segmenter.push(pending.text, pending.timestamp, pending.isFinal),
        );
      }
    } finally {
      this.translating = false;
    }
  }

  /** 逐句翻译，active 为 false 时提前终止——消除 processASRResult 中的 while→for 嵌套 */
  private async translateSentences(sentences: string[]): Promise<void> {
    for (const sentence of sentences) {
      if (!this.active) break;
      await this.translateSentence(sentence);
    }
  }

  /** 翻译单个句子，流式产出结果并通知回调 */
  private async translateSentence(text: string): Promise<void> {
    const request = this.buildTranslationRequest(text);
    let finalResult: TranslationResult | null = null;

    try {
      for await (const result of this.llm.translate(request)) {
        /** 流式中间结果实时通知（打字机效果） */
        this.translationCallbacks.forEach((cb) => cb(result));
        finalResult = result;
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
