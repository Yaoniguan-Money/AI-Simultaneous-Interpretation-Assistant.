import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { subtitleStackAtom } from '../stores/session-store';

/**
 * 字幕同步 Hook——监听本地 subtitleStackAtom 变化并通过 IPC 推送到 OverlayWindow
 * 在 MainWindow 组件树中使用，使得翻译管线或 Demo 播放器产出的字幕自动同步到悬浮窗
 * 不关心字幕来源——无论实时翻译还是演示模式，只要 atom 变化就自动推送
 */
export function useSubtitleSync(): void {
  const stack = useAtomValue(subtitleStackAtom);

  useEffect(() => {
    window.electronAPI?.sendSubtitleUpdate(stack);
  }, [stack]);
}
