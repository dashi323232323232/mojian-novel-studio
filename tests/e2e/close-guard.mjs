import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-close-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function launch() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.')], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(800);
  return { app, win };
}

async function main() {
  let { app, win } = await launch();

  // 关闭自动保存，确保"未保存"状态真实存在
  await win.evaluate(() => {
    localStorage.setItem(
      'dashi.editor.settings',
      JSON.stringify({ fontSize: 18, lineHeight: 1.9, fontFamily: 'serif', autoSave: false, showWordCount: true }),
    );
  });

  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '关窗保护测试');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一章');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(700);
  await win.click('.cm-content');
  await win.keyboard.type('关闭窗口前的未保存内容。', { delay: 1 });
  await win.waitForTimeout(400);
  const dirtyLabel = await win.locator('.save-state').first().innerText();
  record('关闭自动保存后显示未保存状态', /未保存/.test(dirtyLabel), dirtyLabel);

  // 触发主进程关窗流程：守卫应先保存再放行，或弹出提示
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  // 窗口可能已关闭（保存后放行）或保持打开（等待用户选择）
  await new Promise((r) => setTimeout(r, 2500));
  let windowAlive = true;
  let modalCount = 0;
  try {
    modalCount = await win.locator('.modal').count();
    await win.title();
  } catch {
    windowAlive = false;
  }
  record('关窗时未保存内容被保护（自动保存或弹窗）', !windowAlive || modalCount > 0, windowAlive ? `弹窗 ${modalCount}` : '已保存并关闭');

  if (windowAlive && modalCount > 0) {
    await win.screenshot({ path: 'tests/e2e/shots/19-close-guard.png' });
    await win.click('.modal button:has-text("保存并继续")');
    await new Promise((r) => setTimeout(r, 2000));
  }
  try {
    await app.close();
  } catch {
    /* 已退出 */
  }

  // 重启验证内容已保存
  ({ app, win } = await launch());
  await win.click('.project-row');
  await win.waitForTimeout(900);
  await win.click('.chapter-row');
  await win.waitForTimeout(900);
  const text = await win.locator('.cm-content').innerText();
  record('关窗保存后正文未丢失', text.includes('关闭窗口前'), text.slice(0, 30));
  await app.close();

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-close-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
