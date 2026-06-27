/**
 * SentenceSegmenter 单元测试
 * 覆盖多策略分句：标点、静音间隔、话题转换词、最大缓冲、首段特殊处理
 */
import { describe, it, expect } from 'vitest';
import { SentenceSegmenter } from './sentence-segmenter';

describe('SentenceSegmenter', () => {
  // ---- 构造 ----

  describe('构造', () => {
    it('默认配置创建', () => {
      const seg = new SentenceSegmenter();
      const results = seg.push('Hello.', 1000, true);
      // 仅一句 → 留在 buffer，无输出
      expect(results).toEqual([]);
      expect(seg.flush()).toBe('Hello.');
    });

    it('自定义 pauseThresholdMs 覆盖默认值', () => {
      const seg = new SentenceSegmenter({ pauseThresholdMs: 500 });
      seg.push('Hello.', 1000, true);
      // gap = 600ms > 500ms 自定阈值 → 静音分句排空 buffer
      const results = seg.push('World.', 1600, true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toContain('Hello');
    });
  });

  // ---- 标点分句 ----

  describe('标点分句', () => {
    it('单句含英文句号 → 留在缓冲，不输出', () => {
      const seg = new SentenceSegmenter();
      const results = seg.push('Hello world.', 1000, true);
      expect(results).toEqual([]);
    });

    it('两句（通过标点）→ 第一句输出，第二句留缓冲', () => {
      const seg = new SentenceSegmenter();
      const results = seg.push('First sentence. Second sentence.', 1000, true);
      // splitSentences 将 text 切为 ["First sentence.", "Second sentence."]
      // 最后一段留在 buffer，其余输出
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('First sentence.');
      // 第二句留在 buffer
      expect(seg.flush()).toBe('Second sentence.');
    });

    it('问号和感叹号切分', () => {
      const seg = new SentenceSegmenter();
      const results = seg.push('Hello! How are you?', 1000, true);
      // splitSentences → ["Hello!", "How are you?"]
      // 最后一段留 buffer
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('Hello!');
      expect(seg.flush()).toBe('How are you?');
    });

    it('三个句子 → 前两个输出，第三个留缓冲', () => {
      const seg = new SentenceSegmenter();
      const results = seg.push('One. Two. Three.', 1000, true);
      expect(results).toHaveLength(2);
      expect(results[0]).toBe('One.');
      expect(results[1]).toBe('Two.');
      expect(seg.flush()).toBe('Three.');
    });

    it('无标点文本 → splitSentences 返回原文本，不切分', () => {
      const seg = new SentenceSegmenter();
      const results = seg.push('This is a long sentence without punctuation', 1000, true);
      // splitSentences 无法切分（无标点），返回 [text]
      // sentences.length = 1，不满足 > 1
      // 但首段特殊处理可能在文本 >= 28 字符时触发
      // "This is a long sentence without punctuation" = 49 chars >= 28 → 触发首段排空
      // 未触发前留在 buffer
      // 实际上：firstSegmentMinChars=28 默认，49 chars >= 28 → 排空输出
      expect(results.length).toBe(1);
      expect(results[0]).toBe('This is a long sentence without punctuation');
    });
  });

  // ---- 静音间隔分句 ----

  describe('静音间隔分句', () => {
    it('间隔超过阈值 → 清空缓冲并输出', () => {
      const seg = new SentenceSegmenter({ pauseThresholdMs: 800 });
      seg.push('Hello', 1000, true);
      // gap = 900ms > 800ms → 静音分句
      const results = seg.push('world.', 1900, true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toContain('Hello');
    });

    it('间隔未超过阈值 → 继续缓冲', () => {
      const seg = new SentenceSegmenter({ pauseThresholdMs: 800 });
      seg.push('Hello', 1000, true);
      // gap = 500ms < 800ms 阈值 → 不触发静音分句，继续缓冲
      const results = seg.push('world.', 1500, true);
      expect(results).toEqual([]);
      // 两段拼接在 buffer 中
      expect(seg.flush()).toBe('Hello world.');
    });
  });

  // ---- 最大缓冲时 ----

  describe('最大缓冲时长', () => {
    it('缓冲超过 maxBufferMs → 强制交付', () => {
      const seg = new SentenceSegmenter({ maxBufferMs: 4000 });
      seg.push('No punctuation here', 1000, true);
      // 时间前进超过 4000ms → 强制排空
      const results = seg.push('more text', 5100, true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('缓冲未超时不强制交付', () => {
      // 使用大 pauseThresholdMs 避免静音间隔误触发
      const seg = new SentenceSegmenter({ maxBufferMs: 4000, pauseThresholdMs: 99999 });
      seg.push('Short', 1000, true);
      // 时间仅前进 400ms → 未超时 + 静音未超阈值
      const results = seg.push('text', 1400, true);
      // 无标点、静音未超阈值、buffer 未超时 → 不出句
      // Short text = 10 chars < 28 (firstSegmentMinChars), 1400ms < 2500ms
      expect(results).toEqual([]);
      expect(seg.flush()).toBe('Short text');
    });
  });

  // ---- Interim 处理 ----

  describe('Interim 交互', () => {
    it('interim 结果不追加到缓冲区', () => {
      const seg = new SentenceSegmenter();
      seg.push('Hel', 1000, false); // interim
      expect(seg.flush()).toBe(''); // 缓冲为空
    });

    it('interim 后跟 final → final 追加到缓冲', () => {
      const seg = new SentenceSegmenter();
      seg.push('Hel', 1000, false); // interim，不缓冲
      seg.push('Hello world.', 1500, true); // final，缓冲
      expect(seg.flush()).toBe('Hello world.');
    });

    it('仅 interim → 无输出', () => {
      const seg = new SentenceSegmenter();
      const results = seg.push('Partial text', 1000, false);
      expect(results).toEqual([]);
    });
  });

  // ---- flush ----

  describe('flush', () => {
    it('缓冲有文本时 flush 返回全部', () => {
      const seg = new SentenceSegmenter();
      seg.push('Unfinished sentence', 1000, true);
      const result = seg.flush();
      expect(result).toBe('Unfinished sentence');
    });

    it('空缓冲 flush 返回空字符串', () => {
      const seg = new SentenceSegmenter();
      expect(seg.flush()).toBe('');
    });

    it('flush 后缓冲清空', () => {
      const seg = new SentenceSegmenter();
      seg.push('Text', 1000, true);
      seg.flush();
      expect(seg.flush()).toBe('');
    });
  });

  // ---- reset ----

  describe('reset', () => {
    it('重置后状态归零', () => {
      const seg = new SentenceSegmenter();
      seg.push('Some text.', 1000, true);
      seg.reset();
      expect(seg.flush()).toBe('');
    });

    it('重置后可重新使用', () => {
      const seg = new SentenceSegmenter();
      seg.push('First.', 1000, true);
      seg.reset();
      seg.push('Second.', 1500, true);
      expect(seg.flush()).toBe('Second.');
    });
  });

  // ---- 首段特殊处理 ----

  describe('首段特殊处理', () => {
    it('首段达到 firstSegmentMinChars → 排空缓冲', () => {
      const seg = new SentenceSegmenter({ firstSegmentMinChars: 10, firstSegmentMaxMs: 999999 });
      const longText = 'A'.repeat(11);
      const result = seg.push(longText, 1000, true);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(longText);
    });

    it('首段未达 firstSegmentMinChars → 留缓冲', () => {
      const seg = new SentenceSegmenter({ firstSegmentMinChars: 50, firstSegmentMaxMs: 999999 });
      const result = seg.push('Short text', 1000, true);
      // 11 chars < 50 → 不触发 firstSegmentMinChars
      expect(result).toEqual([]);
    });
  });

  // ---- 边界 ----

  describe('边界情况', () => {
    it('空字符串 → 返回空数组', () => {
      const seg = new SentenceSegmenter();
      expect(seg.push('', 1000, true)).toEqual([]);
    });

    it('仅空白文本 → 返回空数组', () => {
      const seg = new SentenceSegmenter();
      expect(seg.push('   ', 1000, true)).toEqual([]);
    });

    it('多次调用 push 渐进形成句子', () => {
      const seg = new SentenceSegmenter({ pauseThresholdMs: 800 });
      seg.push('The', 1000, true);
      seg.push('quick', 1100, true);
      seg.push('fox.', 1200, true);
      const result = seg.flush();
      expect(result).toBe('The quick fox.');
    });
  });
});
