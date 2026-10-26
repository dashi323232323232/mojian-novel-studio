import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const DATA_DIR = process.env.MOJIAN_DATA_DIR || path.join(os.tmpdir(), `mojian-e2e-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const env = { ...process.env, MOJIAN_DATA_DIR: DATA_DIR, MOJIAN_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [root],
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1200);
  await win.screenshot({ path: path.join(root, 'tests/e2e/shots/01-welcome.png') });

  // 1. 创建项目
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 5000 });
  await win.fill('.modal input.input', '普法战争');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);
  const projectVisible = await win.locator('.project-name', { hasText: '普法战争' }).count();
  record('创建项目并显示在侧边栏', projectVisible > 0);
  await win.screenshot({ path: path.join(root, 'tests/e2e/shots/02-content-empty.png') });

  // 2. 新建阶段
  await win.click('button:has-text("新建阶段")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一阶段：战云密布');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(700);
  record('创建阶段', (await win.locator('.stage-name', { hasText: '第一阶段' }).count()) > 0);

  // 3. 新建章节
  await win.click('button:has-text("新建章节")');
  await win.waitForSelector('.modal input.input');
  await win.fill('.modal input.input', '第一章 宣战');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(900);
  record('创建章节并进入编辑页', (await win.locator('.cm-content').count()) > 0);
  await win.screenshot({ path: path.join(root, 'tests/e2e/shots/03-editor.png') });

  // 4. 输入正文
  const text = '一八七〇年七月，巴黎的夏天闷热得反常。\n\n皇宫里，欧仁妮皇后正在读一份来自柏林的电报。';
  await win.click('.cm-content');
  await win.keyboard.type(text, { delay: 2 });
  await win.waitForTimeout(600);
  await win.click('.editor-topbar .btn-primary');
  await win.waitForTimeout(900);
  const savedText = await win.locator('.save-state').first().innerText();
  record('手动保存正文', /已保存/.test(savedText), savedText);

  // 5. 自动保存（输入后等待）
  await win.click('.cm-content');
  await win.keyboard.press('End');
  await win.keyboard.type('\n\n这是自动保存测试。', { delay: 2 });
  await win.waitForTimeout(2400);
  const autoSaved = await win.locator('.save-state').first().innerText();
  record('自动保存', /已保存/.test(autoSaved), autoSaved);

  // 6. 退出到内容页
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(600);
  const chapterRow = await win.locator('.chapter-title', { hasText: '第一章 宣战' }).count();
  record('退出编辑页返回内容页', chapterRow > 0);
  await win.screenshot({ path: path.join(root, 'tests/e2e/shots/04-content-list.png') });

  // 7. 重新进入，正文仍在
  await win.click('.chapter-row');
  await win.waitForTimeout(800);
  const contentText = await win.locator('.cm-content').innerText();
  record('重新进入正文仍存在', contentText.includes('普法战争') || contentText.includes('巴黎'), contentText.slice(0, 30));
  await win.click('.editor-topbar button:has-text("退出")');
  await win.waitForTimeout(500);

  // 8. 大纲
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(1200);
  record('进入大纲页', (await win.locator('.outline-canvas-wrap').count()) > 0);
  await win.click('.palette-item:has-text("剧情事件")');
  await win.waitForTimeout(800);
  await win.click('.palette-item:has-text("人物")');
  await win.waitForTimeout(800);
  record('创建大纲节点', (await win.locator('.node-card').count()) >= 2, `节点数 ${await win.locator('.node-card').count()}`);
  await win.screenshot({ path: path.join(root, 'tests/e2e/shots/05-outline.png') });

  // 9. 编辑节点名称（先适应画布，确保节点可见）
  await win.click('button:has-text("适应画布")');
  await win.waitForTimeout(600);
  await win.locator('.node-card').first().click({ force: true });
  await win.waitForTimeout(400);
  const titleInput = win.locator('.outline-details input.input').first();
  await titleInput.fill('色当战役');
  await win.waitForTimeout(1200);
  record('编辑节点名称', (await win.locator('.node-card-title', { hasText: '色当战役' }).count()) > 0);

  // 10. 关联章节
  await win.click('.outline-details button[title="添加关联章节"]');
  await win.waitForTimeout(400);
  const addRow = win.locator('.linked-chapter-row').first();
  if (await addRow.count()) {
    await addRow.click();
    await win.waitForTimeout(700);
  }
  record('节点关联章节', (await win.locator('.outline-details .linked-chapter-row').count()) > 0);

  // 11. 保存状态与刷新持久化
  await win.reload();
  await win.waitForTimeout(1500);
  await win.click('.nav-child:has-text("大纲")').catch(() => undefined);
  await win.waitForTimeout(1200);
  record('刷新后大纲节点仍在', (await win.locator('.node-card').count()) >= 2);

  // 12. 音频页
  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForTimeout(1200);
  record('进入音频页', (await win.locator('.audio-page').count()) > 0);
  await win.screenshot({ path: path.join(root, 'tests/e2e/shots/06-audio.png') });

  // 13. Agent 页
  await win.click('.sidebar-bottom-item:has-text("Agent 接入")');
  await win.waitForTimeout(1200);
  record('进入 Agent 接入页', (await win.locator('.agent-page').count()) > 0);
  await win.screenshot({ path: path.join(root, 'tests/e2e/shots/07-agent.png') });

  // 14. 读取 API 状态
  const statusText = await win.locator('.card').first().innerText();
  record('显示服务状态', statusText.includes('127.0.0.1'), statusText.replace(/\n/g, ' ').slice(0, 80));

  await app.close();

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(root, 'tests/e2e/last-run.json'), JSON.stringify({ dataDir: DATA_DIR, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('E2E 运行失败：', err);
  process.exitCode = 1;
});
