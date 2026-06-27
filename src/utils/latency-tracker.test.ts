/**
 * latency-tracker.ts 单元测试
 * 覆盖标记/测量/摘要/报告/重置
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LatencyTracker } from './latency-tracker';
import type { LatencySummary } from './latency-tracker';

describe('LatencyTracker', () => {
  let timeValue: number;

  beforeEach(() => {
    timeValue = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => timeValue);
  });

  it('禁用时不存储标记', () => {
    const tracker = new LatencyTracker(undefined, false);
    tracker.mark('audio_captured');
    expect(tracker.measure('audio_captured', 'asr_result_final')).toBe(0);
  });

  it('启用后存储标记', () => {
    const tracker = new LatencyTracker(undefined, true);
    tracker.mark('audio_captured');
    timeValue = 1500;
    tracker.mark('asr_result_final');
    expect(tracker.measure('audio_captured', 'asr_result_final')).toBe(500);
  });

  it('measure 在标记缺失时返回 0', () => {
    const tracker = new LatencyTracker(undefined, true);
    tracker.mark('audio_captured');
    expect(tracker.measure('audio_captured', 'llm_complete')).toBe(0);
  });

  it('summary 计算各标记点相对于 audio_captured 的偏移', () => {
    const tracker = new LatencyTracker(undefined, true);
    tracker.mark('audio_captured'); // 1000
    timeValue = 1200;
    tracker.mark('asr_result_final');
    timeValue = 1500;
    tracker.mark('llm_complete');

    const summary = tracker.summary();
    expect(summary['audio_captured']).toBe(0);
    expect(summary['asr_result_final']).toBe(200);
    expect(summary['llm_complete']).toBe(500);
  });

  it('report 在禁用时不调用回调', () => {
    const cb = vi.fn();
    const tracker = new LatencyTracker(cb, false);
    tracker.report();
    expect(cb).not.toHaveBeenCalled();
  });

  it('report 在启用且有回调时调用回调', () => {
    const cb = vi.fn();
    const tracker = new LatencyTracker(cb, true);
    tracker.mark('audio_captured');
    tracker.report();
    expect(cb).toHaveBeenCalledTimes(1);
    const summary: LatencySummary = cb.mock.calls[0][0];
    expect(summary['audio_captured']).toBe(0);
  });

  it('reset 清除所有标记', () => {
    const tracker = new LatencyTracker(undefined, true);
    tracker.mark('audio_captured');
    tracker.reset();
    expect(tracker.measure('audio_captured', 'asr_result_final')).toBe(0);
  });

  it('enable/disable 切换', () => {
    const tracker = new LatencyTracker(undefined, false);
    tracker.mark('audio_captured');
    expect(tracker.measure('audio_captured', 'asr_result_final')).toBe(0);

    tracker.enable();
    timeValue = 1000;
    tracker.mark('audio_captured');
    timeValue = 1500;
    tracker.mark('asr_result_final');
    expect(tracker.measure('audio_captured', 'asr_result_final')).toBe(500);
  });
});
