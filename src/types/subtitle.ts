import type { SubtitleFontSize } from './index';

/** 字幕条目——一条翻译结果 */
export interface SubtitleEntry {
  /** 唯一标识 */
  id: number;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 英文原文 */
  original: string;
  /** 中文翻译 */
  translation: string;
  /** 是否翻译完成（false 表示仍在流式接收 token） */
  isComplete: boolean;
  /** 修正信息（如有） */
  correction: SubtitleCorrection | null;
}

/** 字幕修正 */
export interface SubtitleCorrection {
  oldText: string;
  newText: string;
  reason: string;
}

/**
 * 字幕 IPC 推送负载 —— MainWindow → 主进程 → OverlayWindow
 * 将渲染所需全部数据（字幕条目 + 双语开关 + 字号）单次传输，
 * 避免 Jotai atom 无法跨 Electron 进程共享的问题
 */
export interface SubtitlePayload {
  /** 字幕堆栈数组 */
  entries: SubtitleEntry[];
  /** 双语字幕开关状态 */
  bilingual: boolean;
  /** 当前字幕字号，OverlayWindow 据此动态渲染 */
  fontSize: SubtitleFontSize;
}
