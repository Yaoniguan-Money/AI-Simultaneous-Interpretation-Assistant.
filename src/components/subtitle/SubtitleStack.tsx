import { useAtomValue } from 'jotai';
import { subtitleStackAtom } from '../../stores/session-store';
import { bilingualAtom } from '../../stores/settings-store';
import { SubtitleLine } from './SubtitleLine';

/** 字幕堆叠——显示最近 N 条字幕 */
export function SubtitleStack(): JSX.Element {
  const stack = useAtomValue(subtitleStackAtom);
  const bilingual = useAtomValue(bilingualAtom);

  /** 仅显示最近 2 条：最新（当前句）+ 上一句 */
  const visible = stack.slice(-2);

  if (visible.length === 0) return <div />;

  return (
    <div className="flex flex-col items-center gap-0.5">
      {visible.map((entry, i) => (
        <SubtitleLine
          key={entry.id}
          entry={entry}
          showOriginal={bilingual && (i === 0 || visible.length === 1)}
        />
      ))}
    </div>
  );
}
