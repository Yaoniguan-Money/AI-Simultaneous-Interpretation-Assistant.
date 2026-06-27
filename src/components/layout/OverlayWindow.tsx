import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { bilingualAtom, subtitleFontSizeAtom } from '../../stores/settings-store';
import type { SubtitleFontSize } from '../../types';
import { SubtitleStack } from '../subtitle/SubtitleStack';
import { useSubtitleReceiver } from '../../hooks/useSubtitleReceiver';

/**
 * 悬浮窗高度映射：fontSize × 双语模式 → 像素
 * 覆盖 3 条字幕（MIN_DISPLAY_MS 保护扩展）+ 内边距 + 底部留白的最坏情况
 * 单语模式仅显示中文翻译行，双语模式额外显示英文原文行
 */
const OVERLAY_HEIGHT: Record<SubtitleFontSize, { single: number; bilingual: number }> = {
  sm:  { single: 120, bilingual: 170 },
  md:  { single: 140, bilingual: 200 },
  lg:  { single: 170, bilingual: 260 },
};

/** 悬浮窗固定宽度 */
const OVERLAY_WIDTH = 800;

/**
 * 字幕悬浮窗组件
 * 纯文字，无背景无遮挡——透明窗口 + 纯白文字
 * 字幕由 SubtitleStack 驱动，通过 useSubtitleReceiver 从 IPC 接收 MainWindow 推送的数据
 * 字号变化时通过 IPC 请求主进程调整悬浮窗高度
 */
export function OverlayWindow(): JSX.Element {
  /** 启动 IPC 字幕数据接收，将 MainWindow 推送的字幕写入本地 Jotai atom */
  useSubtitleReceiver();
  const fontSize = useAtomValue(subtitleFontSizeAtom);
  const bilingual = useAtomValue(bilingualAtom);

  /** 字号或双语模式变化时请求主进程调整悬浮窗尺寸 */
  useEffect(() => {
    const mode = bilingual ? 'bilingual' : 'single';
    const height = OVERLAY_HEIGHT[fontSize][mode];
    window.electronAPI?.resizeOverlay(OVERLAY_WIDTH, height);
  }, [fontSize, bilingual]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-end pointer-events-none pb-4">
      <SubtitleStack />
    </div>
  );
}
