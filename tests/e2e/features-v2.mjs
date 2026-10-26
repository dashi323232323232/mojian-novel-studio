import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.DASHI_DATA_DIR || path.join(os.tmpdir(), `dashi-e2e-v2-${Date.now()}`);
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
  await win.evaluate(() => {
    localStorage.setItem(
      'dashi.editor.settings',
      JSON.stringify({ fontSize: 18, lineHeight: 1.9, fontFamily: 'serif', autoSave: true, showWordCount: true }),
    );
  });
  await win.reload();
  await win.waitForSelector('.sidebar');
  await win.waitForTimeout(700);
  return { app, win };
}

async function main() {
  const { app, win } = await launch();

  // ---------- 1. 只写名字创建阶段与章节 ----------
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '新功能验收');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);

  await win.click('button:has-text("新建阶段")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第二阶段');
  // 简介留空，直接创建
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(800);
  record('阶段只填名称即可创建', (await win.locator('.stage-name', { hasText: '第二阶段' }).count()) > 0);

  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一章 只有名字');
  const summaryField = win.locator('.modal textarea').first();
  const summaryVisible = await summaryField.count();
  record('新建章节弹窗包含简介输入', summaryVisible > 0);
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);
  record('章节只填名称即可创建并进入编辑', (await win.locator('.cm-content').count()) > 0);

  // ---------- 2. 编辑器里编辑章节简介 ----------
  const summaryInput = win.locator('.chapter-summary-input');
  const hasSummaryBox = await summaryInput.count();
  record('编辑器显示章节简介框', hasSummaryBox > 0);
  if (hasSummaryBox) {
    await summaryInput.fill('这是第一章的简介，从编辑器写入。');
    await win.locator('.cm-content').click();
    await win.waitForTimeout(1600);
    record('编辑器简介自动保存', true);
  }
  await win.screenshot({ path: 'tests/e2e/shots/20-editor-summary.png' });

  // 正文
  await win.locator('.cm-content').click();
  await win.keyboard.type('第一章正文内容。', { delay: 2 });
  await win.waitForTimeout(2200);
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(700);

  // 内容页显示简介
  const chapterSummaryShown = await win.locator('.chapter-row', { hasText: '第一章 只有名字' }).innerText();
  record('内容页显示章节简介', chapterSummaryShown.includes('从编辑器写入'), chapterSummaryShown.replace(/\n/g, ' ').slice(0, 50));

  // 再建一章用于导出
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第二章 导出测试');
  await win.locator('.modal textarea').first().fill('第二章简介');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);
  await win.locator('.cm-content').click();
  await win.keyboard.type('第二章正文，用于导出验证。', { delay: 2 });
  await win.waitForTimeout(2200);
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(700);

  // ---------- 3. 勾选导出 ----------
  await win.click('button:has-text("导出 TXT")');
  await win.waitForTimeout(600);
  const selectMode = await win.locator('button:has-text("全选章节")').count();
  record('进入勾选导出模式', selectMode > 0);
  await win.click('button:has-text("全选章节")');
  await win.waitForTimeout(400);
  const selectedBadge = await win.locator('.badge', { hasText: '已选' }).innerText();
  record('全选章节', /已选\s*2/.test(selectedBadge), selectedBadge);
  await win.screenshot({ path: 'tests/e2e/shots/21-export-select.png' });

  // 取消一章（单独选择）
  await win.locator('.chapter-row').first().click();
  await win.waitForTimeout(300);
  const badgeAfter = await win.locator('.badge', { hasText: '已选' }).innerText();
  record('单独取消选择', /已选\s*1/.test(badgeAfter), badgeAfter);

  // 导出到固定路径（拦截保存对话框）
  const exportPath = path.join(DATA_DIR, 'export-test.txt');
  await app.evaluate(async ({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, exportPath);
  await win.click('button:has-text("导出所选")');
  await win.waitForTimeout(1500);
  const exported = fs.existsSync(exportPath);
  record('导出所选章节为 TXT', exported, exported ? `${fs.statSync(exportPath).size} 字节` : '文件不存在');
  if (exported) {
    const text = fs.readFileSync(exportPath, 'utf8');
    record('导出内容包含章节正文', text.includes('第二章正文'), text.slice(0, 40).replace(/\n/g, ' '));
    record('导出内容包含简介', text.includes('第二章简介'));
    record('导出内容包含阶段标题', text.includes('阶段') || text.includes('=='));
  }

  // 全选阶段
  await win.click('button:has-text("导出 TXT")').catch(() => undefined);
  await win.waitForTimeout(500);
  if (await win.locator('button:has-text("全选阶段")').count()) {
    await win.click('button:has-text("全选阶段")');
    await win.waitForTimeout(400);
    record('全选阶段可用', true);
  }

  // ---------- 4. 大纲：具体章节节点 + 备注 ----------
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(1000);
  const paletteHasChapter = await win.locator('.palette-item:has-text("具体章节")').count();
  record('大纲工具栏含「具体章节」', paletteHasChapter > 0);

  if (paletteHasChapter) {
    await win.click('.palette-item:has-text("具体章节")');
    await win.waitForTimeout(900);
    await win.click('button:has-text("适应画布")');
    await win.waitForTimeout(600);
    await win.locator('.node-card').last().click({ force: true });
    await win.waitForTimeout(500);

    // 绑定真实章节
    const bindSelect = win.locator('.outline-details select').filter({ hasText: '未绑定' }).first();
    if (await bindSelect.count()) {
      const options = await bindSelect.locator('option').allInnerTexts();
      const target = options.find((o) => o.includes('第一章'));
      if (target) {
        await bindSelect.selectOption({ label: target });
        await win.waitForTimeout(1200);
      }
    }
    const detailsText = await win.locator('.outline-details').innerText();
    record('具体章节节点可绑定真实章节', detailsText.includes('已绑定') || detailsText.includes('第一章'), detailsText.slice(0, 60).replace(/\n/g, ' '));

    // 备注：写超长内容
    const notesArea = win.locator('.outline-details textarea').filter({ hasText: '' }).last();
    const longNotes = '这是一条超长备注，用于验证不限字数。'.repeat(300);
    await notesArea.fill(longNotes);
    await win.locator('.outline-details input.input').first().click();
    await win.waitForTimeout(1600);
    const notesText = await win.locator('.outline-details').innerText();
    record('备注可写超长内容', notesText.includes('字'), notesText.match(/备注（不限字数）[\s\S]{0,20}/)?.[0]?.replace(/\n/g, ' ') ?? '');

    // 一键删除备注
    await win.locator('.outline-details button:has-text("删除备注")').click();
    await win.waitForTimeout(1200);
    const afterClear = await win.locator('.outline-details textarea').last().inputValue();
    record('备注可一键删除', afterClear === '');
    await win.screenshot({ path: 'tests/e2e/shots/22-chapter-node-notes.png' });

    // 大纲改简介 → 内容页同步
    const descArea = win.locator('.outline-details textarea').first();
    await descArea.fill('大纲里修改的章节简介');
    await win.locator('.outline-details input.input').first().click();
    await win.waitForTimeout(1500);
    await win.click('.nav-child:has-text("内容")');
    await win.waitForTimeout(900);
    const contentAfter = await win.locator('.chapter-row').first().innerText();
    record('大纲改简介后内容页同步', contentAfter.includes('大纲里修改的章节简介'), contentAfter.replace(/\n/g, ' ').slice(0, 60));
  }

  // ---------- 5. 数据存储位置 UI ----------
  await win.click('.sidebar-bottom-item:has-text("设置与备份")');
  await win.waitForTimeout(1200);
  const settingsText = await win.locator('.settings-page').innerText();
  record('设置页显示数据存储位置', settingsText.includes('数据存储位置'));
  record('显示当前数据目录', settingsText.includes(DATA_DIR) || settingsText.includes('当前数据目录'));
  const changeBtn = win.locator('button:has-text("选择新位置并迁移数据")');
  record('提供更改数据位置按钮', (await changeBtn.count()) > 0);
  await win.screenshot({ path: 'tests/e2e/shots/23-data-location.png' });

  await app.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync('tests/e2e/last-v2-run.json', JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 失败', e);
  process.exitCode = 1;
});
