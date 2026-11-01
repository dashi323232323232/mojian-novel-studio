import { app, BrowserWindow, Menu, nativeImage, protocol, session, shell, Tray } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AppCore } from './core';
import { ApiServer } from './api/server';
import { EndpointFileService, ensureToken } from './api/discovery';
import { registerIpc, buildMenu } from './ipc';
import { resolveDataDir } from './dataLocation';
import { APP_DISPLAY_NAME, API_VERSION, APP_VERSION } from '@shared/constants';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'novel-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

const isDev = !app.isPackaged && process.env.DASHI_DEV === '1';
const DEV_URL = process.env.DASHI_DEV_URL ?? 'http://127.0.0.1:5199';

let mainWindow: BrowserWindow | null = null;
let core: AppCore | null = null;
let api: ApiServer | null = null;
let endpoint: EndpointFileService | null = null;
let tray: Tray | null = null;
let dirty = false;
let closingConfirmed = false;
let closeRequestPending = false;
/** 用户是否从托盘菜单选择了「退出」；此时关闭窗口应真正退出。 */
let quittingFromTray = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

/** 显示并聚焦主窗口；从托盘恢复时一并还原最小化状态。 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

/** 关闭行为：默认收缩到系统托盘，可在设置中改为直接退出。 */
function shouldHideToTray(): boolean {
  if (quittingFromTray || closingConfirmed) return false;
  try {
    return core?.settings.getCloseAction() !== 'quit';
  } catch {
    return true;
  }
}

function getDataDir(): string {
  // 支持用户自定义数据目录（写入 userData/data-location.json）
  return resolveDataDir();
}

function registerMediaProtocol(dataDir: string): void {
  protocol.handle('novel-media', (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'audio') {
        return new Response('Not found', { status: 404 });
      }
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      // /audio/<projectId>/<fileName>
      if (segments.length !== 2) return new Response('Bad request', { status: 400 });
      const [projectId, fileName] = segments;
      if (!/^[A-Za-z0-9_-]+$/.test(projectId) || path.basename(fileName) !== fileName) {
        return new Response('Bad request', { status: 400 });
      }
      const base = path.resolve(dataDir, 'audio', projectId);
      const target = path.resolve(base, fileName);
      if (!target.startsWith(base + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(target)) return new Response('Not found', { status: 404 });
      const data = fs.readFileSync(target);
      const ext = path.extname(target).toLowerCase();
      const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'application/octet-stream';
      return new Response(data, {
        headers: {
          'Content-Type': mime,
          'Content-Length': String(data.length),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      console.error('[media] 读取音频失败', err);
      return new Response('Internal error', { status: 500 });
    }
  });
}

/**
 * 图标文件的实际位置：主进程编译产物在 dist/electron/electron/main/，
 * 而 assets/ 位于项目根目录（打包后在 app.asar 根），因此需要向上 4 层。
 * 这里同时兼容开发目录与打包目录，逐级向上探测，避免路径层级变化后图标静默丢失。
 */
function resolveAsset(...candidates: string[]): string | undefined {
  const roots = [
    path.join(__dirname, '../../../../'), // dist/electron/electron/main → 项目根 / asar 根
    path.join(__dirname, '../../../'), // 兼容历史布局
    path.join(process.resourcesPath ?? '', 'app'), // 打包后兜底
    process.cwd(),
  ];
  for (const root of roots) {
    if (!root) continue;
    for (const name of candidates) {
      const target = path.join(root, name);
      if (fs.existsSync(target)) return target;
    }
  }
  return undefined;
}

/** 窗口图标：找不到就不设置（不影响功能）。 */
function windowIconPath(): string | undefined {
  return resolveAsset('assets/icon.ico', 'assets/icon.png');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f6f7f9',
    title: APP_DISPLAY_NAME,
    autoHideMenuBar: true,
    icon: windowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  if (isDev) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../../../renderer/index.html'));
  }

  win.on('close', (event) => {
    if (closingConfirmed || quittingFromTray) return;
    // 有未保存修改时先询问，避免直接藏到托盘后丢内容
    if (dirty || closeRequestPending) {
      event.preventDefault();
      // 只询问一次，避免重复弹窗；用户确认后由渲染层调用 app:closeConfirmed
      if (!closeRequestPending) {
        closeRequestPending = true;
        win.webContents.send('app:requestClose');
      }
      return;
    }
    if (shouldHideToTray()) {
      // 收缩到托盘：不退出进程，朗读与后台任务继续
      event.preventDefault();
      win.hide();
      if (!tray) createTray();
      return;
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  // 从托盘恢复时刷新界面状态
  win.on('show', () => {
    if (!win.isDestroyed()) win.webContents.send('app:windowShown');
  });

  return win;
}

/**
 * 兜底托盘图标：打包后资源目录可能不在，这里直接生成 16×16 位图，
 * 保证托盘图标一定存在（否则 Windows 上 Tray 构造会抛错）。
 */
function fallbackTrayIcon(): Electron.NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx * dx + dy * dy <= 7.4 * 7.4;
      // 圆角方块：主色 #4f5bd5，中间留出白色书页
      const isPage = Math.abs(dx) <= 2.6 && Math.abs(dy) <= 4.2;
      if (!inside) {
        buffer[i] = 0;
        buffer[i + 1] = 0;
        buffer[i + 2] = 0;
        buffer[i + 3] = 0;
      } else if (isPage) {
        buffer[i] = 255;
        buffer[i + 1] = 255;
        buffer[i + 2] = 255;
        buffer[i + 3] = 255;
      } else {
        buffer[i] = 0xd5;
        buffer[i + 1] = 0x5b;
        buffer[i + 2] = 0x4f;
        buffer[i + 3] = 255;
      }
    }
  }
  // nativeImage 需要 BGRA 顺序
  for (let i = 0; i < buffer.length; i += 4) {
    const b = buffer[i];
    buffer[i] = buffer[i + 2];
    buffer[i + 2] = b;
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

/** 系统托盘图标与菜单：单击显示窗口，右键可显示/退出。 */
function createTray(): Tray | null {
  if (tray) return tray;
  let image = nativeImage.createEmpty();
  try {
    const iconPath = resolveAsset('assets/icon.ico', 'assets/icon.png');
    if (iconPath) image = nativeImage.createFromPath(iconPath);
  } catch {
    /* 图标读取失败时走兜底图标 */
  }
  if (image.isEmpty()) image = fallbackTrayIcon();
  try {
    tray = new Tray(image);
  } catch (err) {
    console.error('[tray] 创建系统托盘失败', err);
    tray = null;
    return null;
  }
  tray.setToolTip(APP_DISPLAY_NAME);
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '退出软件',
      click: () => {
        quittingFromTray = true;
        closingConfirmed = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  return tray;
}

async function bootstrap(): Promise<void> {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  core = new AppCore(dataDir);
  endpoint = new EndpointFileService(dataDir, () => api?.status.port ?? 45871);
  const token = ensureToken(core);
  api = new ApiServer({ core, endpoint, token });
  registerMediaProtocol(dataDir);

  try {
    await api.start();
    console.log(`[api] 本地 API 已启动：${api.getBaseUrl()} (API ${API_VERSION})`);
  } catch (err) {
    console.error('[api] 启动失败', err);
  }

  mainWindow = createWindow();
  buildMenu(mainWindow, (action) => {
    if (!mainWindow) return;
    if (action === 'new-project' || action === 'save-chapter' || action === 'open-agent') {
      mainWindow.webContents.send('app:menuAction', action);
    }
  }, dataDir);

  registerIpc({
    core,
    api,
    endpoint,
    getWindow: () => mainWindow,
    markDirty: (value) => {
      dirty = value;
      if (!value) closeRequestPending = false;
    },
    isDirty: () => dirty,
    cancelClose: () => {
      closeRequestPending = false;
    },
    requestClose: () => {
      // 用户确认了关闭：按设置决定「退出」还是「收缩到托盘」
      closingConfirmed = false;
      closeRequestPending = false;
      dirty = false;
      if (shouldHideToTray()) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
          createTray();
        }
        return;
      }
      closingConfirmed = true;
      app.quit();
    },
    hideToTray: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.hide();
      createTray();
    },
    showWindow: () => showMainWindow(),
    isTrayActive: () => Boolean(tray),
  });

  core.changes.on('change', (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('data:changed', event);
    }
  });

  if (isDev) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow?.webContents.toggleDevTools();
      }
    });
  }

  // 允许跨域预检只影响本地 API；渲染层 CSP 保持严格。
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' || permission === 'clipboard-read');
  });

  app.setAppUserModelId('com.dashi.novelstudio');
}

app.whenReady().then(() => {
  void bootstrap().catch((err) => {
    console.error('[boot] 启动失败', err);
    app.quit();
  });
});

app.on('window-all-closed', () => {
  // 收缩到托盘时窗口只是隐藏，不会触发该事件；真正常见的是用户选择直接退出。
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});

app.on('before-quit', () => {
  closingConfirmed = true;
  try {
    tray?.destroy();
    tray = null;
  } catch {
    /* 托盘销毁失败不影响退出 */
  }
  try {
    api?.stop();
    core?.close();
  } catch (err) {
    console.error('[shutdown] 清理失败', err);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled]', reason);
});

export { APP_VERSION };
