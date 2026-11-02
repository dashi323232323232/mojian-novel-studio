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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashi-api3-'));
  core = new AppCore(dir);
  token = 'mj_test_' + 'c'.repeat(24);
  core.settings.setApiToken(token);
  server = new ApiServer({ core, endpoint: new EndpointFileService(dir, () => 0), token });
  await server.start(0);
  base = server.getBaseUrl();

  const p = await call('POST', '/api/v1/projects', { name: '导出与生成测试' });
  projectId = p.json.project.id;
  const stages = await call('GET', `/api/v1/projects/${projectId}/stages`);
  const stageId = stages.json.stages[0].id;
  await call('PATCH', `/api/v1/stages/${stageId}`, { summary: '阶段简介' });
  for (const name of ['第一章', '第二章']) {
    const c = await call('POST', `/api/v1/projects/${projectId}/chapters`, {
      name,
      summary: name + '简介',
      stageId,
      content: name + '正文内容',
    });
    assert.equal(c.status, 200);
  }
});

after(async () => {
  await server.stop();
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('API：导出与大纲结构生成', () => {
  test('按结构生成大纲节点与连线', async () => {
    const res = await call('POST', `/api/v1/projects/${projectId}/outline/generate`);
    assert.equal(res.status, 200);
    assert.equal(res.json.createdStageNodes, 1);
    assert.equal(res.json.createdChapterNodes, 2);
    assert.equal(res.json.createdEdges, 2);

    const snapshot = await call('GET', `/api/v1/projects/${projectId}/outline`);
    assert.equal(snapshot.json.nodes.length, 3);
    const types = snapshot.json.nodes.map((n: any) => n.type).sort();
    assert.deepEqual(types, ['chapter', 'chapter', 'stage']);
    // 阶段节点在左、章节节点在右
    const stageNode = snapshot.json.nodes.find((n: any) => n.type === 'stage');
    const chapterNodes = snapshot.json.nodes.filter((n: any) => n.type === 'chapter');
    assert.ok(chapterNodes.every((n: any) => n.x > stageNode.x));
  });

  test('重复生成不会重复创建', async () => {
    const res = await call('POST', `/api/v1/projects/${projectId}/outline/generate`);
    assert.equal(res.status, 200);
    assert.equal(res.json.createdStageNodes, 0);
    assert.equal(res.json.createdChapterNodes, 0);
    assert.equal(res.json.createdEdges, 0);
  });

  test('生成的节点绑定真实章节且简介一致', async () => {
    const snapshot = await call('GET', `/api/v1/projects/${projectId}/outline`);
    const chapterNode = snapshot.json.nodes.find((n: any) => n.type === 'chapter');
    assert.ok(chapterNode.data.chapterId);
    assert.equal(chapterNode.description, chapterNode.title + '简介');
  });

  test('导出所选章节为 TXT 文件', async () => {
    const chapters = await call('GET', `/api/v1/projects/${projectId}/chapters`);
    const ids = chapters.json.chapters.map((c: any) => c.id);
    const res = await call('POST', `/api/v1/projects/${projectId}/export/chapters`, {
      chapterIds: ids,
      includeStageHeaders: true,
      fileName: 'api-export.txt',
    });
    assert.equal(res.status, 200);
    const info = res.json.export;
    assert.ok(fs.existsSync(info.filePath), '导出文件应存在');
    assert.equal(info.chapterCount, 2);
    const text = fs.readFileSync(info.filePath, 'utf8');
    assert.ok(text.includes('导出与生成测试'));
    assert.ok(text.includes('阶段简介'));
    assert.ok(text.includes('第一章简介'));
    assert.ok(text.includes('第一章正文内容'));
    assert.ok(text.includes('第二章正文内容'));
    assert.ok(info.bytes > 0);
  });

  test('导出空数组返回 400', async () => {
    const res = await call('POST', `/api/v1/projects/${projectId}/export/chapters`, { chapterIds: [] });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'VALIDATION_ERROR');
  });

  test('OpenAPI 包含导出与结构生成接口', async () => {
    const res = await call('GET', '/api/v1/openapi.json', undefined, { token: null });
    assert.ok(res.json.paths['/api/v1/projects/{projectId}/export/chapters']);
    assert.ok(res.json.paths['/api/v1/projects/{projectId}/outline/generate']);
    assert.ok(res.json.components.schemas.ExportChaptersInput);
  });

  test('Agent 文档包含导出与结构生成示例', async () => {
    const res = await call('GET', '/api/v1/agent-guide', undefined, { token: null });
    assert.ok(res.text.includes('/export/chapters'));
    assert.ok(res.text.includes('/outline/generate'));
    assert.ok(res.text.includes('双向同步'));
    assert.ok(res.text.includes('clear-notes'));
  });
});
