import type { Correction, TranslatedSentence } from '../llm/types';

/** 修正引擎配置 */
export interface CorrectionConfig {
  /** 上下文窗口大小（保留最近 N 句用于修正检测） */
  windowSize?: number;
  /** 每隔 N 句触发一次修正检查 */
  triggerEvery?: number;
}

/** 默认配置 */
const DEFAULTS = {
  WINDOW_SIZE: 5,
  TRIGGER_EVERY: 3,
} as const;

/** 修正目标——引擎判定需要重新评估的句子 */
export interface CorrectionTarget {
  /** 待修正的句子记录 */
  sentence: TranslatedSentence;
  /** 作为新上下文的后续句子 */
  newContext: TranslatedSentence[];
}

/**
 * 修正引擎
 * 实现上下文滚动修正的触发策略：每 N 句检查最旧一句是否需要修正
 * 维护已修正索引，防止重复触发
 */
export class CorrectionEngine {
  private readonly windowSize: number;
  private readonly triggerEvery: number;
  private history: TranslatedSentence[] = [];
  private sentenceCount = 0;
  /** 已触发过修正检查的 sentenceIndex 集合，防重复 */
  private correctedIndices = new Set<number>();

  constructor(config: CorrectionConfig = {}) {
    this.windowSize = config.windowSize ?? DEFAULTS.WINDOW_SIZE;
    this.triggerEvery = config.triggerEvery ?? DEFAULTS.TRIGGER_EVERY;
  }

  /**
   * 注册一条完成的翻译
   * 返回本次触发的修正目标（如有），未触发则返回 null
   */
  registerTranslation(entry: TranslatedSentence): CorrectionTarget | null {
    this.history.push(entry);
    this.sentenceCount++;

    /** 环形截断历史窗口 */
    if (this.history.length > this.windowSize) {
      this.history = this.history.slice(-this.windowSize);
    }

    /** 触发策略：每 triggerEvery 句检查最早未检查的句子 */
    if (this.sentenceCount % this.triggerEvery !== 0) return null;
    if (this.history.length < 2) return null;

    const target = this.history[0];

    /** 已检查过的不重复触发 */
    if (this.correctedIndices.has(target.index)) return null;

    this.correctedIndices.add(target.index);

    const newContext = this.history.slice(1);
    return { sentence: target, newContext };
  }

  /**
   * 手动触发对指定句子的修正检查
   * 用于 LLM 内联修正标记之外的独立审计
   */
  checkSentence(sentence: TranslatedSentence): CorrectionTarget | null {
    if (this.correctedIndices.has(sentence.index)) return null;
    this.correctedIndices.add(sentence.index);

    const idx = this.history.findIndex((h) => h.index === sentence.index);
    const newContext = idx >= 0 ? this.history.slice(idx + 1) : [];

    return { sentence, newContext };
  }

  /**
   * 处理 LLM 产出的修正，标记已修正避免重复
   * @param corrections LLM 或二次翻译产出的修正列表
   */
  applyCorrections(corrections: Correction[]): void {
    for (const c of corrections) {
      this.correctedIndices.add(c.sentenceIndex);
    }
  }

  /** 重置引擎状态 */
  reset(): void {
    this.history = [];
    this.sentenceCount = 0;
    this.correctedIndices.clear();
  }
}
