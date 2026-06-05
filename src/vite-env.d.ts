/// <reference types="vite/client" />

export {};

declare global {
  /** Electron API 类型声明，与 preload.ts 保持同步 */
  interface ElectronAPI {
    getVersion: () => Promise<string>;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
