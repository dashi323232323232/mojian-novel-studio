import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-clone-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-clone-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const results = [];
const record = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function main() {
  // 把真实音色包（约 380MB，用硬链接避免复制开销）放进本次临时数据目录
  const real = path.join(process.env.APPDATA || '', '大师小说工作台', 'voices', '你好你好你好');
  if (fs.existsSync(real)) {
    const target = path.join(DATA_DIR, 'voices', '你好你好你好');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.cpSync(real, target, { recursive: true });
      console.log('voice package copied:', target);
    } catch (e) {
      console.log('WARN cpSync failed: ' + e.message.slice(0, 120));
    }
  }
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root, `--user-data-dir=${USER_DATA}`], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1800);

  // 用 IPC 查 voices，验证 cloned provider 出现且包含「你好你好你好」
  const voices = await win.evaluate(async () => await window.dashi.audio.voices());
  record('音频 voice 列表可用', voices?.ok === true, JSON.stringify(voices?.error ?? '').slice(0, 100));
  const all = (voices?.data ?? []).flatMap((p) => p.voices ?? []);
  const cloneVoice = all.find((v) => v.id === 'clone_nihaof' || v.name === '你好你好你好');
  record('克隆音色出现在列表里', Boolean(cloneVoice), cloneVoice ? JSON.stringify(cloneVoice) : all.map(v=>v.name).join(', '));
  record('克隆音色的 provider 为 cloned', cloneVoice?.provider === 'cloned', String(cloneVoice?.provider));

  const clonedProvider = (voices?.data ?? []).find((p) => p.provider === 'cloned');
  record('cloned provider 已配置', clonedProvider?.configured === true, JSON.stringify(clonedProvider?.configured));

  // 默认推理路径应能解析到工具
  const ui = await win.evaluate(async () => await window.dashi.app.settings());
  record('设置可读取', ui?.ok === true, JSON.stringify(ui?.error ?? '').slice(0, 80));

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) for (const f of failed) console.log('  - ' + f.n + (f.d ? ' — ' + f.d : ''));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message.slice(0, 400)); process.exit(1); });
