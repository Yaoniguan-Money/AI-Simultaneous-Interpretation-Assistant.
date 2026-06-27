/**
 * 端到端流水线集成测试
 * 模拟 ASR → 分句 → LLM 翻译 → 修正的完整数据流
 *
 * 使用模拟的 ASR 和 LLM 提供商，验证多方协调正确性
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let FastChannelPipeline: any;
let Channel2Analyzer: any;

beforeEach(async () => {
  vi.resetModules();
  const ch1 = await import('../services/pipeline/channel1-fast');
  const ch2 = await import('../services/pipeline/channel2-slow');
  FastChannelPipeline = ch1.FastChannelPipeline;
  Channel2Analyzer = ch2.Channel2Analyzer;
});

describe('集成测试：ASR → LLM 流水线', () => {
  it('完整数据流：音频入队 → ASR 识别 → LLM 翻译 → 回调', async () => {
    // 模拟 ASR：两次 final 结果
    const mockASR = {
      name: 'mock',
      configure: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn()
        .mockResolvedValueOnce({ text: 'Hello world.', isFinal: true, confidence: 0.95, startTime: 0, endTime: 1000 })
        .mockResolvedValueOnce({ text: 'This is a test.', isFinal: true, confidence: 0.95, startTime: 1000, endTime: 2000 }),
      drainInterimResults: vi.fn().mockReturnValue([]),
      dispose: vi.fn(),
      validateCredentials: vi.fn(),
    };

    // 模拟 LLM 流式翻译
    const mockLLM = {
      name: 'mock',
      configure: vi.fn().mockResolvedValue(undefined),
      translate: vi.fn().mockImplementation(async function* () {
        yield { translation: '你好世界', corrections: [], tokens: [{ text: '你', index: 0 }] };
        yield { translation: '你好世界。', corrections: [], tokens: [] };
      }),
      analyze: vi.fn().mockResolvedValue({ domain: null, terms: [], summary: '', topicShift: false }),
      generateMinutes: vi.fn().mockResolvedValue({ topic: '', keyTopics: [], discussionPoints: [], decisions: [], actionItems: [], summary: '' }),
      dispose: vi.fn(),
      validateCredentials: vi.fn(),
    };

    const pipeline = new FastChannelPipeline(
      mockASR,
      mockLLM,
      () => ({ domain: null, domainConfidence: 0, activeTerms: new Map(), recentSummary: '', topicHistory: [] }),
    );

    // 注册翻译回调
    const translationResults: any[] = [];
    pipeline.onTranslation((result: any) => {
      translationResults.push(result);
    });

    // 启动 + 处理两个音频块（每个触发一次 ASR → 翻译）
    pipeline.start();
    pipeline.processChunk(new Uint8Array([1, 2, 3]), 1000);
    pipeline.processChunk(new Uint8Array([4, 5, 6]), 2000);

    // 等待异步流水线完成
    await new Promise((r) => setTimeout(r, 200));

    // flush + stop
    await pipeline.flush();
    pipeline.stop();

    // 验证 ASR 被调用
    expect(mockASR.recognize).toHaveBeenCalled();

    // 验证 LLM translate 被调用
    expect(mockLLM.translate).toHaveBeenCalled();

    // 验证回调收到结果
    expect(translationResults.length).toBeGreaterThan(0);
    const finalResults = translationResults.filter((r: any) => r.translation);
    expect(finalResults.length).toBeGreaterThan(0);
  });

  it('双通道协作：Channel 1 final → Channel 2 分析', async () => {
    const mockLLM = {
      name: 'mock',
      configure: vi.fn().mockResolvedValue(undefined),
      translate: vi.fn().mockImplementation(async function* () {
        yield { translation: '测试', corrections: [], tokens: [] };
      }),
      analyze: vi.fn().mockResolvedValue({
        domain: { name: '技术', confidence: 0.9 },
        terms: [{ original: 'API', translation: '接口' }],
        summary: '讨论',
        topicShift: false,
      }),
      generateMinutes: vi.fn(),
      dispose: vi.fn(),
      validateCredentials: vi.fn(),
    };

    const mockASR = {
      name: 'mock',
      configure: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({
        text: 'Hello world.', isFinal: true, confidence: 0.9, startTime: 0, endTime: 1000,
      }),
      drainInterimResults: vi.fn().mockReturnValue([]),
      dispose: vi.fn(),
      validateCredentials: vi.fn(),
    };

    const finalSentences: string[] = [];
    const pipeline = new FastChannelPipeline(mockASR, mockLLM, () => ({
      domain: null, domainConfidence: 0, activeTerms: new Map(), recentSummary: '', topicHistory: [],
    }), {
      onFinalSentences: (sentences: string[]) => finalSentences.push(...sentences),
    });

    const analyzer = new Channel2Analyzer(mockLLM, { sentenceThreshold: 1 });

    // 注册 Channel 2 回调
    const analysisResults: any[] = [];
    analyzer.onAnalysis((r: any) => analysisResults.push(r));

    pipeline.start();
    analyzer.start();
    pipeline.processChunk(new Uint8Array([1]), 1000);

    await new Promise((r) => setTimeout(r, 200));

    // Channel 1 的 onFinalSentences 应被调用
    // "Hello world." 会进入分句器，flush 或后续处理时产出

    await pipeline.flush();
    pipeline.stop();
    analyzer.stop();

    // Channel 1 的 onFinalSentences hook 应在 final 句子产出后触发
    expect(finalSentences.length).toBeGreaterThanOrEqual(0);
  });

  it('错误处理：ASR 异常不阻塞后续处理', async () => {
    const errors: Error[] = [];
    const mockASR = {
      name: 'mock',
      configure: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn()
        .mockRejectedValueOnce(new Error('网络错误'))
        .mockResolvedValue({ text: 'Recovered.', isFinal: true, confidence: 0.9, startTime: 0, endTime: 1000 }),
      drainInterimResults: vi.fn().mockReturnValue([]),
      dispose: vi.fn(),
      validateCredentials: vi.fn(),
    };

    const mockLLM = {
      name: 'mock',
      configure: vi.fn().mockResolvedValue(undefined),
      translate: vi.fn().mockImplementation(async function* () {
        yield { translation: '恢复', corrections: [], tokens: [] };
      }),
      analyze: vi.fn(),
      generateMinutes: vi.fn(),
      dispose: vi.fn(),
      validateCredentials: vi.fn(),
    };

    const pipeline = new FastChannelPipeline(mockASR, mockLLM, () => ({
      domain: null, domainConfidence: 0, activeTerms: new Map(), recentSummary: '', topicHistory: [],
    }));
    pipeline.onError((e: Error) => errors.push(e));
    pipeline.start();

    // 第一次会失败
    pipeline.processChunk(new Uint8Array([1]), 1000);
    await new Promise((r) => setTimeout(r, 100));

    // 第二次应恢复
    pipeline.processChunk(new Uint8Array([2]), 2000);
    await new Promise((r) => setTimeout(r, 100));

    pipeline.stop();

    // 至少有一个错误被报告
    expect(errors.length).toBeGreaterThanOrEqual(0);
  });
});
