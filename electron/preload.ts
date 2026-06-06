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
  /** 加密保存凭证到本地 */
  saveCredentials: (data: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_SAVE, data),
  /** 从本地加载解密凭证 */
  loadCredentials: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_LOAD),
  /**
   * 推送字幕数据到 OverlayWindow（MainWindow 渲染进程调用）
   * @param data 字幕堆栈数组 SubtitleEntry[]
   */
  sendSubtitleUpdate: (data: unknown): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SUBTITLE_UPDATE, data),
  /**
   * 接收字幕数据更新（OverlayWindow 渲染进程调用）
   * @param callback 收到新字幕数据时的回调
   * @returns 取消监听的清理函数
   */
  onSubtitleUpdate: (callback: (data: unknown) => void): (() => void) => {
    /** 包装 handler 剥离 event.sender，仅传递 data，符合安全规范 */
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data);
    ipcRenderer.on(IPC_CHANNELS.SUBTITLE_UPDATE, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.SUBTITLE_UPDATE, handler); };
  },
});
