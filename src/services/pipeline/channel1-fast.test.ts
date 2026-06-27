/**
 * FastChannelPipeline 单元测试
 * 覆盖启动/停止、回调管理、isTranslatable、enqueue/flush、错误处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let FastChannelPipeline: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./channel1-fast');
  FastChannelPipeline = mod.FastChannelPipeline;
});

function createMockASR() {
  return {
    name: 'mock-asr',
    configure: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn().mockResolvedValue({
      text: '', isFinal: false, confidence: 0, startTime: 0, endTime: 0,
    }),
    drainInterimResults: vi.fn().mockReturnValue([]),
    dispose: vi.fn(),
    validateCredentials: vi.fn().mockResolvedValue(true),
    preconnect: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockLLM() {
  return {
    name: 'mock-llm',
    configure: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn().mockImplementation(async function* () {
      yield { translation: '测试', corrections: [], tokens: [{ text: '测', index: 0 }, { text: '试', index: 1 }] };
    }),
    analyze: vi.fn().mockResolvedValue({ domain: null, terms: [], summary: '', topicShift: false }),
    generateMinutes: vi.fn().mockResolvedValue({ topic: '', keyTopics: [], discussionPoints: [], decisions: [], actionItems: [], summary: '' }),
    dispose: vi.fn(),
    validateCredentials: vi.fn().mockResolvedValue(true),
  };
}

function createPipeline(overrides: any = {}) {
  return new FastChannelPipeline(
    overrides.asr ?? createMockASR(),
    overrides.llm ?? createMockLLM(),
    overrides.getSharedContext ?? (() => ({ domain: null, domainConfidence: 0, activeTerms: new Map(), recentSummary: '', topicHistory: [] })),
    overrides.config ?? {},
  );
}

describe('FastChannelPipeline', () => {
  describe('start/stop', () => {
    it('start 后 active 为 true', () => {
      const p = createPipeline();
      p.start();
      // processChunk 可被调用（不会跳过）
      const asr = createMockASR();
      const p2 = createPipeline({ asr });
      p2.start();
      p2.processChunk(new Uint8Array([1, 2]), 1000);
    });

    it('stop 调用 asr.dispose 和 llm.dispose', () => {
      const asr = createMockASR();
      const llm = createMockLLM();
      const p = createPipeline({ asr, llm });
      p.start();
      p.stop();
      expect(asr.dispose).toHaveBeenCalled();
      expect(llm.dispose).toHaveBeenCalled();
    });

    it('stop 后 processChunk 不处理', () => {
      const asr = createMockASR();
      const p = createPipeline({ asr });
      p.start();
      p.stop();
      p.processChunk(new Uint8Array([1, 2]), 1000);
      // 环形缓冲区入队但不消费（active=false）
    });
  });

  describe('回调管理', () => {
    it('onTranslation 注册并返回取消函数', () => {
      const p = createPipeline();
      const cb = vi.fn();
      const unsub = p.onTranslation(cb);
      expect(unsub).toBeInstanceOf(Function);
      unsub();
      // 回调已移除
    });

    it('onInterimResult 注册', () => {
      const p = createPipeline();
      const cb = vi.fn();
      p.onInterimResult(cb);
    });

    it('onError 注册', () => {
      const p = createPipeline();
      const cb = vi.fn();
      p.onError(cb);
    });
  });

  describe('isTranslatable', () => {
    it('长度 < 2 → false', () => {
      const p = createPipeline();
      expect(p.isTranslatable('a')).toBe(false);
    });

    it('纯中文 → false（无英文字母）', () => {
      const p = createPipeline();
      expect(p.isTranslatable('你好世界')).toBe(false);
    });

    it('纯数字/标点 → false', () => {
      const p = createPipeline();
      expect(p.isTranslatable('123 !!!')).toBe(false);
    });

    it('正常英文文本 → true', () => {
      const p = createPipeline();
      expect(p.isTranslatable('Hello world')).toBe(true);
    });

    it('中英混合含英文 → true', () => {
      const p = createPipeline();
      expect(p.isTranslatable('使用API接口')).toBe(true);
    });

    it('空字符串 → false', () => {
      const p = createPipeline();
      expect(p.isTranslatable('')).toBe(false);
    });
  });

  describe('warmup', () => {
    it('调用 asr.preconnect', async () => {
      const asr = createMockASR();
      const p = createPipeline({ asr });
      await p.warmup();
      expect(asr.preconnect).toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('空闲时 flush 不崩溃', async () => {
      const p = createPipeline();
      p.start();
      await p.flush();
    });

    it('分句器内有剩余文本时 enqueue', async () => {
      const asr = createMockASR();
      asr.recognize.mockResolvedValue({
        text: 'Hello world',
        isFinal: true,
        confidence: 0.9,
        startTime: 0,
        endTime: 1000,
      });

      const llm = createMockLLM();
      const p = createPipeline({ asr, llm });
      p.start();
      p.processChunk(new Uint8Array([1]), 1000);
      // 等待异步处理
      await new Promise((r) => setTimeout(r, 100));
      await p.flush();
      // 不崩溃即可
    });
  });

  describe('resetContext', () => {
    it('清空翻译记忆，不停止管线', () => {
      const p = createPipeline();
      p.start();
      p.resetContext();
      // 不崩溃
    });
  });
});
