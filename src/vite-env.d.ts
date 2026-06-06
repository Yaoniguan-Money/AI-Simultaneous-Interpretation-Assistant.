/// <reference types="vite/client" />

export {};

declare global {
  /** Electron API 类型声明，与 preload.ts 保持同步 */
  interface ElectronAPI {
    getVersion: () => Promise<string>;
    showOverlay: () => Promise<void>;
    hideOverlay: () => Promise<void>;
    /** 加密保存凭证到本地 */
    saveCredentials: (data: string) => Promise<boolean>;
    /** 从本地加载解密凭证 */
    loadCredentials: () => Promise<string | null>;
    /** 推送字幕数据到 OverlayWindow —— payload 包含字幕条目、双语开关和字号 */
    sendSubtitleUpdate: (data: import('../src/types/subtitle').SubtitlePayload) => Promise<void>;
    /** 注册字幕数据更新监听，返回取消监听函数 */
    onSubtitleUpdate: (callback: (data: import('../src/types/subtitle').SubtitlePayload) => void) => (() => void);
    /** 请求主进程调整悬浮窗尺寸 */
    resizeOverlay: (width: number, height: number) => Promise<void>;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
