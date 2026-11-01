#!/usr/bin/env node
/**
 * 「未保存修改关闭保护」× 「托盘 / 直接退出」组合回归测试。
 *
 * 覆盖链路：
 *   渲染层 App.tsx 的 onRequestClose → confirmLeave()（编辑页守卫：先尝试自动保存，
 *   保存失败才弹「有未保存的修改」）→ setDirty(false) + closeConfirmed() / cancelClose()
 *   主进程 win.on('close') → closingConfirmed / quittingFromTray / dirty / shouldHideToTray()
 *   IPC app:closeConfirmed → requestClose() → hide+托盘 或 closingConfirmed + app.quit()
 *
 * 只读取源码行为，不修改任何源码。直接运行：node tests/e2e/close-guard-tray.mjs
 * 每个 Electron 实例都带独立的 --user-data-dir，避免单实例锁导致并发冲突。
 */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const BASE_DATA = path.join(os.tmpdir(), `dashi-e2e-close-tray-${Date.now()}`);
fs.mkdirSync(BASE_DATA, { recursive: true });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 每次启动都用全新的 --user-data-dir：单实例锁按 userData 生效，避免与其他脚本互相踢掉。 */
let udSeq = 0;
function freshUserData() {
  const dir = path.join(
    os.tmpdir(),
    `dashi-ud-${Date.now()}-${udSeq++}-${Math.random().toString(16).slice(2, 8)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const launched = [];

/** 启动应用；同时关闭编辑器自动保存，让「未保存」状态真实存在。 */
async function launch(dataDir, label) {
  fs.mkdirSync(dataDir, { recursive: true });
  const userData = freshUserData();
  const env = { ...process.env, DASHI_DATA_DIR: dataDir, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [root, `--user-data-dir=${userData}`],
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.evaluate(() => {
    localStorage.setItem(
      'dashi.editor.settings',
      JSON.stringify({ fontSize: 18, lineHeight: 1.9, fontFamily: 'serif', autoSave: false, showWordCount: true }),
    );
  });
  await win.reload();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(900);
  const handle = { app, win, dataDir, userData, label, exited: false };
  app.process().on('exit', () => {
    handle.exited = true;
  });
  launched.push(handle);
  console.log(`[启动] ${label}  data=${dataDir}  userData=${path.basename(userData)}`);
  return handle;
}

/** 真实点击标题栏关闭按钮的效果：调用 BrowserWindow.close()，走 win.on('close')。 */
async function closeWindow(handle) {
  await handle.app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) w.close();
  });
}

async function waitExit(handle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.exited) return true;
    await sleep(100);
  }
  return handle.exited;
}

async function closeAndWaitExit(handle, timeoutMs) {
  await closeWindow(handle);
  return waitExit(handle, timeoutMs);
}

/** 兜底停止：先尝试正常关闭，再直接结束进程，确保不残留实例抢占单实例锁 / API 端口。 */
async function forceStop(handle) {
  if (handle.exited) return true;
  try {
    await handle.app.close();
  } catch {
    /* 已退出或窗口已隐藏 */
  }
  if (await waitExit(handle, 2000)) return true;
  try {
    handle.app.process().kill();
  } catch {
    /* 忽略 */
  }
  return waitExit(handle, 4000);
}

async function isVisible(handle) {
  try {
    return await handle.app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return w && !w.isDestroyed() ? w.isVisible() : 'destroyed';
    });
  } catch {
    return 'gone';
  }
}

async function windowState(handle) {
  try {
    const res = await handle.win.evaluate(async () => await window.dashi.app.windowState());
    return res?.ok ? res.data : null;
  } catch {
    return null;
  }
}

async function modalTitles(handle) {
  try {
    return await handle.win.locator('.modal-title').allInnerTexts();
  } catch {
    return [];
  }
}

/** 页面已随进程退出时，所有渲染层查询都返回兜底值，避免用例中断。 */
async function safeCount(locator) {
  try {
    return await locator.count();
  } catch {
    return -1;
  }
}

const leaveModal = (handle) => handle.win.locator('.modal:has(.modal-title:text-is("有未保存的修改"))');
const conflictModal = (handle) => handle.win.locator('.modal:has(.modal-title:text-is("保存冲突"))');

/** 记录 win.on('close') 的实际触发次数（渲染层侧只读观测，不改源码）。 */
async function watchCloseEvents(handle) {
  await handle.win.evaluate(() => {
    window.__closeEvents = 0;
    window.dashi.app.onWindowShown(() => {
      window.__closeEvents += 1;
    });
  });
}

/** 统计主进程 app:requestClose 的下发次数（渲染层侧计数，不改源码）。 */
async function watchCloseRequests(handle) {
  await handle.win.evaluate(() => {
    window.__closeRequests = 0;
    window.dashi.app.onRequestClose(() => {
      window.__closeRequests += 1;
    });
  });
}

async function closeRequestCount(handle) {
  try {
    return await handle.win.evaluate(() => window.__closeRequests || 0);
  } catch {
    return -1;
  }
}

/** 打开（或创建）项目与章节，必要时输入正文。 */
async function ensureEditor(handle, projectName, chapterName, text) {
  const { win } = handle;
  if ((await win.locator('.project-row').count()) > 0) {
    await win.click('.project-row');
    await win.waitForTimeout(900);
  } else {
    await win.click('.sidebar .btn-primary');
    await win.waitForSelector('.modal input.input', { timeout: 8000 });
    await win.fill('.modal input.input', projectName);
    await win.click('.modal-foot .btn-primary');
    await win.waitForTimeout(900);
  }
  if ((await win.locator('.chapter-row').count()) > 0) {
    await win.click('.chapter-row');
    await win.waitForTimeout(900);
  } else {
    await win.click('button:has-text("新建章节")');
    await win.waitForSelector('.modal input.input', { timeout: 8000 });
    await win.fill('.modal input.input', chapterName);
    await win.click('.modal-foot .btn-primary');
    await win.waitForTimeout(900);
  }
  if ((await win.locator('.cm-content').count()) === 0) throw new Error('未进入编辑页');
  if (text) {
    await win.click('.cm-content');
    await win.keyboard.type(text, { delay: 2 });
    await win.waitForTimeout(500);
  }
}

/** 模拟「其他窗口 / Agent」抢先保存，制造乐观锁冲突，让编辑页的保存必然失败（从而必须询问）。 */
async function injectExternalEdit(handle) {
  return handle.win.evaluate(async () => {
    const projects = await window.dashi.projects.list();
    const projectId = projects.data[0].id;
    const structure = await window.dashi.projects.structure(projectId);
    const chapter = structure.data.chapters[0];
    const current = await window.dashi.chapters.content(chapter.id);
    const res = await window.dashi.chapters.saveContent(chapter.id, {
      content: current.data.content + '（外部写入，制造保存冲突）',
      baseRevision: current.data.revision,
      source: 'agent',
    });
    return { ok: res.ok, revision: current.data.revision, chapterId: chapter.id };
  });
}

async function readBackendContent(handle) {
  try {
    return await handle.win.evaluate(async () => {
      const projects = await window.dashi.projects.list();
      const projectId = projects.data[0].id;
      const structure = await window.dashi.projects.structure(projectId);
      const chapter = structure.data.chapters[0];
      const current = await window.dashi.chapters.content(chapter.id);
      return current.data.content;
    });
  } catch (err) {
    return `读取失败：${err?.message ?? err}`;
  }
}

async function main() {
  // ---------- 实例 A：tray 模式下的用例 1、2、5 与附加用例 ----------
  const A = await launch(path.join(BASE_DATA, 'tray'), 'A/tray');

  // 用例 1：closeAction='tray' + 有未保存修改
  await ensureEditor(A, '关闭保护测试', '第一章', '未保存内容甲。');
  const dirtyLabel = await A.win.locator('.save-state').first().innerText();
  const injected = await injectExternalEdit(A);
  await sleep(400);
  await watchCloseRequests(A);
  await closeWindow(A);
  await sleep(1300);

  const visible1 = await isVisible(A);
  const leaveCount1 = await safeCount(leaveModal(A));
  const reqCount1 = await closeRequestCount(A);
  const titles1 = await modalTitles(A);
  record(
    '用例1-1：tray 模式 + 有未保存修改，关闭窗口时窗口没有立刻消失（isVisible 仍为 true）',
    visible1 === true,
    `isVisible=${JSON.stringify(visible1)}；关闭前保存状态=${dirtyLabel}；注入冲突=${JSON.stringify(injected)}`,
  );
  record(
    '用例1-2：渲染层收到询问（出现「有未保存的修改」弹窗，且 app:requestClose 已下发）',
    leaveCount1 > 0 && reqCount1 >= 1,
    `弹窗数=${leaveCount1}，app:requestClose 次数=${reqCount1}，弹窗标题=${JSON.stringify(titles1)}`,
  );
  if (leaveCount1 > 0) {
    await A.win.screenshot({ path: path.join(root, 'tests/e2e/shots/20-close-tray-prompt.png') }).catch(() => undefined);
    await leaveModal(A).locator('button:has-text("取消")').click();
    await sleep(1000);
  }
  const visible1c = await isVisible(A);
  const state1c = await windowState(A);
  record(
    '用例1-3：取消关闭后窗口仍可见、进程仍在',
    visible1c === true && !A.exited && state1c?.visible === true,
    `isVisible=${JSON.stringify(visible1c)}，进程仍在=${!A.exited}，windowState=${JSON.stringify(state1c)}`,
  );

  // 用例 2：closeAction='tray' + 已保存（先解决上面的冲突，回到干净状态）
  if ((await safeCount(conflictModal(A))) > 0) {
    await conflictModal(A).locator('button:has-text("以本地内容覆盖")').click();
    await sleep(1200);
  }
  const savedLabel = await A.win.locator('.save-state').first().innerText();
  await closeWindow(A);
  await sleep(1300);
  const visible2 = await isVisible(A);
  const state2 = await windowState(A);
  record(
    '用例2：tray 模式 + 已保存，关闭窗口后隐藏（isVisible=false）、进程仍在、托盘已创建',
    visible2 === false && !A.exited && state2?.trayActive === true,
    `关闭前保存状态=${savedLabel}；isVisible=${JSON.stringify(visible2)}；进程仍在=${!A.exited}；windowState=${JSON.stringify(state2)}`,
  );

  // 用例 5：托盘恢复
  await A.win.evaluate(async () => await window.dashi.app.showWindow());
  await sleep(1000);
  const visible5 = await isVisible(A);
  const sidebar5 = await A.win.locator('.sidebar').count();
  const state5 = await windowState(A);
  record(
    '用例5：托盘恢复后窗口可见，渲染层仍正常（.sidebar 仍在、windowState.visible=true）',
    visible5 === true && sidebar5 > 0 && state5?.visible === true,
    `isVisible=${JSON.stringify(visible5)}，.sidebar 数量=${sidebar5}，windowState=${JSON.stringify(state5)}`,
  );

  // 附加用例：未保存修改时关闭不会丢内容（当前实现是守卫先自动保存，成功就直接隐藏到托盘）
  await A.win.click('.cm-content');
  await A.win.keyboard.type('乙未保存内容。', { delay: 2 });
  await sleep(500);
  const addLabel = await A.win.locator('.save-state').first().innerText();
  await closeWindow(A);
  await sleep(1600);
  const visibleAdd = await isVisible(A);
  const leaveAdd = await safeCount(leaveModal(A));
  const backend = await readBackendContent(A);
  record(
    '附加用例：tray 模式 + 有未保存修改，关闭时内容不丢失（自动保存成功则隐藏，保存失败则询问）',
    !A.exited && (backend.includes('乙未保存内容') || leaveAdd > 0),
    `关闭前保存状态=${addLabel}；isVisible=${JSON.stringify(visibleAdd)}；询问弹窗=${leaveAdd}；后端正文=${JSON.stringify(backend.slice(0, 40))}`,
  );
  await forceStop(A);

  // ---------- 实例 B：用例 3（quit + 已保存） ----------
  const B = await launch(path.join(BASE_DATA, 'quit-saved'), 'B/quit-saved');
  await B.win.evaluate(async () => {
    await window.dashi.app.updateSettings({ closeAction: 'quit' });
  });
  await sleep(400);
  const setting3 = await B.win.evaluate(async () => (await window.dashi.app.settings()).data.closeAction);
  const visible3 = await isVisible(B);
  const exited3 = await closeAndWaitExit(B, 8000);
  record(
    '用例3：quit 模式 + 已保存，关闭窗口后进程退出（8 秒内）',
    exited3 === true,
    `closeAction=${setting3}；关闭前可见=${JSON.stringify(visible3)}；进程退出=${exited3}`,
  );
  if (!exited3) await forceStop(B);

  // ---------- 实例 C：用例 4（quit + 有未保存修改） ----------
  const C = await launch(path.join(BASE_DATA, 'quit-dirty'), 'C/quit-dirty');
  await C.win.evaluate(async () => {
    await window.dashi.app.updateSettings({ closeAction: 'quit' });
  });
  await sleep(400);
  const setting4 = await C.win.evaluate(async () => (await window.dashi.app.settings()).data.closeAction);
  record('用例4-0：关闭行为已切换为 quit（前置条件）', setting4 === 'quit', `closeAction=${setting4}`);
  await ensureEditor(C, '退出保护测试', '第一章', '未保存内容丙。');
  await injectExternalEdit(C);
  await sleep(400);
  await closeWindow(C);
  await sleep(1300);
  const visible4a = await isVisible(C);
  const leaveCount4 = await safeCount(leaveModal(C));
  record(
    '用例4-1：quit 模式 + 有未保存修改，关闭时先询问（窗口保持可见、出现询问弹窗）',
    visible4a === true && leaveCount4 > 0,
    `isVisible=${JSON.stringify(visible4a)}；询问弹窗=${leaveCount4}；弹窗标题=${JSON.stringify(await modalTitles(C))}`,
  );
  if (leaveCount4 > 0) {
    await leaveModal(C).locator('button:has-text("取消")').click();
    await sleep(1000);
  }
  const visible4b = await isVisible(C);
  record(
    '用例4-2：取消关闭后进程仍在、窗口可见',
    visible4b === true && !C.exited,
    `isVisible=${JSON.stringify(visible4b)}；进程仍在=${!C.exited}`,
  );

  // 再次关闭：应再次询问（主进程「只问一次」的标志已在取消时复位）
  await closeWindow(C);
  await sleep(1300);
  const visible4c = await isVisible(C);
  const leaveCount4c = await safeCount(leaveModal(C));
  record(
    '用例4-3：取消后再关闭，仍会再次询问（窗口保持可见，询问弹窗再次出现）',
    visible4c === true && leaveCount4c > 0,
    `isVisible=${JSON.stringify(visible4c)}；询问弹窗=${leaveCount4c}；弹窗标题=${JSON.stringify(await modalTitles(C))}`,
  );

  // 在询问弹窗上点「保存并继续」：此时保存必然撞上冲突，期望「不退出、给出冲突提示」
  const leaveStillOpen = await safeCount(leaveModal(C));
  if (leaveStillOpen > 0) {
    await leaveModal(C).locator('button:has-text("保存并继续")').click();
  }
  await sleep(1400);
  const visible4d = await isVisible(C);
  const conflictAfterSave = await safeCount(conflictModal(C));
  const exitedAfterSave = C.exited;
  record(
    '用例4-4：询问弹窗上「保存并继续」而保存失败时，应用不退出并给出「保存冲突」提示',
    exitedAfterSave === false && visible4d === true && conflictAfterSave > 0,
    `点击「保存并继续」=${leaveStillOpen > 0}；isVisible=${JSON.stringify(visible4d)}；保存冲突弹窗=${conflictAfterSave}；进程已退出=${exitedAfterSave}；弹窗标题=${JSON.stringify(await modalTitles(C))}`,
  );

  // 解决冲突（以本地内容覆盖）→ 回到已保存，再关闭 → 进程退出
  let savedOk = false;
  if (conflictAfterSave > 0) {
    await conflictModal(C).locator('button:has-text("以本地内容覆盖")').click();
    await sleep(1400);
    savedOk = /已保存/.test(await C.win.locator('.save-state').first().innerText());
  }
  const visible4e = await isVisible(C);
  await closeWindow(C);
  const exited4 = await waitExit(C, 8000);
  record(
    '用例4-5：保存成功后再关闭，进程退出（8 秒内）',
    exited4 === true,
    `冲突已解决=${savedOk}；关闭前可见=${JSON.stringify(visible4e)}；进程退出=${exited4}`,
  );


  // ---------- 实例 D：用例 4 的持久化校验 ----------
  let persisted = '';
  try {
    const D = await launch(path.join(BASE_DATA, 'quit-dirty'), 'D/relaunch');
    await ensureEditor(D, '退出保护测试', '第一章', null);
    persisted = await D.win.locator('.cm-content').innerText();
    await forceStop(D);
  } catch (err) {
    persisted = `重启失败：${err?.message ?? err}`;
  }
  record(
    '用例4-6：确认保存后退出，重新启动正文未丢失（本地内容已落盘）',
    persisted.includes('未保存内容丙') && !persisted.includes('外部写入'),
    `正文=${JSON.stringify(persisted.slice(0, 60))}`,
  );

  // ---------- 收尾 ----------
  for (const handle of launched) await forceStop(handle);
  await sleep(400);

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(
    path.join(root, 'tests/e2e/last-close-tray-run.json'),
    JSON.stringify({ dataDir: BASE_DATA, results }, null, 2),
  );
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('失败清单：');
    failed.forEach((item, index) => console.log(`  ${index + 1}. ${item.name} — ${item.detail}`));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('E2E 异常', err);
  for (const handle of launched) await forceStop(handle);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('失败清单：');
    failed.forEach((item, index) => console.log(`  ${index + 1}. ${item.name} — ${item.detail}`));
  }
  process.exit(1);
});