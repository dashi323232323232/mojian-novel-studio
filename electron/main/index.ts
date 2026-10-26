import { app, BrowserWindow, protocol, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AppCore } from './core';
import { ApiServer } from './api/server';
import { EndpointFileService, ensureToken } from './api/discovery';
import { registerIpc, buildMenu } from './ipc';
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
let dirty = false;
let closingConfirmed = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getDataDir(): string {
  const override = process.env.DASHI_DATA_DIR;
  if (override) return path.resolve(override);
  if (process.env.DASHI_PORTABLE === '1') {
    return path.join(path.dirname(app.getPath('exe')), 'data');
  }
  return app.getPath('userData');
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
    icon: path.join(__dirname, '../../../assets/icon.ico'),
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
    if (closingConfirmed) return;
    if (dirty) {
      event.preventDefault();
      win.webContents.send('app:requestClose');
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
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
    },
    requestClose: () => {
      closingConfirmed = true;
      app.quit();
    },
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
