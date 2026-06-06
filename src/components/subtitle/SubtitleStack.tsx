import { useAtomValue } from 'jotai';
import { useRef } from 'react';
import { subtitleStackAtom } from '../../stores/session-store';
import { bilingualAtom, subtitleFontSizeAtom } from '../../stores/settings-store';
import { SubtitleLine } from './SubtitleLine';

/** 字幕最短显示时长（毫秒）——防止长句被后续短句瞬间挤出 */
const MIN_DISPLAY_MS = 3000;

/**
 * 字幕堆叠——显示最近 N 条字幕。
 * 支持双语模式（中文 + 英文原文）和最短显示时长保护（修复 B2 + B5）。
 */
export function SubtitleStack(): JSX.Element {
  const stack = useAtomValue(subtitleStackAtom);
  const bilingual = useAtomValue(bilingualAtom);
  const fontSize = useAtomValue(subtitleFontSizeAtom);

  /** 跟踪每条字幕首次渲染时间，用于最短显示时长保护 */
  const firstShown = useRef<Map<number, number>>(new Map());

  /** 清理已不在栈中的过期记录 */
  const stackIds = new Set(stack.map((e) => e.id));
  for (const id of firstShown.current.keys()) {
    if (!stackIds.has(id)) firstShown.current.delete(id);
  }

  /**
   * 可见条目选择：常规显示最近 2 条；若倒数第 3 条显示不足 MIN_DISPLAY_MS，
   * 则扩展至 3 条，防止长句被后续短句瞬间挤出导致用户来不及阅读
   */
  const now = Date.now();
  let count = 2;
  if (stack.length >= 3) {
    const thirdLast = stack[stack.length - 3];
    const shownAt = firstShown.current.get(thirdLast.id);
    if (shownAt !== undefined && now - shownAt < MIN_DISPLAY_MS) {
      count = 3;
    }
  }

  const visible = stack.slice(-count);

  /** 记录本次可见条目的首次渲染时间 */
  for (const entry of visible) {
    if (!firstShown.current.has(entry.id)) {
      firstShown.current.set(entry.id, now);
    }
  }

  if (visible.length === 0) return <div />;

  return (
    <div className="flex flex-col items-center gap-0.5">
      {visible.map((entry) => (
        <SubtitleLine
          key={entry.id}
          entry={entry}
          showOriginal={bilingual}
          fontSize={fontSize}
        />
      ))}
    </div>
  );
}
