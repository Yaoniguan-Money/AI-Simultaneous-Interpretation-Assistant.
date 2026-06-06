/// <reference types="vite/client" />

export {};

declare global {
  /** Electron API 类型声明，与 preload.ts 保持同步 */
  interface ElectronAPI {
    getVersion: () => Promise<string>;
    showOverlay: () => Promise<void>;
    hideOverlay: () => Promise<void>;
    /** 获取桌面捕获源 ID（系统音频） */
    getDesktopSourceId: () => Promise<string | null>;
    /** 加密保存凭证到本地 */
    saveCredentials: (data: string) => Promise<boolean>;
    /** 从本地加载解密凭证 */
    loadCredentials: () => Promise<string | null>;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
