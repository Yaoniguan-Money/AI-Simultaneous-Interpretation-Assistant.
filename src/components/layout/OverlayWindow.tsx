import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { subtitleFontSizeAtom } from '../../stores/settings-store';
import type { SubtitleFontSize } from '../../types';
import { SubtitleStack } from '../subtitle/SubtitleStack';
import { useSubtitleReceiver } from '../../hooks/useSubtitleReceiver';

/** 字号 → 悬浮窗高度映射，覆盖双语模式 2 行文本 + 内边距 + 底部留白 */
const OVERLAY_HEIGHT: Record<SubtitleFontSize, number> = {
  sm: 90,
  md: 100,
  lg: 130,
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

  /** 字号变化时请求主进程调整悬浮窗尺寸 */
  useEffect(() => {
    const height = OVERLAY_HEIGHT[fontSize];
    window.electronAPI?.resizeOverlay(OVERLAY_WIDTH, height);
  }, [fontSize]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-end pointer-events-none pb-4">
      <SubtitleStack />
    </div>
  );
}
