/**
 * OpenAICompatLLM 单元测试
 * 覆盖纯方法：sanitizeTranslation、extractCorrections、isRejectionResponse、
 * cleanOutput、truncateHistory、buildTranslationSystemPrompt、parseAnalysisResponse、validateConfig
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TranslatedSentence, TranslationRequest } from './types';

// 从 openai-compat 导入类（ESM 动态导入）
let OpenAICompatLLM: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./openai-compat');
  OpenAICompatLLM = mod.OpenAICompatLLM;
});

/** 构造测试实例——不依赖真实 API */
function createLLM() {
  return new OpenAICompatLLM('test-provider', 'https://test.api/v1', 'test-model');
}

// ---- sanitizeTranslation ----

describe('sanitizeTranslation', () => {
  it('纯中文文本通过', () => {
    const llm = createLLM();
    expect(llm.sanitizeTranslation('你好世界')).toBe('你好世界');
  });

  it('CJK 字符占比 < 10% → 返回空字符串', () => {
    const llm = createLLM();
    expect(llm.sanitizeTranslation('Hello world')).toBe('');
  });

  it('中文前有英文前缀 → 裁剪到首个中文字符', () => {
    const llm = createLLM();
    expect(llm.sanitizeTranslation('Translation: 你好')).toBe('你好');
  });

  it('包含拒绝模式 → 返回空字符串', () => {
    const llm = createLLM();
    expect(llm.sanitizeTranslation('你好，请提供需要翻译的英语文本')).toBe('');
  });

  it('空字符串 → 返回空字符串', () => {
    const llm = createLLM();
    expect(llm.sanitizeTranslation('')).toBe('');
  });

  it('仅空白 → 返回空字符串', () => {
    const llm = createLLM();
    expect(llm.sanitizeTranslation('   \n  ')).toBe('');
  });

  it('中文含数字 → CJK 占比仍然足够', () => {
    const llm = createLLM();
    const result = llm.sanitizeTranslation('第123页');
    expect(result).toBe('第123页');
  });

  it('翻译结果为正常中文 + 英文缩写 → 通过', () => {
    const llm = createLLM();
    const result = llm.sanitizeTranslation('我们使用API接口');
    expect(result).toBe('我们使用API接口');
  });
});

// ---- isRejectionResponse ----

describe('isRejectionResponse', () => {
  it('所有拒绝模式均检测到', () => {
    const rejections = [
      '请提供需要翻译的英语',
      '请提供需要翻译的文本',
      '抱歉，我无法翻译',
      'Please provide text',
      'Please provide the text',
    ];
    for (const r of rejections) {
      expect(OpenAICompatLLM.isRejectionResponse(r)).toBe(true);
    }
  });

  it('正常中文文本 → false', () => {
    expect(OpenAICompatLLM.isRejectionResponse('这是正常的翻译结果')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(OpenAICompatLLM.isRejectionResponse('')).toBe(false);
  });
});

// ---- extractCorrections ----

describe('extractCorrections', () => {
  it('有修正标记 → 解析为 Correction 数组', () => {
    const llm = createLLM();
    const raw = '你好世界【修正】[{"sentenceIndex":0,"oldTranslation":"旧译","newTranslation":"新译","reason":"原因"}]';
    const corrections = llm.extractCorrections(raw);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].sentenceIndex).toBe(0);
    expect(corrections[0].newTranslation).toBe('新译');
  });

  it('无修正标记 → 返回空数组', () => {
    const llm = createLLM();
    expect(llm.extractCorrections('你好世界')).toEqual([]);
  });

  it('修正标记后跟无效 JSON → 返回空数组', () => {
    const llm = createLLM();
    expect(llm.extractCorrections('你好世界【修正】invalid')).toEqual([]);
  });

  it('多个修正条目 → 全部解析', () => {
    const llm = createLLM();
    const raw = 'text【修正】[{"sentenceIndex":0,"oldTranslation":"a","newTranslation":"b","reason":"r"},{"sentenceIndex":1,"oldTranslation":"c","newTranslation":"d","reason":"r2"}]';
    const corrections = llm.extractCorrections(raw);
    expect(corrections).toHaveLength(2);
  });
});

// ---- cleanOutput ----

describe('cleanOutput', () => {
  it('移除修正标记文本', () => {
    const llm = createLLM();
    const result = llm.cleanOutput('你好世界【修正】[{"sentenceIndex":0}]');
    expect(result).toBe('你好世界');
  });

  it('正常翻译 → 文本不变', () => {
    const llm = createLLM();
    expect(llm.cleanOutput('正常翻译')).toBe('正常翻译');
  });
});

// ---- truncateHistory ----

describe('truncateHistory', () => {
  it('总字符数 ≤ MAX_INPUT_CHARS → 返回完整历史', () => {
    const llm = createLLM();
    const history: TranslatedSentence[] = [
      { index: 0, original: 'Hello', translation: '你好' },
    ];
    const result = llm.truncateHistory(history);
    expect(result).toEqual(history);
  });

  it('总字符数 > MAX_INPUT_CHARS → 截断为首部+尾部', () => {
    const llm = createLLM();
    // 构造超长历史
    const history: TranslatedSentence[] = [];
    for (let i = 0; i < 20; i++) {
      history.push({
        index: i,
        original: 'A'.repeat(200),
        translation: '测'.repeat(200),
      });
    }
    const result = llm.truncateHistory(history);
    // 应 < 完整长度
    expect(result.length).toBeLessThan(history.length);
    // 应至少保留头部和尾部
    expect(result.length).toBeGreaterThan(0);
  });

  it('空历史 → 返回空数组', () => {
    const llm = createLLM();
    expect(llm.truncateHistory([])).toEqual([]);
  });

  it('头部+尾部 ≥ 完整长度时直接返回', () => {
    const llm = createLLM();
    const history: TranslatedSentence[] = [
      { index: 0, original: 'a', translation: 'b' },
      { index: 1, original: 'c', translation: 'd' },
    ];
    const result = llm.truncateHistory(history);
    expect(result).toEqual(history);
  });
});

// ---- buildTranslationSystemPrompt ----

describe('buildTranslationSystemPrompt', () => {
  it('preview 模式 → 简短提示词', () => {
    const llm = createLLM();
    const request: TranslationRequest = {
      text: 'Hello',
      context: { domain: null, domainConfidence: 0, activeTerms: new Map(), recentSummary: '', topicHistory: [] },
      previousSentences: [],
      mode: 'preview',
    };
    const prompt = llm.buildTranslationSystemPrompt(request);
    expect(prompt).toContain('real-time');
    expect(prompt).toContain('subtitle translator');
  });

  it('final 模式含领域 → 提示词包含领域信息', () => {
    const llm = createLLM();
    const request: TranslationRequest = {
      text: 'Hello',
      context: {
        domain: '人工智能',
        domainConfidence: 0.95,
        activeTerms: new Map(),
        recentSummary: '',
        topicHistory: [],
      },
      previousSentences: [],
      mode: 'final',
    };
    const prompt = llm.buildTranslationSystemPrompt(request);
    expect(prompt).toContain('人工智能');
    expect(prompt).toContain('置信度');
  });

  it('final 模式含术语 → 提示词包含术语映射', () => {
    const llm = createLLM();
    const request: TranslationRequest = {
      text: 'Hello',
      context: {
        domain: null,
        domainConfidence: 0,
        activeTerms: new Map([['API', '接口']]),
        recentSummary: '',
        topicHistory: [],
      },
      previousSentences: [],
      mode: 'final',
    };
    const prompt = llm.buildTranslationSystemPrompt(request);
    expect(prompt).toContain('API');
    expect(prompt).toContain('接口');
  });

  it('含前文翻译 → 提示词包含前文记录', () => {
    const llm = createLLM();
    const request: TranslationRequest = {
      text: 'Hello',
      context: {
        domain: null, domainConfidence: 0,
        activeTerms: new Map(), recentSummary: '', topicHistory: [],
      },
      previousSentences: [
        { index: 0, original: 'Hi', translation: '你好' },
      ],
      mode: 'final',
    };
    const prompt = llm.buildTranslationSystemPrompt(request);
    expect(prompt).toContain('Hi');
    expect(prompt).toContain('你好');
    expect(prompt).toContain('修正');
  });
});

// ---- parseAnalysisResponse ----

describe('parseAnalysisResponse', () => {
  it('正常 JSON → 返回 AnalysisResult', async () => {
    const llm = createLLM();
    const mockResponse = {
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ domain: { name: '技术', confidence: 0.9 }, summary: '讨论', topicShift: false, terms: [] }) } }],
      }),
    };
    const result = await llm.parseAnalysisResponse(mockResponse);
    expect(result.domain).toEqual({ name: '技术', confidence: 0.9 });
  });

  it('无效 JSON → 返回安全默认值', async () => {
    const llm = createLLM();
    const mockResponse = {
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'not json' } }],
      }),
    };
    const result = await llm.parseAnalysisResponse(mockResponse);
    expect(result).toEqual({ domain: null, terms: [], summary: '', topicShift: false });
  });

  it('缺失 choices → 返回默认值', async () => {
    const llm = createLLM();
    const mockResponse = {
      json: vi.fn().mockResolvedValue({}),
    };
    const result = await llm.parseAnalysisResponse(mockResponse);
    expect(result.domain).toBeNull();
    expect(result.terms).toEqual([]);
  });
});

// ---- validateConfig ----

describe('validateConfig', () => {
  it('apiKey 存在 → 通过', async () => {
    const llm = createLLM();
    await expect(llm.configure({
      provider: 'test',
      credentials: { apiKey: 'sk-test' },
    })).resolves.not.toThrow();
  });

  it('apiKey 缺失 → 抛出错误', async () => {
    const llm = createLLM();
    await expect(llm.configure({
      provider: 'test',
      credentials: {} as any,
    })).rejects.toThrow('缺少 apiKey');
  });
});
