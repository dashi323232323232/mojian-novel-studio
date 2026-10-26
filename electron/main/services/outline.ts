import type { ServiceContext } from './projects';
import { notFound, validationError } from '../errors';
import { makeId, nowIso, asNumber, isPlainObject } from '../util';
import { NODE_TYPES, EDGE_RELATIONS } from '@shared/types';
import type {
  EdgeRelation,
  NodeChapterLink,
  NodeType,
  OutlineEdge,
  OutlineNode,
  OutlineNodeInput,
  OutlineNodePatch,
  OutlineEdgeInput,
  OutlineEdgePatch,
  OutlineSnapshot,
} from '@shared/types';

interface NodeRow {
  id: string;
  project_id: string;
  type: NodeType;
  title: string;
  description: string;
  notes: string;
  stage_id: string | null;
  chapter_id: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
  data: string;
  created_at: string;
  updated_at: string;
}

interface EdgeRow {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  relation: EdgeRelation;
  label: string;
  description: string;
  created_at: string;
  updated_at: string;
}

const DEFAULT_SIZE: Record<NodeType, { width: number; height: number }> = {
  stage: { width: 250, height: 128 },
  event: { width: 230, height: 116 },
  chapter: { width: 230, height: 116 },
  character: { width: 220, height: 120 },
  foreshadow: { width: 220, height: 116 },
  note: { width: 210, height: 108 },
};

function mapNode(row: NodeRow): OutlineNode {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.data || '{}');
    if (isPlainObject(parsed)) data = parsed;
  } catch {
    data = {};
  }
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    description: row.description ?? '',
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    color: row.color,
    data,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEdge(row: EdgeRow): OutlineEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    label: row.label ?? '',
    description: row.description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertNodeType(value: unknown): NodeType {
  if (!NODE_TYPES.includes(value as NodeType)) {
    throw validationError(`节点类型无效，可选值：${NODE_TYPES.join(', ')}`);
  }
  return value as NodeType;
}

function assertRelation(value: unknown): EdgeRelation {
  if (!EDGE_RELATIONS.includes(value as EdgeRelation)) {
    throw validationError(`连线类型无效，可选值：${EDGE_RELATIONS.join(', ')}`);
  }
  return value as EdgeRelation;
}

export class OutlineService {
  constructor(
    private ctx: ServiceContext,
    private structureSync: {
      syncBoundEntity: (
        nodeType: string,
        stageId: string | null,
        chapterId: string | null,
        title: string,
        description: string,
      ) => void;
    },
  ) {}

  private assertProject(projectId: string): void {
    const row = this.ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
    if (!row) throw notFound(`项目不存在：${projectId}`);
  }

  snapshot(projectId: string): OutlineSnapshot {
    this.assertProject(projectId);
    const nodes = this.ctx.db
      .all<NodeRow>('SELECT * FROM outline_nodes WHERE project_id = ? ORDER BY created_at ASC', projectId)
      .map(mapNode);
    const edges = this.ctx.db
      .all<EdgeRow>('SELECT * FROM outline_edges WHERE project_id = ? ORDER BY created_at ASC', projectId)
      .map(mapEdge);
    const links = this.ctx.db.all<{ node_id: string; chapter_id: string; created_at: string }>(
      `SELECT l.node_id, l.chapter_id, l.created_at
       FROM node_chapter_links l JOIN outline_nodes n ON n.id = l.node_id
       WHERE n.project_id = ?`,
      projectId,
    );
    return {
      nodes,
      edges,
      links: links.map((l) => ({ nodeId: l.node_id, chapterId: l.chapter_id, createdAt: l.created_at })),
    };
  }

  listNodes(projectId: string, type?: NodeType): OutlineNode[] {
    this.assertProject(projectId);
    if (type) {
      return this.ctx.db
        .all<NodeRow>('SELECT * FROM outline_nodes WHERE project_id = ? AND type = ? ORDER BY created_at ASC', projectId, type)
        .map(mapNode);
    }
    return this.ctx.db
      .all<NodeRow>('SELECT * FROM outline_nodes WHERE project_id = ? ORDER BY created_at ASC', projectId)
      .map(mapNode);
  }

  getNode(nodeId: string): OutlineNode {
    const row = this.ctx.db.get<NodeRow>('SELECT * FROM outline_nodes WHERE id = ?', nodeId);
    if (!row) throw notFound(`大纲节点不存在：${nodeId}`);
    return mapNode(row);
  }

  createNode(projectId: string, input: OutlineNodeInput): OutlineNode {
    this.assertProject(projectId);
    const type = assertNodeType(input?.type);
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw validationError('节点名称不能为空');
    if (title.length > 200) throw validationError('节点名称不能超过 200 个字符');
    const size = DEFAULT_SIZE[type];
    const id = makeId('nod');
    const ts = nowIso();
    const x = asNumber(input.x, 80 + Math.random() * 120);
    const y = asNumber(input.y, 80 + Math.random() * 120);
    const width = Math.max(140, Math.min(1200, asNumber(input.width, size.width)));
    const height = Math.max(70, Math.min(900, asNumber(input.height, size.height)));
    const data = isPlainObject(input.data) ? input.data : {};
    const notes = typeof input.notes === 'string' ? input.notes : '';
    // 故事阶段 / 具体章节节点可绑定真实对象，标题与简介随之双向同步
    let stageId: string | null = null;
    let chapterId: string | null = null;
    let boundTitle = title;
    let boundDescription = typeof input.description === 'string' ? input.description : '';
    if (type === 'stage' && input.stageId) {
      const stage = this.ctx.db.get<{ id: string; name: string; summary: string; project_id: string }>(
        'SELECT id, name, summary, project_id FROM stages WHERE id = ?',
        input.stageId,
      );
      if (!stage) throw notFound(`阶段不存在：${input.stageId}`);
      if (stage.project_id !== projectId) throw validationError('绑定的阶段不属于该项目');
      stageId = stage.id;
      boundTitle = stage.name;
      boundDescription = stage.summary ?? '';
    }
    if (type === 'chapter' && input.chapterId) {
      const chapter = this.ctx.db.get<{ id: string; name: string; summary: string; project_id: string }>(
        'SELECT id, name, summary, project_id FROM chapters WHERE id = ?',
        input.chapterId,
      );
      if (!chapter) throw notFound(`章节不存在：${input.chapterId}`);
      if (chapter.project_id !== projectId) throw validationError('绑定的章节不属于该项目');
      chapterId = chapter.id;
      boundTitle = chapter.name;
      boundDescription = chapter.summary ?? '';
    }
    if (stageId) data.stageId = stageId;
    if (chapterId) data.chapterId = chapterId;
    this.ctx.db.transaction(() => {
      this.ctx.db.run(
        `INSERT INTO outline_nodes (id, project_id, type, title, description, notes, stage_id, chapter_id, x, y, width, height, color, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        projectId,
        type,
        boundTitle,
        boundDescription.slice(0, 200000),
        notes,
        stageId,
        chapterId,
        x,
        y,
        width,
        height,
        typeof input.color === 'string' ? input.color : null,
        JSON.stringify(data),
        ts,
        ts,
      );
      this.ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', ts, projectId);
    });
    this.ctx.changes.emitChange({ scope: 'outline', projectId, action: 'node.create' });
    return this.getNode(id);
  }

  updateNode(nodeId: string, patch: OutlineNodePatch): OutlineNode {
    const node = this.getNode(nodeId);
    const sets: string[] = [];
    const params: unknown[] = [];
    let nextTitle: string | null = null;
    let nextDescription: string | null = null;
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw validationError('节点名称不能为空');
      sets.push('title = ?');
      params.push(title.slice(0, 200));
      nextTitle = title.slice(0, 200);
    }
    if (patch.type !== undefined) {
      sets.push('type = ?');
      params.push(assertNodeType(patch.type));
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(String(patch.description).slice(0, 200000));
      nextDescription = String(patch.description).slice(0, 200000);
    }
    if (patch.notes !== undefined) {
      // 备注不限字数，仅防止极端内存占用
      sets.push('notes = ?');
      params.push(String(patch.notes).slice(0, 5_000_000));
    }
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (patch[key] !== undefined) {
        if (!Number.isFinite(Number(patch[key]))) throw validationError(`${key} 必须是数字`);
        sets.push(`${key} = ?`);
        params.push(Number(patch[key]));
      }
    }
    if (patch.color !== undefined) {
      sets.push('color = ?');
      params.push(patch.color === null ? null : String(patch.color));
    }
    if (patch.data !== undefined) {
      if (!isPlainObject(patch.data)) throw validationError('data 必须是对象');
      sets.push('data = ?');
      params.push(JSON.stringify(patch.data));
    }
    if (!sets.length) return node;
    sets.push('updated_at = ?');
    params.push(nowIso(), nodeId);
    this.ctx.db.transaction(() => {
      this.ctx.db.run(`UPDATE outline_nodes SET ${sets.join(', ')} WHERE id = ?`, ...params);
      // 绑定的真实阶段/章节：名称与简介双向同步
      if (nextTitle !== null || nextDescription !== null) {
        this.structureSync.syncBoundEntity(
          node.type,
          node.data?.stageId ? String(node.data.stageId) : null,
          node.data?.chapterId ? String(node.data.chapterId) : null,
          nextTitle ?? node.title,
          nextDescription ?? node.description,
        );
      }
    });
    this.ctx.changes.emitChange({ scope: 'outline', projectId: node.projectId, action: 'node.update' });
    return this.getNode(nodeId);
  }

  /**
   * 按内容页的真实结构生成/补齐大纲：
   * 阶段节点（左列）→ 章节节点（右列），并建立「先后顺序」连线。
   * 只新增缺失的节点与连线，不删除任何现有内容。
   */
  generateStructure(projectId: string): {
    createdStageNodes: number;
    createdChapterNodes: number;
    createdEdges: number;
  } {
    this.assertProject(projectId);
    const stages = this.ctx.db.all<{ id: string; name: string; summary: string; sort_order: number }>(
      'SELECT id, name, summary, sort_order FROM stages WHERE project_id = ? ORDER BY sort_order ASC',
      projectId,
    );
    const chapters = this.ctx.db.all<{
      id: string;
      name: string;
      summary: string;
      stage_id: string | null;
      sort_order: number;
    }>(
      'SELECT id, name, summary, stage_id, sort_order FROM chapters WHERE project_id = ? ORDER BY sort_order ASC',
      projectId,
    );
    const ts = nowIso();
    let createdStageNodes = 0;
    let createdChapterNodes = 0;
    let createdEdges = 0;

    this.ctx.db.transaction(() => {
      const stageNodeByStage = new Map<string, string>();
      const existingStageNodes = this.ctx.db.all<{ id: string; stage_id: string | null }>(
        "SELECT id, stage_id FROM outline_nodes WHERE project_id = ? AND type = 'stage' AND stage_id IS NOT NULL",
        projectId,
      );
      for (const n of existingStageNodes) if (n.stage_id) stageNodeByStage.set(n.stage_id, n.id);

      stages.forEach((stage, index) => {
        if (stageNodeByStage.has(stage.id)) return;
        const id = makeId('nod');
        this.ctx.db.run(
          `INSERT INTO outline_nodes (id, project_id, type, title, description, notes, stage_id, chapter_id, x, y, width, height, color, data, created_at, updated_at)
           VALUES (?, ?, 'stage', ?, ?, '', ?, NULL, ?, ?, 250, 128, NULL, ?, ?, ?)`,
          id,
          projectId,
          stage.name,
          stage.summary ?? '',
          stage.id,
          80,
          90 + index * 220,
          JSON.stringify({ stageId: stage.id, goal: '' }),
          ts,
          ts,
        );
        stageNodeByStage.set(stage.id, id);
        createdStageNodes++;
      });

      const chapterNodeByChapter = new Map<string, string>();
      const existingChapterNodes = this.ctx.db.all<{ id: string; chapter_id: string | null }>(
        "SELECT id, chapter_id FROM outline_nodes WHERE project_id = ? AND type = 'chapter' AND chapter_id IS NOT NULL",
        projectId,
      );
      for (const n of existingChapterNodes) if (n.chapter_id) chapterNodeByChapter.set(n.chapter_id, n.id);

      const rowByStage = new Map<string | null, number>();
      for (const chapter of chapters) {
        const key = chapter.stage_id ?? null;
        const row = rowByStage.get(key) ?? 0;
        rowByStage.set(key, row + 1);
        if (chapterNodeByChapter.has(chapter.id)) continue;
        const id = makeId('nod');
        this.ctx.db.run(
          `INSERT INTO outline_nodes (id, project_id, type, title, description, notes, stage_id, chapter_id, x, y, width, height, color, data, created_at, updated_at)
           VALUES (?, ?, 'chapter', ?, ?, '', NULL, ?, ?, ?, 230, 116, NULL, ?, ?, ?)`,
          id,
          projectId,
          chapter.name,
          chapter.summary ?? '',
          chapter.id,
          640,
          90 + row * 170,
          JSON.stringify({ chapterId: chapter.id }),
          ts,
          ts,
        );
        chapterNodeByChapter.set(chapter.id, id);
        createdChapterNodes++;
      }

      for (const chapter of chapters) {
        if (!chapter.stage_id) continue;
        const from = stageNodeByStage.get(chapter.stage_id);
        const to = chapterNodeByChapter.get(chapter.id);
        if (!from || !to) continue;
        const exists = this.ctx.db.get<{ id: string }>(
          "SELECT id FROM outline_edges WHERE source_id = ? AND target_id = ? AND relation = 'sequence'",
          from,
          to,
        );
        if (exists) continue;
        this.ctx.db.run(
          `INSERT INTO outline_edges (id, project_id, source_id, target_id, relation, label, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'sequence', '', '', ?, ?)`,
          makeId('edg'),
          projectId,
          from,
          to,
          ts,
          ts,
        );
        createdEdges++;
      }

      // 顺便把节点位置持久化标记项目更新
      this.ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', ts, projectId);
    });

    this.ctx.changes.emitChange({ scope: 'outline', projectId, action: 'structure.generate' });
    return { createdStageNodes, createdChapterNodes, createdEdges };
  }

  /** 批量把未绑定的阶段/章节节点自动绑定到同名实体（迁移与新建时使用）。 */
  reconcileBindings(projectId: string): { bound: number } {
    this.assertProject(projectId);
    const ts = nowIso();
    let bound = 0;
    this.ctx.db.transaction(() => {
      const stageNodes = this.ctx.db.all<{ id: string; title: string }>(
        "SELECT id, title FROM outline_nodes WHERE project_id = ? AND type = 'stage' AND stage_id IS NULL",
        projectId,
      );
      for (const n of stageNodes) {
        const stage = this.ctx.db.get<{ id: string; name: string; summary: string }>(
          'SELECT id, name, summary FROM stages WHERE project_id = ? AND name = ? LIMIT 1',
          projectId,
          n.title,
        );
        if (stage) {
          const row = this.ctx.db.get<{ data: string }>('SELECT data FROM outline_nodes WHERE id = ?', n.id);
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(row?.data ?? '{}');
          } catch {
            data = {};
          }
          data.stageId = stage.id;
          this.ctx.db.run(
            'UPDATE outline_nodes SET stage_id = ?, description = ?, data = ?, updated_at = ? WHERE id = ?',
            stage.id,
            stage.summary ?? '',
            JSON.stringify(data),
            ts,
            n.id,
          );
          bound++;
        }
      }
      const chapterNodes = this.ctx.db.all<{ id: string; title: string }>(
        "SELECT id, title FROM outline_nodes WHERE project_id = ? AND type = 'chapter' AND chapter_id IS NULL",
        projectId,
      );
      for (const n of chapterNodes) {
        const chapter = this.ctx.db.get<{ id: string; name: string; summary: string }>(
          'SELECT id, name, summary FROM chapters WHERE project_id = ? AND name = ? LIMIT 1',
          projectId,
          n.title,
        );
        if (chapter) {
          const row = this.ctx.db.get<{ data: string }>('SELECT data FROM outline_nodes WHERE id = ?', n.id);
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(row?.data ?? '{}');
          } catch {
            data = {};
          }
          data.chapterId = chapter.id;
          this.ctx.db.run(
            'UPDATE outline_nodes SET chapter_id = ?, description = ?, data = ?, updated_at = ? WHERE id = ?',
            chapter.id,
            chapter.summary ?? '',
            JSON.stringify(data),
            ts,
            n.id,
          );
          bound++;
        }
      }
    });
    return { bound };
  }

  /** 批量保存画布位置（拖动结束后调用，减少写入次数）。 */
  updatePositions(
    projectId: string,
    positions: Array<{ id: string; x: number; y: number; width?: number; height?: number }>,
  ): { updated: number } {
    this.assertProject(projectId);
    if (!Array.isArray(positions)) throw validationError('positions 必须是数组');
    const ts = nowIso();
    let updated = 0;
    this.ctx.db.transaction(() => {
      for (const p of positions) {
        if (!p || typeof p.id !== 'string') continue;
        const node = this.ctx.db.get<{ project_id: string }>(
          'SELECT project_id FROM outline_nodes WHERE id = ?',
          p.id,
        );
        if (!node || node.project_id !== projectId) continue;
        const sets = ['x = ?', 'y = ?', 'updated_at = ?'];
        const params: unknown[] = [asNumber(p.x), asNumber(p.y), ts];
        if (p.width !== undefined) {
          sets.push('width = ?');
          params.push(Math.max(140, Math.min(1200, asNumber(p.width))));
        }
        if (p.height !== undefined) {
          sets.push('height = ?');
          params.push(Math.max(70, Math.min(900, asNumber(p.height))));
        }
        params.push(p.id);
        this.ctx.db.run(`UPDATE outline_nodes SET ${sets.join(', ')} WHERE id = ?`, ...params);
        updated++;
      }
    });
    if (updated) this.ctx.changes.emitChange({ scope: 'outline', projectId, action: 'node.move' });
    return { updated };
  }

  deleteNode(nodeId: string, options: { confirm?: boolean } = {}): { deleted: true; id: string } {
    const node = this.getNode(nodeId);
    if (!options.confirm) {
      throw new (require('../errors').NovelError)(
        'CONFIRMATION_REQUIRED',
        `删除大纲节点「${node.title}」会同时删除相关连线与章节关联，需要显式确认（confirm=true）。`,
        409,
        { nodeId, title: node.title },
      );
    }
    // 只删除画布节点，不删除真实章节/阶段（避免误删正文）；绑定关系随节点消失
    this.ctx.db.transaction(() => {
      this.ctx.db.run('DELETE FROM outline_nodes WHERE id = ?', nodeId);
    });
    this.ctx.changes.emitChange({ scope: 'outline', projectId: node.projectId, action: 'node.delete' });
    return { deleted: true, id: nodeId };
  }

  /** 直接清空节点备注（一键删除）。 */
  clearNotes(nodeId: string): OutlineNode {
    return this.updateNode(nodeId, { notes: '' });
  }

  duplicateNode(nodeId: string, offset = 32): OutlineNode {
    const node = this.getNode(nodeId);
    const id = makeId('nod');
    const ts = nowIso();
    this.ctx.db.transaction(() => {
      this.ctx.db.run(
        `INSERT INTO outline_nodes (id, project_id, type, title, description, x, y, width, height, color, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        node.projectId,
        node.type,
        `${node.title} 副本`,
        node.description,
        node.x + offset,
        node.y + offset,
        node.width,
        node.height,
        node.color,
        JSON.stringify(node.data),
        ts,
        ts,
      );
      // 复制章节关联，方便快速搭建相似节点
      this.ctx.db.run(
        `INSERT OR IGNORE INTO node_chapter_links (node_id, chapter_id, created_at)
         SELECT ?, chapter_id, ? FROM node_chapter_links WHERE node_id = ?`,
        id,
        ts,
        nodeId,
      );
    });
    this.ctx.changes.emitChange({ scope: 'outline', projectId: node.projectId, action: 'node.duplicate' });
    return this.getNode(id);
  }

  listEdges(projectId: string): OutlineEdge[] {
    this.assertProject(projectId);
    return this.ctx.db
      .all<EdgeRow>('SELECT * FROM outline_edges WHERE project_id = ? ORDER BY created_at ASC', projectId)
      .map(mapEdge);
  }

  getEdge(edgeId: string): OutlineEdge {
    const row = this.ctx.db.get<EdgeRow>('SELECT * FROM outline_edges WHERE id = ?', edgeId);
    if (!row) throw notFound(`连线不存在：${edgeId}`);
    return mapEdge(row);
  }

  createEdge(projectId: string, input: OutlineEdgeInput): OutlineEdge {
    this.assertProject(projectId);
    const source = this.getNode(input?.sourceId);
    const target = this.getNode(input?.targetId);
    if (source.projectId !== projectId || target.projectId !== projectId) {
      throw validationError('连线两端节点必须属于同一项目');
    }
    if (source.id === target.id) throw validationError('不能把节点连接到自身');
    const relation = input.relation ? assertRelation(input.relation) : 'sequence';
    const existing = this.ctx.db.get<EdgeRow>(
      'SELECT * FROM outline_edges WHERE source_id = ? AND target_id = ? AND relation = ?',
      source.id,
      target.id,
      relation,
    );
    if (existing) return mapEdge(existing);
    const id = makeId('edg');
    const ts = nowIso();
    this.ctx.db.run(
      `INSERT INTO outline_edges (id, project_id, source_id, target_id, relation, label, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      projectId,
      source.id,
      target.id,
      relation,
      typeof input.label === 'string' ? input.label.slice(0, 120) : '',
      typeof input.description === 'string' ? input.description.slice(0, 2000) : '',
      ts,
      ts,
    );
    this.ctx.changes.emitChange({ scope: 'outline', projectId, action: 'edge.create' });
    return this.getEdge(id);
  }

  updateEdge(edgeId: string, patch: OutlineEdgePatch): OutlineEdge {
    const edge = this.getEdge(edgeId);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.relation !== undefined) {
      sets.push('relation = ?');
      params.push(assertRelation(patch.relation));
    }
    if (patch.label !== undefined) {
      sets.push('label = ?');
      params.push(String(patch.label).slice(0, 120));
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(String(patch.description).slice(0, 2000));
    }
    if (patch.sourceId !== undefined) {
      const node = this.getNode(patch.sourceId);
      if (node.projectId !== edge.projectId) throw validationError('节点不属于该项目');
      if (patch.sourceId === (patch.targetId ?? edge.targetId)) throw validationError('不能把节点连接到自身');
      sets.push('source_id = ?');
      params.push(patch.sourceId);
    }
    if (patch.targetId !== undefined) {
      const node = this.getNode(patch.targetId);
      if (node.projectId !== edge.projectId) throw validationError('节点不属于该项目');
      if (patch.targetId === (patch.sourceId ?? edge.sourceId)) throw validationError('不能把节点连接到自身');
      sets.push('target_id = ?');
      params.push(patch.targetId);
    }
    if (!sets.length) return edge;
    sets.push('updated_at = ?');
    params.push(nowIso(), edgeId);
    this.ctx.db.run(`UPDATE outline_edges SET ${sets.join(', ')} WHERE id = ?`, ...params);
    this.ctx.changes.emitChange({ scope: 'outline', projectId: edge.projectId, action: 'edge.update' });
    return this.getEdge(edgeId);
  }

  deleteEdge(edgeId: string): { deleted: true; id: string } {
    const edge = this.getEdge(edgeId);
    this.ctx.db.run('DELETE FROM outline_edges WHERE id = ?', edgeId);
    this.ctx.changes.emitChange({ scope: 'outline', projectId: edge.projectId, action: 'edge.delete' });
    return { deleted: true, id: edgeId };
  }

  // ---------------- 大纲 ↔ 章节关联 ----------------

  listLinks(projectId: string, filter: { nodeId?: string; chapterId?: string } = {}): NodeChapterLink[] {
    this.assertProject(projectId);
    const rows = this.ctx.db.all<{ node_id: string; chapter_id: string; created_at: string }>(
      `SELECT l.node_id, l.chapter_id, l.created_at
       FROM node_chapter_links l
       JOIN outline_nodes n ON n.id = l.node_id
       WHERE n.project_id = ?
         AND (? IS NULL OR l.node_id = ?)
         AND (? IS NULL OR l.chapter_id = ?)`,
      projectId,
      filter.nodeId ?? null,
      filter.nodeId ?? null,
      filter.chapterId ?? null,
      filter.chapterId ?? null,
    );
    return rows.map((r) => ({ nodeId: r.node_id, chapterId: r.chapter_id, createdAt: r.created_at }));
  }

  linkChapter(nodeId: string, chapterId: string): NodeChapterLink {
    const node = this.getNode(nodeId);
    const chapter = this.ctx.db.get<{ id: string; project_id: string }>(
      'SELECT id, project_id FROM chapters WHERE id = ?',
      chapterId,
    );
    if (!chapter) throw notFound(`章节不存在：${chapterId}`);
    if (chapter.project_id !== node.projectId) throw validationError('章节与节点不属于同一项目');
    const ts = nowIso();
    this.ctx.db.run(
      'INSERT OR IGNORE INTO node_chapter_links (node_id, chapter_id, created_at) VALUES (?, ?, ?)',
      nodeId,
      chapterId,
      ts,
    );
    this.ctx.changes.emitChange({ scope: 'links', projectId: node.projectId, action: 'link.create' });
    return { nodeId, chapterId, createdAt: ts };
  }

  unlinkChapter(nodeId: string, chapterId: string): { deleted: true } {
    const node = this.getNode(nodeId);
    this.ctx.db.run('DELETE FROM node_chapter_links WHERE node_id = ? AND chapter_id = ?', nodeId, chapterId);
    this.ctx.changes.emitChange({ scope: 'links', projectId: node.projectId, action: 'link.delete' });
    return { deleted: true };
  }

  /** 节点关联的章节列表（带编号、名称、字数），用于悬停浮层。 */
  chaptersForNode(nodeId: string): Array<{
    id: string;
    name: string;
    stageId: string | null;
    stageName: string | null;
    wordCount: number;
    order: number;
  }> {
    const node = this.getNode(nodeId);
    const rows = this.ctx.db.all<{
      id: string;
      name: string;
      stage_id: string | null;
      stage_name: string | null;
      word_count: number;
      sort_order: number;
    }>(
      `SELECT c.id, c.name, c.stage_id, s.name AS stage_name, c.word_count, c.sort_order
       FROM node_chapter_links l
       JOIN chapters c ON c.id = l.chapter_id
       LEFT JOIN stages s ON s.id = c.stage_id
       WHERE l.node_id = ? AND c.project_id = ?
       ORDER BY c.sort_order ASC`,
      nodeId,
      node.projectId,
    );
    return rows.map((r, index) => ({
      id: r.id,
      name: r.name,
      stageId: r.stage_id,
      stageName: r.stage_name,
      wordCount: Number(r.word_count ?? 0),
      order: index + 1,
    }));
  }

  nodesForChapter(chapterId: string): OutlineNode[] {
    const chapter = this.ctx.db.get<{ project_id: string }>(
      'SELECT project_id FROM chapters WHERE id = ?',
      chapterId,
    );
    if (!chapter) throw notFound(`章节不存在：${chapterId}`);
    return this.ctx.db
      .all<NodeRow>(
        `SELECT n.* FROM outline_nodes n
         JOIN node_chapter_links l ON l.node_id = n.id
         WHERE l.chapter_id = ? ORDER BY n.created_at ASC`,
        chapterId,
      )
      .map(mapNode);
  }
}
