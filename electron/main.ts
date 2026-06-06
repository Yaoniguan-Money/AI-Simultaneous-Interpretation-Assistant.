import { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** ESM 环境下 __dirname 不可用，手动构造 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { APP_NAME } from '../shared/app-config';
import {
  closeOverlayWindow,
  createOverlayWindow,
  getOverlayWindow,
  hideOverlayWindow,
} from './overlay-window';

/** 主控制窗口引用 */
let mainWindow: BrowserWindow | null = null;

/** 创建主控制窗口 */
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 600,
    resizable: true,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发模式加载 Vite dev server，生产模式加载打包文件
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

/** 应用就绪后创建窗口并注册 IPC */
app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

/** 所有窗口关闭时退出应用——同时清理悬浮窗 */
app.on('window-all-closed', () => {
  closeOverlayWindow();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---- IPC 通道 ----

/** 获取应用版本 */
ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion());

/** 显示字幕悬浮窗 */
ipcMain.handle(IPC_CHANNELS.OVERLAY_SHOW, () => {
  createOverlayWindow();
});

/** 隐藏字幕悬浮窗 */
ipcMain.handle(IPC_CHANNELS.OVERLAY_HIDE, () => {
  hideOverlayWindow();
});

/** 获取桌面捕获源 ID——供渲染进程的系统音频捕获使用 */
ipcMain.handle(IPC_CHANNELS.DESKTOP_GET_SOURCE_ID, async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  /** 返回第一个屏幕源 ID，渲染进程用此 ID 调用 getDisplayMedia */
  return sources.length > 0 ? sources[0].id : null;
});

/** 凭证文件路径 */
const credPath = path.join(app.getPath('userData'), 'credentials.enc');

/** 加密保存凭证 */
ipcMain.handle(IPC_CHANNELS.CREDENTIALS_SAVE, async (_event, data: string) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    const encrypted = safeStorage.encryptString(data);
    fs.writeFileSync(credPath, encrypted);
    return true;
  } catch {
    return false;
  }
});

/** 加载并解密凭证 */
ipcMain.handle(IPC_CHANNELS.CREDENTIALS_LOAD, async () => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    if (!fs.existsSync(credPath)) return null;
    const encrypted = fs.readFileSync(credPath);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
});

/** 字幕数据转发：MainWindow 渲染进程 → 主进程 → OverlayWindow 渲染进程 */
ipcMain.handle(IPC_CHANNELS.SUBTITLE_UPDATE, (_event, data: unknown) => {
  const overlay = getOverlayWindow();
  if (overlay) {
    overlay.webContents.send(IPC_CHANNELS.SUBTITLE_UPDATE, data);
  }
});
