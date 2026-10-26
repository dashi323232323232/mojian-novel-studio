import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../util';

/**
 * 数据访问基础设施。
 * - 每个应用一个 SQLite 数据库文件（位于用户数据目录），使用 WAL 模式。
 * - 章节正文单独放在 chapter_contents 表，避免章节列表查询拖动大量文本。
 * - 所有写操作通过 transaction() 包裹，崩溃时由 SQLite 回滚保证一致性。
 */
export class Database {
  readonly filePath: string;
  readonly raw: DatabaseSync;
  private txDepth = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.raw = new DatabaseSync(filePath);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA synchronous = FULL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    const current = Number(row?.user_version ?? 0);
    if (current < 1) {
      this.raw.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          genre TEXT NOT NULL DEFAULT '',
          cover_color TEXT NOT NULL DEFAULT '#5b6cff',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT
        );

        CREATE TABLE IF NOT EXISTS stages (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sort_order REAL NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_stages_project ON stages(project_id, sort_order);

        CREATE TABLE IF NOT EXISTS chapters (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          sort_order REAL NOT NULL,
          word_count INTEGER NOT NULL DEFAULT 0,
          content_updated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_chapters_stage ON chapters(stage_id, sort_order);

        CREATE TABLE IF NOT EXISTS chapter_contents (
          chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
          content TEXT NOT NULL DEFAULT '',
          revision INTEGER NOT NULL DEFAULT 0,
          word_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chapter_versions (
          id TEXT PRIMARY KEY,
          chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          content TEXT NOT NULL,
          word_count INTEGER NOT NULL,
          saved_at TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'manual'
        );
        CREATE INDEX IF NOT EXISTS idx_versions_chapter ON chapter_versions(chapter_id, saved_at DESC);

        CREATE TABLE IF NOT EXISTS outline_nodes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          x REAL NOT NULL DEFAULT 0,
          y REAL NOT NULL DEFAULT 0,
          width REAL NOT NULL DEFAULT 220,
          height REAL NOT NULL DEFAULT 120,
          color TEXT,
          data TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_project ON outline_nodes(project_id);

        CREATE TABLE IF NOT EXISTS outline_edges (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
          relation TEXT NOT NULL DEFAULT 'sequence',
          label TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (source_id, target_id, relation)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_project ON outline_edges(project_id);

        CREATE TABLE IF NOT EXISTS node_chapter_links (
          node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
          chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (node_id, chapter_id)
        );
        CREATE INDEX IF NOT EXISTS idx_links_chapter ON node_chapter_links(chapter_id);

        CREATE TABLE IF NOT EXISTS foreshadows (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'planned',
          planted_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
          planned_resolve_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
          planned_resolve_stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
          node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
          character_node_ids TEXT NOT NULL DEFAULT '[]',
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_foreshadows_project ON foreshadows(project_id);

        CREATE TABLE IF NOT EXISTS foreshadow_chapters (
          foreshadow_id TEXT NOT NULL REFERENCES foreshadows(id) ON DELETE CASCADE,
          chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'related',
          PRIMARY KEY (foreshadow_id, chapter_id, role)
        );
        CREATE INDEX IF NOT EXISTS idx_fc_chapter ON foreshadow_chapters(chapter_id);

        CREATE TABLE IF NOT EXISTS audio_jobs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
          chapter_name TEXT NOT NULL,
          status TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,
          message TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL,
          voice_id TEXT NOT NULL,
          voice_name TEXT NOT NULL,
          rate INTEGER NOT NULL DEFAULT 0,
          volume INTEGER NOT NULL DEFAULT 100,
          format TEXT NOT NULL DEFAULT 'wav',
          file_name TEXT,
          file_path TEXT,
          duration_ms INTEGER,
          char_count INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audio_project ON audio_jobs(project_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_settings (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (project_id, key)
        );

        CREATE TABLE IF NOT EXISTS api_request_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          status INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,
          actor TEXT NOT NULL DEFAULT 'agent',
          ip TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT ''
        );

        PRAGMA user_version = 1;
      `);
    }
    // 未来版本在此追加迁移分支，保证旧数据库可平滑升级。
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.raw.prepare(sql).run(...(params as never[])) as {
      changes: number;
      lastInsertRowid: number | bigint;
    };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.txDepth++;
    try {
      this.raw.exec('BEGIN IMMEDIATE;');
      const result = fn();
      this.raw.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK;');
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  /** 生成一致性快照（用于备份），不阻塞正常读写。 */
  backupTo(targetPath: string): void {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tmp = `${targetPath}.tmp-${process.pid}`;
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    const escaped = tmp.replace(/'/g, "''");
    this.raw.exec(`VACUUM INTO '${escaped}';`);
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
    fs.renameSync(tmp, targetPath);
  }

  close(): void {
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      /* ignore */
    }
    this.raw.close();
  }
}

export function createDatabase(filePath: string): Database {
  return new Database(filePath);
}

export function now(): string {
  return nowIso();
}
