import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { subtitleStackAtom } from '../stores/session-store';
import type { SubtitleEntry } from '../types/subtitle';

/**
 * 字幕接收 Hook——在 OverlayWindow 中使用，监听主进程推送的字幕数据
 * 将接收到的数据写入本地 Jotai subtitleStackAtom，驱动 SubtitleStack 渲染
 * 组件卸载时自动调用 IPC 清理函数，防止内存泄漏（CLAUDE.md A.5）
 */
export function useSubtitleReceiver(): void {
  const setStack = useSetAtom(subtitleStackAtom);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSubtitleUpdate((data) => {
      /** 类型断言安全：数据来源是本应用 MainWindow，格式确定为 SubtitleEntry[] */
      setStack(data as SubtitleEntry[]);
    });
    /** 组件卸载时移除 IPC 监听 */
    return () => { unsubscribe?.(); };
  }, [setStack]);
}
