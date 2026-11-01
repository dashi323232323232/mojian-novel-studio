import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-min-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-min-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root, `--user-data-dir=${USER_DATA}`], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(900);

  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 5000 });
  await win.fill('.modal input.input', '尺寸测试');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal.input.input, .modal input.input', '第一章 测试');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1100);
  await win.waitForSelector('.cm-content', { timeout: 10000 });
  await win.click('.cm-content');
  await win.keyboard.insertText('夜色沉下来，风从窗缝里挤进来。'.repeat(30));
  await win.waitForTimeout(2600);
  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForTimeout(1800);

  fs.mkdirSync('proof_tmp/shots/min', { recursive: true });
  for (const [w, h] of [[1024, 680], [1280, 800], [1440, 900], [1920, 1080]]) {
    await app.evaluate(async ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size[0], size[1]);
    }, [w, h]);
    await win.waitForTimeout(700);
    await win.screenshot({ path: `proof_tmp/shots/min/reader-${w}x${h}.png` });
    const boxes = await win.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        play: pick('.reader-play'),
        left: pick('.reader-bar-left'),
        center: pick('.reader-bar-center'),
        right: pick('.reader-bar-right'),
        controls: pick('.reader-controls'),
        active: pick('.reader-line.active'),
        voice: pick('.reader-select-voice'),
        volume: pick('.reader-volume'),
        innerW: window.innerWidth,
        innerH: window.innerHeight,
      };
    });
    const overlap = boxes.left && boxes.center && boxes.right
      ? (boxes.left.x + boxes.left.w <= boxes.center.x + 1 && boxes.center.x + boxes.center.w <= boxes.right.x + 1)
      : false;
    console.log(`${w}x${h} inner=${boxes.innerW}x${boxes.innerH} play=${boxes.play ? boxes.play.w + 'x' + boxes.play.h : 'null'} noOverlap=${overlap} controlsBottom=${boxes.controls ? boxes.controls.y + boxes.controls.h : '?'} voice=${boxes.voice ? boxes.voice.w : 'null'} volume=${boxes.volume ? 'shown' : 'hidden'} active=${boxes.active ? boxes.active.y : 'null'}`);
  }

  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error('ERR', e.message.slice(0, 400)); process.exit(1); });
