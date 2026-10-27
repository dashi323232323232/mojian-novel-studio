import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppCore } from '../core';
import { NovelError, errorPayload, notFound, validationError } from '../errors';
import { APP_VERSION, API_VERSION } from '@shared/constants';
import { buildOpenApiSpec } from './openapi';
import { buildAgentGuide } from './agentGuide';
import { buildOutlineGuide } from './outlineGuide';
import { asBoolean, asString } from '../util';

export interface ApiRequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  query: URLSearchParams;
  body: unknown;
  rawBody: Buffer;
  ip: string;
  actor: string;
  core: AppCore;
  baseUrl: string;
  token: string;
  startTime: number;
  params?: Record<string, string>;
}

type Handler = (ctx: ApiRequestContext & { params: Record<string, string> }) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  handler: Handler;
  auth: boolean;
  destructive?: boolean;
  summary: string;
}

export class ApiRouter {
  private routes: Route[] = [];
  constructor(private core: AppCore) {
    this.register();
  }

  private add(
    method: string,
    pattern: string,
    handler: Handler,
    options: { auth?: boolean; destructive?: boolean; summary?: string } = {},
  ): void {
    this.routes.push({
      method,
      pattern,
      segments: pattern.split('/').filter(Boolean),
      handler,
      auth: options.auth !== false,
      destructive: options.destructive,
      summary: options.summary ?? '',
    });
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  async handle(ctx: ApiRequestContext): Promise<{ status: number; payload: unknown; summary: string }> {
    const matched = this.match(ctx.method, ctx.pathname);
    if (!matched) {
      throw notFound(`接口不存在：${ctx.method} ${ctx.pathname}。可访问 GET /api/v1/openapi.json 查看全部接口。`);
    }
    const { route, params } = matched;
    const merged = Object.assign(ctx, { params });
    const result = await route.handler(merged);
    return { status: 200, payload: result, summary: route.summary };
  }

  getRouteInfo(method: string, pathname: string): { auth: boolean; destructive: boolean } | null {
    const matched = this.match(method, pathname);
    if (!matched) return null;
    return { auth: matched.route.auth, destructive: Boolean(matched.route.destructive) };
  }

  private register(): void {
    const c = this.core;

    // ---------------- 基础信息 ----------------
    this.add(
      'GET',
      '/api/v1/health',
      () => ({
        ok: true,
        status: 'running',
        app: '大师小说工作台',
        appVersion: APP_VERSION,
        apiVersion: API_VERSION,
        time: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        database: 'ok',
      }),
      { auth: false, summary: '健康检查' },
    );

    this.add(
      'GET',
      '/api/v1/version',
      (ctx) => ({
        appVersion: APP_VERSION,
        apiVersion: API_VERSION,
        name: '大师小说工作台',
        platform: process.platform,
        node: process.versions.node,
        electron: process.versions.electron,
        endpoints: {
          openapi: `${ctx.baseUrl}/api/v1/openapi.json`,
          agentGuide: `${ctx.baseUrl}/api/v1/agent-guide`,
        },
      }),
      { auth: false, summary: '获取软件与接口版本' },
    );

    this.add('GET', '/api/v1/openapi.json', (ctx) => buildOpenApiSpec(ctx.baseUrl), {
      auth: false,
      summary: 'OpenAPI 3.1 接口定义',
    });

    this.add('GET', '/api/v1/agent-guide', (ctx) => buildAgentGuide({ core: c, baseUrl: ctx.baseUrl }), {
      auth: false,
      summary: '完整 Agent 接入文档（Markdown）',
    });

    this.add('GET', '/api/v1/outline-guide', (ctx) => buildOutlineGuide({ baseUrl: ctx.baseUrl }), {
      auth: false,
      summary: '大纲使用说明：阶段/事件/章节/伏笔语义与调用示例（Markdown）',
    });

    this.add(
      'GET',
      '/api/v1/stats',
      () => c.stats(),
      { summary: '获取全库统计' },
    );

    // ---------------- 项目 ----------------
    this.add('GET', '/api/v1/projects', () => ({ projects: c.projects.list() }), { summary: '查询项目列表' });
    this.add(
      'POST',
      '/api/v1/projects',
      (ctx) => {
        const body = asObject(ctx.body);
        return { project: c.projects.create({ name: asString(body.name), description: asString(body.description), genre: asString(body.genre), coverColor: asString(body.coverColor) || undefined }) };
      },
      { summary: '创建项目' },
    );
    this.add('GET', '/api/v1/projects/:projectId', (ctx) => ({ project: c.projects.get(ctx.params.projectId) }), {
      summary: '查询项目详情',
    });
    this.add(
      'PATCH',
      '/api/v1/projects/:projectId',
      (ctx) => {
        const body = asObject(ctx.body);
        return { project: c.projects.update(ctx.params.projectId, body) };
      },
      { summary: '修改项目' },
    );
    this.add(
      'DELETE',
      '/api/v1/projects/:projectId',
      (ctx) => {
        const body = asObject(ctx.body);
        if (!c.settings.getApiSettings().allowDestructive) {
          throw new NovelError(
            'FORBIDDEN',
            '删除项目属于高危操作，当前 API 未开启「允许高危操作」。请由用户在软件「Agent 接入」页面开启后再调用。',
            403,
          );
        }
        return c.projects.delete(ctx.params.projectId, {
          confirm: asBoolean(body.confirm, false),
          confirmName: typeof body.confirmName === 'string' ? body.confirmName : undefined,
        });
      },
      { destructive: true, summary: '删除项目（高危）' },
    );
    this.add(
      'GET',
      '/api/v1/projects/:projectId/structure',
      (ctx) => c.projects.structure(ctx.params.projectId),
      { summary: '查询阶段与章节树' },
    );

    // ---------------- 阶段 ----------------
    this.add('GET', '/api/v1/projects/:projectId/stages', (ctx) => ({ stages: c.structure.listStages(ctx.params.projectId) }), {
      summary: '查询阶段列表',
    });
    this.add(
      'POST',
      '/api/v1/projects/:projectId/stages',
      (ctx) => {
        const body = asObject(ctx.body);
        return {
          stage: c.structure.createStage(ctx.params.projectId, {
            name: asString(body.name),
            summary: typeof body.summary === 'string' ? body.summary : '',
          }),
        };
      },
      { summary: '创建阶段' },
    );
    this.add(
      'PATCH',
      '/api/v1/stages/:stageId',
      (ctx) => ({ stage: c.structure.updateStage(ctx.params.stageId, asObject(ctx.body)) }),
      { summary: '重命名阶段' },
    );
    this.add(
      'DELETE',
      '/api/v1/stages/:stageId',
      (ctx) => {
        const body = asObject(ctx.body);
        if (!c.settings.getApiSettings().allowDestructive) {
          throw new NovelError('FORBIDDEN', '删除阶段属于高危操作，请在「Agent 接入」中开启「允许高危操作」。', 403);
        }
        return c.structure.deleteStage(ctx.params.stageId, {
          confirm: asBoolean(body.confirm, false),
          chapterAction: body.chapterAction === 'delete' ? 'delete' : 'move',
          targetStageId: typeof body.targetStageId === 'string' ? body.targetStageId : null,
        });
      },
      { destructive: true, summary: '删除阶段（高危）' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/stages/reorder',
      (ctx) => ({ stages: c.structure.reorderStages(ctx.params.projectId, asArray(asObject(ctx.body).orderedIds)) }),
      { summary: '调整阶段顺序' },
    );

    // ---------------- 章节 ----------------
    this.add(
      'GET',
      '/api/v1/projects/:projectId/chapters',
      (ctx) => ({
        chapters: c.structure.listChapters(
          ctx.params.projectId,
          ctx.query.get('stageId') || undefined,
        ),
      }),
      { summary: '查询章节列表' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/chapters',
      (ctx) => {
        const body = asObject(ctx.body);
        return {
          chapter: c.structure.createChapter(ctx.params.projectId, {
            name: asString(body.name),
            summary: typeof body.summary === 'string' ? body.summary : '',
            stageId: typeof body.stageId === 'string' ? body.stageId : null,
            content: typeof body.content === 'string' ? body.content : '',
          }),
        };
      },
      { summary: '创建章节' },
    );
    this.add('GET', '/api/v1/chapters/:chapterId', (ctx) => ({ chapter: c.structure.getChapter(ctx.params.chapterId) }), {
      summary: '查询章节详情',
    });
    this.add(
      'PATCH',
      '/api/v1/chapters/:chapterId',
      (ctx) => ({ chapter: c.structure.updateChapter(ctx.params.chapterId, asObject(ctx.body)) }),
      { summary: '修改章节名称或所属阶段' },
    );
    this.add(
      'DELETE',
      '/api/v1/chapters/:chapterId',
      (ctx) => {
        const body = asObject(ctx.body);
        if (!c.settings.getApiSettings().allowDestructive) {
          throw new NovelError('FORBIDDEN', '删除章节属于高危操作，请在「Agent 接入」中开启「允许高危操作」。', 403);
        }
        return c.structure.deleteChapter(ctx.params.chapterId, { confirm: asBoolean(body.confirm, false) });
      },
      { destructive: true, summary: '删除章节（高危）' },
    );
    this.add(
      'POST',
      '/api/v1/chapters/:chapterId/move',
      (ctx) => ({ chapter: c.structure.moveChapter(ctx.params.chapterId, asObject(ctx.body)) }),
      { summary: '移动章节到指定阶段与位置' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/chapters/reorder',
      (ctx) => ({ chapters: c.structure.reorderChapters(ctx.params.projectId, asArray(asObject(ctx.body).orderedIds)) }),
      { summary: '整体调整章节顺序' },
    );
    this.add('GET', '/api/v1/chapters/:chapterId/content', (ctx) => ({ content: c.structure.getContent(ctx.params.chapterId) }), {
      summary: '读取章节正文',
    });
    this.add(
      'PUT',
      '/api/v1/chapters/:chapterId/content',
      (ctx) => {
        const body = asObject(ctx.body);
        if (typeof body.content !== 'string') throw validationError('content 必须是字符串');
        return {
          save: c.structure.saveContent(ctx.params.chapterId, {
            content: body.content,
            baseRevision: typeof body.baseRevision === 'number' ? body.baseRevision : null,
            source: ctx.actor === 'agent' ? 'api' : 'manual',
          }),
        };
      },
      { summary: '保存章节正文' },
    );
    this.add('GET', '/api/v1/chapters/:chapterId/versions', (ctx) => c.structure.listVersions(ctx.params.chapterId), {
      summary: '查询当前版本与上一个版本',
    });
    this.add(
      'GET',
      '/api/v1/chapters/:chapterId/versions/:versionId',
      (ctx) => ({ version: c.structure.getVersion(ctx.params.versionId) }),
      { summary: '读取指定历史版本正文' },
    );
    this.add(
      'POST',
      '/api/v1/chapters/:chapterId/versions/:versionId/restore',
      (ctx) => ({
        save: c.structure.restoreVersion(ctx.params.chapterId, ctx.params.versionId),
      }),
      { summary: '回滚到上一个版本' },
    );

    // ---------------- 大纲 ----------------
    this.add('GET', '/api/v1/projects/:projectId/outline', (ctx) => c.outline.snapshot(ctx.params.projectId), {
      summary: '获取完整大纲（节点、连线、关联）',
    });
    this.add(
      'GET',
      '/api/v1/projects/:projectId/outline/nodes',
      (ctx) => ({
        nodes: c.outline.listNodes(ctx.params.projectId, (ctx.query.get('type') as never) || undefined),
      }),
      { summary: '查询大纲节点' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/outline/nodes',
      (ctx) => ({ node: c.outline.createNode(ctx.params.projectId, asObject(ctx.body) as never) }),
      { summary: '创建大纲节点' },
    );
    this.add('GET', '/api/v1/outline/nodes/:nodeId', (ctx) => ({ node: c.outline.getNode(ctx.params.nodeId) }), {
      summary: '查询单个节点',
    });
    this.add(
      'PATCH',
      '/api/v1/outline/nodes/:nodeId',
      (ctx) => ({ node: c.outline.updateNode(ctx.params.nodeId, asObject(ctx.body)) }),
      { summary: '修改节点（名称/描述/位置/尺寸/数据）' },
    );
    this.add(
      'DELETE',
      '/api/v1/outline/nodes/:nodeId',
      (ctx) => c.outline.deleteNode(ctx.params.nodeId, { confirm: asBoolean(asObject(ctx.body).confirm, false) }),
      { destructive: true, summary: '删除节点（需确认）' },
    );
    this.add('POST', '/api/v1/outline/nodes/:nodeId/duplicate', (ctx) => ({ node: c.outline.duplicateNode(ctx.params.nodeId) }), {
      summary: '复制节点',
    });
    this.add('POST', '/api/v1/outline/nodes/:nodeId/clear-notes', (ctx) => ({ node: c.outline.clearNotes(ctx.params.nodeId) }), {
      summary: '清空节点备注',
    });
    this.add(
      'POST',
      '/api/v1/projects/:projectId/outline/generate',
      (ctx) => c.outline.generateStructure(ctx.params.projectId),
      { summary: '按章节结构自动生成阶段/章节节点与顺序连线' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/outline/reconcile-bindings',
      (ctx) => c.outline.reconcileBindings(ctx.params.projectId),
      { summary: '按名称自动绑定阶段/章节节点' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/outline/nodes/positions',
      (ctx) => c.outline.updatePositions(ctx.params.projectId, asArray(asObject(ctx.body).positions) as never),
      { summary: '批量保存节点位置' },
    );
    this.add('GET', '/api/v1/projects/:projectId/outline/edges', (ctx) => ({ edges: c.outline.listEdges(ctx.params.projectId) }), {
      summary: '查询连线',
    });
    this.add(
      'POST',
      '/api/v1/projects/:projectId/outline/edges',
      (ctx) => ({ edge: c.outline.createEdge(ctx.params.projectId, asObject(ctx.body) as never) }),
      { summary: '创建连线' },
    );
    this.add('PATCH', '/api/v1/outline/edges/:edgeId', (ctx) => ({ edge: c.outline.updateEdge(ctx.params.edgeId, asObject(ctx.body)) }), {
      summary: '修改连线',
    });
    this.add('DELETE', '/api/v1/outline/edges/:edgeId', (ctx) => c.outline.deleteEdge(ctx.params.edgeId), {
      summary: '删除连线',
    });
    this.add('GET', '/api/v1/projects/:projectId/links', (ctx) => ({
      links: c.outline.listLinks(ctx.params.projectId, {
        nodeId: ctx.query.get('nodeId') || undefined,
        chapterId: ctx.query.get('chapterId') || undefined,
      }),
    }), { summary: '查询章节与节点关联' });
    this.add(
      'POST',
      '/api/v1/projects/:projectId/links',
      (ctx) => {
        const body = asObject(ctx.body);
        const nodeId = asString(body.nodeId);
        const chapterId = asString(body.chapterId);
        if (!nodeId || !chapterId) throw validationError('nodeId 与 chapterId 均必填');
        return { link: c.outline.linkChapter(nodeId, chapterId) };
      },
      { summary: '创建章节与节点关联' },
    );
    this.add(
      'DELETE',
      '/api/v1/projects/:projectId/links',
      (ctx) => {
        const nodeId = ctx.query.get('nodeId');
        const chapterId = ctx.query.get('chapterId');
        if (!nodeId || !chapterId) throw validationError('nodeId 与 chapterId 均必填');
        c.outline.unlinkChapter(nodeId, chapterId);
        return { deleted: true, nodeId, chapterId };
      },
      { summary: '删除章节与节点关联' },
    );
    this.add('GET', '/api/v1/outline/nodes/:nodeId/chapters', (ctx) => ({
      nodeId: ctx.params.nodeId,
      chapters: c.outline.chaptersForNode(ctx.params.nodeId),
    }), { summary: '查询节点关联的章节' });
    this.add('GET', '/api/v1/chapters/:chapterId/nodes', (ctx) => ({
      chapterId: ctx.params.chapterId,
      nodes: c.outline.nodesForChapter(ctx.params.chapterId),
    }), { summary: '查询章节关联的节点' });

    // ---------------- 伏笔 ----------------
    this.add(
      'GET',
      '/api/v1/projects/:projectId/foreshadows',
      (ctx) => ({
        foreshadows: c.foreshadow.list(ctx.params.projectId, {
          status: (ctx.query.get('status') as never) || undefined,
          chapterId: ctx.query.get('chapterId') || undefined,
        }),
      }),
      { summary: '查询伏笔' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/foreshadows',
      (ctx) => ({ foreshadow: c.foreshadow.create(ctx.params.projectId, asObject(ctx.body) as never) }),
      { summary: '创建伏笔' },
    );
    this.add('GET', '/api/v1/foreshadows/:foreshadowId', (ctx) => ({ foreshadow: c.foreshadow.get(ctx.params.foreshadowId) }), {
      summary: '查询伏笔详情',
    });
    this.add(
      'PATCH',
      '/api/v1/foreshadows/:foreshadowId',
      (ctx) => ({ foreshadow: c.foreshadow.update(ctx.params.foreshadowId, asObject(ctx.body) as never) }),
      { summary: '修改伏笔' },
    );
    this.add(
      'DELETE',
      '/api/v1/foreshadows/:foreshadowId',
      (ctx) => c.foreshadow.delete(ctx.params.foreshadowId, { confirm: asBoolean(asObject(ctx.body).confirm, false) }),
      { destructive: true, summary: '删除伏笔（需确认）' },
    );
    this.add('POST', '/api/v1/foreshadows/:foreshadowId/attach-outline', (ctx) => c.foreshadow.attachToOutline(ctx.params.foreshadowId), {
      summary: '将伏笔同步为大纲节点',
    });

    // ---------------- 音频 ----------------
    this.add('GET', '/api/v1/audio/voices', async (ctx) => ({
      providers: await c.audio.listVoices(ctx.query.get('provider') || undefined),
    }), { summary: '查询可用声音' });
    this.add(
      'GET',
      '/api/v1/projects/:projectId/audio/jobs',
      (ctx) => ({ jobs: c.audio.listJobs(ctx.params.projectId, ctx.query.get('chapterId') || undefined) }),
      { summary: '查询音频任务' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/audio/jobs',
      async (ctx) => {
        const body = asObject(ctx.body);
        return {
          job: await c.audio.createJob(ctx.params.projectId, {
            chapterId: asString(body.chapterId),
            voiceId: asString(body.voiceId),
            provider: asString(body.provider) || 'sapi',
            rate: typeof body.rate === 'number' ? body.rate : undefined,
            volume: typeof body.volume === 'number' ? body.volume : undefined,
          }),
        };
      },
      { summary: '创建音频生成任务' },
    );
    this.add(
      'POST',
      '/api/v1/projects/:projectId/audio/preview',
      async (ctx) => {
        const body = asObject(ctx.body);
        return {
          preview: await c.audio.previewVoice(ctx.params.projectId, {
            voiceId: asString(body.voiceId),
            provider: asString(body.provider) || 'sapi',
            rate: typeof body.rate === 'number' ? body.rate : undefined,
            volume: typeof body.volume === 'number' ? body.volume : undefined,
            text: typeof body.text === 'string' ? body.text : undefined,
          }),
        };
      },
      { summary: '试听声音样本（不创建任务）' },
    );
    this.add('GET', '/api/v1/audio/jobs/:jobId', (ctx) => ({ job: c.audio.getJob(ctx.params.jobId) }), {
      summary: '查询音频任务状态与结果',
    });
    this.add('POST', '/api/v1/audio/jobs/:jobId/cancel', (ctx) => ({ job: c.audio.cancelJob(ctx.params.jobId) }), {
      summary: '取消音频任务',
    });
    this.add('DELETE', '/api/v1/audio/jobs/:jobId', (ctx) => c.audio.deleteJob(ctx.params.jobId), {
      destructive: true,
      summary: '删除音频任务及文件',
    });

    // ---------------- 导出 ----------------
    this.add(
      'POST',
      '/api/v1/projects/:projectId/export/chapters',
      (ctx) => {
        const body = asObject(ctx.body);
        const chapterIds = asArray(body.chapterIds);
        return {
          export: c.projects.exportChapters(ctx.params.projectId, chapterIds, {
            includeStageHeaders: body.includeStageHeaders !== false,
            fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
          }),
        };
      },
      { summary: '导出所选章节为 TXT 文件' },
    );

    // ---------------- 搜索与设置 ----------------
    this.add(
      'GET',
      '/api/v1/search',
      (ctx) => {
        const q = ctx.query.get('q') ?? '';
        const projectId = ctx.query.get('projectId') ?? undefined;
        return { query: q, hits: c.projects.search(q, projectId) };
      },
      { summary: '搜索章节与正文' },
    );
    this.add(
      'GET',
      '/api/v1/settings',
      () => {
        const ui = c.settings.getUi();
        return { settings: ui, api: c.settings.getApiSettings() };
      },
      { summary: '读取界面设置（不含密钥）' },
    );
    this.add(
      'PATCH',
      '/api/v1/settings',
      (ctx) => {
        const body = asObject(ctx.body);
        const ui = c.settings.updateUi({
          lastProjectId: typeof body.lastProjectId === 'string' ? body.lastProjectId : undefined,
          editor: body.editor as never,
        });
        return { settings: ui };
      },
      { summary: '更新界面设置' },
    );
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw validationError('该字段必须是数组');
  return value.map((v) => String(v));
}
