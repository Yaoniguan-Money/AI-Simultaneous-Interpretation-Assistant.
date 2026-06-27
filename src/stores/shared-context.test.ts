/**
 * shared-context.ts 单元测试
 * 验证共享上下文 atom 的初始值、派生快照和写入操作
 */
import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import {
  domainAtom,
  domainConfidenceAtom,
  activeTermsAtom,
  recentSummaryAtom,
  topicHistoryAtom,
  sharedContextAtom,
  updateDomainAtom,
  addTermAtom,
  updateTermsAtom,
  updateSummaryAtom,
  addTopicAtom,
  resetContextAtom,
} from './shared-context';

describe('shared-context', () => {
  describe('初始值', () => {
    it('domainAtom 初始为 null', () => {
      const store = createStore();
      expect(store.get(domainAtom)).toBeNull();
    });

    it('domainConfidenceAtom 初始为 0', () => {
      const store = createStore();
      expect(store.get(domainConfidenceAtom)).toBe(0);
    });

    it('activeTermsAtom 初始为空 Map', () => {
      const store = createStore();
      expect(store.get(activeTermsAtom)).toEqual(new Map());
    });

    it('recentSummaryAtom 初始为空字符串', () => {
      const store = createStore();
      expect(store.get(recentSummaryAtom)).toBe('');
    });

    it('topicHistoryAtom 初始为空数组', () => {
      const store = createStore();
      expect(store.get(topicHistoryAtom)).toEqual([]);
    });
  });

  describe('sharedContextAtom（派生只读）', () => {
    it('读取初始快照', () => {
      const store = createStore();
      const ctx = store.get(sharedContextAtom);
      expect(ctx.domain).toBeNull();
      expect(ctx.domainConfidence).toBe(0);
      expect(ctx.activeTerms).toEqual(new Map());
      expect(ctx.recentSummary).toBe('');
      expect(ctx.topicHistory).toEqual([]);
    });

    it('派生快照随底层 atom 变化', () => {
      const store = createStore();
      store.set(domainAtom, '技术');
      store.set(domainConfidenceAtom, 0.9);

      const ctx = store.get(sharedContextAtom);
      expect(ctx.domain).toBe('技术');
      expect(ctx.domainConfidence).toBe(0.9);
    });
  });

  describe('updateDomainAtom', () => {
    it('同时设置 domain 和 confidence', () => {
      const store = createStore();
      store.set(updateDomainAtom, '医疗', 0.85);
      expect(store.get(domainAtom)).toBe('医疗');
      expect(store.get(domainConfidenceAtom)).toBe(0.85);
    });
  });

  describe('addTermAtom', () => {
    it('追加单条术语', () => {
      const store = createStore();
      store.set(addTermAtom, 'API', '接口');
      const terms = store.get(activeTermsAtom);
      expect(terms.get('API')).toBe('接口');
    });

    it('多次追加不丢失已有术语', () => {
      const store = createStore();
      store.set(addTermAtom, 'API', '接口');
      store.set(addTermAtom, 'SDK', '开发包');
      const terms = store.get(activeTermsAtom);
      expect(terms.get('API')).toBe('接口');
      expect(terms.get('SDK')).toBe('开发包');
    });
  });

  describe('updateTermsAtom', () => {
    it('全量替换术语映射', () => {
      const store = createStore();
      store.set(addTermAtom, 'old', '旧');
      const newTerms = new Map([['new', '新']]);
      store.set(updateTermsAtom, newTerms);

      const terms = store.get(activeTermsAtom);
      expect(terms.get('new')).toBe('新');
      expect(terms.get('old')).toBeUndefined();
      // 应为深拷贝，修改原始 Map 不影响 atom
      newTerms.set('extra', '额外');
      expect(store.get(activeTermsAtom).get('extra')).toBeUndefined();
    });
  });

  describe('updateSummaryAtom', () => {
    it('设置摘要', () => {
      const store = createStore();
      store.set(updateSummaryAtom, '会议讨论了技术架构。');
      expect(store.get(recentSummaryAtom)).toBe('会议讨论了技术架构。');
    });
  });

  describe('addTopicAtom', () => {
    it('追加话题切换记录', () => {
      const store = createStore();
      store.set(addTopicAtom, '技术架构', 1000);
      expect(store.get(topicHistoryAtom)).toEqual([
        { name: '技术架构', timestamp: 1000 },
      ]);
    });

    it('多次追加保持顺序', () => {
      const store = createStore();
      store.set(addTopicAtom, 'A', 1000);
      store.set(addTopicAtom, 'B', 2000);
      expect(store.get(topicHistoryAtom)).toHaveLength(2);
    });
  });

  describe('resetContextAtom', () => {
    it('重置所有上下文', () => {
      const store = createStore();
      store.set(domainAtom, '技术');
      store.set(updateSummaryAtom, '摘要');
      store.set(addTopicAtom, '话题', 1000);

      store.set(resetContextAtom);

      expect(store.get(domainAtom)).toBeNull();
      expect(store.get(recentSummaryAtom)).toBe('');
      expect(store.get(topicHistoryAtom)).toEqual([]);
    });
  });
});
