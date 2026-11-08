import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-sync-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-sync-ud-${Date.now()}`);
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
  await win.waitForTimeout(1200);

  // 准备：项目 + 卷 + 2 章
  const ids = await win.evaluate(async () => {
    const p = (await window.dashi.projects.create({ name: '同步测试' })).data;
    const st0 = (await window.dashi.projects.structure(p.id)).data.stages[0];
    const stageId = st0 ? st0.id : (await window.dashi.stages.create(p.id, '第一卷 风起')).data.id;
    const chapters = [];
    for (let i = 1; i <= 2; i++) {
      const ch = (await window.dashi.chapters.create(p.id, { name: `第${i}章 原名`, stageId })).data;
      chapters.push(ch.id);
      await window.dashi.chapters.update(ch.id, { summary: `第${i}章原简介` });
    }
    return { projectId: p.id, stageId, chapters };
  });
  const { projectId, stageId, chapters } = ids;
  record('准备数据完成', Boolean(projectId && stageId && chapters.length === 2));

  // 1) 大纲 → 章节：建绑定节点并改名/改简介
  const nodeIds = await win.evaluate(async ({ pid, sid, cid }) => {
    const a = (await window.dashi.outline.createNode(pid, { type: 'chapter', title: '章节节点原名', description: '章节节点原简介', chapterId: cid })).data;
    const b = (await window.dashi.outline.createNode(pid, { type: 'stage', title: '卷节点原名', description: '卷节点原简介', stageId: sid })).data;
    return { chapterNode: a.id, stageNode: b.id };
  }, { pid: projectId, sid: stageId, cid: chapters[0] });
  record('建绑定节点成功', Boolean(nodeIds.chapterNode && nodeIds.stageNode));

  await win.evaluate(async (nid) => {
    await window.dashi.outline.updateNode(nid, { title: '大纲改的章节名', description: '大纲改的章节简介' });
  }, nodeIds.chapterNode);
  let st = (await win.evaluate(async (pid) => (await window.dashi.projects.structure(pid)).data, projectId));
  const ch1 = st.chapters.find(c => c.id === chapters[0]);
  record('大纲改章节名 → 内容同步', ch1?.name === '大纲改的章节名', ch1?.name);
  record('大纲改章节简介 → 内容同步', ch1?.summary === '大纲改的章节简介', ch1?.summary);

  await win.evaluate(async (nid) => {
    await window.dashi.outline.updateNode(nid, { title: '大纲改的卷名', description: '大纲改的卷简介' });
  }, nodeIds.stageNode);
  st = (await win.evaluate(async (pid) => (await window.dashi.projects.structure(pid)).data, projectId));
  const stage1 = st.stages.find(s => s.id === stageId);
  record('大纲改卷名 → 内容同步', stage1?.name === '大纲改的卷名', stage1?.name);
  record('大纲改卷简介 → 内容同步', stage1?.summary === '大纲改的卷简介', stage1?.summary);

  // 2) 内容 → 大纲：改章节名/简介
  await win.evaluate(async (cid) => {
    await window.dashi.chapters.update(cid, { name: '内容改的章节名', summary: '内容改的章节简介' });
  }, chapters[0]);
  let snap = (await win.evaluate(async (pid) => (await window.dashi.outline.snapshot(pid)).data, projectId));
  let cn = snap.nodes.find(n => n.id === nodeIds.chapterNode);
  record('内容改章节名 → 大纲同步', cn?.title === '内容改的章节名', cn?.title);
  record('内容改章节简介 → 大纲同步', cn?.description === '内容改的章节简介', cn?.description);

  // 3) 内容 → 大纲：改卷名/简介
  await win.evaluate(async (sid) => {
    await window.dashi.stages.update(sid, { name: '内容改的卷名', summary: '内容改的卷简介' });
  }, stageId);
  snap = (await win.evaluate(async (pid) => (await window.dashi.outline.snapshot(pid)).data, projectId));
  const sn = snap.nodes.find(n => n.id === nodeIds.stageNode);
  record('内容改卷名 → 大纲同步', sn?.title === '内容改的卷名', sn?.title);
  record('内容改卷简介 → 大纲同步', sn?.description === '内容改的卷简介', sn?.description);

  // 4) 只改名不清空简介
  await win.evaluate(async (cid) => {
    await window.dashi.chapters.update(cid, { name: '只改名字' });
  }, chapters[0]);
  st = (await win.evaluate(async (pid) => (await window.dashi.projects.structure(pid)).data, projectId));
  const ch1b = st.chapters.find(c => c.id === chapters[0]);
  snap = (await win.evaluate(async (pid) => (await window.dashi.outline.snapshot(pid)).data, projectId));
  cn = snap.nodes.find(n => n.id === nodeIds.chapterNode);
  record('只改名称时简介不被清空（内容侧）', ch1b?.summary === '内容改的章节简介', ch1b?.summary);
  record('只改名称时简介不被清空（大纲侧）', cn?.description === '内容改的章节简介', cn?.description);

  // 5) 刷新后 UI 显示新名字
  await win.reload();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1500);
  if ((await win.locator('.nav-child:has-text("内容")').count()) === 0) {
    await win.click('.project-row');
    await win.waitForTimeout(900);
  }
  await win.click('.nav-child:has-text("内容")');
  await win.waitForTimeout(1200);
  const treeText = await win.locator('.ct-root').innerText().catch(() => '');
  record('刷新后目录显示新卷名', treeText.includes('内容改的卷名'), treeText.slice(0, 60).replace(/\n/g, ' '));

  // 6) 卷改名入口
  const editBtn = win.locator('.ct-volume-action[aria-label*="编辑"]');
  const editCount = await editBtn.count();
  record('卷标题行有「编辑此卷」按钮', editCount > 0, `${editCount} 个`);
  if (editCount > 0) {
    await editBtn.first().click();
    await win.waitForTimeout(800);
    const modalCount = await win.locator('.modal').count();
    // 弹窗里的输入框应预填当前卷名
    const inputValue = await win.locator('.modal input.input').first().inputValue().catch(() => '');
    record('点击后打开改名弹窗且预填卷名', modalCount > 0 && inputValue.includes('内容改的卷名'), inputValue);
    if (modalCount > 0) {
      // 真的改个名字，验证入口端到端可用
      await win.fill('.modal input.input', '从这里改的卷名');
      await win.click('.modal-foot .btn-primary');
      await win.waitForTimeout(1200);
      const after = await win.evaluate(async (pid) => (await window.dashi.projects.structure(pid)).data, projectId);
      const s = after.stages.find((x) => x.id === stageId);
      record('通过卷编辑入口改名成功', s?.name === '从这里改的卷名', s?.name);
      // 大纲侧同步
      const snapAfter = await win.evaluate(async (pid) => (await window.dashi.outline.snapshot(pid)).data, projectId);
      const nodeAfter = snapAfter.nodes.find((n) => n.id === nodeIds.stageNode);
      record('在内容页改卷名后大纲节点同步', nodeAfter?.title === '从这里改的卷名', nodeAfter?.title);
    }
  }

  // 7) 缩放范围
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForSelector('.react-flow', { timeout: 20000 });
  await win.waitForTimeout(1800);
  const badge = await win.locator('.outline-zoom-badge').count();
  record('工具栏显示当前缩放倍率', badge > 0);

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) for (const f of failed) console.log('  - ' + f.n + (f.d ? ' — ' + f.d : ''));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message.slice(0, 400)); process.exit(1); });
