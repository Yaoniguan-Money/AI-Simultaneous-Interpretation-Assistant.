/** 字幕条目——一条翻译结果 */
export interface SubtitleEntry {
  /** 唯一标识 */
  id: number;
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
