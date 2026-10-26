import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-packed-${Date.now()}`);
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
  await win.evaluate(() => {
    localStorage.setItem('dashi.editor.settings', JSON.stringify({ fontSize: 18, lineHeight: 1.9, fontFamily: 'serif', autoSave: true, showWordCount: true }));
  });

}

async function main() {
  const { app, win } = await launch();
  record('打包版可启动', true);

  const title = await win.title();
  record('窗口标题为大师小说工作台', title.includes('大师'), title);

  // 创建项目
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '打包验收项目');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);
  record('打包版创建项目', (await win.locator('.project-name', { hasText: '打包验收项目' }).count()) > 0);

  // 建章节并写正文
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一章 验收');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
  await win.click('.cm-content');
  await win.keyboard.type('打包后的应用可以正常写作。', { delay: 2 });
  // 等待自动保存（1.2s 防抖 + 写盘）完成；保存状态位于顶部工具栏
  let autoSaved = false;
  for (let i = 0; i < 24; i++) {
    await win.waitForTimeout(500);
    const label = await win.locator('.save-state').first().innerText().catch(() => '');
    if (label.includes('已保存')) {
      autoSaved = true;
      break;
    }
  }
  record('打包版自动保存', autoSaved);
  await win.screenshot({ path: 'tests/e2e/shots/18-packed-editor.png' });

  // 大纲
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(500);
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(1000);
  await win.click('.palette-item:has-text("人物")');
  await win.waitForTimeout(800);
  record('打包版创建大纲节点', (await win.locator('.node-card').count()) >= 1);

  // 音频页检测
  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForTimeout(1500);
  record('打包版检测到本地语音', !(await win.locator('button:has-text("制作音频")').isDisabled()));

  // Agent 页与 API 服务
  await win.click('.sidebar-bottom-item:has-text("Agent 接入")');
  await win.waitForTimeout(1500);
  const statusText = await win.locator('.card').first().innerText();
  record('打包版本地 API 运行', statusText.includes('运行中'), statusText.split('\n').slice(0, 2).join(' '));
  await win.click('button:has-text("连接测试")');
  await win.waitForTimeout(1200);
  const testText = await win.locator('.info-note').filter({ hasText: 'HTTP' }).innerText().catch(() => '');
  record('打包版连接测试通过', testText.includes('HTTP 200'), testText.slice(0, 50));

  // 数据目录写盘检查
  const dbPath = path.join(DATA_DIR, 'dashi.db');
  record('打包版数据库落盘', fs.existsSync(dbPath), `${(fs.statSync(dbPath).size / 1024).toFixed(0)} KB`);

  await app.close();

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-packed-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
