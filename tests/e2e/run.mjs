import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E2E 总入口：按顺序串行执行各个场景脚本。
 * 串行是必须的——应用使用单实例锁，并行启动会互相抢占。
 *
 * 用法：
 *   node tests/e2e/run.mjs            # 全部
 *   node tests/e2e/run.mjs reader tray # 只跑指定场景
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const SUITES = [
  { name: 'smoke', file: 'smoke.mjs', desc: '基础流程：项目/章节/编辑/大纲/音频页' },
  { name: 'reader', file: 'reader.mjs', desc: '实时朗读：播放/暂停/拖动/变速/换声音/记忆进度' },
  { name: 'reader-edge', file: 'reader-edge.mjs', desc: '朗读边界：空章节/极短/超长/连拖/快捷键/自适应' },
  { name: 'reader-visual', file: 'reader-visual.mjs', desc: '朗读界面视觉与响应式（5 种窗口尺寸）' },
  { name: 'tray', file: 'tray.mjs', desc: '系统托盘：关闭收缩/恢复/切换直接退出' },
  { name: 'close-guard-tray', file: 'close-guard-tray.mjs', desc: '关闭保护与托盘组合' },
  { name: 'settings-persist', file: 'settings-persist.mjs', desc: '设置与朗读进度持久化' },
  { name: 'v15-features', file: 'v15-features.mjs', desc: '多实例/卷册目录/自动排版/迷你朗读弹窗' },
  { name: 'advanced', file: 'advanced.mjs', desc: '进阶：长文本/版本/画布/音频/Agent' },
];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const suites = wanted.length ? SUITES.filter((s) => wanted.includes(s.name)) : SUITES;

if (!suites.length) {
  console.error('没有匹配的场景。可选：' + SUITES.map((s) => s.name).join(', '));
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'dist/renderer/index.html'))) {
  console.error('未找到构建产物，请先运行 npm run build');
  process.exit(1);
}

const results = [];
for (const suite of suites) {
  const file = path.join(__dirname, suite.file);
  if (!fs.existsSync(file)) {
    console.log(`SKIP  ${suite.name}（缺少 ${suite.file}）`);
    results.push({ name: suite.name, ok: true, skipped: true });
    continue;
  }
  console.log(`\n=== ${suite.name} · ${suite.desc} ===`);
  const started = Date.now();
  const proc = spawnSync(process.execPath, [file], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    timeout: 15 * 60 * 1000,
  });
  const ok = proc.status === 0;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`--- ${suite.name}: ${ok ? 'PASS' : 'FAIL'}（${seconds}s）`);
  results.push({ name: suite.name, ok, seconds });
}

const failed = results.filter((r) => !r.ok);
console.log('\n================ E2E 汇总 ================');
for (const r of results) {
  console.log(`${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.seconds ? '  ' + r.seconds + 's' : ''}`);
}
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
