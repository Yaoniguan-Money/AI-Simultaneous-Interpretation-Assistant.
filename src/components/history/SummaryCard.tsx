import { useAtomValue } from 'jotai';
import {
  activeTermsAtom,
  domainAtom,
  domainConfidenceAtom,
  recentSummaryAtom,
} from '../../stores/shared-context';

/** Channel 2 分析摘要卡片——只在有分析结果时展示 */
export function SummaryCard(): JSX.Element {
  const domain = useAtomValue(domainAtom);
  const confidence = useAtomValue(domainConfidenceAtom);
  const terms = useAtomValue(activeTermsAtom);
  const summary = useAtomValue(recentSummaryAtom);

  /** 无分析数据时不渲染 */
  const hasData = domain || summary || terms.size > 0;
  if (!hasData) return <></>;

  return (
    <div className="rounded-card border border-border p-4 bg-[rgba(99,102,241,0.04)]">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.05em] text-[rgba(99,102,241,0.6)] mb-2">
        Channel 2 Analysis
      </h4>
      {domain && (
        <p className="text-sm font-semibold text-text-primary">
          {domain}
          <span className="text-text-muted text-xs ml-1 font-normal">
            ({(confidence * 100).toFixed(0)}%)
          </span>
        </p>
      )}
      {summary && (
        <p className="text-xs text-text-muted mt-1">{summary}</p>
      )}
      {terms.size > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[...terms.entries()].map(([en, zh]) => (
            <span key={en}
              className="px-2 py-0.5 rounded-chip text-[10px] font-medium
                         bg-[rgba(99,102,241,0.08)] text-[rgba(99,102,241,0.8)]"
            >
              {en} &rarr; {zh}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
