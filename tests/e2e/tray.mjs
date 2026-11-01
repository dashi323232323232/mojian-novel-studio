import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-tray2-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const USER_DATA = path.join(os.tmpdir(), `dashi-tray2-ud-${Date.now()}`);
fs.mkdirSync(USER_DATA, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [root, `--user-data-dir=${USER_DATA}`],
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1000);

  // 1) 真实点击窗口关闭按钮（走 win.on('close')），应被拦截并隐藏到托盘
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await win.waitForTimeout(1600);
  const afterClose = await app.evaluate(async ({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows();
    return { count: wins.length, visible: wins[0] ? wins[0].isVisible() : null, destroyed: wins[0] ? wins[0].isDestroyed() : null };
  });
  record('点击关闭按钮后收缩到托盘（进程未退出）', afterClose.count === 1 && afterClose.visible === false, JSON.stringify(afterClose));

  const trayState = await win.evaluate(async () => await window.dashi.app.windowState());
  record('托盘已创建', Boolean(trayState?.data?.trayActive), JSON.stringify(trayState?.data));

  // 2) 托盘「显示主窗口」
  await win.evaluate(async () => await window.dashi.app.showWindow());
  await win.waitForTimeout(900);
  const afterShow = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { visible: w ? w.isVisible() : null };
  });
  record('可从托盘恢复窗口', afterShow.visible === true, JSON.stringify(afterShow));

  // 3) 切换成「直接退出」后，close 应真正退出（进程结束）
  await win.evaluate(async () => {
    await window.dashi.app.updateSettings({ closeAction: 'quit' });
  });
  await win.waitForTimeout(400);
  const quitSetting = await win.evaluate(async () => (await window.dashi.app.settings()).data.closeAction);
  record('关闭行为可切换为直接退出', quitSetting === 'quit', quitSetting);

  let exited = false;
  const closed = new Promise((resolve) => {
    app.process().on('exit', () => {
      exited = true;
      resolve();
    });
  });
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await Promise.race([closed, new Promise((r) => setTimeout(r, 8000))]);
  record('选择直接退出后关闭窗口即结束进程', exited);

  if (!exited) {
    await app.close().catch(() => undefined);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E 异常', err);
  process.exit(1);
});
