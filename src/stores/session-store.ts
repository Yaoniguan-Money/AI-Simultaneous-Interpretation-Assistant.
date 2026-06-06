import { atom } from 'jotai';
import type { SubtitleEntry } from '../types/subtitle';

/** 字幕堆栈——OverlayWindow 渲染来源，stop 时清空 */
export const subtitleStackAtom = atom<SubtitleEntry[]>([]);

/** 翻译历史——持久化累积，stop 时不清空，历史视图读取 */
export const historyAtom = atom<SubtitleEntry[]>([]);

/** 当前正在流式接收的活跃字幕 ID，null 表示无进行中 */
export const activeSubtitleIdAtom = atom<number | null>(null);
