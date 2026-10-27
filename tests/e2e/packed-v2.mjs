import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-pv2-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const exe = path.resolve('dist-packaged/DashiNovelStudio-win32-x64/大师小说工作台.exe');

async function launch() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: exe, args: [], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar', { timeout: 25000 });
  await win.waitForTimeout(900);
  return { app, win };
}

async function main() {
  const { app, win } = await launch();
  record('打包版可启动（新版本）', true);

  // 只填名字创建
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '打包新功能');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '只有名字的章');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
  record('打包版只填名称创建章节', (await win.locator('.cm-content').count()) > 0);
  record('打包版编辑器含简介框', (await win.locator('.chapter-summary-input').count()) > 0);

  // 简介写入并同步
  await win.locator('.chapter-summary-input').fill('打包版简介同步测试');
  await win.locator('.cm-content').click();
  await win.waitForTimeout(1600);

  // 导出选择模式
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(600);
  record('打包版有导出 TXT 入口', (await win.locator('button:has-text("导出 TXT")').count()) > 0);
  await win.click('button:has-text("导出 TXT")');
  await win.waitForTimeout(400);
  record('打包版可全选章节', (await win.locator('button:has-text("全选章节")').count()) > 0);

  // 大纲具体章节节点
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(1000);
  record('打包版大纲含具体章节模块', (await win.locator('.palette-item:has-text("具体章节")').count()) > 0);

  // 设置页数据位置
  await win.click('.sidebar-bottom-item:has-text("设置与备份")');
  await win.waitForTimeout(1000);
  const text = await win.locator('.settings-page').innerText();
  record('打包版可更改数据存储位置', text.includes('数据存储位置') && text.includes('选择新位置并迁移数据'));

  await win.screenshot({ path: 'tests/e2e/shots/24-packed-v2.png' });
  await app.close();

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-packed-v2-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
