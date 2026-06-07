import { atom } from 'jotai';
import type { SubtitleEntry } from '../types/subtitle';
import type { MeetingMinutes } from '../services/llm/types';

/** 字幕堆栈——OverlayWindow 渲染来源，stop 时清空 */
export const subtitleStackAtom = atom<SubtitleEntry[]>([]);

/** 翻译历史——持久化累积，stop 时不清空，历史视图读取 */
export const historyAtom = atom<SubtitleEntry[]>([]);

/** 当前正在流式接收的活跃字幕 ID，null 表示无进行中 */
export const activeSubtitleIdAtom = atom<number | null>(null);

/**
 * 会议纪要状态机
 * idle → (stop) → generating → (LLM 成功) → done
 *                               → (LLM 失败) → error
 * start → idle（重置）
 */
export type MeetingMinutesState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'done'; data: MeetingMinutes }
  | { status: 'error'; error: string }
  /** 翻译记录不足，无法生成纪要 */
  | { status: 'empty' };

/** 会议纪要——stop 时自动生成，历史视图展示，start 时复位为 idle */
export const meetingMinutesAtom = atom<MeetingMinutesState>({ status: 'idle' });
