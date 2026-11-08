import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-transfer-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-transfer-ud-${Date.now()}`);
const OUT_DIR = path.join(os.tmpdir(), `dashi-transfer-out-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const record = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root, `--user-data-dir=${USER_DATA}`], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1200);

  // 1) 创建项目弹窗底部有导入入口
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 8000 });
  record('创建项目弹窗有导入区域', (await win.locator('.pt-import').count()) > 0);
  record('导入区域有拖放区', (await win.locator('.pt-dropzone').count()) > 0);
  record('导入区域可选择 zip 文件', (await win.locator('button:has-text("选择 zip 文件")').count()) > 0);

  // 2) 建一个项目 + 章节 + 正文 + 大纲节点
  await win.fill('.modal input.input', '导出源项目');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1200);
  await win.evaluate(async () => {
    const list = await window.dashi.projects.list();
    const pid = list.data[0].id;
    const st = await window.dashi.projects.structure(pid);
    const stageId = st.data.stages[0]?.id ?? null;
    for (let i = 1; i <= 3; i++) {
      const ch = await window.dashi.chapters.create(pid, { name: `第${i}章 内容`, stageId });
      await window.dashi.chapters.saveContent(ch.data.id, { content: `第${i}章正文，包含一些中文内容和标点符号。`.repeat(3) });
    }
    await window.dashi.outline.createNode(pid, { type: 'event', title: '测试事件', description: '导入导出验证' });
    return pid;
  });
  await win.reload();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1600);

  // 3) 三点菜单有「导出项目」
  await win.locator('.project-more button').first().click();
  await win.waitForTimeout(500);
  const menuText = await win.locator('.menu').first().innerText().catch(() => '');
  record('三点菜单含「导出项目」', menuText.includes('导出项目'), menuText.replace(/\n/g, ' | ').slice(0, 80));

  // 4) 通过 IPC 直接导出到指定路径（绕过系统保存对话框，便于自动化）
  const zipPath = path.join(OUT_DIR, '导出源项目.zip');
  const exported = await win.evaluate(async ({ pid, target }) => await window.dashi.projectTransfer.exportProject({ projectId: pid, targetPath: target }), { pid: await win.evaluate(async () => (await window.dashi.projects.list()).data[0].id), target: zipPath });
  record('导出成功', exported?.ok === true, JSON.stringify(exported?.data ?? exported?.error));
  record('zip 文件已生成', fs.existsSync(zipPath), fs.existsSync(zipPath) ? fs.statSync(zipPath).size + ' bytes' : '');

  // 5) 检查 zip 能被 inspect 读到
  const inspected = await win.evaluate(async (p) => await window.dashi.projectTransfer.inspect(p), zipPath);
  record(
    'inspect 能读到项目信息',
    inspected?.ok === true && inspected.data.projectName === '导出源项目' && inspected.data.chapters === 3,
    JSON.stringify(inspected?.data ?? inspected?.error),
  );

  // 6) 导入后生成新项目，数据完整
  const before = await win.evaluate(async () => (await window.dashi.projects.list()).data.length);
  const imported = await win.evaluate(async (p) => await window.dashi.projectTransfer.importProject(p), zipPath);
  record('导入成功', imported?.ok === true, JSON.stringify(imported?.data ?? imported?.error));
  const after = await win.evaluate(async () => (await window.dashi.projects.list()).data.length);
  record('导入创建了新项目（不覆盖原项目）', after === before + 1, `${before} → ${after}`);
  record('导入项目 id 与原项目不同', imported?.data?.projectId !== (await win.evaluate(async () => (await window.dashi.projects.list()).data.find(p => p.name === '导出源项目').id)));

  if (imported?.ok) {
    const detail = await win.evaluate(async (pid) => {
      const st = await window.dashi.projects.structure(pid);
      const snap = await window.dashi.outline.snapshot(pid);
      let totalWords = 0;
      for (const ch of st.data.chapters) totalWords += ch.wordCount;
      return { chapters: st.data.chapters.length, nodes: snap.data.nodes.length, totalWords };
    }, imported.data.projectId);
    record('导入后章节数一致', detail.chapters === 3, String(detail.chapters));
    record('导入后大纲节点数一致', detail.nodes === 1, String(detail.nodes));
    record('导入后正文不为空', detail.totalWords > 0, detail.totalWords + ' 字');
  }

  // 7) 设置页有默认导出文件夹卡片
  await win.keyboard.press('Escape');
  await win.click('.sidebar-bottom-item:has-text("设置与备份")');
  await win.waitForTimeout(1500);
  const settingsText = await win.locator('.settings-page').innerText().catch(() => '');
  record('设置页有「默认导出文件夹」', /默认导出文件夹|选择文件夹/.test(settingsText), settingsText.includes('导出') ? '含导出相关文案' : settingsText.slice(0, 60));

  // 8) 通过 updateSettings 设置默认文件夹并验证落库
  await win.evaluate(async (dir) => await window.dashi.app.updateSettings({ exportFolder: dir }), OUT_DIR);
  const ui = await win.evaluate(async () => await window.dashi.app.settings());
  record('默认导出文件夹可保存并回读', ui?.data?.exportFolder === OUT_DIR, String(ui?.data?.exportFolder));

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) for (const f of failed) console.log('  - ' + f.n + (f.d ? ' — ' + f.d : ''));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message.slice(0, 400)); process.exit(1); });
