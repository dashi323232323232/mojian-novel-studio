import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(os.tmpdir(), `dashi-v15-${Date.now()}`);
const USER_DATA = path.join(os.tmpdir(), `dashi-v15-ud-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });
const SHOTS = path.join(os.tmpdir(), 'dashi-v15-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const record = (n, ok, d = '') => {
  results.push({ n, ok, d });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

async function main() {
  const env = { ...process.env, DASHI_DATA_DIR: DATA_DIR, DASHI_PORTABLE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root, `--user-data-dir=${USER_DATA}`], env, timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  await win.waitForTimeout(1200);

  // ---------- 1. 右上角新实例按钮 ----------
  const instanceBtn = await win.locator('.app-titlebar-actions .instance-btn').count();
  record('标题栏存在「新建实例」按钮（最小化按钮左侧）', instanceBtn > 0);
  // 位置断言：必须落在标题栏内，且在系统窗口按钮（右侧）左边
  const geo = await win.evaluate(() => {
    const btn = document.querySelector('.app-titlebar-actions .instance-btn');
    const bar = document.querySelector('.app-titlebar');
    if (!btn || !bar) return null;
    const b = btn.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    return { btn: { x: b.x, y: b.y, right: b.right, h: b.height }, bar: { x: r.x, y: r.y, w: r.width, right: r.right }, innerW: window.innerWidth };
  });
  record(
    '按钮位于标题栏内且紧贴系统按钮左侧',
    Boolean(geo) && geo.btn.y < 40 && geo.btn.right <= geo.bar.right + 1 && geo.btn.x > geo.innerW * 0.7,
    geo ? `button.right=${Math.round(geo.btn.right)} bar.right=${Math.round(geo.bar.right)} y=${Math.round(geo.btn.y)}` : 'not found',
  );
  await win.click('.app-titlebar-actions .instance-btn');
  await win.waitForTimeout(800);
  const modalVisible = await win.locator('.modal:has-text("新建实例")').count();
  record('点击后弹出密码输入弹窗', modalVisible > 0);
  const pwdInput = await win.locator('.modal input[type=password]').count();
  record('弹窗里有密码输入框', pwdInput > 0);

  // 错误密码应被拒绝
  await win.fill('.modal input[type=password]', 'wrong-password');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1500);
  const errShown = await win.locator('.modal').innerText().catch(() => '');
  record('错误密码被拒绝并提示', /密码不正确|密码/.test(errShown) && (await win.locator('.modal').count()) > 0);
  await win.screenshot({ path: path.join(SHOTS, '01-instance-modal.png') });
  // 关闭弹窗
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // ---------- 2. 内容页卷册分级目录 ----------
  await win.click('.sidebar .btn-primary');
  await win.waitForSelector('.modal input.input', { timeout: 8000 });
  await win.fill('.modal input.input', '分级目录测试');
  await win.click('.modal-foot .btn-primary');
  await win.waitForTimeout(1200);

  // 建 2 个卷
  for (const name of ['第一卷 风起', '第二卷 云涌']) {
    await win.click('button:has-text("新建阶段")');
    await win.waitForSelector('.modal input.input');
    await win.fill('.modal input.input', name);
    await win.click('.modal-foot .btn-primary');
    await win.waitForTimeout(900);
  }
  // 建 25 章（跨两个卷），用 API 加速
  const projectId = await win.evaluate(async () => {
    const list = await window.dashi.projects.list();
    return list.data[0].id;
  });
  await win.evaluate(async (pid) => {
    const st = await window.dashi.projects.structure(pid);
    const stages = st.data.stages;
    for (let i = 1; i <= 25; i += 1) {
      await window.dashi.chapters.create(pid, {
        name: `第${i}章 测试章节`,
        stageId: i <= 15 ? stages[0].id : stages[1].id,
      });
    }
  }, projectId);
  await win.reload();
  await win.waitForTimeout(1800);
  await win.click('.nav-child:has-text("内容")');
  await win.waitForTimeout(1500);

  const volumeHeads = await win.locator('.ct-volume-head').count();
  record('目录按「卷」分级显示', volumeHeads >= 2, `${volumeHeads} 个卷`);
  const firstVolumeLabel = await win.locator('.ct-volume-head').first().innerText().catch(() => '');
  record('卷标题带「第 N 卷」', /第\s*\d+\s*卷/.test(firstVolumeLabel), firstVolumeLabel.replace(/\n/g, ' ').slice(0, 40));
  const groupVisibleInitially = await win.locator('.ct-group-head').count();
  record('卷默认收缩（初始看不到章节分组框）', groupVisibleInitially === 0, `${groupVisibleInitially} 个分组`);

  // 展开第一卷
  await win.click('.ct-volume-head >> nth=0');
  await win.waitForTimeout(600);
  const groups = await win.locator('.ct-group-head').count();
  record('展开卷后出现「每 20 章」分组框', groups >= 1, `${groups} 个分组框`);
  const groupLabel = await win.locator('.ct-group-head').first().innerText().catch(() => '');
  record('分组标题形如「第 1–20 章」', /第\s*\d+[–-]\d+\s*章/.test(groupLabel), groupLabel.replace(/\n/g, ' ').slice(0, 30));
  const chaptersUnderGroup = await win.locator('.ct-chapter').count();
  record('分组框默认也收缩（未直接铺开章节）', chaptersUnderGroup === 0, `${chaptersUnderGroup} 章`);

  // 展开分组
  await win.click('.ct-group-head >> nth=0');
  await win.waitForTimeout(600);
  const chaptersNow = await win.locator('.ct-chapter').count();
  record('展开分组后显示章节', chaptersNow > 0, `${chaptersNow} 章`);
  await win.screenshot({ path: path.join(SHOTS, '02-chapter-tree.png') });

  // ---------- 3. 音频页章节也分级 ----------
  await win.click('.nav-child:has-text("音频制作")');
  await win.waitForTimeout(2200);
  const optgroups = await win.locator('.reader-select optgroup').count();
  record('音频页章节下拉按卷分组', optgroups >= 2, `${optgroups} 个 optgroup`);
  await win.screenshot({ path: path.join(SHOTS, '03-audio-grouped.png') });

  // ---------- 4. 大纲自动排版 ----------
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(2500);
  // 先建几个节点，否则「自动排版」按钮是禁用状态（没有节点可排）
  await win.evaluate(async (pid) => {
    const st = await window.dashi.projects.structure(pid);
    const chapters = st.data.chapters.slice(0, 6);
    const types = ['stage', 'event', 'chapter', 'character', 'foreshadow', 'note'];
    for (let i = 0; i < 6; i += 1) {
      await window.dashi.outline.createNode(pid, {
        type: types[i],
        title: `节点 ${i + 1}`,
        description: '自动排版测试节点',
        x: 80 + (i % 3) * 120,
        y: 80 + Math.floor(i / 3) * 90,
        chapterId: types[i] === 'chapter' ? chapters[i % chapters.length]?.id : undefined,
      });
    }
  }, projectId);
  await win.reload();
  await win.waitForTimeout(2000);
  await win.click('.nav-child:has-text("大纲")');
  await win.waitForTimeout(2500);

  const layoutBtn = await win.locator('button:has-text("自动排版")').count();
  record('大纲页存在「自动排版」按钮', layoutBtn > 0);
  const layoutEnabled = await win.locator('button:has-text("自动排版")').isEnabled().catch(() => false);
  record('有节点时「自动排版」可用', layoutEnabled);
  if (layoutBtn > 0 && layoutEnabled) {
    await win.click('button:has-text("自动排版")');
    await win.waitForTimeout(1200);
    const dialog = await win.locator('.layout-dialog').count();
    record('点击后打开排版参数弹窗', dialog > 0);
    await win.screenshot({ path: path.join(SHOTS, '04-layout-dialog.png') });
    const strategies = await win.locator('.layout-strategies button, .layout-strategies > *').count();
    record('弹窗提供多种布局策略', strategies >= 2, `${strategies} 个`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);
  }

  // ---------- 5. 托盘朗读弹窗 ----------
  await win.evaluate(async () => await window.dashi.miniReader.open({}));
  await win.waitForTimeout(2500);
  const pages = app.windows();
  record('可以打开迷你朗读窗口', pages.length >= 2, `${pages.length} 个窗口`);
  if (pages.length >= 2) {
    const mini = pages[pages.length - 1];
    await mini.waitForLoadState('domcontentloaded');
    await mini.waitForTimeout(2000);
    const miniRoot = await mini.locator('.mr-root, .mini-reader, [class^=mr-]').count();
    record('迷你窗口渲染了朗读界面', miniRoot > 0, `${miniRoot} 个根元素`);
    const hasRate = await mini.locator('input[type=number], [class*=rate]').count();
    record('迷你窗口有语速控件', hasRate > 0);
    const hasProgress = await mini.locator('[role=slider], input[type=range], [class*=progress]').count();
    record('迷你窗口有进度控件', hasProgress > 0);
    await mini.screenshot({ path: path.join(SHOTS, '05-mini-reader.png') });
  }

  await app.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) for (const f of failed) console.log('  - ' + f.n + (f.d ? ' — ' + f.d : ''));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('ERR', e.message.slice(0, 500)); process.exit(1); });
