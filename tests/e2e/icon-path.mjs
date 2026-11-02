import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-icon-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-icon-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root, `--user-data-dir=${USER_DATA}`], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(800);

  const info = await app.evaluate(async ({ app, nativeImage, BrowserWindow }) => {
    const fs = process.mainModule.require('node:fs');
    const path = process.mainModule.require('node:path');
    const mainDir = path.join(app.getAppPath(), 'dist/electron/electron/main');
    const candidates = {
      fourUp: path.join(mainDir, '../../../../assets/icon.ico'),
      threeUp: path.join(mainDir, '../../../assets/icon.ico'),
    };
    const exists = Object.fromEntries(Object.entries(candidates).map(([k, v]) => [k, fs.existsSync(v)]));
    const img = nativeImage.createFromPath(candidates.fourUp);
    return {
      appPath: app.getAppPath(),
      exists,
      iconSize: img.getSize(),
      iconEmpty: img.isEmpty(),
      windowAlive: !BrowserWindow.getAllWindows()[0].isDestroyed(),
    };
  });
  console.log('INFO=' + JSON.stringify(info, null, 2));

  // 托盘图标应非空
  await win.evaluate(async () => await window.dashi.app.hideToTray());
  await win.waitForTimeout(800);
  const tray = await win.evaluate(async () => await window.dashi.app.windowState());
  console.log('TRAY=' + JSON.stringify(tray?.data));

  await app.close();
  process.exit(info.exists.fourUp && !info.iconEmpty ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
