/**
 * first-screen-latency.ts 单元测试
 * 覆盖 start/mark 时间记录
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 由于 firstScreenLatency 是单例，需要重置
describe('FirstScreenLatencyTracker', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => { });
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
  });

  it('start 记录起始时间', async () => {
    const { firstScreenLatency } = await import('./first-screen-latency');
    firstScreenLatency.start('test-start');

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[first-screen] [start]'),
    );
  });

  it('mark 首次调用自动设置 startedAt', async () => {
    const { firstScreenLatency } = await import('./first-screen-latency');
    firstScreenLatency.mark('audio_ready');

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[first-screen] [audio_ready]'),
    );
  });

  it('重复 mark 同一标记点幂等', async () => {
    const { firstScreenLatency } = await import('./first-screen-latency');
    firstScreenLatency.mark('first_asr_interim');
    consoleInfoSpy.mockClear();
    firstScreenLatency.mark('first_asr_interim');

    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it('mark 输出包含 details', async () => {
    const { firstScreenLatency } = await import('./first-screen-latency');
    firstScreenLatency.mark('llm_request_start', 'model=deepseek-chat');

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('model=deepseek-chat'),
    );
  });

  it('start 后 mark 输出正确的 elapsed', async () => {
    const { firstScreenLatency } = await import('./first-screen-latency');
    firstScreenLatency.start();
    firstScreenLatency.mark('first_audio_sent');

    const call = consoleInfoSpy.mock.calls[1]?.[0] ?? '';
    expect(call).toContain('[first-screen] [first_audio_sent]');
    expect(call).toContain('+');
  });
});
