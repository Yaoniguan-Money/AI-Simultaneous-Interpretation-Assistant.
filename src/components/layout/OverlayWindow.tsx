import { SubtitleStack } from '../subtitle/SubtitleStack';
import { useSubtitleReceiver } from '../../hooks/useSubtitleReceiver';

/**
 * 字幕悬浮窗组件
 * 纯文字，无背景无遮挡——透明窗口 + 纯白文字
 * 字幕由 SubtitleStack 驱动，通过 useSubtitleReceiver 从 IPC 接收 MainWindow 推送的数据
 */
export function OverlayWindow(): JSX.Element {
  /** 启动 IPC 字幕数据接收，将 MainWindow 推送的字幕写入本地 Jotai atom */
  useSubtitleReceiver();
  return (
    <div className="w-full h-full flex flex-col items-center justify-end pointer-events-none pb-4">
      <SubtitleStack />
    </div>
  );
}
