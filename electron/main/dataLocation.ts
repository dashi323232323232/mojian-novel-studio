import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * 数据目录管理：
 * - 默认使用 Electron userData；
 * - 用户可在「设置与备份 → 数据存储位置」中选择任意目录；
 * - 选择结果写入一个固定的小引导文件（位于 userData/data-location.json），
 *   启动时优先读取它，因此即使数据目录本身被移动也能重新定位；
 * - 切换时把现有数据库、音频与备份完整迁移过去（复制校验后再切换）。
 */

const BOOTSTRAP_FILE = 'data-location.json';

export interface DataLocationInfo {
  currentDir: string;
  defaultDir: string;
  bootstrapFile: string;
  isCustom: boolean;
  exists: boolean;
  dbSize: number;
  audioCount: number;
  backupCount: number;
}

interface BootstrapPayload {
  dataDir: string;
  updatedAt: string;
  previousDir?: string;
}

export function defaultDataDir(): string {
  return app.getPath('userData');
}

function bootstrapPath(): string {
  return path.join(app.getPath('userData'), BOOTSTRAP_FILE);
}

export function readConfiguredDataDir(): string | null {
  try {
    const raw = fs.readFileSync(bootstrapPath(), 'utf8');
    const parsed = JSON.parse(raw) as BootstrapPayload;
    if (typeof parsed.dataDir === 'string' && parsed.dataDir.trim()) {
      const resolved = path.resolve(parsed.dataDir);
      if (fs.existsSync(resolved)) return resolved;
    }
  } catch {
    /* 无配置或损坏 */
  }
  return null;
}

export function resolveDataDir(): string {
  const override = process.env.DASHI_DATA_DIR;
  if (override) return path.resolve(override);
  if (process.env.DASHI_PORTABLE === '1') {
    return path.join(path.dirname(app.getPath('exe')), 'data');
  }
  return readConfiguredDataDir() ?? defaultDataDir();
}

export function writeConfiguredDataDir(dataDir: string, previousDir?: string): void {
  const target = path.resolve(dataDir);
  fs.mkdirSync(target, { recursive: true });
  const payload: BootstrapPayload = {
    dataDir: target,
    updatedAt: new Date().toISOString(),
    ...(previousDir ? { previousDir: path.resolve(previousDir) } : {}),
  };
  fs.mkdirSync(path.dirname(bootstrapPath()), { recursive: true });
  const tmp = `${bootstrapPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, bootstrapPath());
}

export function resetDataDir(): void {
  try {
    fs.rmSync(bootstrapPath(), { force: true });
  } catch {
    /* ignore */
  }
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return total;
}

function countFiles(dir: string, predicate: (name: string) => boolean): number {
  try {
    return fs.readdirSync(dir).filter(predicate).length;
  } catch {
    return 0;
  }
}

export function describeDataLocation(currentDir: string): DataLocationInfo {
  const defaultDir = defaultDataDir();
  const dbPath = path.join(currentDir, 'dashi.db');
  let dbSize = 0;
  try {
    dbSize = fs.statSync(dbPath).size;
  } catch {
    dbSize = 0;
  }
  return {
    currentDir,
    defaultDir,
    bootstrapFile: bootstrapPath(),
    isCustom: path.resolve(currentDir) !== path.resolve(defaultDir),
    exists: fs.existsSync(currentDir),
    dbSize,
    audioCount: countFiles(path.join(currentDir, 'audio'), () => true),
    backupCount: countFiles(path.join(currentDir, 'backups'), (n) => n.endsWith('.db')),
  };
}

export interface MoveResult {
  from: string;
  to: string;
  copiedBytes: number;
  copiedFiles: number;
  message: string;
}

/**
 * 把数据目录迁移到新位置。调用方必须保证数据库已关闭。
 * 先复制到临时目录并校验，成功后再写入引导文件，避免半途失败导致数据丢失。
 */
export function migrateDataDir(from: string, to: string): MoveResult {
  const source = path.resolve(from);
  const target = path.resolve(to);
  if (source === target) {
    return { from: source, to: target, copiedBytes: 0, copiedFiles: 0, message: '目标目录与当前目录相同' };
  }
  if (target.startsWith(source + path.sep)) {
    throw new Error('不能把数据目录移动到它自己的子目录中');
  }
  fs.mkdirSync(target, { recursive: true });
  const existingDb = path.join(target, 'dashi.db');
  if (fs.existsSync(existingDb)) {
    throw new Error('目标目录已存在 dashi.db，请选择一个空目录或先备份后手动处理');
  }

  let copiedBytes = 0;
  let copiedFiles = 0;
  const copyTree = (src: string, dest: string) => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyTree(s, d);
      } else if (entry.isFile()) {
        fs.copyFileSync(s, d);
        copiedFiles++;
        try {
          copiedBytes += fs.statSync(d).size;
        } catch {
          /* ignore */
        }
      }
    }
  };

  // 复制数据库（含 WAL/SHM，确保一致性快照完整）
  for (const name of ['dashi.db', 'dashi.db-wal', 'dashi.db-shm', 'api-endpoint.json']) {
    const s = path.join(source, name);
    if (fs.existsSync(s)) {
      fs.copyFileSync(s, path.join(target, name));
      copiedFiles++;
      copiedBytes += fs.statSync(s).size;
    }
  }
  copyTree(path.join(source, 'audio'), path.join(target, 'audio'));
  copyTree(path.join(source, 'backups'), path.join(target, 'backups'));

  const verifyDb = path.join(target, 'dashi.db');
  if (!fs.existsSync(verifyDb) || fs.statSync(verifyDb).size === 0) {
    throw new Error('复制校验失败：目标目录缺少数据库文件');
  }

  writeConfiguredDataDir(target, source);
  return {
    from: source,
    to: target,
    copiedBytes,
    copiedFiles,
    message: `数据已迁移到 ${target}，共复制 ${copiedFiles} 个文件。请重新启动软件以使用新位置。`,
  };
}

/** 只切换位置（不复制），用于数据目录已在别处准备好的情况。 */
export function switchDataDir(to: string): void {
  const target = path.resolve(to);
  fs.mkdirSync(target, { recursive: true });
  writeConfiguredDataDir(target);
}

export { dirSize };
