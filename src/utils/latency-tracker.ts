/**
 * 延迟追踪器 —— 记录流水线各阶段耗时，供性能调优参考
 *
 * 设计原则：
 * - 通过回调暴露数据，不写入 console.log（符合 CLAUDE.md A.7）
 * - 仅在开发环境启用，生产环境通过 enabled 开关隔离开销
 * - 所有标记点为枚举，无硬编码字符串
 *
 * 用法：
 *   const tracker = new LatencyTracker((summary) => { ... });
 *   tracker.mark('audio_captured');
 *   ...做 ASR...
 *   tracker.mark('asr_result_final');
 *   const ms = tracker.measure('audio_captured', 'asr_result_final');
 *   tracker.reset();  // 新句子开始时调用
 */

/** 流水线延迟标记点 */
export type LatencyMark =
  | 'audio_captured'
  | 'asr_sent'
  | 'asr_result_interim'
  | 'asr_result_final'
  | 'segmenter_output'
  | 'llm_first_token'
  | 'llm_complete'
  | 'subtitle_rendered';

/** 延迟摘要：每个标记点相对于 audio_captured 的累计耗时（毫秒） */
export type LatencySummary = Record<LatencyMark, number>;

/** 延迟报告回调 */
export type LatencyReportCallback = (summary: LatencySummary) => void;

export class LatencyTracker {
  private marks = new Map<LatencyMark, number>();
  private enabled: boolean;

  /** @param onReport 延迟报告回调——调用方决定如何展示（存日志/发分析等） */
  constructor(
    private onReport?: LatencyReportCallback,
    enabled = false,
  ) {
    this.enabled = enabled;
  }

  /** 开启追踪 */
  enable(): void { this.enabled = true; }

  /** 关闭追踪——停止收集，避免性能开销 */
  disable(): void { this.enabled = false; }

  /**
   * 记录一个标记点——当前时间的毫秒时间戳
   * @param point 标记点名称
   */
  mark(point: LatencyMark): void {
    if (!this.enabled) return;
    this.marks.set(point, performance.now());
  }

  /**
   * 计算两个标记点之间的耗时（毫秒）
   * @returns 耗时毫秒数，任一标记点未记录时返回 0
   */
  measure(from: LatencyMark, to: LatencyMark): number {
    const start = this.marks.get(from);
    const end = this.marks.get(to);
    if (start === undefined || end === undefined) return 0;
    return Math.max(0, end - start);
  }

  /**
   * 生成延迟摘要——所有标记点相对于 audio_captured 的累计耗时
   * 通过构造函数注入的回调报告，不在此处做 I/O
   */
  summary(): LatencySummary {
    const origin = this.marks.get('audio_captured') ?? 0;
    const result: Record<string, number> = {};
    for (const [key, ts] of this.marks.entries()) {
      result[key] = Math.max(0, ts - origin);
    }
    return result as LatencySummary;
  }

  /** 报告延迟摘要（若已设置回调） */
  report(): void {
    if (!this.enabled || !this.onReport) return;
    this.onReport(this.summary());
  }

  /** 重置——新句子开始时调用 */
  reset(): void {
    this.marks.clear();
  }
}
