/** IPC 通道名称常量 —— 主进程与渲染进程共享引用 */
export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:getVersion',
  /** 打开/显示字幕悬浮窗 */
  OVERLAY_SHOW: 'overlay:show',
  /** 隐藏字幕悬浮窗 */
  OVERLAY_HIDE: 'overlay:hide',
  /** 获取桌面捕获源 ID（系统音频） */
  DESKTOP_GET_SOURCE_ID: 'desktop:getSourceId',
  /** 加密保存凭证到本地 */
  CREDENTIALS_SAVE: 'credentials:save',
  /** 从本地加载解密凭证 */
  CREDENTIALS_LOAD: 'credentials:load',
} as const;
