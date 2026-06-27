/**
 * ASR factory.ts 单元测试
 * 覆盖 createASRProvider 各供应商类型
 */
import { describe, it, expect } from 'vitest';
import { createASRProvider } from './factory';
import type { ASRConfig } from './types';

describe('createASRProvider', () => {
  function config(provider: string): ASRConfig {
    return {
      provider: provider as ASRConfig['provider'],
      credentials: { apiKey: 'test' },
    };
  }

  it('iflytek → 返回 IFlyTekASR 实例', () => {
    const asr = createASRProvider(config('iflytek'));
    expect(asr.name).toBe('iflytek');
  });

  it('aliyun → 返回 AliyunASR 实例', () => {
    const asr = createASRProvider(config('aliyun'));
    expect(asr.name).toBe('aliyun');
  });

  it('deepgram → 返回 DeepgramASR 实例', () => {
    const asr = createASRProvider(config('deepgram'));
    expect(asr.name).toBe('deepgram');
  });

  it('custom → 返回 CustomASR 实例', () => {
    const asr = createASRProvider(config('custom'));
    expect(asr.name).toBe('custom');
  });

  it('不支持的供应商 → 抛出错误', () => {
    expect(() => createASRProvider(config('unknown' as any)))
      .toThrow('不支持的 ASR 供应商');
  });
});
