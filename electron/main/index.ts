import { app, BrowserWindow, Menu, nativeImage, protocol, session, shell, Tray } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { AppCore } from './core';
import { ApiServer } from './api/server';
import { EndpointFileService, ensureToken } from './api/discovery';
import { registerIpc, buildMenu } from './ipc';
import { resolveDataDir } from './dataLocation';
import { InstanceAuthService } from './services/instanceAuth';
import { NovelError } from './errors';
import { makeId } from './util';
import { APP_DISPLAY_NAME, API_VERSION, APP_VERSION } from '@shared/constants';
import type { InstanceSummary } from '@shared/types';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'novel-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

// 子实例由主实例 spawn 启动，命令行里的 --dashi-* 开关先还原成环境变量，
// 再读取 isDev / DEV_URL，保证开发模式下的新实例也能连上同一个 Vite 服务。
// 该函数是函数声明（存在提升），因此可以在这里先于定义处调用。
applyForwardedSwitches(process.argv);

const isDev = !app.isPackaged && process.env.DASHI_DEV === '1';

/**
 * 自绘标题栏高度（逻辑像素）。系统窗口按钮（最小化/最大化/关闭）位于右侧这个高度内，
 * 渲染层用 --titlebar-height 预留出等高的可拖动区域，并把「新建实例」按钮排在系统按钮左侧。
 */
const TITLEBAR_HEIGHT = 36;
const DEV_URL = process.env.DASHI_DEV_URL ?? 'http://127.0.0.1:5199';

let mainWindow: BrowserWindow | null = null;
/** 迷你朗读窗口（全局单例，独立于主窗口存在） */
let miniWindow: BrowserWindow | null = null;
let core: AppCore | null = null;
/** 当前实例的密码服务（scrypt 加盐哈希，只存本机数据库）。 */
let instanceAuth: InstanceAuthService | null = null;
let api: ApiServer | null = null;
let endpoint: EndpointFileService | null = null;
let tray: Tray | null = null;
let dirty = false;
let closingConfirmed = false;
let closeRequestPending = false;
/** 用户是否从托盘菜单选择了「退出」；此时关闭窗口应真正退出。 */
let quittingFromTray = false;

// ---------- 多实例：实例标识、userData 隔离与实例清单 ----------

/** 主实例的 userData 目录：必须在任何 app.setPath('userData') 之前读取，否则会被子实例覆盖。 */
const mainInstanceBaseDir = app.getPath('userData');
/** 实例清单文件：固定放在主实例 userData 下，所有实例共用一份。 */
const INSTANCE_REGISTRY_FILE = path.join(mainInstanceBaseDir, 'instances.json');
/** 主实例（不带 --instance 参数启动的那个）的固定 id。 */
const MAIN_INSTANCE_ID = 'main';

/**
 * 从命令行解析 --instance=<id>。
 * 支持两种写法：--instance=inst_xxx 与 --instance inst_xxx（打包版快捷方式可能带空格写法）。
 * 未指定时返回主实例 id。
 */
function getInstanceIdFromArgv(argv: string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = /^--instance=(.*)$/.exec(arg);
    if (eq) {
      const value = eq[1].trim();
      if (value) return value;
    }
    if (arg === '--instance') {
      const value = (argv[i + 1] ?? '').trim();
      if (value) return value;
    }
  }
  return MAIN_INSTANCE_ID;
}

const instanceId = getInstanceIdFromArgv(process.argv);
const isMainInstance = instanceId === MAIN_INSTANCE_ID;

/**
 * 实例数据隔离：子实例的 userData 指向 <主实例 userData>/instances/<id>。
 * 必须在 app.whenReady() 之前调用，且早于任何 app.getPath('userData')，
 * 这样 Chromium 缓存、Local Storage 与数据库（resolveDataDir 默认返回 userData）都会落在各自目录。
 */
function applyInstanceUserDataPath(): void {
  if (isMainInstance) return;
  const target = path.join(mainInstanceBaseDir, 'instances', instanceId);
  fs.mkdirSync(target, { recursive: true });
  app.setPath('userData', target);
}
applyInstanceUserDataPath();

/** 子实例不再竞争单实例锁，否则第二个进程会被立刻退出。 */
if (isMainInstance) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      showMainWindow();
    });
  }
}

/** 实例清单：{ instances: [{ id, name, createdAt, lastOpenedAt }] }。 */
function readInstanceRegistry(): InstanceSummary[] {
  try {
    const raw = fs.readFileSync(INSTANCE_REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { instances?: unknown };
    if (!Array.isArray(parsed.instances)) return [];
    return parsed.instances
      .filter((item): item is InstanceSummary => {
        if (!item || typeof item !== 'object') return false;
        const row = item as Record<string, unknown>;
        return typeof row.id === 'string' && row.id.length > 0 && typeof row.name === 'string';
      })
      .map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        lastOpenedAt: typeof item.lastOpenedAt === 'string' ? item.lastOpenedAt : null,
      }));
  } catch {
    return [];
  }
}

/** 原子写入实例清单：先写临时文件再改名，避免半截 JSON 损坏清单。 */
function writeInstanceRegistry(instances: InstanceSummary[]): void {
  fs.mkdirSync(path.dirname(INSTANCE_REGISTRY_FILE), { recursive: true });
  const tmp = INSTANCE_REGISTRY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ instances }, null, 2), 'utf8');
  fs.renameSync(tmp, INSTANCE_REGISTRY_FILE);
}

/** 新增或更新一个实例元信息。 */
function upsertInstance(entry: { id: string; name: string; createdAt?: string }): InstanceSummary {
  const instances = readInstanceRegistry();
  const now = new Date().toISOString();
  const existing = instances.find((item) => item.id === entry.id);
  let result: InstanceSummary;
  if (existing) {
    existing.name = entry.name;
    existing.lastOpenedAt = now;
    result = existing;
  } else {
    result = {
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt ?? now,
      lastOpenedAt: now,
    };
    instances.push(result);
  }
  writeInstanceRegistry(instances);
  return result;
}

/** 当前实例的显示名：主实例固定为「主实例」，子实例取清单里的名字。 */
function resolveCurrentInstanceName(): string {
  if (isMainInstance) return '主实例';
  return readInstanceRegistry().find((item) => item.id === instanceId)?.name ?? instanceId;
}

/** 窗口标题带上实例名，方便同时开多个窗口时区分。 */
function windowTitle(): string {
  return isMainInstance ? APP_DISPLAY_NAME : APP_DISPLAY_NAME + ' · ' + resolveCurrentInstanceName();
}

/** 在清单里登记当前实例（主实例首次启动时也会写入一条 main 记录）。 */
function registerCurrentInstance(): void {
  if (!isMainInstance) {
    upsertInstance({ id: instanceId, name: resolveCurrentInstanceName() });
    return;
  }
  const instances = readInstanceRegistry();
  if (!instances.some((item) => item.id === MAIN_INSTANCE_ID)) {
    upsertInstance({ id: MAIN_INSTANCE_ID, name: '主实例' });
  }
}

/**
 * 生成新实例的启动参数。
 *
 * 开发模式：process.execPath 是 node_modules/electron/dist/electron.exe，
 *   第一个参数必须是项目根目录（即 package.json 所在目录），之后才是自定义参数，例如
 *   electron.exe <项目根> --instance=inst_xxx
 *
 * 打包模式：process.execPath 就是应用 exe（dist-packaged/DashiNovelStudio-win32-x64/大师小说工作台.exe），
 *   不能再传项目路径，直接追加自定义参数，例如
 *   大师小说工作台.exe --instance=inst_xxx
 *
 * 另外只透传开发模式需要的 DASHI_DEV / DASHI_DEV_URL（子进程拿不到父进程的环境变量时也能连上 Vite）。
 * 数据目录相关的开关（DASHI_DATA_DIR / DASHI_PORTABLE）**故意不透传也不继承**，
 * 否则两个进程会共用同一个 dashi.db，既破坏实例隔离也会让 SQLite 并发写冲突。
 */
function buildInstanceArgs(id: string): string[] {
  const args: string[] = [];
  if (app.isPackaged) {
    args.push(`--instance=${id}`);
  } else {
    // 开发模式：编译产物在 dist/electron/electron/main/，项目根目录向上 4 层
    args.push(path.join(__dirname, '../../../../'));
    args.push(`--instance=${id}`);
    const devUrl = process.env.DASHI_DEV_URL;
    if (devUrl) args.push(`--dashi-dev-url=${devUrl}`);
  }
  if (process.env.DASHI_DEV === '1') args.push('--dashi-dev=1');
  return args;
}

/**
 * 把命令行里透传的 --dashi-* 开关还原成环境变量，供 resolveDataDir 与开发模式加载使用。
 * 只处理本程序自己写出的白名单参数，避免继承任意命令行内容。
 */
function applyForwardedSwitches(argv: string[]): void {
  const read = (name: string): string | undefined => {
    const flag = '--' + name + '=';
    const hit = argv.find((arg) => arg.startsWith(flag));
    if (!hit) return undefined;
    const value = hit.slice(flag.length).trim();
    return value || undefined;
  };
  if (read('dashi-dev') === '1') process.env.DASHI_DEV = '1';
  const devUrl = read('dashi-dev-url');
  if (devUrl) process.env.DASHI_DEV_URL = devUrl;
}

/** 新建实例并启动一个独立进程。密码校验由调用方（IPC）负责。 */
function createInstance(name?: string): InstanceSummary {
  // 形如 inst_<36 进制时间戳><随机后缀>：按创建时间大致有序，且不会与已有实例重复
  const id = makeId('inst', 12);
  const displayName = (name ?? '').trim() || '实例 ' + (readInstanceRegistry().length + 1);
  const entry = upsertInstance({ id, name: displayName.slice(0, 60) });
  // 子进程默认继承父进程环境变量：这里显式剔除数据目录覆盖，确保每个实例各自落到
  // <主实例 userData>/instances/<id>，拥有独立数据库与设置。
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DASHI_DATA_DIR;
  delete env.DASHI_PORTABLE;
  try {
    spawn(process.execPath, buildInstanceArgs(id), {
      detached: true,
      stdio: 'ignore',
      env,
    }).unref();
  } catch (err) {
    // 启动失败时回滚清单，避免留下一个永远打不开的实例
    writeInstanceRegistry(readInstanceRegistry().filter((item) => item.id !== id));
    throw new NovelError(
      'INTERNAL_ERROR',
      '启动新实例失败：' + (err instanceof Error ? err.message : String(err)),
      500,
    );
  }
  return entry;
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

/** 迷你朗读页面的 hash 查询串：`?projectId=xxx&chapterId=yyy`；无参数时返回空串。 */
function miniReaderQuery(projectId?: string, chapterId?: string): string {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (chapterId) params.set('chapterId', chapterId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * 打开迷你朗读窗口。
 * 全局只保留一个实例：已存在时只显示/聚焦，并通过 IPC 通知它切换章节，不再重复创建。
 * 不设置 parent / modal，保证主窗口收缩到托盘或最小化时它仍能独立存在。
 */
function createMiniReaderWindow(projectId?: string, chapterId?: string): BrowserWindow {
  const query = miniReaderQuery(projectId, chapterId);
  if (miniWindow && !miniWindow.isDestroyed()) {
    if (miniWindow.isMinimized()) miniWindow.restore();
    miniWindow.show();
    miniWindow.focus();
    // 已存在时用 IPC 通知页面切换章节，避免重复创建窗口
    miniWindow.webContents.send('miniReader:switch', {
      projectId: projectId ?? null,
      chapterId: chapterId ?? null,
    });
    return miniWindow;
  }

  const win = new BrowserWindow({
    width: 440,
    height: 600,
    minWidth: 380,
    minHeight: 480,
    resizable: true,
    show: false,
    title: '朗读 · ' + windowTitle(),
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: true,
    icon: windowIconPath(),
    // 不设置 parent / modal：朗读窗口需要独立存在，不能被主窗口遮挡或跟着最小化
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      // 朗读计时与音频进度不能因为窗口不可见而被节流
      backgroundThrottling: false,
    },
  });

  // 页面里的 <title> 会覆盖窗口标题，这里固定为「朗读 · 大师小说工作台」
  win.on('page-title-updated', (event) => event.preventDefault());

  win.once('ready-to-show', () => {
    win.show();
  });

  if (isDev) {
    void win.loadURL(`${DEV_URL}/mini.html#/mini-reader${query}`);
  } else {
    // loadFile 的 hash 选项只接收 hash 片段，query string 必须自己拼进去：
    // 最终得到 file://.../renderer/mini.html#/mini-reader?projectId=xxx&chapterId=yyy
    void win.loadFile(path.join(__dirname, '../../../renderer/mini.html'), {
      hash: `/mini-reader${query}`,
    });
  }

  win.on('closed', () => {
    miniWindow = null;
  });

  miniWindow = win;
  return win;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f6f7f9',
    title: windowTitle(),
    autoHideMenuBar: true,
    icon: windowIconPath(),
    // 保留系统标题栏与最小化/最大化/关闭按钮，但把标题栏交给渲染层绘制。
    // 这样「新建实例」按钮可以精确排布在最小化按钮的左侧（而不是浮在内容区顶部）。
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f7f8fa',
      symbolColor: '#1c2330',
      height: TITLEBAR_HEIGHT,
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      // 朗读不能因为窗口不可见被节流
      backgroundThrottling: false,
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
  // 托盘提示带上实例名，多实例同时运行时便于区分
  tray.setToolTip(windowTitle());
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    // 不带参数：让迷你窗口自己恢复上次朗读的章节
    { label: '朗读弹窗', click: () => createMiniReaderWindow() },
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
  // 首次启动用默认密码初始化（只存 salt + hash），并把当前实例登记进实例清单
  instanceAuth = new InstanceAuthService(core.db);
  instanceAuth.ensureInitialized();
  registerCurrentInstance();
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
    instanceAuth,
    currentInstanceId: instanceId,
    isMainInstance,
    listInstances: () => readInstanceRegistry(),
    createInstance: (name?: string) => createInstance(name),
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
    openMiniReader: (projectId?: string, chapterId?: string) => {
      createMiniReaderWindow(projectId, chapterId);
    },
    closeMiniReader: () => {
      if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
      miniWindow = null;
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
  // 退出时销毁独立的迷你朗读窗口，避免残留进程
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.destroy();
  }
  miniWindow = null;
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
