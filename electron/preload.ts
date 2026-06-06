import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';

/**
 * 通过 contextBridge 向渲染进程暴露安全的 API
 * 渲染进程通过 window.electronAPI 调用，不直接访问 Node.js
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /** 获取应用版本 */
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  /** 显示字幕悬浮窗 */
  showOverlay: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_SHOW),
  /** 隐藏字幕悬浮窗 */
  hideOverlay: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_HIDE),
  /** 获取桌面捕获源 ID（供系统音频捕获使用） */
  getDesktopSourceId: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_GET_SOURCE_ID),
  /** 加密保存凭证到本地 */
  saveCredentials: (data: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_SAVE, data),
  /** 从本地加载解密凭证 */
  loadCredentials: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_LOAD),
});
