import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../db/database';
import type { SettingsService } from './settings';
import type { ChangeBus } from '../events';
import { NovelError, notFound, validationError, confirmationRequired } from '../errors';
import { makeId, nowIso } from '../util';
import { countWords } from '@shared/text';
import { DEFAULT_PROJECT_COLORS } from '@shared/constants';
import type { Chapter, Project, Stage } from '@shared/types';

export interface ServiceContext {
  db: Database;
  settings: SettingsService;
  changes: ChangeBus;
  dataDir: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  genre: string;
  cover_color: string;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  chapter_count?: number;
  word_count?: number;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    genre: row.genre ?? '',
    coverColor: row.cover_color,
    chapterCount: Number(row.chapter_count ?? 0),
    wordCount: Number(row.word_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at ?? null,
  };
}

const PROJECT_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM chapters c WHERE c.project_id = p.id) AS chapter_count,
    (SELECT COALESCE(SUM(c.word_count), 0) FROM chapters c WHERE c.project_id = p.id) AS word_count
  FROM projects p
`;

export class ProjectService {
  constructor(private ctx: ServiceContext) {}

  list(): Project[] {
    const rows = this.ctx.db.all<ProjectRow>(
      `${PROJECT_SELECT} ORDER BY COALESCE(p.last_opened_at, p.updated_at) DESC, p.created_at DESC`,
    );
    return rows.map(mapProject);
  }

  get(id: string): Project {
    const row = this.ctx.db.get<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = ?`, id);
    if (!row) throw notFound(`项目不存在：${id}`);
    return mapProject(row);
  }

  create(input: {
    name: string;
    description?: string;
    genre?: string;
    coverColor?: string;
  }): Project {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name) throw validationError('项目名称不能为空');
    if (name.length > 120) throw validationError('项目名称不能超过 120 个字符');
    const id = makeId('prj');
    const ts = nowIso();
    const coverColor =
      typeof input.coverColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.coverColor)
        ? input.coverColor
        : DEFAULT_PROJECT_COLORS[Math.floor(Math.random() * DEFAULT_PROJECT_COLORS.length)];
    this.ctx.db.transaction(() => {
      this.ctx.db.run(
        `INSERT INTO projects (id, name, description, genre, cover_color, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        name,
        (input.description ?? '').trim(),
        (input.genre ?? '').trim(),
        coverColor,
        ts,
        ts,
        ts,
      );
      // 新项目默认创建一个「第一阶段」，空项目同样可以立即使用。
      this.ctx.db.run(
        `INSERT INTO stages (id, project_id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
        makeId('stg'),
        id,
        '第一阶段',
        ts,
        ts,
      );
      this.ctx.db.run(
        `INSERT INTO project_settings (project_id, key, value) VALUES (?, 'linkSplitRatio', '0.5')`,
        id,
      );
    });
    this.ctx.settings.setLastProject(id);
    this.ctx.changes.emitChange({ scope: 'projects', projectId: id, action: 'create' });
    return this.get(id);
  }

  update(
    id: string,
    patch: { name?: string; description?: string; genre?: string; coverColor?: string },
  ): Project {
    const existing = this.get(id);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw validationError('项目名称不能为空');
      if (name.length > 120) throw validationError('项目名称不能超过 120 个字符');
      sets.push('name = ?');
      params.push(name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(String(patch.description).slice(0, 5000));
    }
    if (patch.genre !== undefined) {
      sets.push('genre = ?');
      params.push(String(patch.genre).slice(0, 60));
    }
    if (patch.coverColor !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(String(patch.coverColor))) {
        throw validationError('封面颜色格式必须为 #RRGGBB');
      }
      sets.push('cover_color = ?');
      params.push(String(patch.coverColor));
    }
    if (!sets.length) return existing;
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    this.ctx.db.run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, ...params);
    this.ctx.changes.emitChange({ scope: 'projects', projectId: id, action: 'update' });
    return this.get(id);
  }

  touch(id: string): Project {
    this.ctx.db.run('UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
    this.ctx.settings.setLastProject(id);
    return this.get(id);
  }

  delete(id: string, options: { confirm?: boolean; confirmName?: string } = {}): { deleted: true; id: string } {
    const project = this.get(id);
    if (!options.confirm) {
      throw confirmationRequired(
        `删除项目「${project.name}」是危险操作，需要显式确认（confirm=true，并填写 confirmName 或项目名称）。`,
        { projectId: id, chapterCount: project.chapterCount, wordCount: project.wordCount },
      );
    }
    if (options.confirmName !== undefined && options.confirmName !== project.name) {
      throw new NovelError('CONFIRMATION_REQUIRED', '确认名称与项目名称不一致，删除已取消。', 409);
    }
    this.ctx.db.transaction(() => {
      this.ctx.db.run('DELETE FROM projects WHERE id = ?', id);
      this.ctx.db.run('DELETE FROM project_settings WHERE project_id = ?', id);
    });
    // 删除该项目的音频文件目录（数据库记录已级联删除）
    try {
      const dir = require('node:path').join(this.ctx.dataDir, 'audio', id);
      if (require('node:fs').existsSync(dir)) require('node:fs').rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 文件清理失败不阻塞项目删除 */
    }
    const last = this.ctx.settings.getUi().lastProjectId;
    if (last === id) this.ctx.settings.setLastProject(null);
    this.ctx.changes.emitChange({ scope: 'projects', projectId: id, action: 'delete' });
    return { deleted: true, id };
  }

  structure(id: string): { project: Project; stages: Stage[]; chapters: Chapter[] } {
    const project = this.get(id);
    const stages = this.ctx.db.all<{
      id: string;
      project_id: string;
      name: string;
      summary: string;
      sort_order: number;
      created_at: string;
      updated_at: string;
      chapter_count: number;
      word_count: number;
    }>(
      `SELECT s.*,
         (SELECT COUNT(*) FROM chapters c WHERE c.stage_id = s.id) AS chapter_count,
         (SELECT COALESCE(SUM(c.word_count),0) FROM chapters c WHERE c.stage_id = s.id) AS word_count
       FROM stages s WHERE s.project_id = ? ORDER BY s.sort_order ASC, s.created_at ASC`,
      id,
    );
    const chapters = this.ctx.db.all<{
      id: string;
      project_id: string;
      stage_id: string | null;
      name: string;
      summary: string;
      sort_order: number;
      word_count: number;
      content_updated_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC`,
      id,
    );
    return {
      project,
      stages: stages.map((s) => ({
        id: s.id,
        projectId: s.project_id,
        name: s.name,
        summary: s.summary ?? '',
        sortOrder: s.sort_order,
        chapterCount: Number(s.chapter_count),
        wordCount: Number(s.word_count),
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
      chapters: chapters.map((c) => ({
        id: c.id,
        projectId: c.project_id,
        stageId: c.stage_id,
        name: c.name,
        summary: c.summary ?? '',
        sortOrder: c.sort_order,
        wordCount: Number(c.word_count),
        contentUpdatedAt: c.content_updated_at,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    };
  }

  /**
   * 导出所选章节为纯文本（供本地 API 使用）。
   * 文件写入数据目录的 exports/ 下，返回可读的绝对路径。
   */
  exportChapters(
    projectId: string,
    chapterIds: string[],
    options: { includeStageHeaders?: boolean; fileName?: string } = {},
  ): { filePath: string; fileName: string; chapterCount: number; wordCount: number; bytes: number } {
    const structure = this.structure(projectId);
    const ids = Array.isArray(chapterIds) ? chapterIds : [];
    if (!ids.length) throw validationError('chapterIds 不能为空');
    const chosen = structure.chapters.filter((c) => ids.includes(c.id));
    if (!chosen.length) throw notFound('所选章节不存在');
    const stageOrder = structure.stages.map((s) => s.id);
    const grouped = new Map<string | null, typeof chosen>();
    for (const c of chosen) {
      const key = c.stageId ?? null;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }
    const keys = [...grouped.keys()].sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return stageOrder.indexOf(a) - stageOrder.indexOf(b);
    });
    const parts: string[] = [];
    for (const key of keys) {
      const list = grouped.get(key)!;
      const stage = structure.stages.find((s) => s.id === key);
      if (options.includeStageHeaders !== false) {
        parts.push('\n\n========== ' + (stage?.name ?? '未分阶段') + ' ==========\n');
        if (stage?.summary) parts.push(stage.summary + '\n');
      }
      for (const chapter of list) {
        const content = this.ctx.db.get<{ content: string }>(
          'SELECT content FROM chapter_contents WHERE chapter_id = ?',
          chapter.id,
        );
        parts.push('\n\n' + chapter.name + '\n');
        if (chapter.summary) parts.push('【简介】' + chapter.summary + '\n');
        parts.push('\n');
        parts.push(content?.content || '（本章暂无正文）');
      }
    }
    const header =
      structure.project.name +
      '\n导出时间：' +
      new Date().toLocaleString('zh-CN') +
      '\n共 ' +
      chosen.length +
      ' 章\n';
    const text = header + parts.join('') + '\n';

    const exportsDir = path.join(this.ctx.dataDir, 'exports');
    fs.mkdirSync(exportsDir, { recursive: true });
    const safeName = (options.fileName || structure.project.name + '-' + Date.now())
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 80);
    const fileName = safeName.endsWith('.txt') ? safeName : safeName + '.txt';
    const filePath = path.join(exportsDir, fileName);
    fs.writeFileSync(filePath, text, 'utf8');
    return {
      filePath,
      fileName,
      chapterCount: chosen.length,
      wordCount: chosen.reduce((sum, c) => sum + c.wordCount, 0),
      bytes: Buffer.byteLength(text, 'utf8'),
    };
  }

  /** 全库搜索（书名/章节正文），用于内容页搜索框。 */
  search(query: string, projectId?: string, limit = 30): Array<{
    projectId: string;
    chapterId: string;
    chapterName: string;
    stageName: string | null;
    snippet: string;
  }> {
    const q = query.trim();
    if (!q) return [];
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    const rows = this.ctx.db.all<{
      project_id: string;
      chapter_id: string;
      chapter_name: string;
      stage_name: string | null;
      content: string;
    }>(
      `SELECT c.project_id, c.id AS chapter_id, c.name AS chapter_name, s.name AS stage_name,
              COALESCE(cc.content, '') AS content
       FROM chapters c
       LEFT JOIN stages s ON s.id = c.stage_id
       LEFT JOIN chapter_contents cc ON cc.chapter_id = c.id
       WHERE (? IS NULL OR c.project_id = ?)
         AND (c.name LIKE ? ESCAPE '\\' OR cc.content LIKE ? ESCAPE '\\')
       ORDER BY c.updated_at DESC
       LIMIT ?`,
      projectId ?? null,
      projectId ?? null,
      like,
      like,
      limit,
    );
    return rows.map((r) => {
      const idx = r.content.toLowerCase().indexOf(q.toLowerCase());
      let snippet = r.content.slice(Math.max(0, idx - 30), Math.max(0, idx - 30) + 100).replace(/\s+/g, ' ');
      if (idx < 0) snippet = r.content.replace(/\s+/g, ' ').slice(0, 100);
      return {
        projectId: r.project_id,
        chapterId: r.chapter_id,
        chapterName: r.chapter_name,
        stageName: r.stage_name,
        snippet: snippet.trim(),
      };
    });
  }

  refreshProjectStats(projectId: string): void {
    this.ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', nowIso(), projectId);
  }

  recomputeWordCount(chapterId: string): number {
    const row = this.ctx.db.get<{ content: string }>(
      'SELECT content FROM chapter_contents WHERE chapter_id = ?',
      chapterId,
    );
    const count = countWords(row?.content ?? '');
    this.ctx.db.run(
      'UPDATE chapters SET word_count = ?, updated_at = ? WHERE id = ?',
      count,
      nowIso(),
      chapterId,
    );
    return count;
  }
}
