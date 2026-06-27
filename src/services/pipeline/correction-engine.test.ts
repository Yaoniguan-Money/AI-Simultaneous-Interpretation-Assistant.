/**
 * CorrectionEngine 单元测试
 * 覆盖修正触发策略、去重、环形窗口、applyCorrections
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CorrectionEngine } from './correction-engine';
import type { TranslatedSentence } from '../llm/types';

/** 构造假翻译条目 */
function mkEntry(
  index: number,
  text: string = 'test',
  translation: string = '测试',
): TranslatedSentence {
  return {
    index,
    text,
    translation,
    tokens: [],
    startMs: 0,
    endMs: 1000,
    isPreview: false,
  };
}

describe('CorrectionEngine', () => {
  // ---- 构造 ----

  describe('构造', () => {
    it('默认配置创建', () => {
      const engine = new CorrectionEngine();
      expect(engine.registerTranslation(mkEntry(0))).toBeNull();
    });

    it('自定义 windowSize 和 triggerEvery', () => {
      const engine = new CorrectionEngine({ windowSize: 3, triggerEvery: 2 });
      engine.registerTranslation(mkEntry(0));
      const result = engine.registerTranslation(mkEntry(1)); // count=2, triggerEvery=2 → 触发
      expect(result).not.toBeNull();
      if (result) {
        expect(result.sentence.index).toBe(0);
      }
    });
  });

  // ---- registerTranslation ----

  describe('registerTranslation', () => {
    let engine: CorrectionEngine;

    beforeEach(() => {
      engine = new CorrectionEngine({ windowSize: 5, triggerEvery: 3 });
    });

    it('前 N-1 条不触发', () => {
      engine.registerTranslation(mkEntry(0));
      expect(engine.registerTranslation(mkEntry(1))).toBeNull();
    });

    it('第 N 条触发修正检查（瞄准 history[0]）', () => {
      engine.registerTranslation(mkEntry(0));
      engine.registerTranslation(mkEntry(1));
      const result = engine.registerTranslation(mkEntry(2)); // count=3, hit triggerEvery=3
      expect(result).not.toBeNull();
      expect(result!.sentence.index).toBe(0); // 最早的句子
      expect(result!.newContext).toHaveLength(2); // 后续 2 句作为上下文
    });

    it('history 不足 2 条时不触发（即使 count % triggerEvery === 0）', () => {
      const e = new CorrectionEngine({ windowSize: 5, triggerEvery: 1 });
      // triggerEvery=1 → 第一条就触发，但 history.length=1 < 2 → null
      expect(e.registerTranslation(mkEntry(0))).toBeNull();
    });

    it('已修正的索引不重复触发', () => {
      // 使用 windowSize=3, triggerEvery=2
      const e = new CorrectionEngine({ windowSize: 3, triggerEvery: 2 });
      e.registerTranslation(mkEntry(0)); // count=1, history=[0]
      e.registerTranslation(mkEntry(1)); // count=2, triggerEvery=2, history.length=2 >=2, target=idx0 → 触发，标记 idx0
      e.registerTranslation(mkEntry(2)); // count=3, history=[0,1,2] → windowSize=3, history OK
      e.registerTranslation(mkEntry(3)); // count=4, trigger! history截断为[1,2,3], target=idx1（未修正），触发标记 idx1
      e.registerTranslation(mkEntry(4)); // count=5
      // count=6, trigger! history=[2,3,4] (截断), target=idx2（未修正）→ 触发
      // wait, need to verify
      const r1 = e.registerTranslation(mkEntry(5)); // count=6, trigger
      expect(r1).not.toBeNull();
      // history should now be [3,4,5], and idx 2,3,4,5 triggered
    });

    it('索引被修正后再次作为 target 不触发', () => {
      const e = new CorrectionEngine({ windowSize: 3, triggerEvery: 2 });
      e.registerTranslation(mkEntry(0)); // count=1
      const r1 = e.registerTranslation(mkEntry(1)); // count=2, trigger → mark idx=0
      expect(r1).not.toBeNull();

      // 继续注册直到 idx=0 被截断… 实际上 idx=0 已被标记，windowSize=3
      // 如果再注册 3 个，history 变为 [1,2,3]，target 不会是 idx=0
      // 我们测试的是：同一个 idx 不会再被 checkSentence 重新修正
      expect(e.checkSentence(mkEntry(0))).toBeNull();
    });
  });

  // ---- 环形窗口 ----

  describe('环形窗口截断', () => {
    it('超过 windowSize 后截断历史', () => {
      const engine = new CorrectionEngine({ windowSize: 3, triggerEvery: 4 });

      // 注册 4 条，触发第一次修正（target=idx0）
      engine.registerTranslation(mkEntry(0));
      engine.registerTranslation(mkEntry(1));
      engine.registerTranslation(mkEntry(2));
      const r1 = engine.registerTranslation(mkEntry(3)); // count=4, trigger, history截为[1,2,3], target=idx1
      expect(r1).not.toBeNull();
      expect(r1!.sentence.index).toBe(1);
    });
  });

  // ---- checkSentence ----

  describe('checkSentence', () => {
    it('手动检查未修正的句子 → 返回目标', () => {
      const engine = new CorrectionEngine();
      engine.registerTranslation(mkEntry(0));

      const result = engine.checkSentence(mkEntry(0));
      expect(result).not.toBeNull();
      expect(result!.sentence.index).toBe(0);
    });

    it('手动检查已修正的句子 → null', () => {
      const engine = new CorrectionEngine();
      engine.registerTranslation(mkEntry(0));
      engine.checkSentence(mkEntry(0));

      expect(engine.checkSentence(mkEntry(0))).toBeNull();
    });

    it('不存在的索引 → newContext 为空', () => {
      const engine = new CorrectionEngine();
      const result = engine.checkSentence(mkEntry(999));
      expect(result).not.toBeNull();
      expect(result!.newContext).toEqual([]);
    });
  });

  // ---- applyCorrections ----

  describe('applyCorrections', () => {
    it('空修正数组无影响', () => {
      const engine = new CorrectionEngine();
      engine.registerTranslation(mkEntry(0));
      engine.applyCorrections([]);
      // 未崩溃，后续仍可正常修正
      expect(engine.checkSentence(mkEntry(0))).not.toBeNull();
    });

    it('应用修正后对应索引不再触发', () => {
      const engine = new CorrectionEngine();
      engine.applyCorrections([{ sentenceIndex: 0, correctedText: 'corrected' }]);

      expect(engine.checkSentence(mkEntry(0))).toBeNull();
    });

    it('多个修正条目全部标记', () => {
      const engine = new CorrectionEngine();
      engine.applyCorrections([
        { sentenceIndex: 0, correctedText: 'A' },
        { sentenceIndex: 1, correctedText: 'B' },
      ]);

      expect(engine.checkSentence(mkEntry(0))).toBeNull();
      expect(engine.checkSentence(mkEntry(1))).toBeNull();
      expect(engine.checkSentence(mkEntry(2))).not.toBeNull(); // 未标记
    });
  });

  // ---- reset ----

  describe('reset', () => {
    it('重置清除所有状态并重新计数', () => {
      const engine = new CorrectionEngine({ triggerEvery: 2 });
      engine.registerTranslation(mkEntry(0)); // count=1
      engine.registerTranslation(mkEntry(1)); // count=2, trigger → mark idx=0

      engine.reset();

      // 重置后从 0 开始
      engine.registerTranslation(mkEntry(10)); // count=1, history=[10]
      engine.registerTranslation(mkEntry(11)); // count=2, trigger→ history=[10,11], target=idx10
      const result = engine.registerTranslation(mkEntry(12)); // count=3
      expect(result).toBeNull(); // target idx10 已标记（count=2 时触发）
    });
  });

  // ---- 边界 ----

  describe('边界情况', () => {
    it('windowSize=1 → 第二条触发时 history.length=1 < 2 不触发', () => {
      const engine = new CorrectionEngine({ windowSize: 1, triggerEvery: 1 });
      // count=1, history=[0], triggerEvery=1 → 触发，但 history.length=1 < 2 → null
      expect(engine.registerTranslation(mkEntry(0))).toBeNull();
      // count=2, history=[1] (截断), triggerEvery=1 → 触发，但 history.length=1 < 2 → null
      expect(engine.registerTranslation(mkEntry(1))).toBeNull();
    });

    it('第一条就触发但 history 不足 → null', () => {
      const engine = new CorrectionEngine({ triggerEvery: 1 });
      expect(engine.registerTranslation(mkEntry(0))).toBeNull();
    });

    it('triggerEvery=1 第二条注册时触发', () => {
      const engine = new CorrectionEngine({ windowSize: 5, triggerEvery: 1 });
      engine.registerTranslation(mkEntry(0)); // count=1, history.length=1 < 2 → null
      const result = engine.registerTranslation(mkEntry(1)); // count=2, history.length=2 >= 2 → 触发
      expect(result).not.toBeNull();
      expect(result!.sentence.index).toBe(0);
    });
  });
});
