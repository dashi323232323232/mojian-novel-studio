import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-gen-${Date.now()}`);
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
  await win.waitForTimeout(800);

  // 建项目 + 2 阶段 + 3 章节
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '结构生成验收');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);

  await win.click('button:has-text("新建阶段")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第二阶段');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(600);

  for (const name of ['第一章', '第二章', '第三章']) {
    await win.click('button:has-text("新建章节")');
    await win.waitForSelector('.modal input.input');
    await win.fill('.modal input.input', name);
    await win.click('.modal-foot .btn-primary');
    await win.waitForTimeout(700);
    await win.click('.editor-topbar button:has-text("退出")').catch(() => undefined);
    await win.waitForTimeout(500);
  }

  // 大纲：从内容生成结构
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(900);
  const btn = win.locator('button:has-text("从内容生成结构")');
  record('大纲提供「从内容生成结构」按钮', (await btn.count()) > 0);
  if (await btn.count()) {
    await btn.click();
    // 等待节点渲染（生成 + 快照回传 + ReactFlow 渲染）
    let nodeCount = 0;
    for (let i = 0; i < 30; i++) {
      await win.waitForTimeout(500);
      nodeCount = await win.locator('.node-card').count();
      if (nodeCount >= 5) break;
    }
    await win.click('button:has-text("适应画布")');
    await win.waitForTimeout(700);
    const edgeCount = await win.locator('.react-flow__edge').count();
    record('自动生成阶段与章节节点', nodeCount >= 5, `节点 ${nodeCount}`);
    record('自动建立阶段→章节连线', edgeCount >= 3, `连线 ${edgeCount}`);
    await win.screenshot({ path: 'tests/e2e/shots/25-generated-structure.png' });

    // 再点一次不应重复
    await btn.click();
    await win.waitForTimeout(2000);
    const nodeCount2 = await win.locator('.node-card').count();
    record('重复生成不重复创建', nodeCount2 === nodeCount, `${nodeCount} -> ${nodeCount2}`);
  }

  // 生成的章节节点绑定真实章节，可打开正文
  await win.locator('.node-card').filter({ hasText: '第一章' }).first().click({ force: true });
  await win.waitForTimeout(600);
  const details = await win.locator('.outline-details').innerText();
  record('生成的章节节点已绑定真实章节', details.includes('已绑定真实章节'), details.slice(0, 40).replace(/\n/g, ' '));

  await app.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-generate-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
