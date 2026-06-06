import { useAtomValue } from 'jotai';
import { historyAtom } from '../../stores/session-store';
import { SummaryCard } from './SummaryCard';

/**
 * 翻译历史视图
 * 从 historyAtom 读取持久化累积的历史记录
 */
export function HistoryPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const history = useAtomValue(historyAtom);

  return (
    <div className="flex-1 flex flex-col">
      <button
        onClick={onBack}
        className="text-xs text-text-muted hover:text-text-primary transition-colors mb-4"
      >
        Back
      </button>

      {history.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-text-muted">
            No translation history yet. Start translating to see entries here.
          </p>
        </div>
      ) : (
        <>
          {/* 历史条目列表 */}
          <div className="flex-1 overflow-y-auto space-y-2 mb-4">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="rounded-card border border-border bg-surface p-3.5"
              >
                <p className="text-[10px] text-text-faded font-mono mb-1">
                  {formatTime(entry.timestamp)}
                </p>
                <p className="text-[15px] font-semibold text-text-primary leading-snug">
                  {entry.translation}
                </p>
                {entry.original && (
                  <p className="text-xs text-text-muted mt-1">{entry.original}</p>
                )}
              </div>
            ))}
          </div>

          {/* Channel 2 摘要卡片 */}
          <SummaryCard />

          {/* 操作按钮 */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => copyHistory(history)}
              className="flex-1 py-2.5 rounded-btn border border-border bg-surface
                         text-xs font-medium hover:bg-surface-hover transition-colors"
            >
              Copy All
            </button>
            <button
              onClick={() => exportMarkdown(history)}
              className="flex-1 py-2.5 rounded-btn bg-black text-white
                         text-xs font-medium hover:bg-[#333] transition-colors"
            >
              Export Markdown
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** 时间戳格式化为 mm:ss */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 复制全部历史到剪贴板 */
function copyHistory(history: { timestamp: number; translation: string }[]): void {
  const text = history
    .map((h) => `[${formatTime(h.timestamp)}] ${h.translation}`)
    .join('\n');
  navigator.clipboard.writeText(text).catch(() => {
    /** 剪贴板不可用时静默失败 */
  });
}

/** 导出为 Markdown 文件 */
function exportMarkdown(history: { timestamp: number; translation: string }[]): void {
  const lines = history.map((h, i) =>
    `${i + 1}. \`${formatTime(h.timestamp)}\`\n   > ${h.translation}`,
  );
  const md = ['# Translation History\n', ...lines, ''].join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `translation-history-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
