import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { subtitleStackAtom } from '../stores/session-store';
import { bilingualAtom, subtitleFontSizeAtom } from '../stores/settings-store';
import type { SubtitlePayload } from '../types/subtitle';
import { firstScreenLatency } from '../utils/first-screen-latency';

/**
 * 字幕同步 Hook——监听本地 subtitleStackAtom、bilingualAtom 和 subtitleFontSizeAtom 变化，
 * 构造 SubtitlePayload 并通过 IPC 推送到 OverlayWindow。
 * 解决 Jotai atom 无法跨 Electron 进程共享的架构缺陷（修复 B1）。
 */
export function useSubtitleSync(): void {
  const stack = useAtomValue(subtitleStackAtom);
  const bilingual = useAtomValue(bilingualAtom);
  const fontSize = useAtomValue(subtitleFontSizeAtom);

  useEffect(() => {
    const payload: SubtitlePayload = { entries: stack, bilingual, fontSize };
    if (stack.some((entry) => entry.translation.trim().length > 0)) {
      firstScreenLatency.mark('overlay_update', `entries=${stack.length}`);
    }
    window.electronAPI?.sendSubtitleUpdate(payload);
  }, [stack, bilingual, fontSize]);
}
