import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const exe = path.join(root, 'dist-packaged/DashiNovelStudio-win32-x64/大师小说工作台.exe');
const DATA_DIR = path.join(os.tmpdir(), `dashi-pk-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-pk-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const results = [];
const record = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${USER_DATA}`], env, timeout: 90000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 30000 });
  await win.waitForTimeout(1800);
  record('打包版启动正常', (await win.locator('.sidebar').count()) > 0);

  const btn = await win.locator('.app-titlebar-actions .instance-btn').count();
  record('打包版标题栏有新建实例按钮', btn > 0);

  // 迷你朗读窗口的 mini.html 必须被打进 asar
  const miniExists = await app.evaluate(async ({ app }) => {
    const fs = process.mainModule.require('node:fs');
    const path = process.mainModule.require('node:path');
    const p = path.join(app.getAppPath(), 'dist/renderer/mini.html');
    return fs.existsSync(p);
  });
  record('打包后 mini.html 存在', miniExists);

  await win.evaluate(async () => await window.dashi.miniReader.open({}));
  await win.waitForTimeout(3000);
  const pages = app.windows();
  record('打包版能打开迷你朗读窗口', pages.length >= 2, `${pages.length} 个窗口`);
  if (pages.length >= 2) {
    const mini = pages[pages.length - 1];
    await mini.waitForLoadState('domcontentloaded');
    await mini.waitForTimeout(2200);
    const rootCount = await mini.locator('[class^=mr-]').count();
    record('迷你窗口渲染成功', rootCount > 0, `${rootCount} 个元素`);
    await mini.screenshot({ path: path.join(os.tmpdir(), 'dashi-pk-mini.png') });
  }

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message.slice(0, 400)); process.exit(1); });
