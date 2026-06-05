import { atom } from 'jotai';
import type { SubtitleEntry } from '../types/subtitle';

/** 字幕堆栈——OverlayWindow 渲染来源 */
export const subtitleStackAtom = atom<SubtitleEntry[]>([]);

/** 当前正在流式接收的活跃字幕 ID，null 表示无进行中 */
export const activeSubtitleIdAtom = atom<number | null>(null);
