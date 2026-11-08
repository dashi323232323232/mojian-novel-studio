/**
 * 项目导出 / 导入的底层服务。
 *
 * 导出：把分散在多张 SQLite 表里的项目数据序列化成若干 JSON 条目，
 *       用 createZip 打成 zip，原子替换写入目标路径。
 * 导入：读取 zip、校验 manifest 与每个条目的 sha256、整体重映射所有 id，
 *       在一个事务内直接写回数据库，任何异常整体回滚。
 *
 * 只依赖 AppCore 的类型（import type），避免运行时循环依赖。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AppCore } from '../core';
import { NovelError } from '../errors';
import { nowIso } from '../util';
import { createZip, readZip } from './zip';
import type {
  Chapter,
  ChapterContent,
  Foreshadow,
  OutlineSnapshot,
  Project,
  ProjectUiSettings,
  Stage,
} from '@shared/types';

const FORMAT = 'dashi-project';
const VERSION = 1;
const APP_VERSION = '1.6.0';

interface ManifestEntry {
  name: string;
  sha256: string;
  bytes: number;
}

interface Manifest {
  format: string;
  version: number;
  exportedAt: string;
  appVersion: string;
  projectName: string;
  chapters: number;
  stages: number;
  entries: ManifestEntry[];
}

interface ExportedProject extends Project {
  chapterCount: number;
  wordCount: number;
}

/** 序列化成 JSON Buffer，保证缩进可读且稳定。 */
function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function parseJsonBuffer<T>(buffer: Buffer | undefined, label: string): T {
  if (!buffer) throw new NovelError('VALIDATION_ERROR', `项目压缩包缺少 ${label}`, 400);
  try {
    return JSON.parse(buffer.toString('utf8')) as T;
  } catch {
    throw new NovelError('VALIDATION_ERROR', `项目压缩包中的 ${label} 不是合法 JSON`, 400);
  }
}

function asArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new NovelError('VALIDATION_ERROR', `项目压缩包中的 ${label} 必须是数组`, 400);
  }
  return value as T[];
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NovelError('VALIDATION_ERROR', `项目压缩包中的 ${label} 必须是对象`, 400);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** 读取并解压 zip，返回 name -> data 的映射。 */
function readArchive(zipPath: string): Map<string, Buffer> {
  let raw: Buffer;
  try {
    raw = fs.readFileSync(zipPath);
  } catch {
    throw new NovelError('VALIDATION_ERROR', '无法读取项目压缩包', 400);
  }
  let entries: Array<{ name: string; data: Buffer }>;
  try {
    entries = readZip(raw);
  } catch (err) {
    throw new NovelError('VALIDATION_ERROR', `项目压缩包已损坏：${(err as Error).message}`, 400);
  }
  const map = new Map<string, Buffer>();
  for (const e of entries) {
    const base = path.posix.basename(e.name);
    if (!map.has(e.name)) map.set(e.name, e.data);
    // 同时按 basename 索引，兼容包内条目带前缀目录的情况
    if (!map.has(base)) map.set(base, e.data);
  }
  return map;
}

/** 严格校验 manifest 格式与版本。 */
function parseManifest(map: Map<string, Buffer>): Manifest {
  const doc = asObject(parseJsonBuffer<unknown>(map.get('manifest.json'), 'manifest.json'), 'manifest.json');
  if (doc.format !== FORMAT) {
    throw new NovelError('VALIDATION_ERROR', '项目压缩包格式不兼容', 400);
  }
  const version = num(doc.version, -1);
  if (!Number.isInteger(version) || version < 0 || version > VERSION) {
    throw new NovelError('VALIDATION_ERROR', '项目压缩包格式不兼容', 400);
  }
  return {
    format: FORMAT,
    version,
    exportedAt: str(doc.exportedAt),
    appVersion: str(doc.appVersion),
    projectName: str(doc.projectName),
    chapters: num(doc.chapters),
    stages: num(doc.stages),
    entries: Array.isArray(doc.entries)
      ? (doc.entries as ManifestEntry[]).map((e) => ({
          name: str(e?.name),
          sha256: str(e?.sha256),
          bytes: num(e?.bytes),
        }))
      : [],
  };
}

const REQUIRED_ENTRIES = [
  'project.json',
  'stages.json',
  'chapters.json',
  'contents.json',
  'outline.json',
  'foreshadows.json',
  'project-settings.json',
];

/** 按 manifest 逐条校验 sha256 与字节数。 */
function verifyEntries(map: Map<string, Buffer>, manifest: Manifest): void {
  // 所有必备条目都必须出现在清单里，否则无法通过「删掉清单项」绕过完整性校验。
  const listed = new Set(manifest.entries.map((e) => e.name));
  for (const required of REQUIRED_ENTRIES) {
    if (!listed.has(required)) {
      throw new NovelError('VALIDATION_ERROR', '项目压缩包已损坏', 400);
    }
  }
  if (manifest.entries.length < REQUIRED_ENTRIES.length) {
    throw new NovelError('VALIDATION_ERROR', '项目压缩包已损坏', 400);
  }
  for (const record of manifest.entries) {
    if (!record.name) {
      throw new NovelError('VALIDATION_ERROR', '项目压缩包已损坏', 400);
    }
    const data = map.get(record.name) ?? map.get(path.posix.basename(record.name));
    if (!data) {
      throw new NovelError('VALIDATION_ERROR', '项目压缩包已损坏', 400);
    }
    if (data.length !== record.bytes || sha256(data) !== record.sha256) {
      throw new NovelError('VALIDATION_ERROR', '项目压缩包已损坏', 400);
    }
  }
}

/** 生成一个与现有全部项目名都不冲突的导入名称。 */
function uniqueProjectName(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  if (!taken.has(`${base}（导入）`)) return `${base}（导入）`;
  let i = 2;
  while (taken.has(`${base}（导入 ${i}）`)) i += 1;
  return `${base}（导入 ${i}）`;
}

/** 递归把对象里所有「看起来像 id 引用」的字段按映射表替换。 */
function remapDeep(value: unknown, map: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => remapDeep(v, map));
  if (typeof value === 'string') return map.get(value) ?? value;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = remapDeep(v, map);
    }
    return out;
  }
  return value;
}

/** 只替换对象顶层指定字段里的 id（值可能是字符串、null 或字符串数组）。 */
function remapFields<T extends Record<string, unknown>>(
  obj: T,
  fields: string[],
  map: Map<string, string>,
): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const field of fields) {
    const v = out[field];
    if (typeof v === 'string') {
      out[field] = map.get(v) ?? v;
    } else if (Array.isArray(v)) {
      out[field] = v.map((item) => (typeof item === 'string' ? map.get(item) ?? item : item));
    }
  }
  return out as T;
}

export class ProjectTransferService {
  constructor(private core: AppCore) {}

  /* ------------------------------ 导出 ------------------------------ */

  async exportProject(
    projectId: string,
    targetPath: string,
  ): Promise<{ filePath: string; projectName: string; size: number }> {
    // 项目不存在时抛 NOT_FOUND，同时保证空项目（只有默认阶段）也能导出。
    const project = this.core.projects.get(projectId);
    const structure = this.core.projects.structure(projectId);
    const stages: Stage[] = structure.stages;
    const chapters: Chapter[] = structure.chapters;

    const contents: ChapterContent[] = chapters.map((c) => this.core.structure.getContent(c.id));
    const outlineSnapshot: OutlineSnapshot = this.core.outline.snapshot(projectId);
    // snapshot() 返回的 OutlineNode 不含数据库里的 stage_id / chapter_id 绑定列，
    // 这里补齐后再序列化，保证导入能还原「节点绑定真实阶段/章节」的关系。
    const boundCols = this.core.db.all<{ id: string; stage_id: string | null; chapter_id: string | null }>(
      'SELECT id, stage_id, chapter_id FROM outline_nodes WHERE project_id = ?',
      projectId,
    );
    const boundById = new Map(boundCols.map((r) => [r.id, r]));
    const outline = {
      nodes: outlineSnapshot.nodes.map((n) => {
        const b = boundById.get(n.id);
        return { ...n, stageId: b?.stage_id ?? null, chapterId: b?.chapter_id ?? null };
      }),
      edges: outlineSnapshot.edges,
      links: outlineSnapshot.links,
    };
    const foreshadows: Foreshadow[] = this.core.foreshadow.list(projectId);
    const projectSettings: ProjectUiSettings = this.core.settings.getProjectSettings(projectId);

    const entryList: Array<{ name: string; data: Buffer }> = [
      { name: 'project.json', data: json(project) },
      { name: 'stages.json', data: json(stages) },
      { name: 'chapters.json', data: json(chapters) },
      { name: 'contents.json', data: json(contents) },
      { name: 'outline.json', data: json(outline) },
      { name: 'foreshadows.json', data: json(foreshadows) },
      { name: 'project-settings.json', data: json(projectSettings) },
    ];

    const manifest: Manifest = {
      format: FORMAT,
      version: VERSION,
      exportedAt: nowIso(),
      appVersion: APP_VERSION,
      projectName: project.name,
      chapters: chapters.length,
      stages: stages.length,
      entries: entryList.map((e) => ({
        name: e.name,
        sha256: sha256(e.data),
        bytes: e.data.length,
      })),
    };

    // manifest.json 放在最前面，便于导入前快速 inspect。
    const allEntries = [{ name: 'manifest.json', data: json(manifest) }, ...entryList];
    const zipBuffer = createZip(allEntries);

    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const tmp = `${resolved}.tmp`;
    try {
      fs.writeFileSync(tmp, zipBuffer);
      // Windows / POSIX 均允许 rename 覆盖已存在文件，实现原子替换。
      fs.renameSync(tmp, resolved);
    } catch (err) {
      try {
        if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
      } catch {
        /* 清理失败不掩盖原始错误 */
      }
      throw err;
    }

    return { filePath: resolved, projectName: project.name, size: fs.statSync(resolved).size };
  }

  /* ------------------------------ 预览 ------------------------------ */

  inspect(zipPath: string): { projectName: string; chapters: number; exportedAt: string; version: number } {
    const map = readArchive(zipPath);
    const manifest = parseManifest(map);
    return {
      projectName: manifest.projectName,
      chapters: manifest.chapters,
      exportedAt: manifest.exportedAt,
      version: manifest.version,
    };
  }

  /* ------------------------------ 导入 ------------------------------ */

  async importProject(
    zipPath: string,
  ): Promise<{ projectId: string; projectName: string; chapters: number; stages: number }> {
    const map = readArchive(zipPath);
    const manifest = parseManifest(map);
    verifyEntries(map, manifest);

    const projectRaw = asObject(parseJsonBuffer<unknown>(map.get('project.json'), 'project.json'), 'project.json');
    const stagesRaw = asArray<Record<string, unknown>>(
      parseJsonBuffer<unknown>(map.get('stages.json'), 'stages.json'),
      'stages.json',
    );
    const chaptersRaw = asArray<Record<string, unknown>>(
      parseJsonBuffer<unknown>(map.get('chapters.json'), 'chapters.json'),
      'chapters.json',
    );
    const contentsRaw = asArray<Record<string, unknown>>(
      parseJsonBuffer<unknown>(map.get('contents.json'), 'contents.json'),
      'contents.json',
    );
    const outlineRaw = asObject(parseJsonBuffer<unknown>(map.get('outline.json'), 'outline.json'), 'outline.json');
    const foreshadowsRaw = asArray<Record<string, unknown>>(
      parseJsonBuffer<unknown>(map.get('foreshadows.json'), 'foreshadows.json'),
      'foreshadows.json',
    );
    // 项目级设置是可选条目（旧包可能没有），缺失时用空对象兜底。
    let settingsRaw: Record<string, unknown> = {};
    const settingsBuf = map.get('project-settings.json');
    if (settingsBuf) {
      settingsRaw = asObject(parseJsonBuffer<unknown>(settingsBuf, 'project-settings.json'), 'project-settings.json');
    }

    const oldProjectId = str(projectRaw.id);
    if (!oldProjectId) {
      throw new NovelError('VALIDATION_ERROR', '项目压缩包已损坏', 400);
    }

    // 无条件重映射全部 id，保证同一包可重复导入且绝不覆盖已有项目。
    const ids = new Map<string, string>();
    const used = new Set<string>();
    const KNOWN_PREFIXES = ['prj', 'stg', 'chp', 'nod', 'edg', 'fsd', 'ver', 'lnk'];
    const prefixFor = (old: string): string => {
      const p = old.split('_')[0];
      return KNOWN_PREFIXES.includes(p) ? p : 'prj';
    };
    // 同一毫秒内批量生成时，util.makeId 的随机后缀过短可能碰撞；
    // 这里用 UUID 主体 + 前缀生成，并显式去重，保证导入事务不会因主键冲突半途失败。
    const fresh = (old: string): string => {
      if (!old) return old;
      let next = ids.get(old);
      if (!next) {
        do {
          next = `${prefixFor(old)}_${randomUUID().replace(/-/g, '')}`;
        } while (used.has(next));
        used.add(next);
        ids.set(old, next);
      }
      return next;
    };
    const newProjectId = fresh(oldProjectId);

    // 先把所有实体 id 登记进映射表，后面替换引用时才能全部命中。
    for (const s of stagesRaw) fresh(str(s.id));
    for (const c of chaptersRaw) fresh(str(c.id));
    const outlineNodesRaw = asArray<Record<string, unknown>>(outlineRaw.nodes, 'outline.nodes');
    const outlineEdgesRaw = asArray<Record<string, unknown>>(outlineRaw.edges, 'outline.edges');
    const linksRaw = asArray<Record<string, unknown>>(outlineRaw.links ?? [], 'outline.links');
    for (const n of outlineNodesRaw) fresh(str(n.id));
    for (const e of outlineEdgesRaw) fresh(str(e.id));
    for (const f of foreshadowsRaw) fresh(str(f.id));

    const existingNames = this.core.db
      .all<{ name: string }>('SELECT name FROM projects')
      .map((r) => r.name);
    const projectName = uniqueProjectName(str(projectRaw.name) || manifest.projectName || '导入项目', existingNames);

    const projectRow: ExportedProject = {
      id: newProjectId,
      name: projectName,
      description: str(projectRaw.description),
      genre: str(projectRaw.genre),
      coverColor: str(projectRaw.coverColor, '#5b6cff'),
      chapterCount: num(projectRaw.chapterCount),
      wordCount: num(projectRaw.wordCount),
      createdAt: str(projectRaw.createdAt, nowIso()),
      updatedAt: str(projectRaw.updatedAt, nowIso()),
      lastOpenedAt: nullableStr(projectRaw.lastOpenedAt),
    };

    // 阶段：projectId + 自身 id。
    const stageRows = stagesRaw.map((s) => {
      const r = remapFields(s, ['id', 'projectId'], ids);
      return {
        id: str(r.id),
        name: str(s.name, '未命名阶段'),
        summary: str(s.summary),
        sort_order: num(s.sortOrder),
        created_at: str(s.createdAt, nowIso()),
        updated_at: str(s.updatedAt, nowIso()),
      };
    });

    // 章节：projectId / 自身 id / stageId。
    const chapterRows = chaptersRaw.map((c) => {
      const r = remapFields(c, ['id', 'projectId', 'stageId'], ids);
      return {
        id: str(r.id),
        stageId: nullableStr(r.stageId),
        name: str(c.name, '未命名章节'),
        summary: str(c.summary),
        sort_order: num(c.sortOrder),
        word_count: num(c.wordCount),
        content_updated_at: nullableStr(c.contentUpdatedAt),
        created_at: str(c.createdAt, nowIso()),
        updated_at: str(c.updatedAt, nowIso()),
      };
    });

    // 正文：chapterId 重映射，其余字段原样保留（revision / wordCount / updatedAt）。
    const contentRows = contentsRaw.map((c) => {
      const r = remapFields(c, ['chapterId'], ids);
      return {
        chapterId: str(r.chapterId),
        content: str(c.content),
        revision: num(c.revision),
        word_count: num(c.wordCount),
        updated_at: str(c.updatedAt, nowIso()),
      };
    });

    // 大纲节点：projectId / 自身 id / 绑定列 / data 里的所有 id 引用（含嵌套）。
    const nodeRows = outlineNodesRaw.map((n) => {
      const remapped = remapDeep(n, ids) as Record<string, unknown>;
      return {
        ...remapped,
        id: str(remapped.id),
        project_id: newProjectId,
        type: str(remapped.type, 'note'),
        title: str(remapped.title),
        description: str(remapped.description),
        notes: str(remapped.notes),
        stage_id: nullableStr(remapped.stageId),
        chapter_id: nullableStr(remapped.chapterId),
        x: num(remapped.x),
        y: num(remapped.y),
        width: num(remapped.width, 220),
        height: num(remapped.height, 120),
        color: nullableStr(remapped.color),
        data: JSON.stringify(
          remapFields(asObject(remapped.data ?? {}, 'outline node.data'), ['stageId', 'chapterId', 'foreshadowId'], ids),
        ),
        created_at: str(remapped.createdAt, nowIso()),
        updated_at: str(remapped.updatedAt, nowIso()),
      };
    });

    // 连线：projectId / 自身 id / sourceId / targetId。
    const edgeRows = outlineEdgesRaw.map((e) => {
      const r = remapFields(e, ['id', 'projectId', 'sourceId', 'targetId'], ids);
      return {
        id: str(r.id),
        sourceId: str(r.sourceId),
        targetId: str(r.targetId),
        relation: str(e.relation, 'sequence'),
        label: str(e.label),
        description: str(e.description),
        created_at: str(e.createdAt, nowIso()),
        updated_at: str(e.updatedAt, nowIso()),
      };
    });

    // 节点↔章节关联：nodeId / chapterId。
    const linkRows = linksRaw.map((l) => {
      const r = remapFields(l, ['nodeId', 'chapterId'], ids);
      return {
        nodeId: str(r.nodeId),
        chapterId: str(r.chapterId),
        created_at: str(l.createdAt, nowIso()),
      };
    });

    // 伏笔：所有外键列、数组字段、chapterRefs 里的 chapterId，以及 data 式的嵌套引用。
    const foreshadowRows = foreshadowsRaw.map((f) => {
      const remapped = remapFields(
        f,
        [
          'id',
          'projectId',
          'plantedChapterId',
          'plannedResolveChapterId',
          'plannedResolveStageId',
          'nodeId',
          'characterNodeIds',
          'chapterIds',
        ],
        ids,
      );
      const chapterRefs = Array.isArray(remapped.chapterRefs)
        ? (remapped.chapterRefs as Array<Record<string, unknown>>).map((ref) =>
            remapFields(asObject(ref, 'chapterRefs[]'), ['chapterId'], ids),
          )
        : [];
      return {
        ...remapped,
        id: str(remapped.id),
        chapterRefs,
        project_id: newProjectId,
        name: str(remapped.name, '未命名伏笔'),
        description: str(remapped.description),
        status: str(remapped.status, 'planned'),
        planted_chapter_id: nullableStr(remapped.plantedChapterId),
        planned_resolve_chapter_id: nullableStr(remapped.plannedResolveChapterId),
        planned_resolve_stage_id: nullableStr(remapped.plannedResolveStageId),
        node_id: nullableStr(remapped.nodeId),
        character_node_ids: JSON.stringify(
          Array.isArray(remapped.characterNodeIds) ? remapped.characterNodeIds : [],
        ),
        notes: str(remapped.notes),
        created_at: str(remapped.createdAt, nowIso()),
        updated_at: str(remapped.updatedAt, nowIso()),
      };
    });

    // project_settings：值里的 chapterId / nodeId 引用同样需要重映射。
    const settingsRemapped = remapDeep(settingsRaw, ids) as Record<string, unknown>;
    // readingProgress 以 chapterId 作为对象键，remapDeep 只改值不改键，这里单独补键。
    const readingProgress = settingsRemapped.readingProgress;
    if (readingProgress && typeof readingProgress === 'object' && !Array.isArray(readingProgress)) {
      const next: Record<string, unknown> = {};
      for (const [chapterId, value] of Object.entries(readingProgress as Record<string, unknown>)) {
        next[ids.get(chapterId) ?? chapterId] = value;
      }
      settingsRemapped.readingProgress = next;
    }

    // 所有写入在一个事务内完成；任何异常由 Database.transaction 整体回滚。
    this.core.db.transaction(() => {
      this.core.db.run(
        `INSERT INTO projects (id, name, description, genre, cover_color, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        projectRow.id,
        projectRow.name,
        projectRow.description,
        projectRow.genre,
        projectRow.coverColor,
        projectRow.createdAt,
        projectRow.updatedAt,
        projectRow.lastOpenedAt,
      );

      for (const s of stageRows) {
        this.core.db.run(
          `INSERT INTO stages (id, project_id, name, summary, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          s.id,
          newProjectId,
          s.name,
          s.summary,
          s.sort_order,
          s.created_at,
          s.updated_at,
        );
      }

      for (const c of chapterRows) {
        this.core.db.run(
          `INSERT INTO chapters (id, project_id, stage_id, name, summary, sort_order, word_count, content_updated_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          c.id,
          newProjectId,
          c.stageId ?? null,
          c.name,
          c.summary,
          c.sort_order,
          c.word_count,
          c.content_updated_at,
          c.created_at,
          c.updated_at,
        );
      }

      for (const c of contentRows) {
        // 只导入仍存在的章节正文，避免外键约束失败。
        const exists = this.core.db.get<{ id: string }>('SELECT id FROM chapters WHERE id = ?', c.chapterId);
        if (!exists) continue;
        this.core.db.run(
          `INSERT INTO chapter_contents (chapter_id, content, revision, word_count, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          c.chapterId,
          c.content,
          c.revision,
          c.word_count,
          c.updated_at,
        );
      }

      for (const n of nodeRows) {
        this.core.db.run(
          `INSERT INTO outline_nodes (id, project_id, type, title, description, notes, stage_id, chapter_id, x, y, width, height, color, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          n.id,
          newProjectId,
          n.type,
          n.title,
          n.description,
          n.notes,
          n.stage_id,
          n.chapter_id,
          n.x,
          n.y,
          n.width,
          n.height,
          n.color,
          n.data,
          n.created_at,
          n.updated_at,
        );
      }

      for (const e of edgeRows) {
        this.core.db.run(
          `INSERT OR IGNORE INTO outline_edges (id, project_id, source_id, target_id, relation, label, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          e.id,
          newProjectId,
          e.sourceId,
          e.targetId,
          e.relation,
          e.label,
          e.description,
          e.created_at,
          e.updated_at,
        );
      }

      for (const l of linkRows) {
        this.core.db.run(
          `INSERT OR IGNORE INTO node_chapter_links (node_id, chapter_id, created_at) VALUES (?, ?, ?)`,
          l.nodeId,
          l.chapterId,
          l.created_at,
        );
      }

      for (const f of foreshadowRows) {
        this.core.db.run(
          `INSERT INTO foreshadows (id, project_id, name, description, status, planted_chapter_id,
             planned_resolve_chapter_id, planned_resolve_stage_id, node_id, character_node_ids, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          f.id,
          newProjectId,
          f.name,
          f.description,
          f.status,
          f.planted_chapter_id,
          f.planned_resolve_chapter_id,
          f.planned_resolve_stage_id,
          f.node_id,
          f.character_node_ids,
          f.notes,
          f.created_at,
          f.updated_at,
        );
        for (const ref of f.chapterRefs) {
          const chapterId = str(ref.chapterId);
          if (!chapterId) continue;
          this.core.db.run(
            `INSERT OR IGNORE INTO foreshadow_chapters (foreshadow_id, chapter_id, role) VALUES (?, ?, ?)`,
            f.id,
            chapterId,
            str(ref.role, 'related'),
          );
        }
      }

      // 项目级设置：按 SettingsService 的存储约定写入（字符串值直接存，对象值 JSON 化）。
      // linkSplitRatio 在库里是纯数字字符串，重映射后按约定归一化。
      if (settingsRemapped.linkSplitRatio !== undefined && typeof settingsRemapped.linkSplitRatio !== 'string') {
        settingsRemapped.linkSplitRatio = String(settingsRemapped.linkSplitRatio);
      }
      for (const [key, value] of Object.entries(settingsRemapped)) {
        if (value === undefined || value === null) continue;
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        this.core.db.run(
          `INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
          newProjectId,
          key,
          raw,
        );
      }
    });

    // 刷新项目统计（时间戳），与 ProjectService.refreshProjectStats 行为一致。
    this.core.projects.refreshProjectStats(newProjectId);
    this.core.changes.emitChange({ scope: 'projects', projectId: newProjectId, action: 'import' });

    return {
      projectId: newProjectId,
      projectName,
      chapters: chapterRows.length,
      stages: stageRows.length,
    };
  }
}
