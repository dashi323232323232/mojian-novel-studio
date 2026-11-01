import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const exe = path.join(root, 'dist-packaged/DashiNovelStudio-win32-x64/大师小说工作台.exe');

const DATA_DIR = path.join(os.tmpdir(), `dashi-packed-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-packed-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const results = [];
const record = (n, ok, d = '') => {
  results.push({ n, ok, d });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

async function main() {
  if (!fs.existsSync(exe)) {
    console.error('找不到打包后的 exe：' + exe);
    process.exit(1);
  }
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${USER_DATA}`],
    env,
    timeout: 90000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 30000 });
  await win.waitForTimeout(1500);
  record('打包版能启动并渲染界面', (await win.locator('.sidebar').count()) > 0);

  // 图标路径是否真的解析到 asar 内的 assets
  const iconInfo = await app.evaluate(async ({ app, nativeImage }) => {
    const fs = process.mainModule.require('node:fs');
    const path = process.mainModule.require('node:path');
    const mainDir = path.join(app.getAppPath(), 'dist/electron/electron/main');
    const fourUp = path.join(mainDir, '../../../../assets/icon.ico');
    const img = nativeImage.createFromPath(fourUp);
    return { fourUp, exists: fs.existsSync(fourUp), empty: img.isEmpty(), size: img.getSize() };
  });
  record(
    '打包后能从 asar 读到图标文件',
    iconInfo.exists && !iconInfo.empty && iconInfo.size.width > 0,
    `${iconInfo.size.width}x${iconInfo.size.height}`,
  );

  // 实时朗读页可用
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 8000 });
  await win.fill('.modal input.input', '打包验证');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1200);
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一章');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1500);
  await win.waitForSelector('.cm-content', { timeout: 15000 });
  await win.click('.cm-content');
  await win.keyboard.insertText('夜色沉下来，风从窗缝里挤进来。他听见楼下有人敲门，敲了三下。');
  await win.waitForTimeout(2800);
  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForTimeout(2500);
  record('打包版实时朗读页可用', (await win.locator('.reader-layout').count()) > 0);
  record('打包版能列出系统语音', (await win.locator('.reader-select-voice option').count()) > 0);
  await win.screenshot({ path: 'proof_tmp/shots/packed-reader.png' });

  // 托盘：关闭应收缩而非退出
  await win.evaluate(async () => await window.dashi.app.hideToTray());
  await win.waitForTimeout(1200);
  const st = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { visible: w ? w.isVisible() : null, destroyed: w ? w.isDestroyed() : null };
  });
  record('打包版关闭收缩到托盘（进程仍在）', st.visible === false && st.destroyed === false, JSON.stringify(st));

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('ERR', e.message.slice(0, 400)); process.exit(1); });
