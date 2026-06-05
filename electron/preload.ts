import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';

/**
 * 通过 contextBridge 向渲染进程暴露安全的 API
 * 渲染进程通过 window.electronAPI 调用，不直接访问 Node.js
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /** 获取应用版本 */
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
});
