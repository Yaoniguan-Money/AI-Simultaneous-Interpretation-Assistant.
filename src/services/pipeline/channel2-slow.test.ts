/**
 * Channel2Analyzer 单元测试
 * 覆盖启动/停止、feedSentences 阈值触发、防并发锁、forceAnalyze、回调分发
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let Channel2Analyzer: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./channel2-slow');
  Channel2Analyzer = mod.Channel2Analyzer;
});

function createMockLLM() {
  return {
    name: 'mock-llm',
    configure: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn(),
    analyze: vi.fn().mockResolvedValue({
      domain: { name: '技术', confidence: 0.9 },
      terms: [{ original: 'API', translation: '接口' }],
      summary: '讨论了技术架构',
      topicShift: false,
    }),
    generateMinutes: vi.fn(),
    dispose: vi.fn(),
    validateCredentials: vi.fn().mockResolvedValue(true),
  };
}

describe('Channel2Analyzer', () => {
  describe('start/stop', () => {
    it('start 后 active', () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm);
      a.start();
      // feedSentences 可以处理
      a.feedSentences(['Hello']);
    });

    it('stop 后 feedSentences 忽略输入', () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm);
      a.start();
      a.stop();
      a.feedSentences(['Hello']);
      // LLM.analyze 不应被调用
      expect(llm.analyze).not.toHaveBeenCalled();
    });

    it('stop 清空状态', () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm);
      a.start();
      a.feedSentences(['A', 'B']);
      a.stop();
      a.start();
      a.feedSentences(['C']);
      // 累积计数已重置
    });
  });

  describe('feedSentences', () => {
    it('未达阈值 → 累积不触发分析', async () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm, { sentenceThreshold: 5 });
      a.start();
      a.feedSentences(['A', 'B']);
      // 分析不应被触发
      await new Promise((r) => setTimeout(r, 50));
      expect(llm.analyze).not.toHaveBeenCalled();
    });

    it('达到阈值 → 触发 LLM.analyze', async () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm, { sentenceThreshold: 3 });
      a.start();
      a.feedSentences(['A', 'B', 'C']);
      // 分析被触发（异步）
      await new Promise((r) => setTimeout(r, 100));
      expect(llm.analyze).toHaveBeenCalled();
    });

    it('空数组不处理', () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm);
      a.start();
      a.feedSentences([]);
      // 不崩溃
    });

    it('非活跃状态忽略', () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm, { sentenceThreshold: 1 });
      // 未 start
      a.feedSentences(['A']);
      expect(llm.analyze).not.toHaveBeenCalled();
    });
  });

  describe('回调', () => {
    it('onAnalysis 注册并返回取消函数', () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm);
      const cb = vi.fn();
      const unsub = a.onAnalysis(cb);
      expect(unsub).toBeInstanceOf(Function);
    });

    it('onError 注册', () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm);
      const cb = vi.fn();
      a.onError(cb);
    });

    it('分析完成后回调被调用', async () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm, { sentenceThreshold: 2 });
      const cb = vi.fn();
      a.onAnalysis(cb);
      a.start();
      a.feedSentences(['A', 'B']);
      await new Promise((r) => setTimeout(r, 100));
      expect(cb).toHaveBeenCalled();
      const result = cb.mock.calls[0][0];
      expect(result.domain.name).toBe('技术');
    });
  });

  describe('forceAnalyze', () => {
    it('句子为空时直接返回', async () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm);
      a.start();
      await a.forceAnalyze();
      expect(llm.analyze).not.toHaveBeenCalled();
    });

    it('忽略阈值强制触发分析', async () => {
      const llm = createMockLLM();
      const a = new Channel2Analyzer(llm, { sentenceThreshold: 99 });
      a.start();
      a.feedSentences(['A']);
      await a.forceAnalyze();
      expect(llm.analyze).toHaveBeenCalled();
    });
  });

  describe('防并发', () => {
    it('分析进行中再次触发被跳过', async () => {
      const llm = createMockLLM();
      // 模拟长时间分析
      let resolveAnalyze: any;
      llm.analyze.mockReturnValue(new Promise((r) => { resolveAnalyze = r; }));

      const a = new Channel2Analyzer(llm, { sentenceThreshold: 2 });
      a.start();
      a.feedSentences(['A', 'B']); // 触发分析，分析中...

      // 再次喂入，达到阈值
      a.feedSentences(['C', 'D']); // 应跳过（analyzing=true）

      // 完成第一次分析
      resolveAnalyze({ domain: null, terms: [], summary: '', topicShift: false });
      await new Promise((r) => setTimeout(r, 50));

      // 只调用了一次
      expect(llm.analyze).toHaveBeenCalledTimes(1);
    });
  });
});
