import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppCore } from '../../electron/main/core';
import { ApiServer } from '../../electron/main/api/server';
import { EndpointFileService } from '../../electron/main/api/discovery';

let core: AppCore;
let server: ApiServer;
let dir: string;
let base: string;
let token: string;
let projectId: string;
let stageId: string;
let chapterId: string;
let nodeId: string;

async function call(method: string, p: string, body?: unknown, opts: { token?: string | null } = {}) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      ...(opts.token === null ? {} : { Authorization: `Bearer ${opts.token ?? token}` }),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashi-api2-'));
  core = new AppCore(dir);
  const endpoint = new EndpointFileService(dir, () => 0);
  token = 'mj_test_' + 'b'.repeat(24);
  core.settings.setApiToken(token);
  server = new ApiServer({ core, endpoint, token });
  await server.start(0);
  base = server.getBaseUrl();
});

after(async () => {
  await server.stop();
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('API：简介、具体章节节点、备注与导出数据', () => {
  test('创建项目与阶段（含简介）', async () => {
    const p = await call('POST', '/api/v1/projects', { name: '新功能项目' });
    projectId = p.json.project.id;
    const stages = await call('GET', `/api/v1/projects/${projectId}/stages`);
    stageId = stages.json.stages[0].id;
    const updated = await call('PATCH', `/api/v1/stages/${stageId}`, { summary: '阶段简介文本' });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.stage.summary, '阶段简介文本');
  });

  test('只给名称创建章节', async () => {
    const res = await call('POST', `/api/v1/projects/${projectId}/chapters`, { name: '只有名字' });
    assert.equal(res.status, 200);
    chapterId = res.json.chapter.id;
    assert.equal(res.json.chapter.summary, '');
    const content = await call('GET', `/api/v1/chapters/${chapterId}/content`);
    assert.equal(content.json.content.content, '');
  });

  test('创建章节时带简介并修改', async () => {
    const created = await call('POST', `/api/v1/projects/${projectId}/chapters`, {
      name: '带简介章节',
      summary: '初始简介',
      stageId,
    });
    assert.equal(created.json.chapter.summary, '初始简介');
    const patched = await call('PATCH', `/api/v1/chapters/${created.json.chapter.id}`, {
      summary: '修改后的简介',
    });
    assert.equal(patched.json.chapter.summary, '修改后的简介');
  });

  test('具体章节节点绑定并双向同步', async () => {
    const created = await call('POST', `/api/v1/projects/${projectId}/outline/nodes`, {
      type: 'chapter',
      title: '占位',
      chapterId,
    });
    assert.equal(created.status, 200);
    nodeId = created.json.node.id;
    assert.equal(created.json.node.title, '只有名字');

    const patched = await call('PATCH', `/api/v1/outline/nodes/${nodeId}`, {
      description: '大纲写的简介',
    });
    assert.equal(patched.json.node.description, '大纲写的简介');
    const chapter = await call('GET', `/api/v1/chapters/${chapterId}`);
    assert.equal(chapter.json.chapter.summary, '大纲写的简介');
  });

  test('备注不限字数、可清空', async () => {
    const long = '备注内容测试。'.repeat(5000);
    const updated = await call('PATCH', `/api/v1/outline/nodes/${nodeId}`, { notes: long });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.node.notes.length, long.length);
    const cleared = await call('POST', `/api/v1/outline/nodes/${nodeId}/clear-notes`);
    assert.equal(cleared.json.node.notes, '');
  });

  test('reconcile-bindings 接口可用', async () => {
    const res = await call('POST', `/api/v1/projects/${projectId}/outline/reconcile-bindings`);
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.bound, 'number');
  });

  test('OpenAPI 包含 chapter 节点与 notes 字段', async () => {
    const res = await call('GET', '/api/v1/openapi.json', undefined, { token: null });
    const spec = res.json;
    const nodeSchema = spec.components.schemas.OutlineNode;
    assert.ok(nodeSchema.properties.notes);
    assert.ok(nodeSchema.properties.type.enum.includes('chapter'));
    assert.ok(spec.paths['/api/v1/outline/nodes/{nodeId}/clear-notes']);
    assert.ok(spec.components.schemas.CreateStageInput.properties.summary);
    assert.ok(spec.components.schemas.CreateChapterInput.properties.summary);
  });

  test('Agent 文档说明简介同步与备注', async () => {
    const res = await call('GET', '/api/v1/agent-guide', undefined, { token: null });
    assert.ok(res.text.includes('双向同步'));
    assert.ok(res.text.includes('chapter'));
    assert.ok(res.text.includes('备注'));
  });
});
