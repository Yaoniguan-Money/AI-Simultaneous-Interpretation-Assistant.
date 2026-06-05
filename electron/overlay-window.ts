import { BrowserWindow, screen } from 'electron';
import path from 'path';

/** 默认窗口尺寸 */
const DEFAULTS = {
  width: 800,
  height: 100,
} as const;

/** 字幕悬浮窗引用 */
let overlayWindow: BrowserWindow | null = null;

/** 创建透明置顶字幕悬浮窗 */
export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    return overlayWindow;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.round((screenWidth - DEFAULTS.width) / 2);
  /** 屏幕底部居中，方案 6.1 要求 */
  const y = screenHeight - DEFAULTS.height - 40;

  overlayWindow = new BrowserWindow({
    width: DEFAULTS.width,
    height: DEFAULTS.height,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  /** 鼠标穿透——默认点击事件透传到下层窗口 */
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  /** 加载悬浮窗页面（hash 路由） */
  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}#overlay`
    : `file://${path.join(__dirname, '../dist/index.html')}#overlay`;

  overlayWindow.loadURL(url);

  /** 窗口关闭时置空引用 */
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

/** 隐藏字幕悬浮窗 */
export function hideOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

/** 销毁字幕悬浮窗 */
export function closeOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}
