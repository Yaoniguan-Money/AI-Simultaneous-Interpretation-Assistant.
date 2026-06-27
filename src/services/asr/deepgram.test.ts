/**
 * DeepgramASR 单元测试
 * 覆盖 configure、recognize、dispose、validateConfig
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let DeepgramASR: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./deepgram');
  DeepgramASR = mod.DeepgramASR;
});

function makeConfig(overrides: Record<string, string> = {}): any {
  return {
    provider: 'deepgram',
    credentials: { apiKey: 'test-key', ...overrides },
  };
}

describe('DeepgramASR', () => {
  let asr: any;

  beforeEach(() => {
    asr = new DeepgramASR();
  });

  describe('configure', () => {
    it('apiKey 有效 → 配置成功', async () => {
      await expect(asr.configure(makeConfig())).resolves.not.toThrow();
    });

    it('缺少 apiKey → 抛出错误', async () => {
      await expect(asr.configure(makeConfig({ apiKey: '' })))
        .rejects.toThrow('缺少 apiKey');
    });
  });

  describe('recognize', () => {
    it('空音频 → 返回空结果', async () => {
      await asr.configure(makeConfig());
      const result = await asr.recognize(new Uint8Array(0));
      expect(result.text).toBe('');
    });

    it('未配置 → 抛出错误', async () => {
      await expect(asr.recognize(new Uint8Array([1])))
        .rejects.toThrow('请先调用 configure()');
    });
  });

  describe('drainInterimResults', () => {
    it('初始为空', () => {
      expect(asr.drainInterimResults()).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('清理状态不崩溃', () => {
      asr.dispose();
    });
  });

  describe('name', () => {
    it('name 为 deepgram', () => {
      expect(asr.name).toBe('deepgram');
    });
  });
});
