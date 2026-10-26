import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppCore } from '../../electron/main/core';
import { ApiServer } from '../../electron/main/api/server';
import { EndpointFileService } from '../../electron/main/api/discovery';
import { buildOpenApiSpec } from '../../electron/main/api/openapi';

interface Ctx {
  core: AppCore;
  server: ApiServer;
  dir: string;
  base: string;
  token: string;
}

let ctx: Ctx;

async function call(
  method: string,
  p: string,
  body?: unknown,
  options: { token?: string | null; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any; text: string }> {
  const token = options.token === undefined ? ctx.token : options.token;
  const res = await fetch(`${ctx.base}${p}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashi-api-'));
  const core = new AppCore(dir);
  const endpoint = new EndpointFileService(dir, () => 0);
  const token = 'mj_testtoken_' + 'a'.repeat(20);
  core.settings.setApiToken(token);
  const server = new ApiServer({ core, endpoint, token });
  await server.start(0);
  ctx = { core, server, dir, base: server.getBaseUrl(), token };
});

after(async () => {
  await ctx.server.stop();
  ctx.core.close();
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

describe('API：系统与鉴权', () => {
  test('健康检查与版本无需令牌', async () => {
    const health = await call('GET', '/api/v1/health', undefined, { token: null });
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    const version = await call('GET', '/api/v1/version', undefined, { token: null });
    assert.equal(version.status, 200);
    assert.equal(version.json.apiVersion, 'v1');
  });

  test('缺少令牌返回 401，错误令牌也返回 401', async () => {
    const none = await call('GET', '/api/v1/projects', undefined, { token: null });
    assert.equal(none.status, 401);
    assert.equal(none.json.error.code, 'UNAUTHORIZED');
    const wrong = await call('GET', '/api/v1/projects', undefined, { token: 'wrong' });
    assert.equal(wrong.status, 401);
  });

  test('未知接口返回 404 结构化错误', async () => {
    const res = await call('GET', '/api/v1/not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, 'NOT_FOUND');
  });

  test('OpenAPI 定义可读取且包含核心路径', async () => {
    const res = await call('GET', '/api/v1/openapi.json', undefined, { token: null });
    assert.equal(res.status, 200);
    const spec = res.json;
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/api/v1/projects/{projectId}/chapters/{chapterId}/content'] || spec.paths['/api/v1/chapters/{chapterId}/content']);
    assert.ok(spec.paths['/api/v1/projects']);
    assert.ok(spec.paths['/api/v1/projects/{projectId}/foreshadows']);
    assert.ok(spec.paths['/api/v1/audio/jobs/{jobId}']);
    assert.ok(spec.components.securitySchemes.bearerAuth);
  });

  test('Agent 文档包含服务发现、鉴权与示例', async () => {
    const res = await call('GET', '/api/v1/agent-guide', undefined, { token: null });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('api-endpoint.json'));
    assert.ok(res.text.includes('Authorization: Bearer'));
    assert.ok(res.text.includes('curl -s -X POST'));
    assert.ok(res.text.includes('当前版本 + 上一个版本'));
    assert.ok(res.text.length > 5000);
  });

  test('跨站 Origin 被拒绝', async () => {
    const res = await fetch(`${ctx.base}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${ctx.token}`, Origin: 'https://evil.example.com' },
    });
    assert.equal(res.status, 403);
  });
});

describe('API：完整创作流程', () => {
  let projectId = '';
  let stageId = '';
  let chapterId = '';
  let nodeId = '';
  let secondNodeId = '';

  test('创建项目', async () => {
    const res = await call('POST', '/api/v1/projects', { name: '普法战争', genre: '历史小说' });
    assert.equal(res.status, 200);
    projectId = res.json.project.id;
    assert.ok(projectId.startsWith('prj_'));
    const structure = await call('GET', `/api/v1/projects/${projectId}/structure`);
    assert.equal(structure.json.stages.length, 1);
    stageId = structure.json.stages[0].id;
  });

  test('空名称校验返回 400', async () => {
    const res = await call('POST', '/api/v1/projects', { name: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'VALIDATION_ERROR');
  });

  test('创建阶段与章节', async () => {
    const stage = await call('POST', `/api/v1/projects/${projectId}/stages`, { name: '第二阶段：围城' });
    assert.equal(stage.status, 200);
    assert.equal(stage.json.stage.name, '第二阶段：围城');

    const chapter = await call('POST', `/api/v1/projects/${projectId}/chapters`, {
      name: '第一章 宣战',
      stageId,
    });
    assert.equal(chapter.status, 200);
    chapterId = chapter.json.chapter.id;
    assert.ok(chapterId.startsWith('chp_'));
    assert.equal(chapter.json.chapter.wordCount, 0);
  });

  test('写入正文并读取校验', async () => {
    const text = '一八七〇年七月，巴黎的夏天闷热得反常。\n\n皇宫里，欧仁妮皇后正在读一份来自柏林的电报。';
    const save = await call('PUT', `/api/v1/chapters/${chapterId}/content`, { content: text });
    assert.equal(save.status, 200);
    assert.equal(save.json.save.revision, 1);
    assert.equal(save.json.save.unchanged, false);

    const read = await call('GET', `/api/v1/chapters/${chapterId}/content`);
    assert.equal(read.json.content.content, text);
    assert.equal(read.json.content.revision, 1);
    assert.ok(read.json.content.wordCount > 0);
  });

  test('再次保存后只保留一个上一版本', async () => {
    await call('PUT', `/api/v1/chapters/${chapterId}/content`, { content: '修改后的正文' });
    await call('PUT', `/api/v1/chapters/${chapterId}/content`, { content: '第三次修改' });
    const versions = await call('GET', `/api/v1/chapters/${chapterId}/versions`);
    assert.ok(versions.json.previous);
    const version = await call('GET', `/api/v1/chapters/${chapterId}/versions/${versions.json.previous.id}`);
    assert.equal(version.json.version.content, '修改后的正文');
  });

  test('版本冲突返回 409', async () => {
    const res = await call('PUT', `/api/v1/chapters/${chapterId}/content`, {
      content: '冲突写入',
      baseRevision: 1,
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'CONFLICT');
  });

  test('创建大纲节点与连线', async () => {
    const n1 = await call('POST', `/api/v1/projects/${projectId}/outline/nodes`, {
      type: 'event',
      title: '色当战役',
      x: 300,
      y: 180,
      data: { time: '1870-09-01', location: '色当' },
    });
    assert.equal(n1.status, 200);
    nodeId = n1.json.node.id;
    const n2 = await call('POST', `/api/v1/projects/${projectId}/outline/nodes`, {
      type: 'character',
      title: '拿破仑三世',
    });
    secondNodeId = n2.json.node.id;

    const edge = await call('POST', `/api/v1/projects/${projectId}/outline/edges`, {
      sourceId: nodeId,
      targetId: secondNodeId,
      relation: 'causal',
      label: '导致',
    });
    assert.equal(edge.status, 200);
    assert.equal(edge.json.edge.relation, 'causal');

    const snapshot = await call('GET', `/api/v1/projects/${projectId}/outline`);
    assert.equal(snapshot.json.nodes.length, 2);
    assert.equal(snapshot.json.edges.length, 1);
  });

  test('节点与章节建立多对多关联并查询', async () => {
    const chapter2 = await call('POST', `/api/v1/projects/${projectId}/chapters`, {
      name: '第二章',
      stageId,
    });
    const link1 = await call('POST', `/api/v1/projects/${projectId}/links`, { nodeId, chapterId });
    const link2 = await call('POST', `/api/v1/projects/${projectId}/links`, {
      nodeId,
      chapterId: chapter2.json.chapter.id,
    });
    assert.equal(link1.status, 200);
    assert.equal(link2.status, 200);
    const ofNode = await call('GET', `/api/v1/outline/nodes/${nodeId}/chapters`);
    assert.equal(ofNode.json.chapters.length, 2);
    const ofChapter = await call('GET', `/api/v1/chapters/${chapterId}/nodes`);
    assert.equal(ofChapter.json.nodes.length, 1);
  });

  test('创建、修改、查询伏笔', async () => {
    const created = await call('POST', `/api/v1/projects/${projectId}/foreshadows`, {
      name: '染血的军旗',
      status: 'planted',
      plantedChapterId: chapterId,
      chapterIds: [chapterId],
      nodeId,
      notes: '决战回收',
    });
    assert.equal(created.status, 200);
    const id = created.json.foreshadow.id;
    const updated = await call('PATCH', `/api/v1/foreshadows/${id}`, { status: 'developing' });
    assert.equal(updated.json.foreshadow.status, 'developing');
    const list = await call('GET', `/api/v1/projects/${projectId}/foreshadows?status=developing`);
    assert.equal(list.json.foreshadows.length, 1);
  });

  test('音频：未配置在线服务时返回明确错误而非伪造成功', async () => {
    const voices = await call('GET', '/api/v1/audio/voices');
    assert.equal(voices.status, 200);
    assert.ok(Array.isArray(voices.json.providers));
    const res = await call('POST', `/api/v1/projects/${projectId}/audio/jobs`, {
      chapterId,
      voiceId: 'not-exist',
      provider: 'openai',
    });
    assert.ok(res.status === 400 || res.status === 502);
    assert.ok(['PROVIDER_NOT_CONFIGURED', 'VALIDATION_ERROR', 'PROVIDER_ERROR'].includes(res.json.error.code));
  });

  test('音频：空章节正文被拒绝', async () => {
    const empty = await call('POST', `/api/v1/projects/${projectId}/chapters`, { name: '空章节', stageId });
    const res = await call('POST', `/api/v1/projects/${projectId}/audio/jobs`, {
      chapterId: empty.json.chapter.id,
      voiceId: 'Microsoft Huihui Desktop',
      provider: 'sapi',
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'VALIDATION_ERROR');
  });

  test('危险操作默认被禁止', async () => {
    const res = await call('DELETE', `/api/v1/chapters/${chapterId}`, { confirm: true });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'FORBIDDEN');
  });

  test('开启高危后仍需 confirm=true', async () => {
    ctx.core.settings.updateApiSettings({ allowDestructive: true });
    const noConfirm = await call('DELETE', `/api/v1/chapters/${chapterId}`, {});
    assert.equal(noConfirm.status, 409);
    assert.equal(noConfirm.json.error.code, 'CONFIRMATION_REQUIRED');
    ctx.core.settings.updateApiSettings({ allowDestructive: false });
  });

  test('删除项目需 confirmName 匹配', async () => {
    ctx.core.settings.updateApiSettings({ allowDestructive: true });
    const wrong = await call('DELETE', `/api/v1/projects/${projectId}`, {
      confirm: true,
      confirmName: '错误名称',
    });
    assert.equal(wrong.status, 409);
    ctx.core.settings.updateApiSettings({ allowDestructive: false });
  });

  test('统计与搜索接口可用', async () => {
    const stats = await call('GET', '/api/v1/stats');
    assert.equal(stats.status, 200);
    assert.ok(stats.json.chapters >= 2);
    const search = await call('GET', `/api/v1/search?q=${encodeURIComponent('色当')}&projectId=${projectId}`);
    assert.equal(search.status, 200);
    assert.ok(Array.isArray(search.json.hits));
  });

  test('数据写入后可持久化到新数据库连接', async () => {
    // 模拟重启：关闭后重新打开同一数据库
    const dbPath = ctx.core.dbPath;
    ctx.core.db.raw.exec('PRAGMA wal_checkpoint(FULL);');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string };
    assert.equal(project.name, '普法战争');
    const chapter = db.prepare('SELECT name FROM chapters WHERE id = ?').get(chapterId) as { name: string };
    assert.equal(chapter.name, '第一章 宣战');
    db.close();
  });
});
