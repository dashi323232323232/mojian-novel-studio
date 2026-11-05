import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-pwd-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-pwd-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const results = [];
const record = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root, `--user-data-dir=${USER_DATA}`], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1500);

  // 新密码应能通过校验
  const okNew = await win.evaluate(async () => await window.dashi.app.verifyInstancePassword('Qy123456'));
  record('新默认密码 Qy123456 校验通过', okNew?.data?.ok === true, JSON.stringify(okNew?.data));

  // 旧密码必须失败
  const okOld = await win.evaluate(async () => await window.dashi.app.verifyInstancePassword('Qy60811'));
  record('旧密码 Qy60811 已失效', okOld?.data?.ok === false, JSON.stringify(okOld?.data));

  // 用旧密码创建实例应被拒绝
  // IPC 失败时返回 { ok: false, error } 而不是抛异常，必须检查返回值
  const createOld = await win.evaluate(async () => await window.dashi.app.createInstance({ password: 'Qy60811', name: 'x' }));
  record(
    '用旧密码新建实例被拒绝',
    createOld?.ok === false && /密码不正确/.test(createOld?.error?.message ?? ''),
    JSON.stringify(createOld?.error ?? createOld?.data),
  );

  // 用新密码应能成功创建（会拉起新进程，这里只断言返回结构）
  const createNew = await win.evaluate(async () => await window.dashi.app.createInstance({ password: 'Qy123456', name: '密码验证实例' }));
  record(
    '用新密码可以新建实例',
    createNew?.ok === true && Boolean(createNew?.data?.instance?.id),
    createNew?.data?.instance?.name ?? JSON.stringify(createNew?.error),
  );

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
