import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-autonext-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-autonext-ud-${Date.now()}`);
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

  // 建项目 + 2 章短正文
  const pid = await win.evaluate(async () => {
    const p = await window.dashi.projects.create({ name: '自动续读测试' });
    const st = await window.dashi.projects.structure(p.data.id);
    const stageId = st.data.stages[0]?.id ?? null;
    for (let i = 1; i <= 2; i++) {
      const ch = await window.dashi.chapters.create(p.data.id, { name: `第${i}章 短章`, stageId });
      await window.dashi.chapters.saveContent(ch.data.id, { content: `这是第${i}章的短正文。` });
    }
    return p.data.id;
  });

  // 打开音频页：reload 后侧栏项目默认折叠，先点项目行展开
  await win.reload();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1500);
  if ((await win.locator('.nav-child:has-text("音频制作")').count()) === 0) {
    await win.click('.project-row');
    await win.waitForTimeout(900);
  }
  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForSelector('.reader-layout', { timeout: 20000 });
  await win.waitForTimeout(1800);

  const chapterOptions = await win.locator('select.reader-select:not(.reader-select-voice) option').count();
  record('音频页有两章可选', chapterOptions >= 2, `${chapterOptions} 个`);

  // 确认 autoNext 开启
  const ui = await win.evaluate(async () => await window.dashi.app.settings());
  record('自动续读开关默认开启', ui?.data?.reading?.autoNext === true, String(ui?.data?.reading?.autoNext));

  const chapterSelect = win.locator('select.reader-select:not(.reader-select-voice)');
  await win.click('.reader-play');
  await win.waitForTimeout(1200);
  const chapterBefore = await chapterSelect.inputValue();

  // 等待第一章读完并自动切到第二章（短正文，最多 25 秒）
  let chapterAfter = chapterBefore;
  let playingAfterSwitch = false;
  for (let i = 0; i < 50; i++) {
    await win.waitForTimeout(500);
    chapterAfter = await chapterSelect.inputValue();
    if (chapterAfter !== chapterBefore) {
      // 切换后再等一会儿，确认新章节真的在朗读（进度前进 / 播放按钮变成暂停）
      await win.waitForTimeout(1200);
      const title = await win.locator('.reader-play').getAttribute('title').catch(() => '');
      playingAfterSwitch = /暂停/.test(title ?? '');
      break;
    }
  }
  record('读完第一章后自动切到下一章', chapterAfter !== chapterBefore, `${chapterBefore} → ${chapterAfter}`);
  record('切到下一章后继续朗读（不是只载入）', playingAfterSwitch, `播放按钮标题=${await win.locator('.reader-play').getAttribute('title').catch(() => '')}`);

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message.slice(0, 400)); process.exit(1); });
