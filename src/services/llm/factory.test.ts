/**
 * LLM factory.ts 单元测试
 * 覆盖 createLLMProvider 各供应商类型
 */
import { describe, it, expect } from 'vitest';
import { createLLMProvider } from './factory';
import type { LLMConfig } from './types';

describe('createLLMProvider', () => {
  function config(provider: string, overrides: Partial<LLMConfig> = {}): LLMConfig {
    return {
      provider: provider as LLMConfig['provider'],
      credentials: { apiKey: 'sk-test' },
      ...overrides,
    };
  }

  it('deepseek → 使用默认端点和模型', () => {
    const llm = createLLMProvider(config('deepseek'));
    expect(llm.name).toBe('deepseek');
  });

  it('qwen → 使用默认端点和模型', () => {
    const llm = createLLMProvider(config('qwen'));
    expect(llm.name).toBe('qwen');
  });

  it('zhipu → 使用默认端点和模型', () => {
    const llm = createLLMProvider(config('zhipu'));
    expect(llm.name).toBe('zhipu');
  });

  it('custom → 使用传入端点', () => {
    const llm = createLLMProvider(config('custom', {
      endpoint: 'https://my-api.example.com/v1/chat/completions',
      model: 'my-model',
    }));
    expect(llm.name).toBe('custom');
  });

  it('不支持的供应商 → 抛出错误', () => {
    expect(() => createLLMProvider(config('unknown' as any)))
      .toThrow('不支持的 LLM 供应商');
  });
});
