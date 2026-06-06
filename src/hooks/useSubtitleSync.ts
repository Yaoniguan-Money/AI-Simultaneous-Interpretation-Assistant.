import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { subtitleStackAtom } from '../stores/session-store';
import { bilingualAtom } from '../stores/settings-store';
import type { SubtitlePayload } from '../types/subtitle';

/**
 * 字幕同步 Hook——监听本地 subtitleStackAtom 和 bilingualAtom 变化，
 * 构造 SubtitlePayload 并通过 IPC 推送到 OverlayWindow。
 * 解决 Jotai atom 无法跨 Electron 进程共享的架构缺陷（修复 B1）。
 */
export function useSubtitleSync(): void {
  const stack = useAtomValue(subtitleStackAtom);
  const bilingual = useAtomValue(bilingualAtom);

  useEffect(() => {
    const payload: SubtitlePayload = { entries: stack, bilingual };
    window.electronAPI?.sendSubtitleUpdate(payload);
  }, [stack, bilingual]);
}
