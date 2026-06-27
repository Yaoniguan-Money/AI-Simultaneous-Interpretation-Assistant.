/**
 * crypto.ts 单元测试
 * 覆盖 uint8ToBase64、hmacSha1Base64、md5Hex
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uint8ToBase64, md5Hex } from './crypto';

// ---- uint8ToBase64 ----

describe('uint8ToBase64', () => {
  it('常规 ASCII 字节转 Base64', () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    expect(uint8ToBase64(bytes)).toBe('aGVsbG8=');
  });

  it('空 Uint8Array 返回空字符串', () => {
    expect(uint8ToBase64(new Uint8Array(0))).toBe('');
  });

  it('包含高位字节的二进制数据', () => {
    const bytes = new Uint8Array([0, 255, 128]);
    expect(uint8ToBase64(bytes)).toBe('AP+A');
  });

  it('单字节', () => {
    expect(uint8ToBase64(new Uint8Array([65]))).toBe('QQ==');
  });

  it('无填充的 3 字节对齐', () => {
    const bytes = new Uint8Array([77, 97, 110]); // "Man"
    expect(uint8ToBase64(bytes)).toBe('TWFu');
  });
});

// ---- hmacSha1Base64 ----

describe('hmacSha1Base64', () => {
  let hmacSha1Base64: typeof import('./crypto').hmacSha1Base64;

  beforeEach(async () => {
    // 重新导入以获取干净的模块状态
    vi.resetModules();
    const mod = await import('./crypto');
    hmacSha1Base64 = mod.hmacSha1Base64;
  });

  it('调用 crypto.subtle.importKey 和 sign 并返回 Base64 结果', async () => {
    const mockKey = { type: 'secret' };
    const mockSig = new Uint8Array([104, 101, 108, 108, 111]).buffer; // "hello" bytes

    const importKeySpy = vi.fn().mockResolvedValue(mockKey);
    const signSpy = vi.fn().mockResolvedValue(mockSig);

    // 对此测试替换 crypto.subtle
    const origSubtle = crypto.subtle;
    Object.defineProperty(crypto, 'subtle', {
      value: { ...origSubtle, importKey: importKeySpy, sign: signSpy },
      writable: true,
      configurable: true,
    });

    const result = await hmacSha1Base64('test-message', 'test-secret');

    // 验证 importKey 调用参数正确
    expect(importKeySpy).toHaveBeenCalledWith(
      'raw',
      expect.any(Uint8Array),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );

    // 验证 sign 被调用
    expect(signSpy).toHaveBeenCalledWith('HMAC', mockKey, expect.any(Uint8Array));

    // 验证 Base64 编码正确
    expect(result).toBe('aGVsbG8=');

    // 恢复
    Object.defineProperty(crypto, 'subtle', { value: origSubtle, configurable: true });
  });

  it('crypto.subtle 失败时抛出异常', async () => {
    const importKeySpy = vi.fn().mockRejectedValue(new Error('Crypto error'));
    const signSpy = vi.fn();

    const origSubtle = crypto.subtle;
    Object.defineProperty(crypto, 'subtle', {
      value: { ...origSubtle, importKey: importKeySpy, sign: signSpy },
      writable: true,
      configurable: true,
    });

    await expect(hmacSha1Base64('msg', 'secret')).rejects.toThrow('Crypto error');

    Object.defineProperty(crypto, 'subtle', { value: origSubtle, configurable: true });
  });

  it('空消息返回有效 Base64 输出', async () => {
    const mockKey = { type: 'secret' };
    const mockSig = new Uint8Array([0xfb, 0xdb, 0x1d, 0x1b]).buffer;

    const importKeySpy = vi.fn().mockResolvedValue(mockKey);
    const signSpy = vi.fn().mockResolvedValue(mockSig);

    const origSubtle = crypto.subtle;
    Object.defineProperty(crypto, 'subtle', {
      value: { ...origSubtle, importKey: importKeySpy, sign: signSpy },
      writable: true,
      configurable: true,
    });

    const result = await hmacSha1Base64('', 'secret');
    expect(result).toBe('+9sdGw==');

    Object.defineProperty(crypto, 'subtle', { value: origSubtle, configurable: true });
  });
});

// ---- md5Hex ----

describe('md5Hex', () => {
  it('空字符串 → RFC 1321 标准测试向量', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('"a" → 标准结果', () => {
    expect(md5Hex('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
  });

  it('"abc" → RFC 1321 标准测试向量', () => {
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('"message digest" → RFC 1321 标准测试向量', () => {
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });

  it('全小写英文字母', () => {
    expect(md5Hex('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });

  it('全大小写 + 数字', () => {
    expect(md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'))
      .toBe('d174ab98d277d9f5a5611c2c9f419d9f');
  });

  it('重复数字序列（多块处理）', () => {
    expect(md5Hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))
      .toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('含空格文本', () => {
    expect(md5Hex('hello world')).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
  });

  it('中文 UTF-8 输入长度和幂等性', () => {
    const result = md5Hex('你好世界');
    expect(result).toHaveLength(32);
    expect(result).toMatch(/^[0-9a-f]{32}$/);
    // 幂等——多次调用结果一致
    expect(md5Hex('你好世界')).toBe(result);
  });

  it('含 emoji 的 UTF-8 输入（代理对）', () => {
    const result = md5Hex('你好😀');
    expect(result).toHaveLength(32);
    expect(md5Hex('你好😀')).toBe(result); // 幂等
  });

  it('长文本（> 64 字节，多块处理）', () => {
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
    const result = md5Hex(long);
    expect(result).toHaveLength(32);
    expect(md5Hex(long)).toBe(result); // 幂等
  });

  it('仅 ASCII 数字', () => {
    expect(md5Hex('42')).toBe('a1d0c6e83f027327d8461063f4ac58a6');
  });

  it('输出为小写 32 位 hex', () => {
    const result = md5Hex('test');
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });
});
