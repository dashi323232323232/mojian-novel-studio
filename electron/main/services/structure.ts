import type { ServiceContext } from './projects';
import { NovelError, notFound, validationError, confirmationRequired } from '../errors';
import { makeId, nowIso, clamp } from '../util';
import { countWords } from '@shared/text';
import type {
  Chapter,
  ChapterContent,
  ChapterSaveResult,
  ChapterVersion,
  ChapterVersionsPayload,
  Stage,
} from '@shared/types';

interface StageRow {
  id: string;
  project_id: string;
  name: string;
  summary: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface ChapterRow {
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
}

function mapStage(row: StageRow, chapterCount = 0, wordCount = 0): Stage {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    summary: row.summary ?? '',
    sortOrder: row.sort_order,
    chapterCount,
    wordCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    projectId: row.project_id,
    stageId: row.stage_id,
    name: row.name,
    summary: row.summary ?? '',
    sortOrder: row.sort_order,
    wordCount: Number(row.word_count ?? 0),
    contentUpdatedAt: row.content_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateName(value: unknown, label: string, max = 200): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw validationError(`${label}不能为空`);
  if (name.length > max) throw validationError(`${label}不能超过 ${max} 个字符`);
  return name;
}

/** 阶段与章节：创建、重命名、移动、排序、删除。 */
export class StructureService {
  constructor(private ctx: ServiceContext) {}

  private assertProject(projectId: string): void {
    const row = this.ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
    if (!row) throw notFound(`项目不存在：${projectId}`);
  }

  getStage(stageId: string): Stage {
    const row = this.ctx.db.get<StageRow>('SELECT * FROM stages WHERE id = ?', stageId);
    if (!row) throw notFound(`阶段不存在：${stageId}`);
    return mapStage(row);
  }

  getChapter(chapterId: string): Chapter {
    const row = this.ctx.db.get<ChapterRow>('SELECT * FROM chapters WHERE id = ?', chapterId);
    if (!row) throw notFound(`章节不存在：${chapterId}`);
    return mapChapter(row);
  }

  listStages(projectId: string): Stage[] {
    this.assertProject(projectId);
    return this.ctx.db
      .all<StageRow & { chapter_count: number; word_count: number }>(
        `SELECT s.*,
           (SELECT COUNT(*) FROM chapters c WHERE c.stage_id = s.id) AS chapter_count,
           (SELECT COALESCE(SUM(c.word_count),0) FROM chapters c WHERE c.stage_id = s.id) AS word_count
         FROM stages s WHERE s.project_id = ? ORDER BY s.sort_order ASC, s.created_at ASC`,
        projectId,
      )
      .map((s) => mapStage(s, Number(s.chapter_count), Number(s.word_count)));
  }

  listChapters(projectId: string, stageId?: string | null): Chapter[] {
    this.assertProject(projectId);
    const rows = stageId
      ? this.ctx.db.all<ChapterRow>(
          'SELECT * FROM chapters WHERE project_id = ? AND stage_id = ? ORDER BY sort_order ASC, created_at ASC',
          projectId,
          stageId,
        )
      : this.ctx.db.all<ChapterRow>(
          'SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC',
          projectId,
        );
    return rows.map(mapChapter);
  }

  createStage(projectId: string, input: { name: string; summary?: string; index?: number }): Stage {
    this.assertProject(projectId);
    const name = validateName(input?.name, '阶段名称', 120);
    const summary = typeof input.summary === 'string' ? input.summary : '';
    const max = this.ctx.db.get<{ m: number | null }>(
      'SELECT MAX(sort_order) AS m FROM stages WHERE project_id = ?',
      projectId,
    );
    const order = (max?.m ?? -1) + 1;
    const id = makeId('stg');
    const ts = nowIso();
    this.ctx.db.transaction(() => {
      this.ctx.db.run(
        `INSERT INTO stages (id, project_id, name, summary, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        projectId,
        name,
        summary,
        order,
        ts,
        ts,
      );
      this.ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', ts, projectId);
    });
    this.ctx.changes.emitChange({ scope: 'structure', projectId, action: 'stage.create' });
    return this.getStage(id);
  }

  updateStage(stageId: string, patch: { name?: string; summary?: string }): Stage {
    const stage = this.getStage(stageId);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(validateName(patch.name, '阶段名称', 120));
    }
    if (patch.summary !== undefined) {
      sets.push('summary = ?');
      params.push(String(patch.summary));
    }
    if (!sets.length) return stage;
    sets.push('updated_at = ?');
    params.push(nowIso(), stageId);
    this.ctx.db.run(`UPDATE stages SET ${sets.join(', ')} WHERE id = ?`, ...params);
    this.syncStageNode(stageId);
    this.ctx.changes.emitChange({ scope: 'structure', projectId: stage.projectId, action: 'stage.update' });
    return this.getStage(stageId);
  }

  /** 把阶段名称/简介同步到绑定的大纲节点。 */
  private syncStageNode(stageId: string): void {
    const stage = this.ctx.db.get<{ name: string; summary: string }>(
      'SELECT name, summary FROM stages WHERE id = ?',
      stageId,
    );
    if (!stage) return;
    this.ctx.db.run(
      `UPDATE outline_nodes SET title = ?, description = ?, updated_at = ?
       WHERE stage_id = ? AND type = 'stage'`,
      stage.name,
      stage.summary ?? '',
      nowIso(),
      stageId,
    );
  }

  /** 把章节名称/简介同步到绑定的具体章节节点。 */
  private syncChapterNode(chapterId: string): void {
    const chapter = this.ctx.db.get<{ name: string; summary: string }>(
      'SELECT name, summary FROM chapters WHERE id = ?',
      chapterId,
    );
    if (!chapter) return;
    this.ctx.db.run(
      `UPDATE outline_nodes SET title = ?, description = ?, updated_at = ?
       WHERE chapter_id = ? AND type = 'chapter'`,
      chapter.name,
      chapter.summary ?? '',
      nowIso(),
      chapterId,
    );
  }

  /** 大纲节点改动后回写章节/阶段（由 OutlineService 调用）。 */
  syncBoundEntity(
    nodeType: string,
    stageId: string | null,
    chapterId: string | null,
    title: string,
    description: string,
  ): void {
    const ts = nowIso();
    if (nodeType === 'stage' && stageId) {
      this.ctx.db.run(
        'UPDATE stages SET name = ?, summary = ?, updated_at = ? WHERE id = ?',
        title,
        description,
        ts,
        stageId,
      );
    } else if (nodeType === 'chapter' && chapterId) {
      this.ctx.db.run(
        'UPDATE chapters SET name = ?, summary = ?, updated_at = ? WHERE id = ?',
        title,
        description,
        ts,
        chapterId,
      );
    }
  }

  reorderStages(projectId: string, orderedIds: string[]): Stage[] {
    this.assertProject(projectId);
    if (!Array.isArray(orderedIds) || !orderedIds.length) {
      throw validationError('orderedIds 必须是非空数组');
    }
    const existing = this.listStages(projectId).map((s) => s.id);
    if (orderedIds.length !== existing.length || !existing.every((id) => orderedIds.includes(id))) {
      throw validationError('阶段排序列表必须包含项目的全部阶段且不重复', {
        expected: existing,
        received: orderedIds,
      });
    }
    const ts = nowIso();
    this.ctx.db.transaction(() => {
      orderedIds.forEach((id, index) => {
        this.ctx.db.run('UPDATE stages SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?', index, ts, id, projectId);
      });
    });
    this.ctx.changes.emitChange({ scope: 'structure', projectId, action: 'stage.reorder' });
    return this.listStages(projectId);
  }

  createChapter(
    projectId: string,
    input: { name: string; summary?: string; stageId?: string | null; content?: string; index?: number },
  ): Chapter {
    this.assertProject(projectId);
    const name = validateName(input?.name, '章节名称', 200);
    const summary = typeof input.summary === 'string' ? input.summary : '';
    let stageId: string | null = input.stageId ?? null;
    if (stageId) {
      const stage = this.ctx.db.get<{ project_id: string }>('SELECT project_id FROM stages WHERE id = ?', stageId);
      if (!stage) throw notFound(`阶段不存在：${stageId}`);
      if (stage.project_id !== projectId) throw validationError('所属阶段不属于该项目');
    } else {
      const first = this.ctx.db.get<{ id: string }>(
        'SELECT id FROM stages WHERE project_id = ? ORDER BY sort_order ASC LIMIT 1',
        projectId,
      );
      stageId = first?.id ?? null;
    }
    const id = makeId('chp');
    const ts = nowIso();
    const content = typeof input.content === 'string' ? input.content : '';
    const words = countWords(content);
    const order = this.nextChapterOrder(projectId);
    this.ctx.db.transaction(() => {
      this.ctx.db.run(
        `INSERT INTO chapters (id, project_id, stage_id, name, summary, sort_order, word_count, content_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        projectId,
        stageId,
        name,
        summary,
        order,
        words,
        content ? ts : null,
        ts,
        ts,
      );
      this.ctx.db.run(
        `INSERT INTO chapter_contents (chapter_id, content, revision, word_count, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        content,
        content ? 1 : 0,
        words,
        ts,
      );
      this.ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', ts, projectId);
    });
    this.ctx.changes.emitChange({ scope: 'structure', projectId, action: 'chapter.create', chapterId: id });
    return this.getChapter(id);
  }

  private nextChapterOrder(projectId: string): number {
    const row = this.ctx.db.get<{ m: number | null }>(
      'SELECT MAX(sort_order) AS m FROM chapters WHERE project_id = ?',
      projectId,
    );
    return (row?.m ?? -1) + 1;
  }

  updateChapter(
    chapterId: string,
    patch: { name?: string; summary?: string; stageId?: string | null; sortOrder?: number },
  ): Chapter {
    const chapter = this.getChapter(chapterId);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      const name = validateName(patch.name, '章节名称', 200);
      sets.push('name = ?');
      params.push(name);
    }
    if (patch.summary !== undefined) {
      sets.push('summary = ?');
      params.push(String(patch.summary));
    }
    if (patch.stageId !== undefined) {
      if (patch.stageId === null) {
        sets.push('stage_id = NULL');
      } else {
        const stage = this.ctx.db.get<{ project_id: string }>('SELECT project_id FROM stages WHERE id = ?', patch.stageId);
        if (!stage) throw notFound(`阶段不存在：${patch.stageId}`);
        if (stage.project_id !== chapter.projectId) throw validationError('目标阶段不属于该项目');
        sets.push('stage_id = ?');
        params.push(patch.stageId);
      }
    }
    if (patch.sortOrder !== undefined) {
      if (!Number.isFinite(patch.sortOrder)) throw validationError('sortOrder 必须是数字');
      sets.push('sort_order = ?');
      params.push(patch.sortOrder);
    }
    if (!sets.length) return chapter;
    sets.push('updated_at = ?');
    params.push(nowIso(), chapterId);
    this.ctx.db.run(`UPDATE chapters SET ${sets.join(', ')} WHERE id = ?`, ...params);
    this.syncChapterNode(chapterId);
    this.ctx.changes.emitChange({
      scope: 'structure',
      projectId: chapter.projectId,
      action: 'chapter.update',
      chapterId,
    });
    return this.getChapter(chapterId);
  }

  /** 把章节移动到目标阶段并插入到指定位置（beforeChapterId 为空则追加到末尾）。 */
  moveChapter(
    chapterId: string,
    input: { stageId?: string | null; beforeChapterId?: string | null; position?: number },
  ): Chapter {
    const chapter = this.getChapter(chapterId);
    const stageId = input.stageId !== undefined ? input.stageId : chapter.stageId;
    if (stageId) {
      const stage = this.ctx.db.get<{ project_id: string }>('SELECT project_id FROM stages WHERE id = ?', stageId);
      if (!stage) throw notFound(`阶段不存在：${stageId}`);
      if (stage.project_id !== chapter.projectId) throw validationError('目标阶段不属于该项目');
    }
    const siblings = this.ctx.db.all<{ id: string }>(
      'SELECT id FROM chapters WHERE project_id = ? AND id != ? ORDER BY sort_order ASC, created_at ASC',
      chapter.projectId,
      chapterId,
    );
    let insertAt = siblings.length;
    if (input.beforeChapterId) {
      const idx = siblings.findIndex((s) => s.id === input.beforeChapterId);
      if (idx < 0) throw notFound(`目标章节不存在：${input.beforeChapterId}`);
      insertAt = idx;
    } else if (typeof input.position === 'number' && Number.isFinite(input.position)) {
      insertAt = clamp(Math.trunc(input.position), 0, siblings.length);
    }
    const ordered = [...siblings.slice(0, insertAt).map((s) => s.id), chapterId, ...siblings.slice(insertAt).map((s) => s.id)];
    const ts = nowIso();
    this.ctx.db.transaction(() => {
      ordered.forEach((id, index) => {
        this.ctx.db.run('UPDATE chapters SET sort_order = ?, updated_at = ? WHERE id = ?', index, ts, id);
      });
      this.ctx.db.run('UPDATE chapters SET stage_id = ? WHERE id = ?', stageId, chapterId);
    });
    this.ctx.changes.emitChange({
      scope: 'structure',
      projectId: chapter.projectId,
      action: 'chapter.move',
      chapterId,
    });
    return this.getChapter(chapterId);
  }

  reorderChapters(projectId: string, orderedIds: string[]): Chapter[] {
    this.assertProject(projectId);
    const existing = this.ctx.db.all<{ id: string }>('SELECT id FROM chapters WHERE project_id = ?', projectId);
    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length !== existing.length ||
      !existing.every((e) => orderedIds.includes(e.id))
    ) {
      throw validationError('章节排序列表必须包含项目的全部章节且不重复');
    }
    const ts = nowIso();
    this.ctx.db.transaction(() => {
      orderedIds.forEach((id, index) => {
        this.ctx.db.run('UPDATE chapters SET sort_order = ?, updated_at = ? WHERE id = ?', index, ts, id);
      });
    });
    this.ctx.changes.emitChange({ scope: 'structure', projectId, action: 'chapter.reorder' });
    return this.listChapters(projectId);
  }

  deleteChapter(chapterId: string, options: { confirm?: boolean } = {}): { deleted: true; id: string } {
    const chapter = this.getChapter(chapterId);
    if (!options.confirm) {
      throw confirmationRequired(`删除章节「${chapter.name}」需要显式确认（confirm=true）。`, {
        chapterId,
        wordCount: chapter.wordCount,
      });
    }
    this.ctx.db.transaction(() => {
      this.ctx.db.run('DELETE FROM chapters WHERE id = ?', chapterId);
      this.ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', nowIso(), chapter.projectId);
    });
    this.ctx.changes.emitChange({
      scope: 'structure',
      projectId: chapter.projectId,
      action: 'chapter.delete',
      chapterId,
    });
    return { deleted: true, id: chapterId };
  }

  deleteStage(
    stageId: string,
    options: { chapterAction?: 'move' | 'delete'; targetStageId?: string | null; confirm?: boolean } = {},
  ): { deleted: true; id: string; movedChapters: number; deletedChapters: number } {
    const stage = this.getStage(stageId);
    const chapters = this.ctx.db.all<{ id: string }>('SELECT id FROM chapters WHERE stage_id = ?', stageId);
    if (!options.confirm) {
      throw confirmationRequired(
        `删除阶段「${stage.name}」需要显式确认，并指定阶段内 ${chapters.length} 个章节的处理方式。`,
        { stageId, chapterCount: chapters.length, options: ['move', 'delete'] },
      );
    }
    const action = options.chapterAction ?? 'move';
    if (action !== 'move' && action !== 'delete') {
      throw validationError('chapterAction 只能是 move 或 delete');
    }
    if (action === 'move') {
      let target = options.targetStageId ?? null;
      if (!target) {
        const other = this.ctx.db.get<{ id: string }>(
          'SELECT id FROM stages WHERE project_id = ? AND id != ? ORDER BY sort_order ASC LIMIT 1',
          stage.projectId,
          stageId,
        );
        target = other?.id ?? null;
      }
      if (!target) {
        throw new NovelError(
          'STAGE_NOT_EMPTY',
          '项目中没有其他阶段可以接收章节。请选择「同时删除阶段内章节」，或先创建另一个阶段。',
          409,
          { stageId, chapterCount: chapters.length },
        );
      }
      const targetStage = this.ctx.db.get<{ project_id: string }>('SELECT project_id FROM stages WHERE id = ?', target);
      if (!targetStage || targetStage.project_id !== stage.projectId) {
        throw validationError('目标阶段不属于该项目');
      }
      const ts = nowIso();
      const max = this.ctx.db.get<{ m: number | null }>(
        'SELECT MAX(sort_order) AS m FROM chapters WHERE stage_id = ?',
        target,
      );
      let order = (max?.m ?? -1) + 1;
      this.ctx.db.transaction(() => {
        for (const c of chapters) {
          this.ctx.db.run('UPDATE chapters SET stage_id = ?, sort_order = ?, updated_at = ? WHERE id = ?', target, order++, ts, c.id);
        }
        this.ctx.db.run('DELETE FROM stages WHERE id = ?', stageId);
      });
      this.ctx.changes.emitChange({ scope: 'structure', projectId: stage.projectId, action: 'stage.delete' });
      return { deleted: true, id: stageId, movedChapters: chapters.length, deletedChapters: 0 };
    }
    this.ctx.db.transaction(() => {
      this.ctx.db.run('DELETE FROM stages WHERE id = ?', stageId);
    });
    this.ctx.changes.emitChange({ scope: 'structure', projectId: stage.projectId, action: 'stage.delete' });
    return { deleted: true, id: stageId, movedChapters: 0, deletedChapters: chapters.length };
  }

  // ---------------- 正文与版本 ----------------

  getContent(chapterId: string): ChapterContent {
    const chapter = this.getChapter(chapterId);
    const row = this.ctx.db.get<{
      content: string;
      revision: number;
      word_count: number;
      updated_at: string;
    }>('SELECT content, revision, word_count, updated_at FROM chapter_contents WHERE chapter_id = ?', chapterId);
    return {
      chapterId,
      content: row?.content ?? '',
      revision: Number(row?.revision ?? 0),
      wordCount: Number(row?.word_count ?? chapter.wordCount ?? 0),
      updatedAt: row?.updated_at ?? chapter.createdAt,
    };
  }

  /**
   * 保存正文。
   * - 使用事务 + SQLite WAL，保证原子性；
   * - 版本策略：把保存前的当前内容归档为「上一个版本」，更早版本全部清理；
   * - baseRevision 用于检测并发覆盖（UI 与 Agent 同时修改时给出冲突提示）。
   */
  saveContent(
    chapterId: string,
    input: { content: string; baseRevision?: number | null; source?: string },
  ): ChapterSaveResult {
    const chapter = this.getChapter(chapterId);
    if (typeof input?.content !== 'string') throw validationError('content 必须是字符串');
    if (input.content.length > 32 * 1024 * 1024) throw validationError('正文超过 32MB 上限');
    const current = this.getContent(chapterId);
    if (
      input.baseRevision !== undefined &&
      input.baseRevision !== null &&
      Number(input.baseRevision) !== current.revision
    ) {
      throw new NovelError(
        'CONFLICT',
        `章节已被其他操作修改（当前版本号 ${current.revision}，提交版本号 ${input.baseRevision}），请重新加载后再保存。`,
        409,
        { chapterId, currentRevision: current.revision, baseRevision: input.baseRevision },
      );
    }
    if (current.content === input.content) {
      return {
        chapterId,
        revision: current.revision,
        wordCount: current.wordCount,
        savedAt: current.updatedAt,
        unchanged: true,
        versionId: null,
      };
    }
    const ts = nowIso();
    const nextRevision = current.revision + 1;
    const words = countWords(input.content);
    let versionId: string | null = null;
    this.ctx.db.transaction(() => {
      // 归档上一版（当前内容），并清理更早版本，只保留最新与上一版本。
      if (current.revision > 0 || current.content.length > 0) {
        const vid = makeId('ver');
        this.ctx.db.run(
          `INSERT INTO chapter_versions (id, chapter_id, revision, content, word_count, saved_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          vid,
          chapterId,
          current.revision,
          current.content,
          current.wordCount,
          ts,
          input.source ?? 'manual',
        );
        versionId = vid;
        this.ctx.db.run(
          `DELETE FROM chapter_versions WHERE chapter_id = ? AND id != (
             SELECT id FROM chapter_versions WHERE chapter_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT 1
           )`,
          chapterId,
          chapterId,
        );
      }
      this.ctx.db.run(
        `INSERT INTO chapter_contents (chapter_id, content, revision, word_count, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chapter_id) DO UPDATE SET
           content = excluded.content, revision = excluded.revision,
           word_count = excluded.word_count, updated_at = excluded.updated_at`,
        chapterId,
        input.content,
        nextRevision,
        words,
        ts,
      );
      this.ctx.db.run(
        'UPDATE chapters SET word_count = ?, content_updated_at = ?, updated_at = ? WHERE id = ?',
        words,
        ts,
        ts,
        chapterId,
      );
      this.ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', ts, chapter.projectId);
    });
    this.ctx.changes.emitChange({
      scope: 'chapter',
      projectId: chapter.projectId,
      chapterId,
      action: 'save',
    });
    return {
      chapterId,
      revision: nextRevision,
      wordCount: words,
      savedAt: ts,
      unchanged: false,
      versionId,
    };
  }

  /** 查询当前版本与上一个版本（供编辑器回溯）。 */
  listVersions(chapterId: string): ChapterVersionsPayload {
    const chapter = this.getChapter(chapterId);
    const current = this.getContent(chapterId);
    const prev = this.ctx.db.get<{
      id: string;
      chapter_id: string;
      revision: number;
      word_count: number;
      saved_at: string;
      source: string;
    }>(
      `SELECT id, chapter_id, revision, word_count, saved_at, source
       FROM chapter_versions WHERE chapter_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT 1`,
      chapterId,
    );
    return {
      current: {
        revision: current.revision,
        wordCount: current.wordCount,
        updatedAt: current.updatedAt,
      },
      previous: prev
        ? {
            id: prev.id,
            chapterId: prev.chapter_id,
            revision: prev.revision,
            wordCount: Number(prev.word_count),
            savedAt: prev.saved_at,
            source: prev.source,
          }
        : null,
    };
  }

  getVersion(versionId: string): ChapterVersion {
    const row = this.ctx.db.get<{
      id: string;
      chapter_id: string;
      revision: number;
      content: string;
      word_count: number;
      saved_at: string;
      source: string;
    }>('SELECT * FROM chapter_versions WHERE id = ?', versionId);
    if (!row) throw notFound(`版本不存在：${versionId}`);
    return {
      id: row.id,
      chapterId: row.chapter_id,
      revision: Number(row.revision),
      content: row.content,
      wordCount: Number(row.word_count),
      savedAt: row.saved_at,
      source: row.source,
    };
  }

  /** 回滚到上一个版本：把上一版本内容写回正文，并保留回滚前的内容作为新的「上一个版本」。 */
  restoreVersion(chapterId: string, versionId: string): ChapterSaveResult {
    const version = this.getVersion(versionId);
    if (version.chapterId !== chapterId) throw validationError('版本不属于该章节');
    const current = this.getContent(chapterId);
    const ts = nowIso();
    const words = countWords(version.content);
    this.ctx.db.transaction(() => {
      // 覆盖前把当前正文归档为上一版本
      this.ctx.db.run(
        `INSERT INTO chapter_versions (id, chapter_id, revision, content, word_count, saved_at, source)
         VALUES (?, ?, ?, ?, ?, ?, 'restore-backup')`,
        makeId('ver'),
        chapterId,
        current.revision,
        current.content,
        current.wordCount,
        ts,
      );
      this.ctx.db.run(
        `DELETE FROM chapter_versions WHERE chapter_id = ? AND id != (
           SELECT id FROM chapter_versions WHERE chapter_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT 1
         )`,
        chapterId,
        chapterId,
      );
      this.ctx.db.run(
        `INSERT INTO chapter_contents (chapter_id, content, revision, word_count, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chapter_id) DO UPDATE SET
           content = excluded.content, revision = excluded.revision,
           word_count = excluded.word_count, updated_at = excluded.updated_at`,
        chapterId,
        version.content,
        current.revision + 1,
        words,
        ts,
      );
      this.ctx.db.run(
        'UPDATE chapters SET word_count = ?, content_updated_at = ?, updated_at = ? WHERE id = ?',
        words,
        ts,
        ts,
        chapterId,
      );
    });
    this.ctx.changes.emitChange({ scope: 'chapter', projectId: this.getChapter(chapterId).projectId, chapterId, action: 'restore' });
    return {
      chapterId,
      revision: current.revision + 1,
      wordCount: words,
      savedAt: ts,
      unchanged: false,
      versionId: null,
    };
  }
}
