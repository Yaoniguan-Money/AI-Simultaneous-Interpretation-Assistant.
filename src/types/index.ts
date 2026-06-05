/**
 * 共享类型定义 —— 主进程与渲染进程共用
 * 所有 IPC 通信的类型集中在此文件维护，保持前后端同步
 */

/** IPC 通道名称常量 */
export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:getVersion',
} as const;

/** 音频捕获源 */
export type AudioSource = 'system' | 'microphone';

/** 字幕字号档位 */
export type SubtitleFontSize = 'sm' | 'md' | 'lg';

/** 字幕行数模式 */
export type SubtitleLineMode = 'single' | 'double';
