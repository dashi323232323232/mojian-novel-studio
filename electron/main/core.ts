import path from 'node:path';
import { createDatabase, type Database } from './db/database';
import { ChangeBus } from './events';
import { SettingsService } from './services/settings';
import { ProjectService, type ServiceContext } from './services/projects';
import { StructureService } from './services/structure';
import { OutlineService } from './services/outline';
import { ForeshadowService } from './services/foreshadow';
import { AudioService } from './services/audio';
import { BackupService } from './services/backup';
import { APP_VERSION, API_VERSION } from '@shared/constants';
import { NovelError } from './errors';

/**
 * 应用核心：主进程内所有能力的单一入口。
 * Electron IPC 与本地 HTTP API 都调用这里，确保两边行为完全一致。
 */
export class AppCore {
  readonly dataDir: string;
  readonly dbPath: string;
  readonly db: Database;
  readonly changes = new ChangeBus();
  readonly settings: SettingsService;
  readonly projects: ProjectService;
  readonly structure: StructureService;
  readonly outline: OutlineService;
  readonly foreshadow: ForeshadowService;
  readonly audio: AudioService;
  readonly backup: BackupService;
  readonly startedAt = new Date().toISOString();
  private closed = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, 'dashi.db');
    this.db = createDatabase(this.dbPath);
    const ctx: ServiceContext = {
      db: this.db,
      settings: undefined as unknown as SettingsService,
      changes: this.changes,
      dataDir,
    };
    this.settings = new SettingsService(this.db);
    ctx.settings = this.settings;
    this.projects = new ProjectService(ctx);
    this.structure = new StructureService(ctx);
    this.outline = new OutlineService(ctx);
    this.foreshadow = new ForeshadowService(ctx);
    this.backup = new BackupService({ dataDir, db: this.db });
    this.audio = new AudioService(
      ctx,
      () => {
        const cfg = this.settings.getAudioConfig();
        return {
          baseUrl: cfg.openaiBaseUrl,
          apiKey: cfg.openaiApiKey ?? '',
          model: cfg.openaiModel,
          voice: cfg.openaiVoice,
        };
      },
      () => this.settings.getAudioConfig().sapiRate,
    );
    this.backup.startAutoBackup();
  }

  info() {
    return {
      name: '大师小说工作台',
      appVersion: APP_VERSION,
      apiVersion: API_VERSION,
      dataDir: this.dataDir,
      dbPath: this.dbPath,
      startedAt: this.startedAt,
    };
  }

  /** 数据库一致性检查 + 统计（设置页与验收使用）。 */
  stats(): {
    projects: number;
    stages: number;
    chapters: number;
    words: number;
    nodes: number;
    edges: number;
    foreshadows: number;
    audioJobs: number;
    dbSize: number;
    backupCount: number;
    lastBackupAt: string | null;
  } {
    const one = (sql: string): number => Number(this.db.get<{ n: number }>(sql)?.n ?? 0);
    const fs = require('node:fs') as typeof import('node:fs');
    let dbSize = 0;
    try {
      dbSize = fs.statSync(this.dbPath).size;
    } catch {
      /* ignore */
    }
    const backup = this.backup.info();
    return {
      projects: one('SELECT COUNT(*) AS n FROM projects'),
      stages: one('SELECT COUNT(*) AS n FROM stages'),
      chapters: one('SELECT COUNT(*) AS n FROM chapters'),
      words: one('SELECT COALESCE(SUM(word_count),0) AS n FROM chapters'),
      nodes: one('SELECT COUNT(*) AS n FROM outline_nodes'),
      edges: one('SELECT COUNT(*) AS n FROM outline_edges'),
      foreshadows: one('SELECT COUNT(*) AS n FROM foreshadows'),
      audioJobs: one('SELECT COUNT(*) AS n FROM audio_jobs'),
      dbSize,
      backupCount: backup.count,
      lastBackupAt: backup.lastBackupAt,
    };
  }

  ensureProject(projectId: string) {
    return this.projects.get(projectId);
  }

  assertChapter(projectId: string, chapterId: string) {
    const chapter = this.structure.getChapter(chapterId);
    if (chapter.projectId !== projectId) {
      throw new NovelError('NOT_FOUND', `章节不属于项目 ${projectId}`, 404);
    }
    return chapter;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.backup.stopAutoBackup();
    this.backup.prune();
    this.db.close();
  }
}
