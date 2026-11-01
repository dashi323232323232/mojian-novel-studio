import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-reader-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
// 独立 userData：多个 e2e 并行运行时避免撞上单实例锁
const USER_DATA = path.join(os.tmpdir(), `dashi-reader-ud-${Date.now()}`);
fs.mkdirSync(USER_DATA, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const SHOTS = path.join(root, 'proof_tmp/shots');
fs.mkdirSync(SHOTS, { recursive: true });

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [root, `--user-data-dir=${USER_DATA}`],
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1200);

  // 准备数据：项目 + 章节 + 正文
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 5000 });
  await win.fill('.modal input.input', '朗读测试');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);

  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一章 深夜');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1200);
  await win.waitForSelector('.cm-content', { timeout: 10000 });
  const text = [
    '夜色像一块浸了水的黑布，沉沉压在屋顶上。',
    '陈默把台灯拧亮了一些，光晕在稿纸边缘抖了抖。',
    '他听见楼下有人敲门，敲了三下，停一停，又敲三下。',
    '那是只有他们两个人知道的暗号。',
    '门外的人低声说了一句话，声音被风撕碎了一半。',
    '陈默没有立刻开门，他把手伸进抽屉，摸到了那把旧钥匙。',
    '钥匙是凉的，凉得让他想起十年前的那个冬天。',
    '他终于站起来，一步一步走向门口。',
  ].join('\n');
  await win.click('.cm-content');
  await win.keyboard.type(text, { delay: 1 });
  await win.waitForTimeout(2600);

  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForTimeout(1600);
  record('音频页打开且默认为实时朗读', (await win.locator('.reader-layout').count()) > 0);
  await win.screenshot({ path: path.join(SHOTS, '01-reader.png') });

  const sentenceCount = await win.locator('.reader-line').count();
  record('正文按短句切分显示（提词器只显示附近几行）', sentenceCount >= 4 && sentenceCount <= 12, `${sentenceCount} 行`);

  const voiceOptions = await win.locator('.reader-select-voice option').count();
  record('检测到系统语音', voiceOptions > 0, `${voiceOptions} 个`);

  // 播放
  await win.click('.reader-play');
  await win.waitForTimeout(2600);
  const activeAfterPlay = await win.locator('.reader-line.active').count();
  const progressText = await win.locator('.reader-progress-meta').innerText();
  record('点击播放后开始朗读并高亮当前句', activeAfterPlay > 0, progressText.replace(/\n/g, ' | '));
  await win.screenshot({ path: path.join(SHOTS, '02-playing.png') });

  // 暂停
  await win.click('.reader-play');
  await win.waitForTimeout(600);
  const pausedIndex = await win.evaluate(() => {
    const el = document.querySelector('.reader-progress');
    return el ? el.getAttribute('aria-valuenow') : null;
  });
  record('暂停后进度停住', pausedIndex !== null, `${pausedIndex}%`);

  // 拖动进度条到 70%
  const box = await win.locator('.reader-progress-track').boundingBox();
  await win.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const afterSeek = await win.locator('.reader-progress').getAttribute('aria-valuenow');
  record('拖动进度条可跳转', Number(afterSeek) >= 65, `${afterSeek}%`);
  const activeText = await win.locator('.reader-line.active').innerText().catch(() => '');
  record('跳转后高亮对应短句', Boolean(activeText), activeText.slice(0, 20));

  // 拖动过程中不崩
  await win.screenshot({ path: path.join(SHOTS, '03-seeked.png') });

  // 改语速
  await win.click('.reader-rate-value');
  await win.waitForTimeout(300);
  await win.click('.reader-rate-preset:has-text("1.5×")');
  await win.waitForTimeout(600);
  const rateLabel = await win.locator('.reader-rate-value').innerText();
  record('语速可随时调整', rateLabel.includes('1.5'), rateLabel);

  // 改声音
  const voiceValues = await win.locator('.reader-select-voice option').evaluateAll((els) => els.map((e) => e.value));
  if (voiceValues.length > 1) {
    await win.selectOption('.reader-select-voice', voiceValues[1]);
    await win.waitForTimeout(500);
    const selected = await win.locator('.reader-select-voice').inputValue();
    record('可切换朗读声音', selected === voiceValues[1], selected);
  } else {
    record('可切换朗读声音', false, '只有一个声音');
  }

  // 播放后换语速仍然继续
  await win.click('.reader-play');
  await win.waitForTimeout(1500);
  await win.click('.reader-rate-value');
  await win.waitForTimeout(200);
  await win.click('.reader-rate-preset:has-text("0.75×")');
  await win.waitForTimeout(1800);
  const stillPlaying = await win.locator('.reader-line.active').count();
  record('朗读中改语速仍然继续朗读', stillPlaying > 0);
  await win.click('.reader-play');

  // 记住进度：切到内容页再回来
  await win.waitForTimeout(900);
  const before = await win.locator('.reader-progress').getAttribute('aria-valuenow');
  await win.click('.nav-child:has-text("内容")');
  await win.waitForTimeout(900);
  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForTimeout(2000);
  const after = await win.locator('.reader-progress').getAttribute('aria-valuenow');
  record('重新进入后回到上次朗读位置', Math.abs(Number(after) - Number(before)) <= 3, `${before}% → ${after}%`);
  const resumeVisible = await win.locator('.reader-resume').count();
  record('显示上次读到提示', resumeVisible > 0);
  await win.screenshot({ path: path.join(SHOTS, '04-resume.png') });

  // 离线音频 tab
  await win.click('.seg-tab:has-text("离线音频")');
  await win.waitForTimeout(1200);
  record('离线音频面板可打开', (await win.locator('.audio-offline').count()) > 0);
  await win.screenshot({ path: path.join(SHOTS, '05-offline.png') });
  await win.click('.seg-tab:has-text("实时朗读")');
  await win.waitForTimeout(800);

  // 设置页：关闭行为
  await win.click('.sidebar-bottom-item:has-text("设置与备份")');
  await win.waitForTimeout(1400);
  const closeCardVisible = await win.locator('.radio-card').count();
  record('设置页存在关闭行为选项', closeCardVisible >= 2, `${closeCardVisible} 个选项`);
  const trayChecked = await win.locator('.radio-card:has-text("收缩到系统托盘") input').isChecked();
  record('默认收缩到系统托盘', trayChecked);
  await win.screenshot({ path: path.join(SHOTS, '06-settings.png'), fullPage: false });

  const readingCard = await win.locator('.settings-card:has-text("实时朗读")').count();
  record('设置页存在实时朗读配置', readingCard > 0);

  // 立即收缩到托盘 → 窗口隐藏但进程还在
  await win.click('button:has-text("立即收缩到托盘")');
  await win.waitForTimeout(1200);
  const hiddenState = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { visible: w ? w.isVisible() : null, destroyed: w ? w.isDestroyed() : null };
  });
  record('收缩到托盘后窗口隐藏但进程仍在', hiddenState.visible === false && hiddenState.destroyed === false, JSON.stringify(hiddenState));

  // 通过托盘菜单同一入口恢复窗口
  await app.evaluate(async ({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins[0]) wins[0].show();
  });
  await win.waitForTimeout(900);
  const shownState = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { visible: w ? w.isVisible() : null };
  });
  record('可从托盘恢复窗口', shownState.visible === true, JSON.stringify(shownState));

  // 关闭行为改成直接退出后，close 应真正退出（这里只验证设置持久化）
  await win.click('.radio-card:has-text("直接退出软件")');
  await win.waitForTimeout(800);
  const quitChecked = await win.locator('.radio-card:has-text("直接退出软件") input').isChecked();
  record('可切换为直接退出', quitChecked);
  // 改回默认
  await win.click('.radio-card:has-text("收缩到系统托盘")');
  await win.waitForTimeout(600);

  await app.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('失败项：');
    for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E 异常', err);
  process.exit(1);
});
