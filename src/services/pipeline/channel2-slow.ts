import type { AnalysisResult, LLMProvider } from '../llm/types';

/** 分析触发配置 */
export interface AnalyzerConfig {
  /** 累积句子数达到此值时触发分析 */
  sentenceThreshold?: number;
  /** 分析历史保留条数，用于 LLM 上下文 */
  historySize?: number;
}

/** 默认配置 */
const DEFAULTS = {
  /** 每积累 3 句触发一次分析 */
  SENTENCE_THRESHOLD: 3,
  HISTORY_SIZE: 5,
} as const;

/** 分析结果回调 */
export type AnalysisCallback = (result: AnalysisResult) => void;

/** 分析错误回调 */
export type AnalysisErrorCallback = (error: Error) => void;

/**
 * Channel 2 慢通道分析器
 * 异步分析会议内容：领域检测、术语提取、滚动摘要、话题切换判断
 * 通过回调写入 SharedContext，不阻塞 Channel 1
 */
export class Channel2Analyzer {
  private readonly sentenceThreshold: number;
  private readonly historySize: number;
  private sentences: string[] = [];
  private analysisHistory: string[] = [];
  private analysisCallbacks = new Set<AnalysisCallback>();
  private errorCallbacks = new Set<AnalysisErrorCallback>();
  private active = false;
  /** 分析锁：防止并发 LLM.analyze 调用 */
  private analyzing = false;

  constructor(
    private llm: LLMProvider,
    config: AnalyzerConfig = {},
  ) {
    this.sentenceThreshold = config.sentenceThreshold ?? DEFAULTS.SENTENCE_THRESHOLD;
    this.historySize = config.historySize ?? DEFAULTS.HISTORY_SIZE;
  }

  /** 注册分析结果回调，返回取消注册函数 */
  onAnalysis(callback: AnalysisCallback): () => void {
    this.analysisCallbacks.add(callback);
    return () => { this.analysisCallbacks.delete(callback); };
  }

  /** 注册错误回调 */
  onError(callback: AnalysisErrorCallback): () => void {
    this.errorCallbacks.add(callback);
    return () => { this.errorCallbacks.delete(callback); };
  }

  /** 启动分析器 */
  start(): void {
    if (this.active) return;
    this.active = true;
  }

  /** 停止并清空累积状态 */
  stop(): void {
    this.active = false;
    this.sentences = [];
    this.analysisHistory = [];
  }

  /**
   * 喂入 Channel 1 产出的完整句子
   * 当累积句子数达到阈值时自动触发 LLM 分析
   * @param sentences Channel 1 分句后产出的句子数组
   */
  feedSentences(sentences: string[]): void {
    if (!this.active) return;
    if (!sentences || sentences.length === 0) return;

    this.sentences.push(...sentences);

    /** 达到阈值且未在分析中，触发异步分析 */
    if (this.sentences.length >= this.sentenceThreshold && !this.analyzing) {
      console.info('[channel2] slow channel triggered', {
        ts: Date.now(),
        queuedSentences: this.sentences.length,
      });
      this.runAnalysis();
    }
  }

  /** 手动强制触发分析（忽略阈值），用于会话结束前刷新 */
  async forceAnalyze(): Promise<void> {
    if (this.sentences.length === 0) return;
    await this.executeAnalysis();
  }

  // ---- 内部 ----

  /** 触发分析（不 await，异步执行不阻塞调用方） */
  private runAnalysis(): void {
    this.executeAnalysis().catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      console.warn('[channel2] analysis failed', {
        ts: Date.now(),
        message: err.message,
      });
      this.errorCallbacks.forEach((cb) => cb(err));
    });
  }

  /** 执行 LLM 分析并分发结果，同一时间只允许一次分析 */
  private async executeAnalysis(): Promise<void> {
    /** 防并发：已在分析中则跳过 */
    if (this.analyzing) return;
    this.analyzing = true;

    try {
      const sentencesToAnalyze = [...this.sentences];
      // 清空已分析句子，准备下一轮累积
      this.sentences = [];

      const result = await this.llm.analyze(
        sentencesToAnalyze,
        this.analysisHistory,
      );

      console.info('[channel2] analysis completed', {
        ts: Date.now(),
        analyzedSentences: sentencesToAnalyze.length,
        domain: result.domain?.name ?? null,
        terms: result.terms.length,
        hasSummary: result.summary.trim().length > 0,
        topicShift: result.topicShift,
      });

      if (!this.active) return;

      /** 将分析摘要存入历史，用于下一轮的上下文 */
      if (result.summary) {
        this.analysisHistory.push(result.summary);
        if (this.analysisHistory.length > this.historySize) {
          this.analysisHistory = this.analysisHistory.slice(-this.historySize);
        }
      }

      /** 通知所有回调 */
      this.analysisCallbacks.forEach((cb) => cb(result));
    } finally {
      this.analyzing = false;
    }
  }
}
