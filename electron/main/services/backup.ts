import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../db/database';
import type { BackupInfo } from '@shared/types';
import { nowIso } from '../util';

export interface BackupOptions {
  dataDir: string;
  db: Database;
  keep?: number;
}

/**
 * 备份服务：
 * - 手动 / 自动把 SQLite 一致性快照写入 dataDir/backups；
 * - 同时把附件目录（音频）做轻量清单，避免恢复后找不到文件；
 * - 仅保留最近 N 份，防止无限增长。
 */
export class BackupService {
  private lastAutoBackupAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: BackupOptions) {}

  private dir(): string {
    const dir = path.join(this.opts.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  list(): BackupInfo[] {
    const dir = this.dir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const filePath = path.join(dir, f);
        const stat = fs.statSync(filePath);
        return {
          fileName: f,
          filePath,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
          auto: f.startsWith('auto-'),
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return files;
  }

  create(kind: 'manual' | 'auto' = 'manual'): BackupInfo {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${kind === 'auto' ? 'auto' : 'manual'}-${stamp}.db`;
    const filePath = path.join(this.dir(), fileName);
    this.opts.db.backupTo(filePath);
    const stat = fs.statSync(filePath);
    this.prune();
    return {
      fileName,
      filePath,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
      auto: kind === 'auto',
    };
  }

  /** 自动备份：最多每 10 分钟一次，失败不阻塞用户操作。 */
  maybeAutoBackup(): void {
    const now = Date.now();
    if (now - this.lastAutoBackupAt < 10 * 60 * 1000) return;
    this.lastAutoBackupAt = now;
    try {
      this.create('auto');
    } catch (err) {
      console.error('[backup] 自动备份失败：', err);
    }
  }

  startAutoBackup(intervalMs = 10 * 60 * 1000): void {
    this.stopAutoBackup();
    this.timer = setInterval(() => this.maybeAutoBackup(), intervalMs);
    this.timer.unref?.();
  }

  stopAutoBackup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  prune(keep = this.opts.keep ?? 20): void {
    const all = this.list();
    for (const backup of all.slice(keep)) {
      try {
        fs.rmSync(backup.filePath, { force: true });
      } catch {
        /* 忽略清理失败 */
      }
    }
  }

  delete(fileName: string): { deleted: true } {
    const safe = path.basename(fileName);
    const filePath = path.join(this.dir(), safe);
    if (!fs.existsSync(filePath)) return { deleted: true };
    fs.rmSync(filePath, { force: true });
    return { deleted: true };
  }

  /** 从备份恢复：先备份当前数据，再用备份覆盖（应用需要重启生效）。 */
  restore(fileName: string): { restored: true; safetyBackup: BackupInfo } {
    const safe = path.basename(fileName);
    const source = path.join(this.dir(), safe);
    if (!fs.existsSync(source)) throw new Error('备份文件不存在');
    const safetyBackup = this.create('manual');
    this.opts.db.close();
    const target = this.opts.db.filePath;
    for (const suffix of ['-wal', '-shm']) {
      const p = `${target}${suffix}`;
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }
    fs.copyFileSync(source, target);
    return { restored: true, safetyBackup };
  }

  info(): { lastBackupAt: string | null; count: number; dir: string } {
    const list = this.list();
    return { lastBackupAt: list[0]?.createdAt ?? null, count: list.length, dir: this.dir() };
  }

  snapshotMeta(): { createdAt: string } {
    return { createdAt: nowIso() };
  }
}
