import type { ServiceContext } from './projects';
import { NovelError, notFound, validationError } from '../errors';
import { makeId, nowIso, uniqueStrings } from '../util';
import { FORESHADOW_STATUSES } from '@shared/types';
import type { Foreshadow, ForeshadowInput, ForeshadowPatch, ForeshadowStatus } from '@shared/types';

interface ForeshadowRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: ForeshadowStatus;
  planted_chapter_id: string | null;
  planned_resolve_chapter_id: string | null;
  planned_resolve_stage_id: string | null;
  node_id: string | null;
  character_node_ids: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

function parseIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function assertStatus(value: unknown): ForeshadowStatus {
  if (!FORESHADOW_STATUSES.includes(value as ForeshadowStatus)) {
    throw validationError(`伏笔状态无效，可选值：${FORESHADOW_STATUSES.join(', ')}`);
  }
  return value as ForeshadowStatus;
}

export class ForeshadowService {
  constructor(private ctx: ServiceContext) {}

  private map(row: ForeshadowRow): Foreshadow {
    const refs = this.ctx.db.all<{ chapter_id: string; role: 'planted' | 'related' | 'resolved' }>(
      'SELECT chapter_id, role FROM foreshadow_chapters WHERE foreshadow_id = ? ORDER BY role ASC',
      row.id,
    );
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      status: row.status,
      plantedChapterId: row.planted_chapter_id,
      plannedResolveChapterId: row.planned_resolve_chapter_id,
      plannedResolveStageId: row.planned_resolve_stage_id,
      nodeId: row.node_id,
      characterNodeIds: parseIds(row.character_node_ids),
      chapterIds: uniqueStrings(refs.map((r) => r.chapter_id)),
      chapterRefs: refs.map((r) => ({ chapterId: r.chapter_id, role: r.role })),
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private assertProject(projectId: string): void {
    const row = this.ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
    if (!row) throw notFound(`项目不存在：${projectId}`);
  }

  private assertChapterInProject(chapterId: string | null | undefined, projectId: string, field: string): void {
    if (!chapterId) return;
    const row = this.ctx.db.get<{ project_id: string }>('SELECT project_id FROM chapters WHERE id = ?', chapterId);
    if (!row) throw notFound(`${field}指定的章节不存在：${chapterId}`);
    if (row.project_id !== projectId) throw validationError(`${field}指定的章节不属于该项目`);
  }

  list(projectId: string, filter: { status?: ForeshadowStatus; chapterId?: string } = {}): Foreshadow[] {
    this.assertProject(projectId);
    let rows: ForeshadowRow[];
    if (filter.chapterId) {
      rows = this.ctx.db.all<ForeshadowRow>(
        `SELECT DISTINCT f.* FROM foreshadows f
         LEFT JOIN foreshadow_chapters fc ON fc.foreshadow_id = f.id
         WHERE f.project_id = ? AND (fc.chapter_id = ? OR f.planted_chapter_id = ? OR f.planned_resolve_chapter_id = ?)
         ORDER BY f.created_at ASC`,
        projectId,
        filter.chapterId,
        filter.chapterId,
        filter.chapterId,
      );
    } else {
      rows = this.ctx.db.all<ForeshadowRow>(
        'SELECT * FROM foreshadows WHERE project_id = ? ORDER BY created_at ASC',
        projectId,
      );
    }
    let result = rows.map((r) => this.map(r));
    if (filter.status) {
      const status = assertStatus(filter.status);
      result = result.filter((f) => f.status === status);
    }
    return result;
  }

  get(id: string): Foreshadow {
    const row = this.ctx.db.get<ForeshadowRow>('SELECT * FROM foreshadows WHERE id = ?', id);
    if (!row) throw notFound(`伏笔不存在：${id}`);
    return this.map(row);
  }

  create(projectId: string, input: ForeshadowInput): Foreshadow {
    this.assertProject(projectId);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name) throw validationError('伏笔名称不能为空');
    if (name.length > 200) throw validationError('伏笔名称不能超过 200 个字符');
    const status = input.status ? assertStatus(input.status) : 'planned';
    this.assertChapterInProject(input.plantedChapterId ?? null, projectId, 'plantedChapterId');
    this.assertChapterInProject(input.plannedResolveChapterId ?? null, projectId, 'plannedResolveChapterId');
    if (input.nodeId) {
      const node = this.ctx.db.get<{ project_id: string }>('SELECT project_id FROM outline_nodes WHERE id = ?', input.nodeId);
      if (!node) throw notFound(`关联节点不存在：${input.nodeId}`);
      if (node.project_id !== projectId) throw validationError('关联节点不属于该项目');
    }
    if (input.plannedResolveStageId) {
      const stage = this.ctx.db.get<{ project_id: string }>('SELECT project_id FROM stages WHERE id = ?', input.plannedResolveStageId);
      if (!stage) throw notFound(`目标阶段不存在：${input.plannedResolveStageId}`);
      if (stage.project_id !== projectId) throw validationError('目标阶段不属于该项目');
    }
    const id = makeId('fsd');
    const ts = nowIso();
    this.ctx.db.transaction(() => {
      this.ctx.db.run(
        `INSERT INTO foreshadows (id, project_id, name, description, status, planted_chapter_id,
           planned_resolve_chapter_id, planned_resolve_stage_id, node_id, character_node_ids, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        projectId,
        name,
        (input.description ?? '').slice(0, 200000),
        status,
        input.plantedChapterId ?? null,
        input.plannedResolveChapterId ?? null,
        input.plannedResolveStageId ?? null,
        input.nodeId ?? null,
        JSON.stringify(uniqueStrings(input.characterNodeIds)),
        (input.notes ?? '').slice(0, 50000),
        ts,
        ts,
      );
      this.syncChapterRefs(id, projectId, input);
    });
    this.ctx.changes.emitChange({ scope: 'foreshadow', projectId, action: 'create' });
    return this.get(id);
  }

  private syncChapterRefs(id: string, projectId: string, input: ForeshadowPatch): void {
    this.ctx.db.run('DELETE FROM foreshadow_chapters WHERE foreshadow_id = ?', id);
    const refs = new Map<string, 'planted' | 'related' | 'resolved'>();
    if (input.chapterIds) {
      for (const chapterId of uniqueStrings(input.chapterIds)) {
        this.assertChapterInProject(chapterId, projectId, 'chapterIds');
        refs.set(chapterId, 'related');
      }
    }
    if (Array.isArray(input.chapterRefs)) {
      for (const ref of input.chapterRefs) {
        if (!ref || typeof ref.chapterId !== 'string') continue;
        this.assertChapterInProject(ref.chapterId, projectId, 'chapterRefs');
        refs.set(ref.chapterId, ref.role === 'planted' || ref.role === 'resolved' ? ref.role : 'related');
      }
    }
    for (const [chapterId, role] of refs) {
      this.ctx.db.run(
        'INSERT OR IGNORE INTO foreshadow_chapters (foreshadow_id, chapter_id, role) VALUES (?, ?, ?)',
        id,
        chapterId,
        role,
      );
    }
  }

  update(id: string, patch: ForeshadowPatch): Foreshadow {
    const existing = this.get(id);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw validationError('伏笔名称不能为空');
      sets.push('name = ?');
      params.push(name.slice(0, 200));
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(String(patch.description).slice(0, 200000));
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(assertStatus(patch.status));
    }
    for (const key of ['plantedChapterId', 'plannedResolveChapterId', 'plannedResolveStageId', 'nodeId'] as const) {
      if (patch[key] !== undefined) {
        const value = patch[key];
        if (key === 'nodeId' && value) {
          const node = this.ctx.db.get<{ project_id: string }>('SELECT project_id FROM outline_nodes WHERE id = ?', value);
          if (!node) throw notFound(`关联节点不存在：${value}`);
          if (node.project_id !== existing.projectId) throw validationError('关联节点不属于该项目');
        }
        if ((key === 'plantedChapterId' || key === 'plannedResolveChapterId') && value) {
          this.assertChapterInProject(value, existing.projectId, key);
        }
        const column =
          key === 'plantedChapterId'
            ? 'planted_chapter_id'
            : key === 'plannedResolveChapterId'
              ? 'planned_resolve_chapter_id'
              : key === 'plannedResolveStageId'
                ? 'planned_resolve_stage_id'
                : 'node_id';
        sets.push(`${column} = ?`);
        params.push(value ?? null);
      }
    }
    if (patch.characterNodeIds !== undefined) {
      sets.push('character_node_ids = ?');
      params.push(JSON.stringify(uniqueStrings(patch.characterNodeIds)));
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?');
      params.push(String(patch.notes).slice(0, 50000));
    }
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    this.ctx.db.transaction(() => {
      this.ctx.db.run(`UPDATE foreshadows SET ${sets.join(', ')} WHERE id = ?`, ...params);
      if (patch.chapterIds !== undefined || patch.chapterRefs !== undefined) {
        this.syncChapterRefs(id, existing.projectId, patch);
      }
    });
    this.ctx.changes.emitChange({ scope: 'foreshadow', projectId: existing.projectId, action: 'update' });
    return this.get(id);
  }

  delete(id: string, options: { confirm?: boolean } = {}): { deleted: true; id: string } {
    const existing = this.get(id);
    if (!options.confirm) {
      throw new NovelError(
        'CONFIRMATION_REQUIRED',
        `删除伏笔「${existing.name}」需要显式确认（confirm=true）。`,
        409,
        { id },
      );
    }
    this.ctx.db.run('DELETE FROM foreshadows WHERE id = ?', id);
    this.ctx.changes.emitChange({ scope: 'foreshadow', projectId: existing.projectId, action: 'delete' });
    return { deleted: true, id };
  }

  /** 把伏笔同步成一个大纲节点（或更新已关联节点），方便在画布上查看。 */
  attachToOutline(id: string): { nodeId: string } {
    const foreshadow = this.get(id);
    if (foreshadow.nodeId) {
      this.ctx.db.run(
        'UPDATE outline_nodes SET title = ?, description = ?, updated_at = ? WHERE id = ?',
        foreshadow.name,
        foreshadow.description,
        nowIso(),
        foreshadow.nodeId,
      );
      return { nodeId: foreshadow.nodeId };
    }
    const nodeId = makeId('nod');
    const ts = nowIso();
    this.ctx.db.transaction(() => {
      this.ctx.db.run(
        `INSERT INTO outline_nodes (id, project_id, type, title, description, x, y, width, height, color, data, created_at, updated_at)
         VALUES (?, ?, 'foreshadow', ?, ?, ?, ?, 220, 116, NULL, ?, ?, ?)`,
        nodeId,
        foreshadow.projectId,
        foreshadow.name,
        foreshadow.description,
        Math.random() * 500 + 80,
        Math.random() * 300 + 80,
        JSON.stringify({ foreshadowId: foreshadow.id, notes: foreshadow.notes }),
        ts,
        ts,
      );
      this.ctx.db.run('UPDATE foreshadows SET node_id = ?, updated_at = ? WHERE id = ?', nodeId, ts, id);
      for (const chapterId of foreshadow.chapterIds) {
        this.ctx.db.run(
          'INSERT OR IGNORE INTO node_chapter_links (node_id, chapter_id, created_at) VALUES (?, ?, ?)',
          nodeId,
          chapterId,
          ts,
        );
      }
    });
    this.ctx.changes.emitChange({ scope: 'foreshadow', projectId: foreshadow.projectId, action: 'attach' });
    return { nodeId };
  }
}
