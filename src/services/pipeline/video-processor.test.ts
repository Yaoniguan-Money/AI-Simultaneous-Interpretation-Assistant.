/**
 * video-processor.ts 单元测试
 * 覆盖 formatTimestamp 和 formatSRT（纯函数）
 */
import { describe, it, expect } from 'vitest';
import { VideoProcessor } from './video-processor';
import type { SRTEntry } from './video-processor';

// ---- formatTimestamp ----
// 注：formatTimestamp 是模块私有函数，通过 formatSRT 间接测试

describe('VideoProcessor.formatSRT', () => {
  it('空数组返回空字符串', () => {
    expect(VideoProcessor.formatSRT([])).toBe('');
  });

  it('单个条目格式化', () => {
    const entries: SRTEntry[] = [
      { index: 1, startMs: 0, endMs: 2000, text: 'Hello' },
    ];
    const result = VideoProcessor.formatSRT(entries);

    expect(result).toContain('1');
    expect(result).toContain('00:00:00,000 --> 00:00:02,000');
    expect(result).toContain('Hello');
  });

  it('多个条目按序号排列', () => {
    const entries: SRTEntry[] = [
      { index: 1, startMs: 0, endMs: 2000, text: 'First' },
      { index: 2, startMs: 2000, endMs: 4000, text: 'Second' },
    ];
    const result = VideoProcessor.formatSRT(entries);

    const lines = result.split('\n');
    expect(lines[0]).toBe('1');
    expect(lines[1]).toContain('00:00:00,000 --> 00:00:02,000');
    expect(lines[2]).toBe('First');
    expect(lines[3]).toBe(''); // 空行分隔
    expect(lines[4]).toBe('2');
    expect(lines[5]).toContain('00:00:02,000 --> 00:00:04,000');
    expect(lines[6]).toBe('Second');
  });

  it('小时级时间戳', () => {
    const entries: SRTEntry[] = [
      { index: 1, startMs: 3661000, endMs: 3665000, text: 'Long' },
    ];
    const result = VideoProcessor.formatSRT(entries);

    expect(result).toContain('01:01:01,000 --> 01:01:05,000');
  });

  it('分钟和秒正确进位', () => {
    const entries: SRTEntry[] = [
      { index: 1, startMs: 61000, endMs: 125000, text: 'Test' },
    ];
    const result = VideoProcessor.formatSRT(entries);

    // 61000ms = 1分1秒0毫秒
    // 125000ms = 2分5秒0毫秒
    expect(result).toContain('00:01:01,000 --> 00:02:05,000');
  });

  it('毫秒部分正确填充至 3 位', () => {
    const entries: SRTEntry[] = [
      { index: 1, startMs: 5, endMs: 42, text: 'ms' },
    ];
    const result = VideoProcessor.formatSRT(entries);

    expect(result).toContain('00:00:00,005 --> 00:00:00,042');
  });

  it('中文文本正常输出', () => {
    const entries: SRTEntry[] = [
      { index: 1, startMs: 0, endMs: 1000, text: '你好世界' },
    ];
    const result = VideoProcessor.formatSRT(entries);

    expect(result).toContain('你好世界');
  });

  it('文本为空仍生成有效时间轴', () => {
    const entries: SRTEntry[] = [
      { index: 1, startMs: 0, endMs: 1000, text: '' },
    ];
    const result = VideoProcessor.formatSRT(entries);

    expect(result).toContain('00:00:00,000 --> 00:00:01,000');
  });
});
