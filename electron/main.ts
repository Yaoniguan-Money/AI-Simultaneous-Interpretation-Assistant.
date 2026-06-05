import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { APP_NAME } from '../shared/app-config';

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
      preload: path.join(__dirname, 'preload.js'),
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

/** 应用就绪后创建窗口 */
app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

/** 所有窗口关闭时退出应用 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---- IPC 通道定义（预留，后续 PR 扩展） ----

/** 示例 IPC handler：获取应用版本 */
ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion());
