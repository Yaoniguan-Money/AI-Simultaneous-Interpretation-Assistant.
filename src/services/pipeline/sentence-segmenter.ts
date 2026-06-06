/**
 * 语义分句器 —— 将 ASR 片段流切分为完整句子
 * 不依赖简单静音时长，结合标点、语义边界词和最大缓冲时长的多策略切分
 */

/** 分句器配置 */
export interface SegmenterConfig {
  /** 静音间隔阈值（毫秒），超过此值判定为句边界候选 */
  pauseThresholdMs?: number;
  /** 最大缓冲时长（毫秒），超过此值强制交付 */
  maxBufferMs?: number;
  /** 句末标点 */
  sentenceEndMarkers?: ReadonlySet<string>;
  /** 话题转换信号词（通常出现在新句开头） */
  topicShiftWords?: ReadonlySet<string>;
}

/** 默认配置 */
const DEFAULTS = {
  /** 静音间隔阈值（毫秒）——300ms 覆盖英语常见句间停顿，平衡分句及时性与完整性 */
  PAUSE_MS: 300,
  /** 最大缓冲时长（毫秒）——1.5s 强制交付，防止无停顿长句阻塞流水线 */
  MAX_BUFFER_MS: 1500,
} as const;

/** 默认句末标点 */
const DEFAULT_END_MARKERS: ReadonlySet<string> = new Set(['.', '!', '?', '。', '！', '？']);

/** 默认话题转换信号词 */
const DEFAULT_TOPIC_SHIFT: ReadonlySet<string> = new Set([
  'So', 'Now', 'That', 'And then', 'But', 'However',
  'Anyway', 'Next', 'First', 'Finally', 'OK', 'Alright',
]);

/** 缓冲片段 */
interface BufferSegment {
  text: string;
  timestamp: number; // 最后更新时间
}

/**
 * 语义分句器
 * 用法：每次收到 ASR 片段调用 push()，返回本次产出的完整句子数组
 */
export class SentenceSegmenter {
  private readonly config: Required<SegmenterConfig>;
  private buffer: BufferSegment[] = [];
  private lastTimestamp = 0;

  constructor(config: SegmenterConfig = {}) {
    this.config = {
      pauseThresholdMs: config.pauseThresholdMs ?? DEFAULTS.PAUSE_MS,
      maxBufferMs: config.maxBufferMs ?? DEFAULTS.MAX_BUFFER_MS,
      sentenceEndMarkers: config.sentenceEndMarkers ?? DEFAULT_END_MARKERS,
      topicShiftWords: config.topicShiftWords ?? DEFAULT_TOPIC_SHIFT,
    };
  }

  /**
   * 推送 ASR 片段，返回本次产出的完整句子
   * @param text ASR 识别的文本片段
   * @param timestamp 音频时间戳（毫秒），用于检测静音间隔和最大缓冲
   * @param isFinal 是否为 ASR 确认结果（非 interim）
   */
  push(text: string, timestamp: number, isFinal: boolean): string[] {
    if (!text || text.trim().length === 0) return [];

    const results: string[] = [];

    /** 检测静音间隔，超过阈值则先清空缓冲 */
    const gap = this.lastTimestamp > 0 ? timestamp - this.lastTimestamp : 0;
    if (gap > this.config.pauseThresholdMs && this.buffer.length > 0) {
      const sentence = this.drainBuffer();
      if (sentence) results.push(sentence);
    }

    /** 检测最大缓冲时长，超时强制交付 */
    if (this.buffer.length > 0) {
      const oldest = this.buffer[0].timestamp;
      if (timestamp - oldest > this.config.maxBufferMs) {
        const sentence = this.drainBuffer();
        if (sentence) results.push(sentence);
      }
    }

    this.lastTimestamp = timestamp;

    /** 更新缓冲：仅 final 结果追加到缓冲参与切句，interim 废弃 */
    if (isFinal) {
      this.buffer.push({ text, timestamp });
    }
    // interim 结果不参与切句——ASR 的 interim 文本不稳定会频繁变化
    // 只等 final 到来时才触发分句逻辑

    /** 切句：扫描缓冲找句末标点或话题转换词 */
    const combined = this.buffer.map((s) => s.text).join(' ');
    const sentences = this.splitSentences(combined);
    if (sentences.length > 1) {
      // 有切分结果，最后的未完成部分留在缓冲
      const complete = sentences.slice(0, -1);
      results.push(...complete.map((s) => s.trim()).filter(Boolean));
      this.buffer = [{ text: sentences[sentences.length - 1], timestamp }];
    }

    return results;
  }

  /** 强制清空缓冲，返回剩余文本 */
  flush(): string {
    const result = this.drainBuffer();
    this.reset();
    return result;
  }

  /** 重置状态 */
  reset(): void {
    this.buffer = [];
    this.lastTimestamp = 0;
  }

  /** 排空缓冲并拼接为一条文本 */
  private drainBuffer(): string {
    if (this.buffer.length === 0) return '';
    const combined = this.buffer.map((s) => s.text).join(' ').trim();
    this.buffer = [];
    return combined;
  }

  /**
   * 按句末标点和话题转换词切分文本
   * 返回的数组长度 > 1 表示有切分发生，最后一项为未完成部分
   */
  private splitSentences(text: string): string[] {
    const { sentenceEndMarkers, topicShiftWords } = this.config;
    const result: string[] = [];
    let current = '';

    /** 按单词遍历，遇到标记时切分 */
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      current += (current ? ' ' : '') + word;

      /** 检测句末标点 */
      const lastChar = word.slice(-1);
      if (sentenceEndMarkers.has(lastChar)) {
        result.push(current);
        current = '';
        continue;
      }

      /** 检测话题转换词（新句开头） */
      if (topicShiftWords.has(word) && current.startsWith(word)) {
        if (result.length > 0 || i > 0) {
          // 前面的内容作为一个句子
          const prev = current.slice(0, -word.length).trim();
          if (prev) {
            result.push(prev);
          }
          current = word;
        }
      }
    }

    if (current.trim()) {
      result.push(current.trim());
    }

    return result.length > 0 ? result : [text];
  }
}
