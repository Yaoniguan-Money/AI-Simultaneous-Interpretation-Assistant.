/**
 * 全局测试设置——所有测试文件运行前执行
 * 模拟 node 环境中不可用的浏览器 API
 */

/** 模拟 crypto.subtle——用于 HMAC-SHA1 和对称加密 */
Object.defineProperty(globalThis, 'crypto', {
  value: {
    ...globalThis.crypto,
    subtle: {
      importKey: vi.fn(),
      sign: vi.fn(),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      generateKey: vi.fn(),
      exportKey: vi.fn(),
    },
    getRandomValues: vi.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    }),
  },
  writable: true,
  configurable: true,
});

/** 模拟 performance.now */
vi.stubGlobal('performance', {
  now: vi.fn(() => Date.now() + 0.123),
});
