import { atom } from 'jotai';
import type { SharedContext, Topic } from '../services/llm/types';

/** 重新导出，方便业务代码统一引用 */
export type { SharedContext, Topic } from '../services/llm/types';

/** 初始共享上下文 */
const initialContext: SharedContext = {
  domain: null,
  domainConfidence: 0,
  activeTerms: new Map(),
  recentSummary: '',
  topicHistory: [],
};

// ---- 原子状态（Channel 2 写入） ----

/** 当前检测领域 */
export const domainAtom = atom<string | null>(initialContext.domain);

/** 领域置信度 0.0~1.0 */
export const domainConfidenceAtom = atom<number>(initialContext.domainConfidence);

/** 活跃术语映射：英文术语 → 中文翻译 */
export const activeTermsAtom = atom<Map<string, string>>(initialContext.activeTerms);

/** 滚动会议摘要 */
export const recentSummaryAtom = atom<string>(initialContext.recentSummary);

/** 话题切换历史 */
export const topicHistoryAtom = atom<Topic[]>(initialContext.topicHistory);

// ---- 派生只读原子（Channel 1 读取） ----

/** 共享上下文快照 —— Channel 1 翻译请求时统一读取 */
export const sharedContextAtom = atom<SharedContext>((get) => ({
  domain: get(domainAtom),
  domainConfidence: get(domainConfidenceAtom),
  activeTerms: get(activeTermsAtom),
  recentSummary: get(recentSummaryAtom),
  topicHistory: get(topicHistoryAtom),
}));

// ---- Channel 2 写入操作 ----

/** 更新领域信息 */
export const updateDomainAtom = atom(
  null,
  (_get, set, domain: string | null, confidence: number) => {
    set(domainAtom, domain);
    set(domainConfidenceAtom, confidence);
  },
);

/** 设置术语映射（全量替换） */
export const updateTermsAtom = atom(null, (_get, set, terms: Map<string, string>) => {
  set(activeTermsAtom, new Map(terms));
});

/** 追加一条术语 */
export const addTermAtom = atom(null, (_get, set, original: string, translation: string) => {
  set(activeTermsAtom, (prev) => {
    const next = new Map(prev);
    next.set(original, translation);
    return next;
  });
});

/** 更新滚动摘要 */
export const updateSummaryAtom = atom(null, (_get, set, summary: string) => {
  set(recentSummaryAtom, summary);
});

/** 记录话题切换 */
export const addTopicAtom = atom(null, (_get, set, name: string, timestamp: number) => {
  set(topicHistoryAtom, (prev) => [...prev, { name, timestamp }]);
});

/** 重置所有上下文（会话结束时调用） */
export const resetContextAtom = atom(null, (_get, set) => {
  set(domainAtom, initialContext.domain);
  set(domainConfidenceAtom, initialContext.domainConfidence);
  set(activeTermsAtom, new Map(initialContext.activeTerms));
  set(recentSummaryAtom, initialContext.recentSummary);
  set(topicHistoryAtom, [...initialContext.topicHistory]);
});
