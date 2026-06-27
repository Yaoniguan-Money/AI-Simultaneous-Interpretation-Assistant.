/**
 * provider-utils.ts 单元测试
 * 覆盖 ensureConfigured、emptyAsrResult、consumeAsrResultQueue
 */
import { describe, it, expect } from 'vitest';
import { ensureConfigured, emptyAsrResult, consumeAsrResultQueue } from './provider-utils';
import type { ASRResult } from './asr/types';

// ---- ensureConfigured ----

describe('ensureConfigured', () => {
  it('配置存在时返回配置', () => {
    const config = { apiKey: 'test-key' };
    expect(ensureConfigured(config, 'TestProvider')).toBe(config);
  });

  it('配置为 null 时抛出含 providerName 的错误', () => {
    expect(() => ensureConfigured(null, '讯飞')).toThrow('请先调用 configure() 配置 讯飞');
  });

  it('配置为 undefined 时抛出', () => {
    expect(() => ensureConfigured(undefined as any, 'Deepgram'))
      .toThrow('请先调用 configure() 配置 Deepgram');
  });
});

// ---- emptyAsrResult ----

describe('emptyAsrResult', () => {
  it('isFinal=true 返回全零结果', () => {
    const result = emptyAsrResult(true);
    expect(result).toEqual({
      text: '',
      isFinal: true,
      confidence: 0,
      startTime: 0,
      endTime: 0,
    });
  });

  it('isFinal=false 返回 intermediate 结果', () => {
    const result = emptyAsrResult(false);
    expect(result.isFinal).toBe(false);
    expect(result.text).toBe('');
  });
});

// ---- consumeAsrResultQueue ----

describe('consumeAsrResultQueue', () => {
  const mkResult = (overrides: Partial<ASRResult> = {}): ASRResult => ({
    text: '',
    isFinal: false,
    confidence: 0,
    startTime: 0,
    endTime: 0,
    ...overrides,
  });

  it('空队列 → 返回空 interim 结果', () => {
    const queue: ASRResult[] = [];
    const pending: ASRResult[] = [];

    const result = consumeAsrResultQueue(queue, pending);
    expect(result).toEqual(emptyAsrResult(false));
    expect(pending).toHaveLength(0);
  });

  it('仅有 final 结果 → 返回 final，pending 为空', () => {
    const queue = [mkResult({ text: 'Hello', isFinal: true })];
    const pending: ASRResult[] = [];

    const result = consumeAsrResultQueue(queue, pending);
    expect(result.text).toBe('Hello');
    expect(result.isFinal).toBe(true);
    expect(queue).toHaveLength(0); // 已消费
    expect(pending).toHaveLength(0); // final 不暂存
  });

  it('仅有 interim 结果 → 返回 interim，暂存到 pending', () => {
    const queue = [mkResult({ text: 'Hel', isFinal: false })];
    const pending: ASRResult[] = [];

    const result = consumeAsrResultQueue(queue, pending);
    expect(result.text).toBe('Hel');
    expect(result.isFinal).toBe(false);
    expect(queue).toHaveLength(0);
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe('Hel');
  });

  it('混合队列：final 优先返回，interim 暂存', () => {
    const queue = [
      mkResult({ text: 'Hel', isFinal: false }),
      mkResult({ text: 'Hello world.', isFinal: true }),
    ];
    const pending: ASRResult[] = [];

    const result = consumeAsrResultQueue(queue, pending);
    expect(result.text).toBe('Hello world.');
    expect(result.isFinal).toBe(true);
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe('Hel');
  });

  it('全部结果无文本 → 返回空结果', () => {
    const queue = [
      mkResult({ text: '', isFinal: false }),
      mkResult({ text: '', isFinal: true }),
    ];
    const pending: ASRResult[] = [];

    const result = consumeAsrResultQueue(queue, pending);
    expect(result).toEqual(emptyAsrResult(false));
  });

  it('多次消费：第二次无 final 则回退到 interim', () => {
    const pending: ASRResult[] = [];

    // 第一次：有 final
    const q1 = [
      mkResult({ text: 'Interim', isFinal: false }),
      mkResult({ text: 'Final1', isFinal: true }),
    ];
    const r1 = consumeAsrResultQueue(q1, pending);
    expect(r1.text).toBe('Final1');

    // 第二次：只有 interim
    const q2 = [mkResult({ text: 'Interim2', isFinal: false })];
    const r2 = consumeAsrResultQueue(q2, pending);
    expect(r2.text).toBe('Interim2');
    expect(pending).toHaveLength(2); // 两个 interim 都暂存
  });

  it('队列消费后原地清空（shift 语义）', () => {
    const queue = [
      mkResult({ text: 'A', isFinal: true }),
      mkResult({ text: 'B', isFinal: true }),
    ];
    const pending: ASRResult[] = [];

    consumeAsrResultQueue(queue, pending);
    expect(queue).toHaveLength(0);
  });

  it('仅有 text 为空的 interim → 不暂存', () => {
    const queue = [mkResult({ text: '', isFinal: false })];
    const pending: ASRResult[] = [];

    const result = consumeAsrResultQueue(queue, pending);
    expect(result).toEqual(emptyAsrResult(false));
    expect(pending).toHaveLength(0);
  });
});
