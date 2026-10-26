import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-final-${Date.now()}`);
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

async function createProject(win, name) {
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', name);
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
}

async function createChapter(win, name) {
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', name);
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
}

async function main() {
  const { app, win } = await launch();

  // 两个项目的数据隔离
  await createProject(win, '项目甲');
  await createChapter(win, '甲的第一章');
  await win.click('.cm-content');
  await win.keyboard.type('这是项目甲的正文。', { delay: 1 });
  await win.waitForTimeout(1800);
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(500);

  await createProject(win, '项目乙');
  await createChapter(win, '乙的第一章');
  await win.click('.cm-content');
  await win.keyboard.type('这是项目乙的正文。', { delay: 1 });
  await win.waitForTimeout(1800);
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(500);

  // 切回项目甲
  await win.click('.project-name:has-text("项目甲")');
  await win.waitForTimeout(1000);
  const chapterList = await win.locator('.chapter-title').allInnerTexts();
  record('项目隔离：切回甲只显示甲章节', chapterList.length === 1 && chapterList[0].includes('甲'), chapterList.join(','));
  await win.click('.chapter-row');
  await win.waitForTimeout(800);
  const contentA = await win.locator('.cm-content').innerText();
  record('项目隔离：正文正确', contentA.includes('项目甲') && !contentA.includes('项目乙'));
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(400);

  // 两个阶段 + 章节移动
  await win.click('button:has-text("新建阶段")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第二阶段');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(600);
  await createChapter(win, '甲的第二章');
  await win.click('.editor-topbar button:has-text("退出")').catch(() => undefined);
  await win.waitForTimeout(600);

  // 章节移动到第二阶段
  await win.locator('.chapter-row').last().hover();
  await win.locator('.chapter-actions .menu-anchor button').first().click();
  await win.waitForTimeout(300);
  await win.click('.menu-item:has-text("移动到其他阶段")');
  await win.waitForTimeout(400);
  await win.locator('.modal button:has-text("移动到此阶段末尾"):not([disabled])').first().click();
  await win.waitForTimeout(800);
  const stageBlocks = await win.locator('.stage-block').count();
  record('阶段数量正确（2 个阶段）', stageBlocks >= 2, String(stageBlocks));

  // 大纲：创建节点、连线、选择连线修改关系
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(900);
  await win.click('.palette-item:has-text("剧情事件")');
  await win.waitForTimeout(700);
  await win.click('.palette-item:has-text("剧情事件")');
  await win.waitForTimeout(700);
  await win.click('button:has-text("适应画布")');
  await win.waitForTimeout(700);

  const nodes = win.locator('.react-flow__node');
  const n1 = await nodes.nth(0).boundingBox();
  const n2 = await nodes.nth(1).boundingBox();
  if (n1 && n2) {
    // 从第一个节点右侧 handle 拖到第二个节点左侧 handle
    await win.mouse.move(n1.x + n1.width - 3, n1.y + n1.height / 2);
    await win.mouse.down();
    await win.mouse.move(n2.x + 3, n2.y + n2.height / 2, { steps: 16 });
    await win.mouse.up();
    await win.waitForTimeout(1200);
  }
  const edges = await win.locator('.react-flow__edge').count();
  record('创建节点连线', edges >= 1, `连线 ${edges}`);
  if (edges >= 1) {
    await win.locator('.react-flow__edge').first().click({ force: true });
    await win.waitForTimeout(600);
    const edgePanel = await win.locator('.outline-details').innerText();
    record('点击连线可编辑关系', edgePanel.includes('关系类型') || edgePanel.includes('连线'), edgePanel.slice(0, 30));
    await win.screenshot({ path: 'tests/e2e/shots/14-edge-select.png' });
  }

  // 大纲画布缩放比例保存
  await win.click('button:has-text("适应画布")');
  await win.waitForTimeout(700);

  // 伏笔
  await win.click('.outline-tab:has-text("伏笔追踪")');
  await win.waitForTimeout(700);
  await win.click('.foreshadow-list-head .btn-primary');
  await win.waitForTimeout(400);
  const nameInput = win.locator('.foreshadow-detail input.input').first();
  await nameInput.fill('染血的军旗');
  await win.locator('.foreshadow-detail textarea').first().fill('第一章出现的军旗，将在最后决战中再次出现。');
  await win.click('.foreshadow-detail button:has-text("保存")');
  await win.waitForTimeout(900);
  record('创建伏笔', (await win.locator('.foreshadow-card').count()) >= 1);
  await win.screenshot({ path: 'tests/e2e/shots/15-foreshadow.png' });

  // 设置页与备份
  await win.click('.sidebar-bottom-item:has-text("设置与备份")');
  await win.waitForTimeout(1000);
  record('设置页显示数据统计', (await win.locator('.stat').count()) >= 5);
  await win.click('button:has-text("立即备份")');
  await win.waitForTimeout(1200);
  const backupRows = await win.locator('.backup-row').count();
  record('创建备份', backupRows >= 1, `${backupRows} 份`);
  await win.screenshot({ path: 'tests/e2e/shots/16-settings.png' });

  // 窄窗口响应式
  await win.setViewportSize({ width: 1024, height: 680 });
  await win.waitForTimeout(600);
  await win.click('.nav-child:has-text("内容")').catch(() => undefined);
  await win.waitForTimeout(700);
  const addBtn = win.locator('.floating-add');
  const addVisible = await addBtn.isVisible();
  record('窄窗口下关键按钮仍可见', addVisible);
  await win.screenshot({ path: 'tests/e2e/shots/17-narrow.png' });
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForTimeout(400);

  await app.close();

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-final-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
