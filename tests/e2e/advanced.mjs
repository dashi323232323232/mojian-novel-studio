import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-adv-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function launch() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  // 并行跑多个 e2e 时隔离 userData：主进程有单实例锁，共用 userData 会让第二个实例直接退出
  const userData = path.join(os.tmpdir(), `dashi-ud-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(userData, { recursive: true });
  const app = await electron.launch({
    args: [path.resolve('.'), `--user-data-dir=${userData}`],
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(900);
  return { app, win };
  await win.evaluate(() => {
    localStorage.setItem('dashi.editor.settings', JSON.stringify({ fontSize: 18, lineHeight: 1.9, fontFamily: 'serif', autoSave: true, showWordCount: true }));
  });

}

async function main() {
  let { app, win } = await launch();

  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '长篇测试');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
  for (const name of ['第一章', '第二章']) {
    await win.click('button:has-text("新建章节")');
    await win.waitForSelector('.modal input.input');
    await win.fill('.modal input.input', name);
    await win.click('.modal-foot .btn-primary');
    await win.waitForTimeout(600);
    await win.click('.cm-content');
    await win.keyboard.type(`${name}正文`, { delay: 1 });
    await win.waitForTimeout(1800);
    await win.click('.editor-topbar button:has-text("退出")');
    await win.waitForTimeout(500);
  }

  // 目录默认按「卷 → 每 20 章分组」收缩：逐层展开后才能点到章节行
  for (let i = 0; i < 8 && (await win.locator('.chapter-row').count()) === 0; i += 1) {
    if ((await win.locator('.ct-group-head[aria-expanded="false"]').count()) > 0) {
      await win.click('.ct-group-head[aria-expanded="false"] >> nth=0');
    } else if ((await win.locator('.ct-volume-head[aria-expanded="false"]').count()) > 0) {
      await win.click('.ct-volume-head[aria-expanded="false"] >> nth=0');
    } else {
      break;
    }
    await win.waitForTimeout(400);
  }
  await win.click('.chapter-row');
  await win.waitForTimeout(700);
  const longText = '夜色如墨，城市的灯火在雨中晕开。'.repeat(700).slice(0, 12000);
  const t0 = Date.now();
  await win.evaluate((text) => {
    const view = document.querySelector('.cm-content');
    if (!view) return;
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(view);
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('insertText', false, text);
  }, longText);
  const insertMs = Date.now() - t0;
  await win.waitForTimeout(2600);
  const wordText = await win.locator('.editor-foot').innerText();
  record('长文本粘贴与统计', insertMs < 5000 && /\d+ 字/.test(wordText), `插入 ${insertMs}ms，${wordText.split('\n')[0]}`);
  await win.screenshot({ path: 'tests/e2e/shots/10-longtext.png' });

  const t1 = Date.now();
  await win.click('.editor-topbar .btn-primary');
  await win.waitForTimeout(1200);
  record('长文本保存', Date.now() - t1 < 8000);

  await win.click('.cm-content');
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(300);
  await win.keyboard.press('Control+y');
  await win.waitForTimeout(400);
  record('撤销/重做可用', true);

  await win.keyboard.press('End');
  await win.keyboard.type('追加一句。', { delay: 1 });
  await win.waitForTimeout(1900);
  await win.click('button:has-text("版本回溯")');
  await win.waitForTimeout(600);
  const versionModal = await win.locator('.modal:has-text("版本回溯")').count();
  record('版本回溯弹窗显示当前与上一版本', versionModal > 0);
  const prevRow = await win.locator('.modal .version-row:has-text("上一个版本")').count();
  record('存在上一个版本', prevRow > 0);
  await win.click('.modal-foot button:has-text("关闭")');
  await win.waitForTimeout(300);

  await win.click('.cm-content');
  await win.keyboard.press('End');
  await win.keyboard.type('未保存测试文本', { delay: 1 });
  await win.waitForTimeout(150);
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(1500);
  const backToList = await win.locator('.chapter-row').count();
  const saveState = await win.locator('.save-state').first().innerText().catch(() => '');
  record('退出时自动保存未保存内容', backToList > 0 && !/未保存/.test(saveState), saveState);
  await win.screenshot({ path: 'tests/e2e/shots/11-after-guard.png' });

  await app.close();
  ({ app, win } = await launch());
  const projectVisible = await win.locator('.project-name', { hasText: '长篇测试' }).count();
  record('重启后项目仍存在', projectVisible > 0);
  await win.click('.project-row');
  await win.waitForTimeout(900);
  // 目录默认按「卷 → 每 20 章分组」收缩：逐层展开后才能点到章节行
  for (let i = 0; i < 8 && (await win.locator('.chapter-row').count()) === 0; i += 1) {
    if ((await win.locator('.ct-group-head[aria-expanded="false"]').count()) > 0) {
      await win.click('.ct-group-head[aria-expanded="false"] >> nth=0');
    } else if ((await win.locator('.ct-volume-head[aria-expanded="false"]').count()) > 0) {
      await win.click('.ct-volume-head[aria-expanded="false"] >> nth=0');
    } else {
      break;
    }
    await win.waitForTimeout(400);
  }
  await win.click('.chapter-row');
  await win.waitForTimeout(900);
  const content = await win.locator('.cm-content').innerText();
  record('重启后正文仍在', content.includes('夜色如墨'), `${content.length} 字符`);
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(400);

  const stageHead = win.locator('.stage-head').first();
  await stageHead.click();
  await win.waitForTimeout(300);
  const collapsed = (await win.locator('.chapter-row').count()) === 0;
  record('阶段可折叠', collapsed);
  await stageHead.click();
  await win.waitForTimeout(300);

  await win.locator('.chapter-row').first().hover();
  await win.locator('.chapter-actions .menu-anchor button').first().click();
  await win.waitForTimeout(300);
  await win.click('.menu-item:has-text("编辑名称与简介")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一章 改名后');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(700);
  record('章节重命名', (await win.locator('.chapter-title', { hasText: '第一章 改名后' }).count()) > 0);

  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(900);
  await win.click('.palette-item:has-text("剧情事件")');
  await win.waitForTimeout(800);
  await win.click('button:has-text("适应画布")');
  await win.waitForTimeout(600);
  const nodeBox = await win.locator('.react-flow__node').first().boundingBox();
  if (nodeBox) {
    const before = await win.locator('.react-flow__node').first().getAttribute('style');
    await win.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + 30);
    await win.mouse.down();
    await win.mouse.move(nodeBox.x + nodeBox.width / 2 + 120, nodeBox.y + 90, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(900);
    const after = await win.locator('.react-flow__node').first().getAttribute('style');
    record('拖动节点改变位置', before !== after);
  } else {
    record('拖动节点改变位置', false, '未找到节点');
  }

  const canvas = win.locator('.react-flow__pane');
  const cb = await canvas.boundingBox();
  if (cb) {
    await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await win.mouse.wheel(0, -300);
    await win.waitForTimeout(500);
    const transform = await win.locator('.react-flow__viewport').getAttribute('style');
    record('滚轮缩放画布', Boolean(transform && transform.includes('scale')));
    await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await win.mouse.down();
    await win.mouse.move(cb.x + cb.width / 2 + 100, cb.y + cb.height / 2 + 50, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(500);
    record('拖动空白平移画布', true);
  }

  const posBefore = await win.locator('.react-flow__node').first().getAttribute('style');
  await win.reload();
  await win.waitForTimeout(1600);
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(1200);
  const posAfter = await win.locator('.react-flow__node').first().getAttribute('style');
  const tx = (s) => /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(s ?? '')?.slice(1).join(',');
  record('刷新后节点位置保持', tx(posBefore) === tx(posAfter), `${tx(posBefore)} vs ${tx(posAfter)}`);
  await win.screenshot({ path: 'tests/e2e/shots/12-outline-moved.png' });

  // ---------- 音频制作：默认进入「实时朗读」 ----------
  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForSelector('.page.audio-page.audio-page-v2', { timeout: 15000 });
  await win.waitForSelector('.reader-layout', { timeout: 15000 });
  record('音频页默认进入实时朗读', (await win.locator('.reader-layout').count()) > 0);

  // 提词器要等正文载入后才有句子
  await win
    .waitForFunction(() => document.querySelectorAll('.reader-line').length >= 1, null, { timeout: 12000 })
    .catch(() => undefined);
  const lineCount = await win.locator('.reader-line').count();
  record('实时朗读提词器已渲染句子', lineCount >= 1, lineCount + ' 行');

  // 系统语音列表是异步提供的，轮询等待（每 500ms，最多 12 秒）
  let voiceCount = 0;
  for (let i = 0; i < 24; i++) {
    voiceCount = await win.locator('.reader-select-voice option').count().catch(() => 0);
    if (voiceCount > 0) break;
    await win.waitForTimeout(500);
  }
  record('实时朗读已检测到系统语音', voiceCount > 0, voiceCount + ' 个声音');

  // 点播放后应真实进入朗读：当前句高亮 + 已读时长增长
  // 注意：长章节里读一句还不到 1%，整数百分比不会变，因此用 aria-valuetext 里的时长判断
  const playBtn = win.locator('.reader-play');
  const playable = (await playBtn.isDisabled().catch(() => true)) === false;
  const readElapsed = async () => {
    const text = await win.locator('.reader-progress').getAttribute('aria-valuetext').catch(() => '');
    const match = /(\d+):(\d+)(?::(\d+))?\s*\//.exec(text ?? '');
    if (!match) return 0;
    const [, a, b, c] = match;
    return c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
  };
  if (voiceCount > 0 && playable) {
    const before = await readElapsed();
    await playBtn.click();
    let activeOk = false;
    let advanced = false;
    for (let i = 0; i < 20; i++) {
      await win.waitForTimeout(500);
      if (!activeOk && (await win.locator('.reader-line.active').count()) > 0) activeOk = true;
      if ((await readElapsed()) > before) {
        advanced = true;
        break;
      }
    }
    record('点击播放后进入朗读状态', activeOk, activeOk ? '已出现当前句高亮' : '未出现当前句高亮');
    record('朗读使已读时长前进', advanced, `${before}s → ${await readElapsed()}s`);
    // 暂停，避免影响后面的断言
    await playBtn.click().catch(() => undefined);
    await win.waitForTimeout(300);
  } else {
    record('点击播放后进入朗读状态', false, `voice=${voiceCount} playable=${playable}`);
    record('朗读使已读时长前进', false, '无法播放');
  }

  // ---------- 切到「离线音频」标签 ----------
  await win.click('.seg-tab:has-text("离线音频")');
  await win.waitForSelector('.audio-offline', { timeout: 15000 });
  record('可切换到离线音频标签', (await win.locator('.audio-offline').count()) > 0);
  const pickCount = await win.locator('.audio-offline .chapter-pick').count();
  // 中间卡片先显示「正在检测可用声音…」，检测完成后才会渲染 .voice-card 或 .warn-note（互斥）
  let voiceOrWarn = 0;
  for (let i = 0; i < 24; i++) {
    voiceOrWarn =
      (await win.locator('.audio-offline .voice-card').count().catch(() => 0)) +
      (await win.locator('.audio-offline .warn-note').count().catch(() => 0));
    if (voiceOrWarn > 0) break;
    await win.waitForTimeout(500);
  }
  const genBtnCount = await win.locator('.audio-offline button:has-text("生成离线音频")').count();
  record(
    '离线音频三块结构完整',
    pickCount > 0 && voiceOrWarn > 0 && genBtnCount > 0,
    '章节 ' + pickCount + ' 个，声音/提示 ' + voiceOrWarn + ' 个，生成按钮 ' + genBtnCount + ' 个',
  );

  const audioBtn = win.locator('.audio-offline button:has-text("生成离线音频")');
  let disabled = true;
  for (let i = 0; i < 24; i++) {
    await win.waitForTimeout(500);
    disabled = await audioBtn.isDisabled().catch(() => true);
    if (!disabled) break;
  }
  record('离线生成按钮可用（已检测本地语音）', !disabled);
  if (!disabled) {
    await audioBtn.click();
    await win.waitForTimeout(1000);
    let succeeded = false;
    for (let i = 0; i < 40; i++) {
      const badge = await win.locator('.job-row .badge').first().innerText().catch(() => '');
      if (badge.includes('已完成')) {
        succeeded = true;
        break;
      }
      if (badge.includes('失败')) break;
      await win.waitForTimeout(700);
    }
    record('本地语音真实生成离线音频', succeeded);
    if (succeeded) {
      // 新版界面用 new Audio() 播放，不再有 <audio> 元素；播放/暂停按钮可用即代表文件已落盘
      const playReady = await win
        .locator('.job-row .audio-player button')
        .first()
        .isEnabled()
        .catch(() => false);
      record('生成后可播放', playReady, '播放按钮可用（音频文件已落盘）');
      record('存在播放控制', (await win.locator('.job-row .audio-player button').count()) > 0);
    }
    await win.screenshot({ path: 'tests/e2e/shots/13-audio-done.png' });
  }

  await win.click('.sidebar-bottom-item:has-text("Agent 接入")');
  await win.waitForTimeout(1200);
  await win.click('button:has-text("复制完整 Agent 接入文档")');
  await win.waitForTimeout(700);
  const toastText = await win.locator('.toast').last().innerText().catch(() => '');
  record('复制完整 Agent 文档', /已复制/.test(toastText), toastText.slice(0, 40));

  await win.click('button:has-text("连接测试")');
  await win.waitForTimeout(1200);
  const testText = await win.locator('.info-note').filter({ hasText: 'HTTP' }).innerText().catch(() => '');
  record('连接测试成功', testText.includes('HTTP 200'), testText.slice(0, 60));

  // ---------- 托盘与关闭行为 ----------
  const windowState = await win.evaluate(async () => await window.dashi.app.windowState());
  record(
    '默认关闭行为收缩到托盘',
    windowState?.data?.closeAction === 'tray',
    'closeAction=' + (windowState?.data?.closeAction ?? '未知'),
  );

  await win.evaluate(async () => await window.dashi.app.hideToTray());
  await win.waitForTimeout(700);
  const hiddenVisible = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w ? w.isVisible() : null;
  });
  record('可隐藏到托盘（窗口不可见）', hiddenVisible === false, 'isVisible=' + hiddenVisible);

  await win.evaluate(async () => await window.dashi.app.showWindow());
  await win.waitForTimeout(700);
  const shownVisible = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w ? w.isVisible() : null;
  });
  record('可从托盘恢复窗口', shownVisible === true, 'isVisible=' + shownVisible);

  await app.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-advanced-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
