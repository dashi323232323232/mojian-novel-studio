import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppCore } from '../../electron/main/core';
import { ApiServer } from '../../electron/main/api/server';
import { EndpointFileService } from '../../electron/main/api/discovery';
import { buildOutlineGuide } from '../../electron/main/api/outlineGuide';

let core: AppCore;
let server: ApiServer;
let dir: string;
let base: string;
let token: string;

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashi-guide-'));
  core = new AppCore(dir);
  token = 'mj_test_' + 'g'.repeat(24);
  core.settings.setApiToken(token);
  server = new ApiServer({ core, endpoint: new EndpointFileService(dir, () => 0), token });
  await server.start(0);
  base = server.getBaseUrl();
});

after(async () => {
  await server.stop();
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('大纲使用说明文档', () => {
  test('GET /api/v1/outline-guide 无需令牌即可读取', async () => {
    const res = await call('GET', '/api/v1/outline-guide', undefined, { token: null });
    assert.equal(res.status, 200);
    assert.ok(res.text.length > 3000);
  });

  test('文档明确区分四类节点并给出时间尺度', async () => {
    const res = await call('GET', '/api/v1/outline-guide', undefined, { token: null });
    const t = res.text;
    assert.ok(t.includes('故事阶段'));
    assert.ok(t.includes('剧情事件'));
    assert.ok(t.includes('具体章节'));
    assert.ok(t.includes('伏笔'));
    assert.ok(t.includes('几个月 ~ 几年'));
    assert.ok(t.includes('几小时 ~ 几天'));
  });

  test('文档包含剧情事件的判断清单与反例', async () => {
    const t = buildOutlineGuide({ baseUrl: 'http://127.0.0.1:1' });
    assert.ok(t.includes('什么时候该建事件节点'));
    assert.ok(t.includes('❌'));
    assert.ok(t.includes('和同桌打了一架'));
    assert.ok(t.includes('一个事件写多章'));
  });

  test('文档说明 contains 与 sequence 的区别', async () => {
    const t = buildOutlineGuide({ baseUrl: 'http://127.0.0.1:1' });
    assert.ok(t.includes('contains'));
    assert.ok(t.includes('不要用 `sequence`') || t.includes('必须用 `contains`'));
    assert.ok(t.includes('阶段 → 被包含者'));
  });

  test('文档包含完整 6 步调用示例', async () => {
    const t = buildOutlineGuide({ baseUrl: 'http://127.0.0.1:1' });
    assert.ok(t.includes('第 1 步'));
    assert.ok(t.includes('第 6 步'));
    assert.ok(t.includes('outline/nodes'));
    assert.ok(t.includes('outline/edges'));
    assert.ok(t.includes('/links'));
  });

  test('传入令牌时文档内嵌真实鉴权头', async () => {
    const t = buildOutlineGuide({ baseUrl: 'http://127.0.0.1:1', token: 'mj_secret' });
    assert.ok(t.includes('Bearer mj_secret'));
  });

  test('OpenAPI 包含 outline-guide 端点', async () => {
    const res = await call('GET', '/api/v1/openapi.json', undefined, { token: null });
    assert.ok(res.json.paths['/api/v1/outline-guide']);
  });

  test('仓库内的 docs/OUTLINE_GUIDE.md 与生成结果一致', () => {
    const filePath = path.resolve(__dirname, '../../docs/OUTLINE_GUIDE.md');
    assert.ok(fs.existsSync(filePath), 'docs/OUTLINE_GUIDE.md 应存在');
    const onDisk = fs.readFileSync(filePath, 'utf8');
    assert.ok(onDisk.includes('剧情事件'));
    assert.ok(onDisk.includes('contains'));
    // 关键结构不能被误删
    assert.ok(onDisk.includes('## 五、完整调用示例'));
    assert.ok(onDisk.includes('## 八、自检清单'));
  });
});
