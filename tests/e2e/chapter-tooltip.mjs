import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-tip-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-tip-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });
const SHOTS = path.join(os.tmpdir(), 'dashi-tip-shots');
fs.mkdirSync(SHOTS, { recursive: true });

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

  const pid = await win.evaluate(async () => {
    const p = (await window.dashi.projects.create({ name: '悬浮窗测试' })).data;
    const st = (await window.dashi.projects.structure(p.id)).data.stages[0];
    const stageId = st ? st.id : (await window.dashi.stages.create(p.id, '第一卷')).data.id;
    const longSummary = '这是一段很长的章节简介，用来验证鼠标悬停时能完整显示，而不是被单行省略号截断。'.repeat(4);
    for (let i = 1; i <= 3; i++) {
      const ch = (await window.dashi.chapters.create(p.id, { name: `第${i}章 测试`, stageId })).data;
      await window.dashi.chapters.update(ch.id, { summary: i === 1 ? longSummary : '' });
    }
    return p.id;
  });
  await win.reload();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1500);
  if ((await win.locator('.nav-child:has-text("内容")').count()) === 0) {
    await win.click('.project-row');
    await win.waitForTimeout(900);
  }
  await win.click('.nav-child:has-text("内容")');
  await win.waitForTimeout(1200);

  // 展开卷 + 分组
  for (let i = 0; i < 6; i++) {
    if ((await win.locator('.ct-chapter').count()) > 0) break;
    if ((await win.locator('.ct-volume-head[aria-expanded="false"]').count()) > 0) {
      await win.click('.ct-volume-head[aria-expanded="false"] >> nth=0');
    } else if ((await win.locator('.ct-group-head[aria-expanded="false"]').count()) > 0) {
      await win.click('.ct-group-head[aria-expanded="false"] >> nth=0');
    } else break;
    await win.waitForTimeout(400);
  }
  record('已展开到章节列表', (await win.locator('.ct-chapter').count()) >= 3);

  // 悬停第一个章节
  await win.locator('.ct-chapter').first().hover();
  await win.waitForTimeout(900);
  const tipCount = await win.locator('.ct-tooltip').count();
  record('悬停章节出现简介浮窗', tipCount > 0);
  if (tipCount > 0) {
    const text = await win.locator('.ct-tooltip').innerText();
    record('浮窗含完整简介（未被省略）', text.includes('这是一段很长的章节简介') && text.length > 60, `长度 ${text.length}`);
    const box = await win.locator('.ct-tooltip').boundingBox();
    record('浮窗在窗口内', Boolean(box) && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1441, JSON.stringify(box));
    await win.screenshot({ path: path.join(SHOTS, 'tip.png') });
  }

  // 移开鼠标浮窗消失
  await win.mouse.move(700, 60);
  await win.waitForTimeout(600);
  record('移开鼠标后浮窗消失', (await win.locator('.ct-tooltip').count()) === 0);

  // 缩放下限
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForSelector('.react-flow', { timeout: 20000 });
  await win.waitForTimeout(1800);
  const getZoom = () => win.evaluate(() => {
    const st = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '';
    const m = /scale\(([\d.]+)\)/.exec(st);
    return m ? Number(m[1]) : null;
  });
  record('工具栏显示缩放倍率', (await win.locator('.outline-zoom-badge').count()) > 0, await win.locator('.outline-zoom-badge').innerText().catch(() => ''));
  for (let i = 0; i < 30; i++) {
    await win.click('button:has-text("缩小")');
    await win.waitForTimeout(60);
  }
  await win.waitForTimeout(400);
  const minZoom = await getZoom();
  record('能缩小到 2%', minZoom !== null && minZoom <= 0.021, String(minZoom));
  for (let i = 0; i < 40; i++) {
    await win.click('button:has-text("放大")');
    await win.waitForTimeout(50);
  }
  await win.waitForTimeout(400);
  const maxZoom = await getZoom();
  record('能放大到 8 倍', maxZoom !== null && maxZoom >= 7.9, String(maxZoom));

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) for (const f of failed) console.log('  - ' + f.n + (f.d ? ' — ' + f.d : ''));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message.slice(0, 400)); process.exit(1); });
