import { useAtomValue } from 'jotai';
import type { MeetingMinutes } from '../../services/llm/types';
import { meetingMinutesAtom } from '../../stores/session-store';

/**
 * 会议纪要卡片——在翻译历史视图中展示 LLM 自动生成的结构化会议纪要
 * 根据 MeetingMinutesState 的四态渲染：idle 不显示 / generating 骨架 / done 卡片 / error 提示
 */
export function MeetingMinutesCard(): JSX.Element {
  const state = useAtomValue(meetingMinutesAtom);

  switch (state.status) {
    case 'idle':
      return <></>;
    case 'generating':
      return <LoadingSkeleton />;
    case 'error':
      return <ErrorCard error={state.error} />;
    case 'empty':
      return <EmptyCard />;
    case 'done':
      return <MinutesCard data={state.data} />;
  }
}

// ---- 子组件 ----

/** 加载骨架——脉冲动画占位 */
function LoadingSkeleton(): JSX.Element {
  return (
    <div className="rounded-card border border-border p-5 bg-[rgba(34,197,94,0.03)] mt-4 animate-pulse">
      <div className="h-3 w-20 bg-surface-muted rounded mb-4" />
      <div className="h-4 w-3/4 bg-surface-muted rounded mb-3" />
      <div className="h-3 w-full bg-surface-muted rounded mb-2" />
      <div className="h-3 w-5/6 bg-surface-muted rounded mb-2" />
      <div className="h-3 w-2/3 bg-surface-muted rounded" />
    </div>
  );
}

/** 错误提示卡片——显示失败原因 */
function ErrorCard({ error }: { error: string }): JSX.Element {
  return (
    <div className="rounded-card border border-[rgba(239,68,68,0.2)] p-5 bg-[rgba(239,68,68,0.03)] mt-4">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.05em] text-[rgba(239,68,68,0.6)] mb-2">
        会议纪要生成失败
      </h4>
      <p className="text-[13px] text-text-primary leading-relaxed">
        {error}
      </p>
      <p className="text-[11px] text-text-muted mt-2">
        请检查网络连接和 LLM API 配置后，重新开始翻译并停止以重试。
      </p>
    </div>
  );
}

/** 空状态提示卡片——翻译记录不足时展示 */
function EmptyCard(): JSX.Element {
  return (
    <div className="rounded-card border border-border p-5 bg-[rgba(156,163,175,0.03)] mt-4">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.05em] text-text-muted mb-2">
        会议纪要
      </h4>
      <p className="text-[13px] text-text-muted leading-relaxed">
        翻译记录不足以生成会议纪要。
      </p>
      <p className="text-[11px] text-text-faded mt-1">
        请确保翻译过程中有完整的句子被识别和翻译，然后重新开始翻译并停止以重试。
      </p>
    </div>
  );
}

/** 会议纪要内容卡片——done 状态且有内容时渲染 */
function MinutesCard({ data }: { data: MeetingMinutes }): JSX.Element {
  const hasContent =
    data.topic ||
    data.keyTopics.length > 0 ||
    data.decisions.length > 0 ||
    data.actionItems.length > 0 ||
    data.summary;

  if (!hasContent) {
    return (
      <div className="rounded-card border border-border p-5 bg-[rgba(34,197,94,0.03)] mt-4">
        <h4 className="text-[10px] font-bold uppercase tracking-[0.05em] text-[rgba(34,197,94,0.6)] mb-2">
          会议纪要
        </h4>
        <p className="text-[12px] text-text-muted">
          LLM 未能提取到有效纪要内容，请确认翻译记录中有足够的对话内容。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border p-5 bg-[rgba(34,197,94,0.03)] mt-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[10px] font-bold uppercase tracking-[0.05em] text-[rgba(34,197,94,0.6)]">
          会议纪要
        </h4>
        <div className="flex gap-2">
          <button
            onClick={() => copyAsText(data)}
            className="text-[10px] px-2.5 py-1 rounded-btn border border-border
                       text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            复制
          </button>
          <button
            onClick={() => exportAsText(data)}
            className="text-[10px] px-2.5 py-1 rounded-btn bg-black text-white
                       hover:bg-[#333] transition-colors"
          >
            导出 TXT
          </button>
        </div>
      </div>

      {/* 会议主题 */}
      {data.topic && (
        <p className="text-[15px] font-semibold text-text-primary mb-4">
          {data.topic}
        </p>
      )}

      {/* 关键议题 */}
      {data.keyTopics.length > 0 && (
        <Section title="关键议题">
          <ul className="list-disc list-inside space-y-1">
            {data.keyTopics.map((t, i) => (
              <li key={i} className="text-[13px] text-text-primary">{t}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* 讨论要点 */}
      {data.discussionPoints.length > 0 && (
        <Section title="讨论要点">
          {data.discussionPoints.map((dp, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <p className="text-[13px] font-medium text-text-primary">{dp.topic}</p>
              <ul className="list-disc list-inside ml-3 space-y-0.5">
                {dp.points.map((p, j) => (
                  <li key={j} className="text-[12px] text-text-muted">{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
      )}

      {/* 决策事项 */}
      {data.decisions.length > 0 && (
        <Section title="决策事项">
          <ul className="list-disc list-inside space-y-1">
            {data.decisions.map((d, i) => (
              <li key={i} className="text-[13px] text-text-primary">{d}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* 行动项 */}
      {data.actionItems.length > 0 && (
        <Section title="行动项">
          <ul className="space-y-1.5">
            {data.actionItems.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span className="text-[rgba(34,197,94,0.6)] mt-0.5">☐</span>
                <span className="text-text-primary">{a.description}</span>
                {a.assignee && (
                  <span className="text-[11px] text-text-muted bg-surface-muted px-1.5 py-0.5 rounded-chip">
                    {a.assignee}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 会议总结 */}
      {data.summary && (
        <Section title="会议总结">
          <p className="text-[13px] text-text-muted leading-relaxed">
            {data.summary}
          </p>
        </Section>
      )}
    </div>
  );
}

// ---- 通用组件 ----

/** 纪要点区块——统一的标题 + 内容布局 */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="mb-4 last:mb-0">
      <h5 className="text-[11px] font-semibold text-text-muted mb-1.5 tracking-[0.02em]">
        {title}
      </h5>
      {children}
    </div>
  );
}

// ---- 导出工具 ----

/** 将会议纪要格式化为纯文本 */
function formatMinutesText(minutes: {
  topic: string;
  keyTopics: string[];
  discussionPoints: { topic: string; points: string[] }[];
  decisions: string[];
  actionItems: { description: string; assignee?: string }[];
  summary: string;
}): string {
  const lines: string[] = [];
  const sep = '='.repeat(40);

  lines.push('会议纪要');
  lines.push(sep);
  lines.push('');

  if (minutes.topic) {
    lines.push(`【主题】${minutes.topic}`);
    lines.push('');
  }

  if (minutes.keyTopics.length > 0) {
    lines.push('【关键议题】');
    minutes.keyTopics.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
    lines.push('');
  }

  if (minutes.discussionPoints.length > 0) {
    lines.push('【讨论要点】');
    minutes.discussionPoints.forEach((dp) => {
      lines.push(`  ■ ${dp.topic}`);
      dp.points.forEach((p) => lines.push(`    - ${p}`));
      lines.push('');
    });
  }

  if (minutes.decisions.length > 0) {
    lines.push('【决策事项】');
    minutes.decisions.forEach((d, i) => lines.push(`  ${i + 1}. ${d}`));
    lines.push('');
  }

  if (minutes.actionItems.length > 0) {
    lines.push('【行动项】');
    minutes.actionItems.forEach((a, i) => {
      const assignee = a.assignee ? `（${a.assignee}）` : '';
      lines.push(`  ${i + 1}. ${a.description}${assignee}`);
    });
    lines.push('');
  }

  if (minutes.summary) {
    lines.push('【会议总结】');
    lines.push(minutes.summary);
    lines.push('');
  }

  lines.push(sep);
  lines.push(`导出时间: ${new Date().toLocaleString()}`);
  return lines.join('\n');
}

/** 复制为纯文本到剪贴板 */
function copyAsText(minutes: Parameters<typeof formatMinutesText>[0]): void {
  const text = formatMinutesText(minutes);
  navigator.clipboard.writeText(text).catch(() => {
    /** 剪贴板不可用时静默失败 */
  });
}

/** 导出为纯文本文件下载 */
function exportAsText(minutes: Parameters<typeof formatMinutesText>[0]): void {
  const text = formatMinutesText(minutes);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meeting-minutes-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
