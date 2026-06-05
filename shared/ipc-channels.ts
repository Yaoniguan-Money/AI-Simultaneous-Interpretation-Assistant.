/** IPC 通道名称常量 —— 主进程与渲染进程共享引用 */
export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:getVersion',
  /** 打开/显示字幕悬浮窗 */
  OVERLAY_SHOW: 'overlay:show',
  /** 隐藏字幕悬浮窗 */
  OVERLAY_HIDE: 'overlay:hide',
} as const;
