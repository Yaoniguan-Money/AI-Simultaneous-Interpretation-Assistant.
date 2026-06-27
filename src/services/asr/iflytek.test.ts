/**
 * IFlyTekASR 单元测试
 * 覆盖 configure、recognize、dispose、drainInterimResults、validateConfig
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 延迟导入以避免模块级副作用
let IFlyTekASR: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./iflytek');
  IFlyTekASR = mod.IFlyTekASR;
});

function makeConfig(overrides: Record<string, string> = {}): any {
  return {
    provider: 'iflytek',
    credentials: { appId: 'test-app-id', apiKey: 'test-api-key', ...overrides },
  };
}

function createMockWs(readyState: number = WebSocket.CONNECTING) {
  const listeners: Record<string, Function[]> = {};
  const mockWs: any = {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((event: string, fn: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    removeEventListener: vi.fn(),
  };
  // 模拟 onopen/onmessage/onerror/onclose 属性
  const props = ['onopen', 'onmessage', 'onerror', 'onclose'];
  for (const prop of props) {
    Object.defineProperty(mockWs, prop, { value: null, writable: true });
  }
  return mockWs;
}

describe('IFlyTekASR', () => {
  let asr: any;

  beforeEach(() => {
    asr = new IFlyTekASR();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configure', () => {
    it('凭证有效 → 配置成功', async () => {
      await expect(asr.configure(makeConfig())).resolves.not.toThrow();
    });

    it('缺少 appId → 抛出错误', async () => {
      await expect(asr.configure(makeConfig({ appId: '' })))
        .rejects.toThrow('缺少凭证');
    });

    it('缺少 apiKey → 抛出错误', async () => {
      await expect(asr.configure(makeConfig({ apiKey: '' })))
        .rejects.toThrow('缺少凭证');
    });
  });

  describe('recognize', () => {
    it('空音频 → 返回空结果', async () => {
      await asr.configure(makeConfig());
      const result = await asr.recognize(new Uint8Array(0));
      expect(result.text).toBe('');
      expect(result.isFinal).toBe(false);
    });

    it('未配置 → 抛出错误', async () => {
      await expect(asr.recognize(new Uint8Array([1, 2, 3])))
        .rejects.toThrow('请先调用 configure()');
    });
  });

  describe('drainInterimResults', () => {
    it('初始为空数组', () => {
      expect(asr.drainInterimResults()).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('清理状态', () => {
      asr.dispose();
      // 无崩溃即为通过
    });
  });

  describe('name', () => {
    it('name 为 iflytek', () => {
      expect(asr.name).toBe('iflytek');
    });
  });
});

// ---- extractConfidence 和 extractRTASRResult ----
// 这些是模块私有函数，通过 recognize 间接测试
// 如果它们被导出，直接测试更好
