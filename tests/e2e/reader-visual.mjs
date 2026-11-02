import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), 'dashi-reader-visual-' + Date.now());
// 并行跑多个 Electron 时必须隔离 userData，否则 requestSingleInstanceLock 会让第二个实例直接退出
const USER_DATA = path.join(os.tmpdir(), 'dashi-reader-visual-ud-' + Date.now() + '-' + Math.random().toString(16).slice(2));
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const SHOT_DIR = path.join(root, 'proof_tmp/shots/visual');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const SIZES = [
  [1024, 680],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
];

const results = [];
const infos = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''));
}
function info(name, detail = '') {
  infos.push({ name, detail });
  console.log('INFO  ' + name + (detail ? '  — ' + detail : ''));
}

const shots = [];
async function shot(win, file) {
  const abs = path.join(SHOT_DIR, file);
  await win.screenshot({ path: abs });
  const bytes = fs.statSync(abs).size;
  shots.push({ file, abs, bytes });
  return { abs, bytes };
}

function rectOverlap(a, b, tol = 1) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > tol && h > tol;
}

const b2s = (b) => (b ? 'x=' + Math.round(b.x) + ' y=' + Math.round(b.y) + ' w=' + Math.round(b.width) + ' h=' + Math.round(b.height) : 'null');
const rnd = (n) => Math.round(n);

async function setSize(app, win, w, h) {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    bw.setContentSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForTimeout(800);
}

async function readerChecks(win, w, h) {
  const tag = ' @' + w + 'x' + h;
  const inner = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

  // 用例：播放按钮
  const play = await win.locator('.reader-play').boundingBox();
  record('播放按钮 .reader-play 可见且宽高均大于 30px' + tag, !!play && play.width > 30 && play.height > 30,
    play ? rnd(play.width) + 'x' + rnd(play.height) : 'boundingBox 为 null');

  // 用例：三栏不重叠
  const left = await win.locator('.reader-bar-left').boundingBox();
  const center = await win.locator('.reader-bar-center').boundingBox();
  const right = await win.locator('.reader-bar-right').boundingBox();
  let barOk = false;
  let barDetail = '';
  if (left && center && right) {
    const sameRow = (a, b) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > Math.min(a.height, b.height) * 0.5;
    const oneRow = sameRow(left, center) && sameRow(center, right);
    if (oneRow) {
      barOk = left.x + left.width <= center.x + 1 && center.x + center.width <= right.x + 1;
      barDetail = '单行三栏：左/中/右水平分离';
    } else {
      barOk = !rectOverlap(left, center) && !rectOverlap(center, right) && !rectOverlap(left, right);
      barDetail = '两行布局（≤1180px 断点，中栏换到上一行）：矩形互不相交';
    }
    barDetail += ' | 左 ' + b2s(left) + ' / 中 ' + b2s(center) + ' / 右 ' + b2s(right);
  } else {
    barDetail = 'boundingBox 缺失：左 ' + b2s(left) + ' 中 ' + b2s(center) + ' 右 ' + b2s(right);
  }
  record('控制栏 .reader-bar 左中右三组互不重叠' + tag, barOk, barDetail);

  // 用例：控制区不超出窗口
  const controls = await win.locator('.reader-controls').boundingBox();
  const controlsBottom = controls ? controls.y + controls.height : null;
  record('控制区 .reader-controls 底部不超出窗口高度' + tag, controlsBottom !== null && controlsBottom <= inner.h + 0.5,
    'controls.bottom=' + (controlsBottom === null ? 'null' : rnd(controlsBottom)) + ' / 窗口高 ' + inner.h);

  // 用例：当前句可见
  const active = await win.locator('.reader-line.active').first().boundingBox();
  const activeVisible = !!active && active.height > 0 && active.y >= 0 && active.y + Math.min(active.height, 8) <= inner.h;
  record('当前句 .reader-line.active 至少一行在窗口内可见' + tag, activeVisible, b2s(active) + ' / 窗口高 ' + inner.h);

  // 用例：当前句不横向溢出
  const lineOverflow = await win.evaluate(() => {
    const el = document.querySelector('.reader-line.active');
    if (!el) return null;
    return { sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent || '').slice(0, 14) };
  });
  record('当前句文字不横向溢出（scrollWidth ≤ clientWidth + 2）' + tag,
    !!lineOverflow && lineOverflow.sw <= lineOverflow.cw + 2,
    lineOverflow ? 'scrollWidth=' + lineOverflow.sw + ' clientWidth=' + lineOverflow.cw : '未找到 .reader-line.active');

  // 用例：进度条三处文字未被省略号截断
  const meta = await win.evaluate(() => Array.from(document.querySelectorAll('.reader-progress-meta span')).map((s) => ({
    sw: s.scrollWidth,
    cw: s.clientWidth,
    text: (s.textContent || '').trim().slice(0, 18),
  })));
  const metaBad = meta.filter((m) => m.sw > m.cw + 2);
  let metaDetail = '共 ' + meta.length + ' 个 span';
  if (metaBad.length) {
    metaDetail += '，被截断：' + metaBad.map((m) => JSON.stringify(m)).join(' / ');
  } else {
    metaDetail += '，全部完整：' + meta.map((m) => m.text + '(' + m.sw + '/' + m.cw + ')').join('  ');
  }
  record('进度条 .reader-progress-meta 三处文字均未被截断成省略号' + tag,
    meta.length === 3 && metaBad.length === 0,
    metaDetail);

  // 附加观察：提词器窗口裁切、上下留白、语音下拉是否被压到省略号
  const clip = await win.evaluate(() => {
    const stage = document.querySelector('.reader-stage');
    if (!stage) return null;
    const sr = stage.getBoundingClientRect();
    const lines = Array.from(document.querySelectorAll('.reader-line')).map((el) => el.getBoundingClientRect());
    if (!lines.length) return null;
    let cutPx = 0;
    let fullyHidden = 0;
    for (const r of lines) {
      const visible = Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top);
      if (visible <= 0) { fullyHidden += 1; cutPx += Math.round(r.height); }
      else if (visible < r.height - 0.5) { cutPx += Math.round(r.height - visible); }
    }
    const lastBottom = Math.max(...lines.map((r) => r.bottom));
    const firstTop = Math.min(...lines.map((r) => r.top));
    return {
      stageH: Math.round(sr.height),
      total: lines.length,
      cutPx,
      fullyHidden,
      gapTop: Math.round(firstTop - sr.top),
      gapBottom: Math.round(sr.bottom - lastBottom),
    };
  });
  if (clip) {
    info('提词器裁切观察' + tag,
      '提词器高 ' + clip.stageH + 'px，渲染 ' + clip.total + ' 行，被裁共 ' + clip.cutPx + 'px（整行完全不可见 ' + clip.fullyHidden + ' 行），顶部留白 ' + clip.gapTop + 'px、底部留白 ' + clip.gapBottom + 'px');
  }
  const voiceTrunc = await win.evaluate(() => {
    const sel = document.querySelector('.reader-select-voice');
    if (!sel) return null;
    const r = sel.getBoundingClientRect();
    const opt = sel.options[sel.selectedIndex];
    const probe = document.createElement('span');
    const cs = getComputedStyle(sel);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + cs.font;
    probe.textContent = opt ? opt.textContent : '';
    document.body.appendChild(probe);
    const tw = probe.getBoundingClientRect().width;
    probe.remove();
    return { box: Math.round(r.width), text: Math.round(tw), truncated: tw > r.width - 18 };
  });
  if (voiceTrunc) {
    info('语音下拉文字是否被截断' + tag,
      '控件宽 ' + voiceTrunc.box + 'px，选中项文本需 ' + voiceTrunc.text + 'px → ' + (voiceTrunc.truncated ? '显示为省略号' : '完整显示'));
  }
  return { play, left, center, right, controls, active, inner };
}

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [root, '--user-data-dir=' + USER_DATA],
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1200);

  // ---------- 准备数据：项目 + 章节 + 约 1500 字正文 ----------
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 5000 });
  await win.fill('.modal input.input', '实时朗读视觉核查');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);

  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一章 长夜将至');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1200);
  await win.waitForSelector('.cm-content', { timeout: 10000 });

  const sentences = [
    '夜色像一块浸了水的黑布，沉沉压在屋顶上。',
    '陈默把台灯拧亮了一些，光晕在稿纸边缘抖了抖。',
    '他听见楼下有人敲门，敲了三下，停一停，又敲三下。',
    '那是只有他们两个人知道的暗号。',
    '门外的人低声说了一句话，声音被风撕碎了一半。',
    '陈默没有立刻开门，他把手伸进抽屉，摸到了那把旧钥匙。',
    '钥匙是凉的，凉得让他想起十年前的那个冬天。',
    '他终于站起来，一步一步走向门口。',
  ];
  const body = [];
  let total = 0;
  while (total < 1500) {
    const s = sentences[body.length % sentences.length];
    body.push(s);
    total += s.length;
  }
  await win.click('.cm-content');
  await win.keyboard.insertText(body.join('\n'));
  await win.waitForTimeout(2800);
  console.log('正文长度约 ' + total + ' 字');

  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForSelector('.reader-layout', { timeout: 15000 });
  await win.waitForSelector('.reader-line.active', { timeout: 15000 });
  await win.waitForTimeout(1800);
  const lineCount = await win.locator('.reader-line').count();
  console.log('提词器可见行数 ' + lineCount);

  // ---------- 1~4：五种窗口尺寸 ----------
  for (const [w, h] of SIZES) {
    await setSize(app, win, w, h);
    await win.waitForTimeout(400);
    await readerChecks(win, w, h);
    const { abs, bytes } = await shot(win, 'reader-' + w + 'x' + h + '.png');
    console.log('截图 ' + path.relative(root, abs) + ' (' + bytes + ' B)');

    // 用例：1024x680 下音量允许被隐藏，但声音下拉必须仍可见可用
    if (w === 1024 && h === 680) {
      const voice = win.locator('.reader-select-voice');
      const vBox = await voice.boundingBox();
      const vDisabled = await voice.isDisabled();
      const vOptions = await win.locator('.reader-select-voice option').count();
      const voiceOk = !!vBox && vBox.width > 30 && vBox.height > 10 && !vDisabled && vOptions > 0;
      record('1024x680 下声音下拉 .reader-select-voice 仍可见可用（音量允许被隐藏）', voiceOk,
        'voice ' + b2s(vBox) + ' disabled=' + vDisabled + ' 可选声音=' + vOptions);

      const volumeDisplay = await win.evaluate(() => {
        const el = document.querySelector('.reader-volume');
        return el ? getComputedStyle(el).display : 'missing';
      });
      record('1024x680 下音量控件状态符合断点设计（CSS 在 ≤980px 才隐藏）',
        volumeDisplay === 'block' || volumeDisplay === 'inline-block',
        '.reader-volume display=' + volumeDisplay + '（窗口 1024px > 980px 断点，按设计仍显示）');
    }
  }

  // ---------- 附加观察：1024x680 下切到中段句子后提词器的裁切情况 ----------
  await setSize(app, win, 1024, 680);
  const lineIdx = Math.min(4, (await win.locator('.reader-line').count()) - 1);
  if (lineIdx > 0) {
    await win.locator('.reader-line').nth(lineIdx).click();
    await win.waitForTimeout(900);
    const seekClip = await win.evaluate(() => {
      const stage = document.querySelector('.reader-stage');
      const sr = stage.getBoundingClientRect();
      const lines = Array.from(document.querySelectorAll('.reader-line')).map((el) => el.getBoundingClientRect());
      let cutPx = 0;
      let fullyHidden = 0;
      let halfCut = 0;
      for (const r of lines) {
        const visible = Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top);
        if (visible <= 0) { fullyHidden += 1; cutPx += Math.round(r.height); }
        else if (visible < r.height * 0.5) { cutPx += Math.round(r.height - visible); halfCut += 1; }
      }
      const act = document.querySelector('.reader-line.active');
      const ar = act ? act.getBoundingClientRect() : null;
      return { total: lines.length, cutPx, fullyHidden, halfCut, activeY: ar ? Math.round(ar.y) : null, stageH: Math.round(sr.height) };
    });
    info('1024x680 切到中段句子后的提词器裁切',
      '渲染 ' + seekClip.total + ' 行，被裁共 ' + seekClip.cutPx + 'px（完全不可见 ' + seekClip.fullyHidden + ' 行，露出不足半行 ' + seekClip.halfCut + ' 行），当前句 y=' + seekClip.activeY);
    const { abs, bytes } = await shot(win, 'reader-1024x680-seek.png');
    console.log('截图 ' + path.relative(root, abs) + ' (' + bytes + ' B)');
  }

  // ---------- 5：离线音频在 1024x680 下变单列 ----------
  await setSize(app, win, 1024, 680);
  await win.click('.seg-tab:has-text("离线音频")');
  await win.waitForSelector('.audio-offline-grid', { timeout: 10000 });
  await win.waitForTimeout(1000);
  const grid = win.locator('.audio-offline-grid');
  const c1 = await grid.locator(':scope > *').nth(0).boundingBox();
  const c2 = await grid.locator(':scope > *').nth(1).boundingBox();
  const cols = await win.evaluate(() => {
    const el = document.querySelector('.audio-offline-grid');
    return el ? getComputedStyle(el).gridTemplateColumns : null;
  });
  const singleCol = !!c1 && !!c2 && c2.y >= c1.y + c1.height * 0.8;
  record('1024x680 离线音频 .audio-offline-grid 变为单列（两卡片上下排列）', singleCol,
    '第一张 ' + b2s(c1) + ' / 第二张 ' + b2s(c2) + ' / grid-template-columns=' + cols);
  {
    const { abs, bytes } = await shot(win, 'offline-1024x680.png');
    console.log('截图 ' + path.relative(root, abs) + ' (' + bytes + ' B)');
  }

  // ---------- 6：设置页 1280x800 ----------
  await setSize(app, win, 1280, 800);
  await win.click('.seg-tab:has-text("实时朗读")');
  await win.waitForTimeout(400);
  await win.click('.sidebar-bottom-item:has-text("设置与备份")');
  await win.waitForSelector('.settings-card', { timeout: 10000 });
  await win.waitForTimeout(1200);
  const closeCard = win.locator('.settings-card:has-text("关闭与托盘")').first();
  const cards = closeCard.locator('.radio-card');
  const cardCount = await cards.count();
  const cb1 = cardCount > 0 ? await cards.nth(0).boundingBox() : null;
  const cb2 = cardCount > 1 ? await cards.nth(1).boundingBox() : null;
  const bothVisible = !!cb1 && !!cb2 && cb1.width > 40 && cb1.height > 20 && cb2.width > 40 && cb2.height > 20;
  const noOverlap = !!cb1 && !!cb2 && !rectOverlap(cb1, cb2);
  record('1280x800 设置页「关闭与托盘」两个 .radio-card 可见且不重叠', bothVisible && noOverlap,
    '数量=' + cardCount + ' / 第一张 ' + b2s(cb1) + ' / 第二张 ' + b2s(cb2) + ' / 重叠=' + (cb1 && cb2 ? rectOverlap(cb1, cb2) : '?'));
  record('1280x800 设置页存在「实时朗读」卡片',
    (await win.locator('.settings-card:has-text("实时朗读")').count()) > 0);
  {
    const { abs, bytes } = await shot(win, 'settings-1280x800.png');
    console.log('截图 ' + path.relative(root, abs) + ' (' + bytes + ' B)');
  }

  await app.close();

  // ---------- 7：截图文件大小（非空白） ----------
  for (const s of shots) {
    record('截图非空白且大于 20KB：' + s.file, s.bytes > 20 * 1024, s.bytes + ' B');
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n通过 ' + (results.length - failed.length) + '/' + results.length);
  console.log('失败清单：' + (failed.length ? '' : '无'));
  for (const f of failed) console.log(' - ' + f.name + (f.detail ? '  — ' + f.detail : ''));
  if (infos.length) {
    console.log('\n观察项（不计入通过率）：');
    for (const i of infos) console.log(' · ' + i.name + (i.detail ? '  — ' + i.detail : ''));
  }
  console.log('\n截图清单：');
  for (const s of shots) console.log(' - ' + path.relative(root, s.abs) + '  ' + s.bytes + ' B');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E 异常', err);
  process.exit(1);
});
