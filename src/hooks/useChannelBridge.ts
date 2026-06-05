import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import type { AnalysisResult } from '../services/llm/types';
import {
  addTopicAtom,
  updateDomainAtom,
  updateSummaryAtom,
  updateTermsAtom,
} from '../stores/shared-context';
import type { FastChannelPipeline } from '../services/pipeline/channel1-fast';
import type { Channel2Analyzer } from '../services/pipeline/channel2-slow';

/**
 * 双通道桥接 Hook
 * 将 Channel 2 的分析结果写入 Jotai 共享上下文原子
 * Channel 1 下次翻译时通过 getSharedContext 自动读取最新值
 * 组件卸载时自动取消回调订阅
 */
export function useChannelBridge(
  analyzer: Channel2Analyzer,
  pipeline: FastChannelPipeline,
): void {
  const updateDomain = useSetAtom(updateDomainAtom);
  const updateTerms = useSetAtom(updateTermsAtom);
  const updateSummary = useSetAtom(updateSummaryAtom);
  const addTopic = useSetAtom(addTopicAtom);

  useEffect(() => {
    /** Channel 2 分析结果 → Jotai 原子 */
    const unsubAnalysis = analyzer.onAnalysis((result: AnalysisResult) => {
      /** ① 领域信号 */
      if (result.domain) {
        updateDomain(result.domain.name, result.domain.confidence);
      }
      /** ② 术语映射 */
      if (result.terms.length > 0) {
        const map = new Map<string, string>();
        for (const t of result.terms) {
          map.set(t.original, t.translation);
        }
        updateTerms(map);
      }
      /** ③ 滚动摘要 */
      if (result.summary) {
        updateSummary(result.summary);
      }
      /** ④ 话题切换 → 重置 Channel 1 翻译记忆 */
      if (result.topicShift) {
        pipeline.resetContext();
        addTopic(result.domain?.name ?? '未知', Date.now());
      }
    });

    /** Channel 2 错误 → 暂由分析器自行分发，后续 PR 可接 Toast */
    const unsubError = analyzer.onError((_error: Error) => {
      // 错误已由 Channel2Analyzer 自身的 errorCallbacks 分发
    });

    /** 组件卸载时移除回调 */
    return () => {
      unsubAnalysis();
      unsubError();
    };
  }, [analyzer, pipeline, updateDomain, updateTerms, updateSummary, addTopic]);
}
