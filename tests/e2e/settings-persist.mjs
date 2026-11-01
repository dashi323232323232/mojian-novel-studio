/**
 * E2E：设置持久化 / 朗读进度持久化
 *
 * 覆盖：
 *  1. 全新数据目录的默认值（closeAction / rememberReading / reading.rate / reading.autoNext）
 *  2. 修改后关闭应用、用同一个 DASHI_DATA_DIR 重新启动，设置仍在
 *  3. 非法值兜底（closeAction 传非法字符串；reading.rate 传 999 / -5 的实际落库行为）
 *  4. 朗读进度写入 project_settings.readingProgress，重启后仍存在
 *  5. 关闭「记住朗读位置」后不再写入
 *  6. 两个项目的朗读进度互相隔离
 *
 * 说明：
 *  - 不改源码、不构建，直接跑 dist 里的最新产物。
 *  - 每次 launch 都额外传一个独立的 --user-data-dir（同一个根目录下的 run-N 子目录），
 *    既避免与并行运行的其他 e2e 脚本抢 requestSingleInstanceLock，也避免上一个进程的 Chromium
 *    子进程尚未释放缓存锁导致「Unable to move the cache / 窗口空白」。业务数据只认 DASHI_DATA_DIR，
 *    因此 userData 每次不同不影响「重启后数据仍在」的验证。
 *  - 重启前会轮询等待旧进程真正退出（process.kill(pid, 0)），必要时 taskkill 兜底。
 *  - 断言规则全部来自 electron/main/services/settings.ts 的实际实现：
 *      updateUi: closeAction 只接受 'quit' / 'tray'，其它值回退为当前合法值；
 *      updateUi: reading 直接 Object.assign 合并 patch，**不做范围校验**（rate/pitch/volume 原样落库）；
 *      getUi:   rememberReading 用 parsed.rememberReading !== false 兜底。
 */
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-settings-${stamp}`);
// 本脚本独占的 userData 目录：隔离单实例锁，避免与并行运行的其它 e2e 脚本互抢锁。
// 每次 launch 用一个新的 userData 目录：上一个进程的 Chromium 子进程可能还没完全释放缓存锁，
// 复用同一目录会偶发「Unable to move the cache / 窗口空白」。业务数据只看 DASHI_DATA_DIR，因此不影响用例。
const USER_DATA_ROOT = path.join(os.tmpdir(), `dashi-settings-ud-${stamp}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA_ROOT, { recursive: true });

const SHOTS = path.join(root, 'proof_tmp/shots');
fs.mkdirSync(SHOTS, { recursive: true });

const NAME_A = '持久化测试A';
const NAME_B = '持久化测试B';
const NAME_UI = '越界值测试';

const TEXT = [
  '夜色像一块浸了水的黑布，沉沉压在屋顶上。',
  '陈默把台灯拧亮了一些，光晕在稿纸边缘抖了抖。',
  '他听见楼下有人敲门，敲了三下，停一停，又敲三下。',
  '那是只有他们两个人知道的暗号。',
  '门外的人低声说了一句话，声音被风撕碎了一半。',
  '陈默没有立刻开门，他把手伸进抽屉，摸到了那把旧钥匙。',
  '钥匙是凉的，凉得让他想起十年前的那个冬天。',
  '他终于站起来，一步一步走向门口。',
].join('\n');

const results = [];
function record(name, ok, detail = '') {
  const pass = Boolean(ok);
  results.push({ name, ok: pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unwrap(result, what) {
  if (!result || result.ok !== true) {
    throw new Error(`${what} 调用失败：${result && result.error ? result.error.message : '返回结构异常'}`);
  }
  return result.data;
}

// ---------------- 启动 / 关闭 ----------------

let ctx = null;
let launchSeq = 0;

async function launchApp(attempt = 1) {
  launchSeq += 1;
  const userDataDir = path.join(USER_DATA_ROOT, `run-${launchSeq}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const app = await electron.launch({
      args: [root, '--user-data-dir=' + userDataDir],
      env,
      timeout: 60000,
    });
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('.sidebar', { timeout: 20000 });
    await win.waitForTimeout(1200);
    let pid = null;
    try {
      pid = app.process()?.pid ?? null;
    } catch {
      pid = null;
    }
    return { app, win, pid, userDataDir };
  } catch (err) {
    if (attempt <= 1) {
      console.log(`启动失败（第 ${attempt} 次），3 秒后重试：${err instanceof Error ? err.message : err}`);
      await sleep(3000);
      return launchApp(attempt + 1);
    }
    throw err;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

async function waitExit(pid, timeoutMs) {
  if (!pid) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(250);
  }
  return !isAlive(pid);
}

function forceKill(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    /* 进程可能已经退出 */
  }
}

/** 干净关闭：确认进程真的退出后才返回，避免下一次启动被单实例锁挡住。 */
async function closeApp(current, label = '') {
  if (!current) return;
  const { app, win, pid } = current;
  try {
    await win.evaluate(() => {
      try {
        window.dashi.app.setDirty(false);
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* 窗口可能已关闭 */
  }
  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), 15000);
  });
  const outcome = await Promise.race([
    app.close().then(() => 'closed').catch(() => 'closed'),
    timeoutPromise,
  ]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    console.log(`关闭应用超时（${label}），强制结束进程 ${pid}`);
    forceKill(pid);
  }
  let exited = await waitExit(pid, outcome === 'timeout' ? 10000 : 15000);
  if (!exited) {
    console.log(`进程 ${pid} 仍未退出，强制结束`);
    forceKill(pid);
    exited = await waitExit(pid, 10000);
  }
  if (!exited) throw new Error(`上一个应用进程（pid ${pid}）无法结束，单实例锁会阻塞后续启动`);
  await sleep(600);
}

/** 关闭并用同一个 DASHI_DATA_DIR 重新启动。 */
async function relaunch(current, label) {
  const oldPid = current ? current.pid : null;
  await closeApp(current, label);
  const next = await launchApp();
  console.log(`已重新启动（${label}）：pid ${oldPid} → ${next.pid}`);
  record(`重启（${label}）产生了新的应用进程`, oldPid !== null && next.pid !== null && oldPid !== next.pid, `${oldPid} → ${next.pid}`);
  return next;
}

// ---------------- 应用内查询 ----------------

const readSettings = async () => unwrap(await ctx.win.evaluate(() => window.dashi.app.settings()), 'app.settings');
const writeSettings = async (patch) =>
  unwrap(await ctx.win.evaluate((p) => window.dashi.app.updateSettings(p), patch), 'app.updateSettings');
const readProjectSettings = async (projectId) =>
  unwrap(await ctx.win.evaluate((id) => window.dashi.app.projectSettings(id), projectId), 'app.projectSettings');

async function findProjectId(name) {
  const list = unwrap(await ctx.win.evaluate(() => window.dashi.projects.list()), 'projects.list');
  const hit = list.find((p) => p.name === name);
  if (!hit) throw new Error(`找不到项目：${name}`);
  return hit.id;
}

async function projectStructure(projectId) {
  return unwrap(await ctx.win.evaluate((id) => window.dashi.projects.structure(id), projectId), 'projects.structure');
}

async function chapterContent(chapterId) {
  return unwrap(await ctx.win.evaluate((id) => window.dashi.chapters.content(id), chapterId), 'chapters.content');
}

// ---------------- UI 操作 ----------------

async function createProject(name) {
  const win = ctx.win;
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 8000 });
  await win.fill('.modal input.input', name);
  await win.click('.modal-foot .btn-primary');
  await win.waitForSelector('.add-chapter-row', { timeout: 20000 });
  await win.waitForTimeout(700);
}

async function createChapterWithText(chapterName, text) {
  const win = ctx.win;
  await win.locator('.add-chapter-row').first().click();
  await win.waitForSelector('.modal input.input', { timeout: 8000 });
  await win.fill('.modal input.input', chapterName);
  await win.click('.modal-foot .btn-primary');
  await win.waitForSelector('.cm-content', { timeout: 20000 });
  await win.waitForTimeout(700);
  await win.click('.cm-content');
  await win.keyboard.type(text, { delay: 1 });
  // 自动保存是输入停止 1.2s 后触发
  await win.waitForTimeout(2800);
}

/** 打开指定项目的音频页（先点项目行，保证侧栏展开且视图切到内容页）。 */
async function gotoAudio(projectName) {
  const win = ctx.win;
  await win.locator('.project-item', { hasText: projectName }).first().locator('.project-row').click();
  await win.waitForTimeout(1200);
  await win
    .locator('.project-item', { hasText: projectName })
    .first()
    .locator('.nav-child:has-text("音频制作")')
    .click();
  await win.waitForSelector('.reader-layout', { timeout: 20000 });
  await win.waitForTimeout(1000);
}

/** 拖动朗读进度条到指定比例，等 2 秒（保存是 1500ms 防抖）后返回 aria-valuenow。 */
async function dragProgress(ratio) {
  const win = ctx.win;
  const track = win.locator('.reader-progress-track');
  await track.waitFor({ state: 'visible', timeout: 15000 });
  const box = await track.boundingBox();
  if (!box || box.width < 10) throw new Error('进度条不可见或宽度异常');
  const y = box.y + box.height / 2;
  await win.mouse.move(box.x + box.width * Math.max(0.01, ratio - 0.01), y);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * ratio, y, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(2000);
  const aria = await win.locator('.reader-progress').getAttribute('aria-valuenow');
  return Number(aria);
}

/**
 * 复现「越界值可以写进库」的真实影响：
 * 写入 reading.rate=999 / pitch=99 / volume=9999，然后进音频页看语速显示、进设置页看 range 输入框的显示值。
 */
async function checkOutOfRangeUi() {
  const win = ctx.win;
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(`${msg.type()}: ${msg.text().slice(0, 200)}`);
  };
  win.on('console', onConsole);

  await writeSettings({ reading: { rate: 999, pitch: 99, volume: 9999 } });
  const stored = await readSettings();

  // 需要先有项目才能进音频页（用独立项目名，避免和后面的用例重名）
  if (!(await projectExists(NAME_UI))) {
    await createProject(NAME_UI);
    const pid = await findProjectId(NAME_UI);
    await createChapterWithText('第一章 越界', TEXT);
    await projectStructure(pid);
  }
  await gotoAudio(NAME_UI);
  const readerRateLabel = await win.locator('.reader-rate-value').innerText().catch(() => '读取失败');
  await win.screenshot({ path: path.join(SHOTS, 'settings-04-rate-999.png') });

  await win.click('.sidebar-bottom-item:has-text("设置与备份")');
  await win.waitForTimeout(1500);
  const rangeValues = await win
    .locator('.settings-card:has-text("实时朗读") input[type=range]')
    .evaluateAll((els) => els.map((e) => ({ min: e.min, max: e.max, value: e.value })));
  await win.screenshot({ path: path.join(SHOTS, 'settings-05-rate-999-settings.png') });

  win.off('console', onConsole);
  return { readerRateLabel: readerRateLabel.trim(), rangeValues, stored: stored.reading, consoleErrors };
}

async function projectExists(name) {
  try {
    await findProjectId(name);
    return true;
  } catch {
    return false;
  }
}

// ---------------- 主流程 ----------------

async function main() {
  ctx = await launchApp();
  console.log(`数据目录：${DATA_DIR}`);
  console.log(`用户数据目录根：${USER_DATA_ROOT}`);
  console.log(`应用进程 pid：${ctx.pid}\n`);

  // ---------- 1. 默认值 ----------
  const s0 = await readSettings();
  record('默认值：closeAction 为 tray', s0.closeAction === 'tray', String(s0.closeAction));
  record('默认值：rememberReading 为 true', s0.rememberReading === true, String(s0.rememberReading));
  record('默认值：reading.rate 为 1', s0.reading.rate === 1, String(s0.reading.rate));
  record('默认值：reading.autoNext 为 true', s0.reading.autoNext === true, String(s0.reading.autoNext));
  record(
    '默认值：reading 其余字段为默认（engine=web / provider=sapi / volume=100 / chapterId=null）',
    s0.reading.engine === 'web' && s0.reading.provider === 'sapi' && s0.reading.volume === 100 && s0.reading.chapterId === null,
    JSON.stringify({ engine: s0.reading.engine, provider: s0.reading.provider, volume: s0.reading.volume, chapterId: s0.reading.chapterId }),
  );

  // ---------- 2. 修改四项设置 ----------
  const patched = await writeSettings({ closeAction: 'quit', rememberReading: false, reading: { rate: 1.5, pitch: 1.2 } });
  record(
    '修改四项设置后返回值为新值',
    patched.closeAction === 'quit' && patched.rememberReading === false && patched.reading.rate === 1.5 && patched.reading.pitch === 1.2,
    JSON.stringify({ closeAction: patched.closeAction, rememberReading: patched.rememberReading, rate: patched.reading.rate, pitch: patched.reading.pitch }),
  );
  const s0b = await readSettings();
  record(
    '修改四项设置后立即回读一致',
    s0b.closeAction === 'quit' && s0b.rememberReading === false && s0b.reading.rate === 1.5 && s0b.reading.pitch === 1.2,
    JSON.stringify({ closeAction: s0b.closeAction, rememberReading: s0b.rememberReading, rate: s0b.reading.rate, pitch: s0b.reading.pitch }),
  );

  // ---------- 重启后仍在 ----------
  ctx = await relaunch(ctx, '修改设置后');
  const s1 = await readSettings();
  record('重启后：closeAction 仍为 quit', s1.closeAction === 'quit', String(s1.closeAction));
  record('重启后：rememberReading 仍为 false', s1.rememberReading === false, String(s1.rememberReading));
  record('重启后：reading.rate 仍为 1.5', s1.reading.rate === 1.5, String(s1.reading.rate));
  record('重启后：reading.pitch 仍为 1.2', s1.reading.pitch === 1.2, String(s1.reading.pitch));

  // ---------- 3. 非法值兜底 ----------
  const beforeBad = s1.closeAction; // 'quit'
  const bad = await writeSettings({ closeAction: 'something-else' });
  record(
    '非法 closeAction 被兜底为修改前的合法值 quit',
    bad.closeAction === beforeBad && bad.closeAction === 'quit',
    `修改前 ${beforeBad} → 传入 something-else → 返回 ${bad.closeAction}`,
  );
  const afterBad = await readSettings();
  record('非法 closeAction 未落库为非法字符串', afterBad.closeAction === 'quit', String(afterBad.closeAction));
  const stillAlive = await ctx.win.evaluate(() => 1 + 1).catch(() => null);
  record('传非法 closeAction 后应用未崩溃', stillAlive === 2, String(stillAlive));
  record('非法 closeAction 没有影响其它设置', afterBad.rememberReading === false && afterBad.reading.rate === 1.5, JSON.stringify({ rememberReading: afterBad.rememberReading, rate: afterBad.reading.rate }));

  // reading.rate 越界：服务端应夹到 0.5~2，不允许把非法值写进库
  const r999 = await writeSettings({ reading: { rate: 999 } });
  const r999read = await readSettings();
  record(
    'reading.rate 传 999 被夹到上限 2',
    r999.reading.rate === 2 && r999read.reading.rate === 2,
    `返回 ${r999.reading.rate} / 回读 ${r999read.reading.rate}`,
  );
  const rneg = await writeSettings({ reading: { rate: -5 } });
  const rnegRead = await readSettings();
  record(
    'reading.rate 传 -5 被夹到下限 0.5',
    rneg.reading.rate === 0.5 && rnegRead.reading.rate === 0.5,
    `返回 ${rneg.reading.rate} / 回读 ${rnegRead.reading.rate}`,
  );
  record('非法 rate 下应用仍然可响应', (await ctx.win.evaluate(() => 2 + 2).catch(() => null)) === 4);

  // reading.rate 传非数字：应回退为合法数值，而不是把字符串写进库
  await writeSettings({ reading: { rate: 1.25 } });
  const rabc = await writeSettings({ reading: { rate: 'abc' } });
  const rabcRead = await readSettings();
  record(
    'reading.rate 传字符串 "abc" 回退为上一个合法值',
    rabc.reading.rate === 1.25 && rabcRead.reading.rate === 1.25,
    `返回 ${JSON.stringify(rabc.reading.rate)} / 回读 ${JSON.stringify(rabcRead.reading.rate)}`,
  );
  record('reading.rate 为字符串时应用未崩溃', (await ctx.win.evaluate(() => 3 + 3).catch(() => null)) === 6);

  // rememberReading 传非布尔值：应归一化为布尔，避免把 0/null 写进库
  const badRemember = await writeSettings({ rememberReading: 0 });
  record(
    'rememberReading 传 0 被归一化为 false',
    badRemember.rememberReading === false,
    `返回 ${JSON.stringify(badRemember.rememberReading)}`,
  );
  const badRememberRead = await readSettings();
  record(
    'rememberReading 传 0 后读回为 false（归一化为布尔）',
    badRememberRead.rememberReading === false,
    `回读 ${JSON.stringify(badRememberRead.rememberReading)}`,
  );
  await writeSettings({ rememberReading: true });
  const nullRemember = await writeSettings({ rememberReading: null });
  record(
    'rememberReading 传 null 被归一化为 false（不再是 null）',
    nullRemember.rememberReading === false,
    `返回 ${JSON.stringify(nullRemember.rememberReading)}`,
  );
  await writeSettings({ rememberReading: true });

  // ---------- 3b. 越界值写入后：库里是合法值，界面显示与库一致 ----------
  const uiCheck = await checkOutOfRangeUi();
  record(
    '越界值写入后音频页语速显示为合法值（不再是 999×）',
    uiCheck.readerRateLabel !== '999×' && Number.parseFloat(uiCheck.readerRateLabel) <= 2,
    `音频页显示 ${JSON.stringify(uiCheck.readerRateLabel)}`,
  );
  record(
    '越界值写入后库中已是夹紧后的合法值，设置页显示与库一致',
    uiCheck.stored.rate <= 2 &&
      uiCheck.stored.rate >= 0.5 &&
      uiCheck.stored.pitch <= 1.6 &&
      uiCheck.stored.volume <= 100 &&
      uiCheck.rangeValues.every((r) => Math.abs(Number(r.value) - Number(r.max)) < 1e-6),
    `库中 rate=${uiCheck.stored.rate} pitch=${uiCheck.stored.pitch} volume=${uiCheck.stored.volume}；设置页 range 显示 ${JSON.stringify(
      uiCheck.rangeValues.map((r) => r.value),
    )}（min/max ${JSON.stringify(uiCheck.rangeValues.map((r) => r.min + '~' + r.max))}）`,
  );
  record(
    '越界值处理过程中渲染进程没有报错/崩溃',
    uiCheck.consoleErrors.length === 0,
    uiCheck.consoleErrors.length ? uiCheck.consoleErrors.join(' | ') : '无 error/warning',
  );

  // 恢复成合法值，后续用例使用
  const restored = await writeSettings({ reading: { rate: 1.5, pitch: 1.2 }, rememberReading: true });
  record(
    '恢复为合法设置（rate=1.5 / rememberReading=true）',
    restored.reading.rate === 1.5 && restored.rememberReading === true,
    JSON.stringify({ rate: restored.reading.rate, rememberReading: restored.rememberReading }),
  );

  // ---------- 4. 朗读进度持久化 ----------
  await createProject(NAME_A);
  const idA = await findProjectId(NAME_A);
  await createChapterWithText('第一章 深夜', TEXT);
  const structureA = await projectStructure(idA);
  if (!structureA.chapters.length) throw new Error('项目A 没有章节');
  const chapterA = structureA.chapters[0];
  const contentA = await chapterContent(chapterA.id);
  record('准备数据：项目A 章节正文已保存', contentA.content.length > 0, `${contentA.content.length} 字符`);

  await gotoAudio(NAME_A);
  await dragProgress(0.6);
  await ctx.win.screenshot({ path: path.join(SHOTS, 'settings-01-progress-60.png') });
  const psA1 = await readProjectSettings(idA);
  const entryA1 = psA1.readingProgress ? psA1.readingProgress[chapterA.id] : undefined;
  record(
    '拖动到约 60% 后写入 readingProgress（charIndex > 0）',
    Boolean(entryA1) && entryA1.charIndex > 0,
    entryA1 ? `charIndex ${entryA1.charIndex}/${entryA1.charTotal}` : '没有记录',
  );
  record(
    'readingProgress.percent 落在 0.5~0.7',
    Boolean(entryA1) && entryA1.percent >= 0.5 && entryA1.percent <= 0.7,
    entryA1 ? `percent ${entryA1.percent.toFixed(4)}` : '没有记录',
  );

  // ---------- 重启后进度仍在 ----------
  ctx = await relaunch(ctx, '写入朗读进度后');
  const psA2 = await readProjectSettings(idA);
  const entryA2 = psA2.readingProgress ? psA2.readingProgress[chapterA.id] : undefined;
  record(
    '重启后同一条朗读进度仍然存在',
    Boolean(entryA2) && entryA2.charIndex === entryA1.charIndex && entryA2.charTotal === entryA1.charTotal,
    entryA2 ? `charIndex ${entryA2.charIndex}/${entryA2.charTotal}，percent ${entryA2.percent.toFixed(4)}` : '记录丢失',
  );

  await gotoAudio(NAME_A);
  let resumeShown = 0;
  try {
    await ctx.win.waitForSelector('.reader-resume', { timeout: 12000 });
    resumeShown = await ctx.win.locator('.reader-resume').count();
  } catch {
    resumeShown = 0;
  }
  record('重启后进入音频页显示「上次读到」提示', resumeShown > 0, resumeShown > 0 ? await ctx.win.locator('.reader-resume').innerText().then((t) => t.replace(/\n/g, ' ')) : '未出现');
  await ctx.win.screenshot({ path: path.join(SHOTS, 'settings-02-resume-after-restart.png') });

  // ---------- 5. 关闭「记住朗读位置」后不再写入 ----------
  // 5a. 先确认「开启时确实会写入」：把进度拖到 75%，等 2 秒，记录应被更新
  await writeSettings({ rememberReading: true });
  await gotoAudio(NAME_A);
  await dragProgress(0.75);
  const psA2b = await readProjectSettings(idA);
  const entryA2b = psA2b.readingProgress ? psA2b.readingProgress[chapterA.id] : undefined;
  record(
    '开启「记住朗读位置」时拖动会更新进度（对照组）',
    Boolean(entryA2b) && entryA2b.charIndex !== entryA2.charIndex && entryA2b.percent >= 0.7 && entryA2b.percent <= 0.8,
    entryA2b ? `${entryA2.charIndex} → ${entryA2b.charIndex}，percent ${entryA2b.percent.toFixed(4)}` : '没有记录',
  );
  /** 关闭「记住朗读位置」之前的最后一条记录，后续用例都以它为基准。 */
  const entryLast = entryA2b || entryA2;

  // 5b. 关闭「记住朗读位置」：UI 上拖动生效，但不再落库
  await writeSettings({ rememberReading: false });
  await gotoAudio(NAME_A); // 重新进入音频页，让 ReaderView 读到 rememberReading=false
  const ariaBefore = await ctx.win.locator('.reader-progress').getAttribute('aria-valuenow');
  const ariaAfter = await dragProgress(0.3);
  const psA3 = await readProjectSettings(idA);
  const entryA3 = psA3.readingProgress ? psA3.readingProgress[chapterA.id] : undefined;
  record(
    '关闭「记住朗读位置」后拖动在界面上依然生效',
    ariaAfter >= 25 && ariaAfter <= 35 && ariaAfter !== Number(ariaBefore),
    `${ariaBefore}% → ${ariaAfter}%`,
  );
  record(
    '关闭「记住朗读位置」后不再写入新进度（charIndex 保持上一次的值）',
    !entryA3 || entryA3.charIndex === entryLast.charIndex,
    entryA3 ? `仍为 charIndex ${entryA3.charIndex}（期望保持 ${entryLast.charIndex}）` : '该章节没有记录（也符合预期）',
  );
  record(
    '关闭「记住朗读位置」后 percent 也未变化',
    !entryA3 || Math.abs(entryA3.percent - entryLast.percent) < 1e-9,
    entryA3 ? `percent ${entryA3.percent.toFixed(4)}（期望 ${entryLast.percent.toFixed(4)}）` : '该章节没有记录',
  );

  // 5c. 重新开启后，被冻结的进度仍未被动过
  await writeSettings({ rememberReading: true });
  await gotoAudio(NAME_A);
  const psA3b = await readProjectSettings(idA);
  const entryA3b = psA3b.readingProgress ? psA3b.readingProgress[chapterA.id] : undefined;
  record(
    '重新开启「记住朗读位置」后进度记录仍为关闭期间的值',
    Boolean(entryA3b) && entryA3b.charIndex === entryLast.charIndex && Math.abs(entryA3b.percent - entryLast.percent) < 1e-9,
    entryA3b ? `charIndex ${entryA3b.charIndex}，percent ${entryA3b.percent.toFixed(4)}` : '记录丢失',
  );

  // ---------- 6. 项目隔离 ----------
  await writeSettings({ rememberReading: true });
  await createProject(NAME_B);
  const idB = await findProjectId(NAME_B);
  await createChapterWithText('第一章 雨夜', TEXT);
  const structureB = await projectStructure(idB);
  if (!structureB.chapters.length) throw new Error('项目B 没有章节');
  const chapterB = structureB.chapters[0];

  await gotoAudio(NAME_B);
  await dragProgress(0.3);
  const psB = await readProjectSettings(idB);
  const entryB = psB.readingProgress ? psB.readingProgress[chapterB.id] : undefined;
  record(
    '项目B 有自己的朗读进度记录',
    Boolean(entryB) && entryB.charIndex > 0 && entryB.percent >= 0.25 && entryB.percent <= 0.35,
    entryB ? `charIndex ${entryB.charIndex}/${entryB.charTotal}，percent ${entryB.percent.toFixed(4)}` : '没有记录',
  );

  const psA4 = await readProjectSettings(idA);
  const entryA4 = psA4.readingProgress ? psA4.readingProgress[chapterA.id] : undefined;
  record(
    '项目A 的朗读进度没有被项目B 影响',
    Boolean(entryA4) && entryA4.charIndex === entryLast.charIndex && Math.abs(entryA4.percent - entryLast.percent) < 1e-9,
    entryA4 ? `charIndex ${entryA4.charIndex}（期望 ${entryLast.charIndex}）` : '项目A 记录丢失',
  );
  record(
    '项目B 的进度表里不含项目A 的章节',
    !(psB.readingProgress && psB.readingProgress[chapterA.id]),
    Object.keys(psB.readingProgress || {}).join(',') || '空',
  );
  record(
    '项目A 的进度表里不含项目B 的章节',
    !(psA4.readingProgress && psA4.readingProgress[chapterB.id]),
    Object.keys(psA4.readingProgress || {}).join(',') || '空',
  );
  await ctx.win.screenshot({ path: path.join(SHOTS, 'settings-03-project-b.png') });

  // 最后再确认一次重启后两个项目的隔离记录都还在
  ctx = await relaunch(ctx, '项目隔离写入后');
  const psA5 = await readProjectSettings(idA);
  const psB5 = await readProjectSettings(idB);
  record(
    '重启后两个项目的进度记录各自独立保存',
    Boolean(psA5.readingProgress[chapterA.id]) &&
      Boolean(psB5.readingProgress[chapterB.id]) &&
      psA5.readingProgress[chapterA.id].charIndex === entryLast.charIndex &&
      psB5.readingProgress[chapterB.id].charIndex === entryB.charIndex,
    `A:${psA5.readingProgress[chapterA.id] ? psA5.readingProgress[chapterA.id].charIndex : '无'} B:${psB5.readingProgress[chapterB.id] ? psB5.readingProgress[chapterB.id].charIndex : '无'}`,
  );
}

main()
  .catch((err) => {
    record('主流程执行完成（无异常中断）', false, err instanceof Error ? err.message : String(err));
    console.error('E2E 异常', err);
  })
  .then(async () => {
    await closeApp(ctx, '结束');
    const failed = results.filter((r) => !r.ok);
    console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
    if (failed.length) {
      console.log('失败清单：');
      for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''));
    }
    fs.writeFileSync(
      path.join(root, 'tests/e2e/last-settings-run.json'),
      JSON.stringify({ dataDir: DATA_DIR, userDataRoot: USER_DATA_ROOT, results }, null, 2),
    );
    process.exit(failed.length ? 1 : 0);
  });
