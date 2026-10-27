import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'dashi-move-'));
const DATA_DIR = path.join(BASE, 'data-a');
const TARGET_DIR = path.join(BASE, 'data-b');
fs.mkdirSync(DATA_DIR, { recursive: true });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function launch() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.')], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(800);
  return { app, win };
}

async function main() {
  const { app, win } = await launch();

  // 创建项目 + 章节 + 正文，确认数据存在
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '迁移测试项目');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '迁移章节');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(700);
  await win.locator('.cm-content').click();
  await win.keyboard.type('迁移前的正文内容。', { delay: 2 });
  await win.waitForTimeout(2200);
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(600);
  record('迁移前数据已写入', fs.existsSync(path.join(DATA_DIR, 'dashi.db')));

  // 直接调用主进程的迁移逻辑（绕过文件对话框），验证真实迁移与重启
  const result = await app.evaluate(async ({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    return true;
  }, TARGET_DIR);

  // 打开设置页点击迁移
  await win.click('.sidebar-bottom-item:has-text("设置与备份")');
  await win.waitForTimeout(1000);
  await win.click('button:has-text("选择新位置并迁移数据")');
  // 迁移成功后主进程会 app.relaunch()，Playwright 连接会断开
  try {
    await win.waitForTimeout(3500);
  } catch {
    /* 应用已重启，连接断开属预期 */
  }
  try {
    await app.close();
  } catch {
    /* 已退出 */
  }

  const targetDb = path.join(TARGET_DIR, 'dashi.db');
  const migrated = fs.existsSync(targetDb);
  record('迁移后目标目录存在数据库', migrated, migrated ? `${(fs.statSync(targetDb).size / 1024).toFixed(0)} KB` : '');
  const bootstrap = path.join(process.env.APPDATA, '大师小说工作台', 'data-location.json');
  // 注意：此处 DASHI_DATA_DIR 覆盖优先，bootstrap 仅记录
  let bootstrapData = null;
  try {
    bootstrapData = JSON.parse(fs.readFileSync(bootstrap, 'utf8'));
  } catch {
    bootstrapData = null;
  }
  record('写入数据位置引导文件', Boolean(bootstrapData?.dataDir), bootstrapData?.dataDir ?? '无');

  // 以新目录启动验证（测试中禁用了自动 relaunch）
  const env = { ...process.env, DASHI_DATA_DIR: TARGET_DIR, DASHI_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app2 = await electron.launch({ args: [path.resolve('.')], env, timeout: 60000 });
  const win2 = await app2.firstWindow();
  await win2.waitForSelector('.sidebar', { timeout: 20000 });
  await win2.waitForTimeout(1000);
  const projectCount = await win2.locator('.project-name', { hasText: '迁移测试项目' }).count();
  record('新目录启动后项目存在', projectCount > 0);
  if (projectCount) {
    await win2.click('.project-row');
    await win2.waitForTimeout(900);
    await win2.click('.chapter-row');
    await win2.waitForTimeout(900);
    const text = await win2.locator('.cm-content').innerText();
    record('新目录启动后正文完整', text.includes('迁移前的正文'), text.slice(0, 30));
  }
  await app2.close();

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-move-run.json', JSON.stringify({ base: BASE, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
