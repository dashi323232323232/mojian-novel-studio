import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const exe = path.join(root, 'dist-installer/win-unpacked/大师小说工作台.exe');
const DATA_DIR = path.join(os.tmpdir(), `dashi-inst-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-inst-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const results = [];
const record = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function main() {
  if (!fs.existsSync(exe)) { console.error('找不到 exe: ' + exe); process.exit(1); }
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${USER_DATA}`], env, timeout: 90000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 30000 });
  await win.waitForTimeout(1800);
  record('安装包内的程序能正常启动', (await win.locator('.sidebar').count()) > 0);
  record('版本号正确', (await win.locator('.sidebar-footer').innerText()).includes('1.6.1'), await win.locator('.sidebar-footer').innerText());

  // 新版功能：卷编辑按钮 + 缩放倍率
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 10000 });
  await win.fill('.modal input.input', '安装包验证');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1200);
  const volumeEdit = await win.locator('.ct-volume-action[aria-label*="编辑"]').count();
  record('卷编辑按钮存在（v1.6.1 新功能）', volumeEdit > 0, `${volumeEdit} 个`);

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
