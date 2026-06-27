import type { ASRProvider } from '../asr/types';
import type {
  LLMProvider,
  SharedContext,
  TranslatedSentence,
  TranslationRequest,
  TranslationResult,
} from '../llm/types';
import { SentenceSegmenter } from './sentence-segmenter';
import type { SegmenterConfig } from './sentence-segmenter';
import { AudioRingBuffer } from '../../utils/audio-ring-buffer';
import { firstScreenLatency } from '../../utils/first-screen-latency';

/** 管线配置 */
export interface PipelineConfig {
  /** 翻译历史保留句数，用于修正检测的上下文回溯 */
  historySize?: number;
  /** 强制交付阈值（毫秒）——ASR 连续发 interim 超此时间未发 final 时强制交付 */
  forceDeliveryMs?: number;
  /** 分句器配置——覆盖默认的静音阈值和最大缓冲时长 */
  segmenterConfig?: SegmenterConfig;
  /** Final sentence output hook for non-blocking slow-channel analysis. */
  onFinalSentences?: (sentences: string[]) => void;
}

/** 默认配置 */
const DEFAULTS = {
  HISTORY_SIZE: 5,
  /** 环形缓冲区容量——8 个 chunk × 128ms ≈ 1s 缓冲深度 */
  RING_BUFFER_CAPACITY: 8,
  /**
   * 强制交付阈值（毫秒）——ASR 连续发 interim 超此时间未发 final，
   * 取最新 interim 作为伪 final 送入分段器，避免长句长时间无翻译。
   * 5s 给 ASR 充足时间确认 final，与分句器 4s maxBufferMs 配合不冲突。
   */
  FORCE_DELIVERY_MS: 5000,
  PREVIEW_MIN_INTERVAL_MS: 1300,
  PREVIEW_MIN_CHAR_DELTA: 10,
  PREVIEW_MIN_LENGTH: 10,
  PREVIEW_TARGET_WORDS: 8,
  PREVIEW_MIN_WORDS: 6,
  PREVIEW_FORCE_MS: 1300,
} as const;

const PREVIEW_BOUNDARY_WORDS = new Set([
  'and',
  'but',
  'so',
  'because',
  'that',
  'which',
  'when',
  'where',
]);

/**
 * 最小可翻译文本长度（字符数）
 * 过滤 ASR 噪音和空输入，避免 LLM 收到无意义文本后返回占位/拒绝响应
 */
const MIN_TRANSLATABLE_LENGTH = 2;

/** 翻译结果回调 */
export type TranslationCallback = (result: TranslationResult) => void;

/** ASR interim 结果回调——实时将识别中的原文推送给 UI 展示 */
export type InterimResultCallback = (text: string) => void;

/** 管线错误回调 */
export type PipelineErrorCallback = (error: Error) => void;

type TranslationPhase = 'preview' | 'final';

interface TranslationJob {
  text: string;
  segmentId: string;
  phase: TranslationPhase;
}

/**
 * Channel 1 快通道管线编排器
 * 协调音频→ASR→句子切分→LLM翻译的完整数据流
 * 通过构造函数注入 ASR 和 LLM 接口，不绑定任何具体供应商
 */
export class FastChannelPipeline {
  private readonly segmenter: SentenceSegmenter;
  private readonly historySize: number;
  private readonly forceDeliveryMs: number;
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
  private firstInterimTimestamp = 0;
  private lastPreviewTimestamp = 0;
  private lastPreviewText = '';
  private activePreviewSegmentId: string | null = null;
  private nextSegmentIndex = 0;
  private translationQueue: TranslationJob[] = [];
  private translating = false;
  private supersededPreviewSegments = new Set<string>();
  private readonly onFinalSentences?: (sentences: string[]) => void;

  constructor(
    private asr: ASRProvider,
    private llm: LLMProvider,
    private getSharedContext: () => SharedContext,
    config: PipelineConfig = {},
  ) {
    this.historySize = config.historySize ?? DEFAULTS.HISTORY_SIZE;
    /** 分句器通过配置注入阈值，遵循无硬编码原则 */
    this.segmenter = new SentenceSegmenter(config.segmenterConfig);
    /** 强制交付阈值通过配置注入，可被 PipelineConfig.forceDeliveryMs 覆盖 */
    this.forceDeliveryMs = config.forceDeliveryMs ?? DEFAULTS.FORCE_DELIVERY_MS;
    this.onFinalSentences = config.onFinalSentences;
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
    /** 初始化强制交付计时——允许首句也触发 5s 强制交付，避免 ASR 长时间不发 final 时首句翻译延迟 */
    this.lastFinalTimestamp = 0;
    this.firstInterimTimestamp = 0;
  }

  /** 停止管线并清理全部状态 */
  stop(): void {
    this.active = false;
    this.ringBuffer.clear();
    this.segmenter.reset();
    this.translatedSentences = [];
    this.lastFinalTimestamp = 0;
    this.latestInterimText = '';
    this.firstInterimTimestamp = 0;
    this.lastPreviewTimestamp = 0;
    this.lastPreviewText = '';
    this.activePreviewSegmentId = null;
    this.translationQueue = [];
    this.translating = false;
    this.supersededPreviewSegments.clear();
    /** 释放外部资源：ASR WebSocket 连接和 LLM 进行中的 HTTP 流 */
    this.asr.dispose();
    this.llm.dispose();
  }

  /**
   * 预热 ASR 连接——提前建立 WebSocket 和握手
   * 可在音频捕获启动前调用，利用 getDisplayMedia 弹窗等待时间并行建连
   * 失败不抛异常——recognize() 首次调用时会通过懒连接重试
   */
  async warmup(): Promise<void> {
    await this.asr.preconnect?.();
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
      this.drainAndDispatchInterim(item.timestamp);

      if (!asrResult.text) return;

      if (!asrResult.isFinal) {
        this.handleInterimText(asrResult.text, item.timestamp);
        return;
      }

      /** 记录 final 到达时间，重置强制交付状态 */
      this.handleFinalText(asrResult.text, item.timestamp);
      return;


    } catch (error) {
      this.handleError(error);
    } finally {
      this.processing = false;
      /** 继续消费：在处理期间可能有新数据入队的 chunk */
      this.consumeNext().catch((e) => this.handleError(e));
    }
  }

  /**
   * 从 ASR 供应商拉取 pending interim 结果并分发给 UI
   * 通过 ASRProvider 接口方法调用，供应商无关
   */
  private drainAndDispatchInterim(timestamp: number): void {
    const interimList = this.asr.drainInterimResults();
    if (!interimList || interimList.length === 0) return;

    for (const r of interimList) {
      if (r.text) {
        this.handleInterimText(r.text, timestamp);
      }
    }
  }

  private handleInterimText(text: string, timestamp: number): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    const now = Date.now();
    if (this.firstInterimTimestamp === 0) {
      this.firstInterimTimestamp = now;
      firstScreenLatency.mark('first_asr_interim', `chars=${trimmed.length}`);
    }

    const changed = trimmed !== this.latestInterimText;
    this.latestInterimText = trimmed;
    if (changed) {
      this.interimCallbacks.forEach((cb) => cb(trimmed));
    }

    this.maybeEnqueuePreview(now);

    const deliveryBase = this.lastFinalTimestamp || this.firstInterimTimestamp;
    if (deliveryBase > 0 && now - deliveryBase >= this.forceDeliveryMs) {
      this.forceDeliverInterim(timestamp);
    }
  }

  private handleFinalText(text: string, timestamp: number): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    const now = Date.now();
    firstScreenLatency.mark('first_asr_final', `chars=${trimmed.length}`);
    this.lastFinalTimestamp = now;

    const segmentId = this.activePreviewSegmentId ?? this.createSegmentId();
    this.firstInterimTimestamp = 0;
    this.latestInterimText = '';

    const sentences = this.segmenter.push(trimmed, timestamp, true);
    if (sentences.length === 0) return;

    this.activePreviewSegmentId = null;
    this.lastPreviewTimestamp = 0;
    this.lastPreviewText = '';
    this.supersededPreviewSegments.add(segmentId);
    this.notifyFinalSentences(sentences);
    this.enqueueSentences(sentences, 'final', segmentId);
  }

  private maybeEnqueuePreview(now: number): void {
    const elapsedSinceFirstInterim = this.firstInterimTimestamp === 0
      ? 0
      : now - this.firstInterimTimestamp;
    const text = this.latestInterimText.trim();
    const previewText = this.buildPreviewSlice(
      text,
      elapsedSinceFirstInterim >= DEFAULTS.PREVIEW_FORCE_MS,
    );
    if (!previewText || !this.isTranslatable(previewText)) return;

    const segmentId = this.activePreviewSegmentId ?? this.createSegmentId();
    this.activePreviewSegmentId = segmentId;

    const elapsedSincePreview = this.lastPreviewTimestamp === 0
      ? Number.POSITIVE_INFINITY
      : now - this.lastPreviewTimestamp;
    const charDelta = Math.max(0, previewText.length - this.lastPreviewText.length);

    if (
      previewText === this.lastPreviewText ||
      charDelta < DEFAULTS.PREVIEW_MIN_CHAR_DELTA &&
      elapsedSincePreview < DEFAULTS.PREVIEW_MIN_INTERVAL_MS &&
      elapsedSinceFirstInterim < DEFAULTS.PREVIEW_MIN_INTERVAL_MS
    ) {
      return;
    }

    this.lastPreviewTimestamp = now;
    this.lastPreviewText = previewText;
    this.enqueueTranslation({ text: previewText, segmentId, phase: 'preview' });
  }

  /**
   * 强制交付当前 interim 文本为伪 final（修复 B4：长句憋字）
   * 当 ASR 长时间只发 interim 不发 final 时（连续说话无自然停顿），
   * 取最新 interim 文本送入分段器，避免中文字幕长时间空白。
   * 触发条件：上次 final 距今超过 FORCE_DELIVERY_MS（3s）。
   */
  private buildPreviewSlice(text: string, forceByTime: boolean): string | null {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length < DEFAULTS.PREVIEW_MIN_LENGTH) return null;

    const words = this.extractEnglishWords(normalized);
    const minWords = forceByTime ? 4 : DEFAULTS.PREVIEW_MIN_WORDS;
    if (words.length < minWords) return null;

    const punctuationSlice = this.sliceAtPreviewPunctuation(normalized, words, minWords);
    if (punctuationSlice) return punctuationSlice;

    const boundarySlice = this.sliceAtPreviewBoundaryWord(normalized, words, minWords);
    if (boundarySlice) return boundarySlice;

    if (words.length >= DEFAULTS.PREVIEW_TARGET_WORDS) {
      return normalized.slice(0, words[DEFAULTS.PREVIEW_TARGET_WORDS - 1].end).trim();
    }

    if (forceByTime) {
      return normalized.slice(0, words[words.length - 1].end).trim();
    }

    return null;
  }

  private extractEnglishWords(text: string): Array<{ value: string; start: number; end: number }> {
    const words: Array<{ value: string; start: number; end: number }> = [];
    const re = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      words.push({
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    return words;
  }

  private sliceAtPreviewPunctuation(
    text: string,
    words: Array<{ end: number }>,
    minWords: number,
  ): string | null {
    const punctuation = /[,;:，；：—-]/g;
    let match: RegExpExecArray | null;
    while ((match = punctuation.exec(text)) !== null) {
      const wordCount = words.filter((word) => word.end <= match!.index).length;
      if (wordCount >= minWords) {
        return text.slice(0, match.index + match[0].length).trim();
      }
    }
    return null;
  }

  private sliceAtPreviewBoundaryWord(
    text: string,
    words: Array<{ value: string; end: number }>,
    minWords: number,
  ): string | null {
    const maxBoundaryWord = Math.min(words.length, DEFAULTS.PREVIEW_TARGET_WORDS + 4);
    for (let i = 1; i < maxBoundaryWord; i++) {
      const word = words[i].value.toLowerCase();
      if (!PREVIEW_BOUNDARY_WORDS.has(word)) continue;

      const end = i >= minWords ? words[i - 1].end : words[i].end;
      const slice = text.slice(0, end).trim();
      if (this.extractEnglishWords(slice).length >= minWords) return slice;
    }
    return null;
  }

  private forceDeliverInterim(timestamp: number): void {
    const text = this.latestInterimText;
    this.latestInterimText = '';
    this.lastFinalTimestamp = Date.now();
    this.firstInterimTimestamp = 0;
    if (!text) return;

    firstScreenLatency.mark('force_delivery_triggered', `chars=${text.length}`);
    const segmentId = this.activePreviewSegmentId ?? this.createSegmentId();
    this.activePreviewSegmentId = segmentId;
    const sentences = this.segmenter.push(text, timestamp, true);
    if (sentences.length === 0) {
      const remaining = this.segmenter.flush();
      if (remaining) sentences.push(remaining);
    }
    this.enqueueSentences(sentences, 'preview', segmentId);
  }

  /** 刷新缓冲，翻译剩余未交付的文本 */
  private enqueueSentences(
    sentences: string[],
    phase: TranslationPhase,
    firstSegmentId?: string,
  ): void {
    if (sentences.length === 0) return;
    firstScreenLatency.mark('segment_output', `phase=${phase} count=${sentences.length}`);

    sentences.forEach((sentence, index) => {
      const segmentId = index === 0 && firstSegmentId ? firstSegmentId : this.createSegmentId();
      this.enqueueTranslation({ text: sentence, segmentId, phase });
    });
  }

  private notifyFinalSentences(sentences: string[]): void {
    if (!this.onFinalSentences || sentences.length === 0) return;
    try {
      this.onFinalSentences([...sentences]);
    } catch (error) {
      console.warn('[channel2] feedSentences failed', error);
    }
  }

  private enqueueTranslation(job: TranslationJob): void {
    if (!this.active || !this.isTranslatable(job.text)) return;

    if (job.phase === 'final') {
      this.supersededPreviewSegments.add(job.segmentId);
      this.translationQueue = this.translationQueue.filter(
        (queued) => queued.phase !== 'preview' || queued.segmentId !== job.segmentId,
      );
    } else {
      this.translationQueue = this.translationQueue.filter(
        (queued) => queued.phase !== 'preview' || queued.segmentId !== job.segmentId,
      );
    }

    this.translationQueue.push(job);
    this.runTranslationQueue().catch((e) => this.handleError(e));
  }

  private async runTranslationQueue(): Promise<void> {
    if (this.translating) return;

    this.translating = true;
    try {
      while (this.active && this.translationQueue.length > 0) {
        const job = this.translationQueue.shift()!;
        if (job.phase === 'preview' && this.supersededPreviewSegments.has(job.segmentId)) {
          continue;
        }
        await this.translateSentence(job);
      }
    } finally {
      this.translating = false;
    }
  }

  private async waitForTranslationIdle(): Promise<void> {
    while (this.active && (this.translating || this.translationQueue.length > 0)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  private createSegmentId(): string {
    this.nextSegmentIndex += 1;
    return `seg-${this.nextSegmentIndex}`;
  }

  async flush(): Promise<void> {
    const remaining = this.segmenter.flush();
    if (remaining && this.active) {
      this.enqueueTranslation({
        text: remaining,
        segmentId: this.createSegmentId(),
        phase: 'final',
      });
    }
    await this.waitForTranslationIdle();
  }

  // ---- 内部 ----

  /** 翻译单个句子，流式产出结果并通知回调 */
  private async translateSentence(job: TranslationJob): Promise<void> {
    const { text, segmentId, phase } = job;
    /** 输入校验——过滤空输入和噪音文本，避免 LLM 返回占位/拒绝响应 */
    if (!this.isTranslatable(text)) return;

    const request = this.buildTranslationRequest(text, phase);
    let finalResult: TranslationResult | null = null;
    if (phase === 'preview') {
      firstScreenLatency.mark('preview_translate_start', `chars=${text.length}`);
    }
    firstScreenLatency.mark('llm_request_start', `phase=${phase} chars=${text.length}`);

    let isFirstToken = true;
    try {
      for await (const result of this.llm.translate(request)) {
        if (phase === 'preview' && this.supersededPreviewSegments.has(segmentId)) break;
        /** stop() 后立即停止流式消费——配合 AbortController abort 作为二次防御 */
        if (!this.active) break;
        /** 首个流式 token 携带原文文本，供字幕层展示英文（修复 B3：译文条目丢失 original 字段） */
        const enriched: TranslationResult = {
          ...result,
          originalText: text,
          segmentId,
          phase,
        };
        if (isFirstToken && (result.tokens.length > 0 || result.translation.length > 0)) {
          firstScreenLatency.mark('first_llm_token', `phase=${phase}`);
        }
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

    if (phase === 'final') {
      this.translatedSentences.push({
      index: tokenIndex,
      original: text,
      translation: finalResult.translation,
    });

    /** 限制历史长度，防止上下文窗口膨胀 */
      if (this.translatedSentences.length > this.historySize) {
        this.translatedSentences = this.translatedSentences.slice(-this.historySize);
      }
    }

    /** 修正独立通知，与翻译结果区分，字幕层可据此触发修正动画 */
    if (finalResult.corrections.length > 0) {
      const { translation, corrections } = finalResult;
      this.translationCallbacks.forEach((cb) =>
        cb({ translation, corrections, tokens: [], originalText: text, segmentId, phase }),
      );
    }
  }

  /**
   * 判定文本是否值得发送 LLM 翻译
   * 过滤空输入、过短噪音、纯标点/数字——这些输入会导致 LLM 返回占位/拒绝响应
   */
  private isTranslatable(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < MIN_TRANSLATABLE_LENGTH) return false;
    /** 必须包含至少一个英文字母——纯标点/数字/空白不需要翻译 */
    if (!/[a-zA-Z]/.test(trimmed)) return false;
    return true;
  }

  /** 构建翻译请求，注入共享上下文和翻译历史 */
  private buildTranslationRequest(text: string, phase: TranslationPhase): TranslationRequest {
    const context = this.getSharedContext();
    if (phase !== 'preview' && this.hasSharedContext(context)) {
      console.info('[channel1] shared context read', {
        ts: Date.now(),
        domain: context.domain,
        terms: context.activeTerms.size,
        hasSummary: context.recentSummary.trim().length > 0,
        topics: context.topicHistory.length,
      });
    }

    return {
      text,
      context,
      mode: phase,
      previousSentences: phase === 'preview' ? [] : [...this.translatedSentences],
    };
  }

  private hasSharedContext(context: SharedContext): boolean {
    return Boolean(
      context.domain ||
      context.activeTerms.size > 0 ||
      context.recentSummary.trim().length > 0 ||
      context.topicHistory.length > 0,
    );
  }

  /** 统一错误分发 */
  private handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.errorCallbacks.forEach((cb) => cb(err));
  }
}
