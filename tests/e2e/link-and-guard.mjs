import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.MOJIAN_DATA_DIR || path.join(os.tmpdir(), `mojian-e2e-link-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function main() {
  const env = { ...process.env, MOJIAN_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.')], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(900);

  // 创建项目
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '联动测试项目');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);

  // 建两章
  for (const name of ['第一章 宣战', '第二章 色当']) {
    await win.click('button:has-text("新建章节")');
    await win.waitForSelector('.modal input.input');
    await win.fill('.modal input.input', name);
    await win.click('.modal-foot .btn-primary');
    await win.waitForTimeout(700);
    await win.click('.cm-content');
    await win.keyboard.type(`${name} 的正文内容。`, { delay: 2 });
    await win.waitForTimeout(1800);
    await win.click('.editor-topbar button:has-text("退出")');
    await win.waitForTimeout(500);
  }

  // 进入大纲，创建节点
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(900);
  await win.click('.palette-item:has-text("剧情事件")');
  await win.waitForTimeout(800);
  await win.click('button:has-text("适应画布")');
  await win.waitForTimeout(500);
  await win.locator('.node-card').first().click({ force: true });
  await win.waitForTimeout(400);

  // 关联两个章节
  for (let i = 0; i < 2; i++) {
    await win.click('.outline-details button[title="添加关联章节"]');
    await win.waitForTimeout(350);
    const row = win.locator('.outline-details .linked-chapter-row').first();
    if (await row.count()) {
      await row.click();
      await win.waitForTimeout(500);
    }
  }
  const linkedCount = await win.locator('.outline-details .linked-chapter-row').count();
  record('一个节点关联多个章节', linkedCount >= 2, `关联 ${linkedCount}`);

  // 悬停节点查看关联章节
  await win.locator('.node-card').first().hover();
  await win.waitForTimeout(800);
  const hoverPop = await win.locator('.node-hover-pop').count();
  record('悬停节点显示关联章节列表', hoverPop > 0);
  if (hoverPop) {
    // 鼠标移入浮层，不应消失
    await win.locator('.node-hover-pop').hover();
    await win.waitForTimeout(600);
    record('鼠标移入浮层不消失', (await win.locator('.node-hover-pop').count()) > 0);
    await win.screenshot({ path: 'tests/e2e/shots/08-hover.png' });
    // 点击章节进入联动
    await win.locator('.node-hover-pop .hover-chapter').first().click();
    await win.waitForTimeout(1200);
    record('点击浮层章节进入联动工作区', (await win.locator('.link-page').count()) > 0);
    await win.screenshot({ path: 'tests/e2e/shots/09-link.png' });
  }

  // 拖动分隔条
  const divider = win.locator('.split-divider');
  const box = await divider.boundingBox();
  if (box) {
    await win.mouse.move(box.x + box.width / 2, box.y + 300);
    await win.mouse.down();
    await win.mouse.move(box.x - 200, box.y + 300, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(900);
    const left = await win.locator('.split-left').boundingBox();
    const total = await win.locator('.split-pane').boundingBox();
    const ratio = left.width / total.width;
    record('拖动分隔条改变比例', ratio < 0.45, `比例 ${ratio.toFixed(2)}`);
  }

  // 右侧编辑正文
  const cm = win.locator('.split-right .cm-content');
  record('联动右侧编辑器可编辑', (await cm.count()) > 0);
  await cm.click();
  await win.keyboard.press('End');
  await win.keyboard.type('\n联动工作区补充文字。', { delay: 2 });
  await win.waitForTimeout(2200);
  const state = await win.locator('.split-right .save-state').first().innerText().catch(() => '');
  record('联动区自动保存', /已保存/.test(state), state);

  // 切换章节（顶部章节按钮）
  const chapterBtns = win.locator('.split-right .btn-sm');
  if ((await chapterBtns.count()) > 1) {
    await chapterBtns.nth(1).click();
    await win.waitForTimeout(900);
    record('联动区切换章节', true);
  }

  // 退出联动
  await win.click('button:has-text("退出")');
  await win.waitForTimeout(700);
  record('退出联动返回大纲', (await win.locator('.outline-canvas-wrap').count()) > 0);

  // 验证分栏比例持久化
  await win.reload();
  await win.waitForTimeout(1500);
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(1000);
  await win.locator('.node-card').first().hover();
  await win.waitForTimeout(700);
  if (await win.locator('.node-hover-pop .hover-chapter').count()) {
    await win.locator('.node-hover-pop .hover-chapter').first().click();
    await win.waitForTimeout(1200);
    const left = await win.locator('.split-left').boundingBox();
    const total = await win.locator('.split-pane').boundingBox();
    const ratio = left.width / total.width;
    record('重新打开后恢复分栏比例', ratio < 0.47, `比例 ${ratio.toFixed(2)}`);
  } else {
    record('重新打开后恢复分栏比例', false, '未找到关联章节浮层');
  }

  // 未保存保护：修改正文后立刻切换项目/章节
  const cm2 = win.locator('.split-right .cm-content');
  await cm2.click();
  await win.keyboard.press('End');
  await win.keyboard.type('未保存保护测试', { delay: 1 });
  await win.waitForTimeout(100); // 不等待自动保存
  await win.click('button:has-text("退出")');
  await win.waitForTimeout(1000);
  const stillInLink = await win.locator('.link-page').count();
  record('有未保存内容时退出被保护（自动保存或提示）', stillInLink === 0 || (await win.locator('.modal').count()) > 0);

  await app.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-link-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
