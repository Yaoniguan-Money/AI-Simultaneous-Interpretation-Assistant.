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
  /** 处理锁：防止并发 ASR 调用导致内部状态冲突 */
  private processing = false;

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
  }

  /**
   * 处理一段音频数据，内部串行化防止并发
   * 流程：ASR 识别 → 语义分句 → LLM 翻译 → 回调通知
   * @param audio PCM 16kHz 16bit mono 音频数据
   * @param timestamp 音频时间戳（毫秒）
   */
  async processChunk(audio: Buffer, timestamp: number): Promise<void> {
    if (!this.active) return;
    if (!audio || audio.length === 0) return;

    /** 处理锁：正在处理前一个 chunk 时跳过当前 chunk，避免并发 */
    if (this.processing) return;
    this.processing = true;

    try {
      /** 第一步：ASR 识别 */
      const asrResult = await this.asr.recognize(audio);
      if (!asrResult.text) { this.processing = false; return; }

      /** 第二步：语义分句 */
      const sentences = this.segmenter.push(
        asrResult.text,
        timestamp,
        asrResult.isFinal,
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
