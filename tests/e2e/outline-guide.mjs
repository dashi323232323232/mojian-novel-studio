import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-guide-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.')], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(900);

  // Agent 页
  await win.click('.sidebar-bottom-item:has-text("Agent 接入")');
  await win.waitForTimeout(1500);

  const card = win.locator('.card').filter({ hasText: '大纲使用说明' });
  record('Agent 页显示大纲使用说明卡片', (await card.count()) > 0);

  const cardText = await card.first().innerText();
  record('卡片解释剧情事件语义', cardText.includes('剧情事件') && cardText.includes('和同桌打了一架'), cardText.slice(0, 40).replace(/\n/g, ' '));

  // 复制
  await win.click('button:has-text("复制大纲使用说明")');
  await win.waitForTimeout(800);
  const toastText = await win.locator('.toast').last().innerText().catch(() => '');
  record('复制大纲使用说明成功', /已复制/.test(toastText), toastText.slice(0, 40));

  // 查看
  await win.click('.card:has-text("大纲使用说明") button:has-text("查看")');
  await win.waitForTimeout(1000);
  const modal = win.locator('.modal:has-text("大纲使用说明")');
  record('可查看大纲说明全文', (await modal.count()) > 0);
  if (await modal.count()) {
    const text = await modal.innerText();
    record('全文包含四类节点对比', text.includes('故事阶段') && text.includes('剧情事件') && text.includes('具体章节') && text.includes('伏笔'));
    record('全文包含调用示例', text.includes('curl') || text.includes('outline/nodes'));
    await win.screenshot({ path: 'tests/e2e/shots/26-outline-guide.png' });
    await win.click('.modal-foot button:has-text("关闭")');
    await win.waitForTimeout(400);
  }

  // HTTP 端点可访问：从主进程取真实端口（渲染层受 CSP 限制不能直接 fetch 外部端口）
  // 从数据目录的服务发现文件读取端口（Node 侧读取，不依赖渲染层）
  const discoveryPath = path.join(DATA_DIR, 'api-endpoint.json');
  const endpointInfo = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
  const endpoint = await fetch(`${endpointInfo.baseUrl}/api/v1/outline-guide`)
    .then(async (r) => ({ status: r.status, len: (await r.text()).length }))
    .catch(() => null);
  record('outline-guide 端点可访问', Boolean(endpoint && endpoint.status === 200 && endpoint.len > 3000), JSON.stringify(endpoint));

  await app.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-guide-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
