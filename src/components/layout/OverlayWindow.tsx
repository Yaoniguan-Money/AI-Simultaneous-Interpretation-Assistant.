import { SubtitleStack } from '../subtitle/SubtitleStack';

/**
 * 字幕悬浮窗组件
 * 纯文字，无背景无遮挡——透明窗口 + 纯白文字
 * 字幕由 SubtitleStack 驱动，从 Jotai subtitleStackAtom 读取
 */
export function OverlayWindow(): JSX.Element {
  return (
    <div className="w-full h-full flex flex-col items-center justify-end pointer-events-none pb-4">
      <SubtitleStack />
    </div>
  );
}
