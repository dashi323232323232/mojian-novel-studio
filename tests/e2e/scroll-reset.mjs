import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-scroll-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function launch() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.')], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(800);
  return { app, win };
}

async function main() {
  const { app, win } = await launch();

  // 建项目 + 3 章，第一章写长文，第二、三章短
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '滚动测试');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);

  const chapters = [
    { name: '第一章 很长', repeat: 300 },
    { name: '第二章 很短', repeat: 3 },
    { name: '第三章 很短', repeat: 3 },
  ];
  for (const ch of chapters) {
    await win.click('button:has-text("新建章节")');
    await win.waitForSelector('.modal input.input');
    await win.fill('.modal input.input', ch.name);
    await win.click('.modal-foot .btn-primary');
    await win.waitForTimeout(700);
    const text = '这一行用来把页面撑长，方便测试滚动位置。'.repeat(ch.repeat);
    await win.evaluate((t) => {
      const el = document.querySelector('.cm-content');
      if (!el) return;
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('insertText', false, t);
    }, text);
    await win.waitForTimeout(2000);
    await win.click('.editor-topbar button:has-text("退出")');
    await win.waitForTimeout(600);
  }

  // 打开第一章，滚到底
  await win.click('.chapter-row:has-text("第一章")');
  await win.waitForTimeout(900);
  const scrolled = await win.evaluate(() => {
    const el = document.querySelector('.editor-scroll');
    if (!el) return null;
    el.scrollTop = el.scrollHeight;
    return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
  });
  record('第一章可滚动到底部', Boolean(scrolled && scrolled.top > 200), JSON.stringify(scrolled));

  // 通过左侧目录切到第二章
  await win.click('.dir-chapter:has-text("第二章")');
  await win.waitForTimeout(1200);
  const afterSwitch = await win.evaluate(() => {
    const el = document.querySelector('.editor-scroll');
    return el ? { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight } : null;
  });
  record('切到第二章后滚动位置归零', Boolean(afterSwitch && afterSwitch.top === 0), JSON.stringify(afterSwitch));

  // 第二章内容短，不应该能滚很远
  record('第二章不会继承第一章的滚动高度', Boolean(afterSwitch && afterSwitch.height <= afterSwitch.client + 400), JSON.stringify(afterSwitch));

  // 回到第一章，也应从顶部开始（每章独立）
  await win.click('.dir-chapter:has-text("第一章")');
  await win.waitForTimeout(1200);
  const backTop = await win.evaluate(() => {
    const el = document.querySelector('.editor-scroll');
    return el ? el.scrollTop : null;
  });
  record('切回第一章同样从顶部开始', backTop === 0, String(backTop));

  // 内容页进入另一章：也应从顶部
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(700);
  await win.click('.chapter-row:has-text("第三章")');
  await win.waitForTimeout(1000);
  const fromList = await win.evaluate(() => {
    const el = document.querySelector('.editor-scroll');
    return el ? el.scrollTop : null;
  });
  record('从内容页进入章节从顶部开始', fromList === 0, String(fromList));

  // 撤销历史不跨章节：在第二章输入后切走再切回，Ctrl+Z 不应影响别的章节
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(600);
  await win.click('.chapter-row:has-text("第二章")');
  await win.waitForTimeout(900);
  await win.locator('.cm-content').click();
  await win.keyboard.press('End');
  await win.keyboard.type('第二章新加的句子。', { delay: 2 });
  await win.waitForTimeout(2000);
  const ch2Text = await win.locator('.cm-content').innerText();
  await win.click('.dir-chapter:has-text("第一章")');
  await win.waitForTimeout(1200);
  const ch1Before = await win.locator('.cm-content').innerText();
  await win.locator('.cm-content').click();
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(600);
  const ch1After = await win.locator('.cm-content').innerText();
  record('撤销不会影响其他章节', ch1Before.length === ch1After.length, `${ch1Before.length} -> ${ch1After.length}`);
  record('第二章修改仍在', ch2Text.includes('第二章新加的句子'));

  await app.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-scroll-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
