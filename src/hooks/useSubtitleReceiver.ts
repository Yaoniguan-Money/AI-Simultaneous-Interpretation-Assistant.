import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { subtitleStackAtom } from '../stores/session-store';
import { bilingualAtom, subtitleFontSizeAtom } from '../stores/settings-store';
import type { SubtitlePayload } from '../types/subtitle';

/**
 * 字幕接收 Hook——在 OverlayWindow 中使用，监听主进程推送的字幕数据。
 * 将接收到的 SubtitlePayload 拆解后写入本地 Jotai atom，驱动 SubtitleStack 渲染。
 * 同步 bilingual 和 fontSize 标志解决 Jotai atom 跨进程不共享问题（修复 B1）。
 * 组件卸载时自动调用 IPC 清理函数，防止内存泄漏（CLAUDE.md A.5）
 */
export function useSubtitleReceiver(): void {
  const setStack = useSetAtom(subtitleStackAtom);
  const setBilingual = useSetAtom(bilingualAtom);
  const setFontSize = useSetAtom(subtitleFontSizeAtom);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSubtitleUpdate((data) => {
      /** 数据来源是本应用 MainWindow，格式确定为 SubtitlePayload */
      const payload = data as SubtitlePayload;
      setStack(payload.entries);
      setBilingual(payload.bilingual);
      setFontSize(payload.fontSize);
    });
    /** 组件卸载时移除 IPC 监听 */
    return () => { unsubscribe?.(); };
  }, [setStack, setBilingual, setFontSize]);
}
