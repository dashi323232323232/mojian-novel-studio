import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-packaged');

if (!fs.existsSync(path.join(root, 'dist/renderer/index.html'))) {
  console.error('请先运行 npm run build');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });

// 打包离线：从本地 node_modules/electron/dist 生成临时 zip，无需联网下载。
// 缓存目录用完即删，避免占用磁盘；已存在则直接复用。
const localElectronDir = path.join(root, 'node_modules/electron/dist');
if (!fs.existsSync(path.join(localElectronDir, 'electron.exe'))) {
  console.error('未找到本地 Electron 运行时，请先安装依赖（npm install）');
  process.exit(1);
}

const zipCacheDir = path.join(root, '.cache/electron-dist');
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const zipName = `electron-v${electronVersion}-win32-x64.zip`;
const zipPath = path.join(zipCacheDir, zipName);

function buildElectronZip() {
  fs.mkdirSync(zipCacheDir, { recursive: true });
  // 用系统自带能力压缩：优先 PowerShell Compress-Archive（Windows）
  const tmpDir = path.join(zipCacheDir, 'stage');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  // 复制 electron dist 内容（保留目录结构）
  fs.cpSync(localElectronDir, tmpDir, { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  // 注意：Compress-Archive 会保留传入路径的相对层级，必须在 dist 目录内执行，
  // 否则压缩包会多出一层目录，导致 packager 找不到 electron.exe。
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path (Join-Path '${tmpDir}' '*') -DestinationPath '${zipPath}' -CompressionLevel Optimal`,
      ],
      { stdio: 'ignore', timeout: 600000 },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  // 校验压缩包非空
  const size = fs.statSync(zipPath).size;
  if (size < 50 * 1024 * 1024) {
    throw new Error(`Electron 压缩包异常（${(size / 1024 / 1024).toFixed(1)} MB）`);
  }
  if (!fs.existsSync(zipPath)) throw new Error('生成 Electron 压缩包失败');
}

if (!fs.existsSync(zipPath)) {
  console.log('正在准备离线 Electron 包…');
  buildElectronZip();
}

const paths = await packager({
  dir: root,
  out: outDir,
  name: 'DashiNovelStudio',
  executableName: '大师小说工作台',
  appVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  platform: 'win32',
  arch: 'x64',
  icon: path.join(root, 'assets/icon.ico'),
  overwrite: true,
  electronZipDir: zipCacheDir,
  asar: true,
  prune: true,
  ignore: [
    /^\/src($|\/)/,
    /^\/tests($|\/)/,
    /^\/scripts($|\/)/,
    /^\/docs($|\/)/,
    /^\/dist-packaged($|\/)/,
    /^\/\.git($|\/)/,
    /^\/\.cache($|\/)/,
    /^\/electron($|\/)/,
    /^\/shared($|\/)/,
    /^\/node_modules\/\.cache/,
    /^\/tsconfig.*\.json$/,
    /^\/vite\.config\.ts$/,
    /^\/index\.html$/,
    /^\/README\.md$/,
    /^\/install\.log$/,
    /^\/tmp-/,
    /^\/assets($|\/)/,
  ],
});

// 打包完成后清理临时 zip（节省约 150MB；下次打包会按需重建）
try {
  fs.rmSync(zipCacheDir, { recursive: true, force: true });
  console.log('已清理临时 Electron 压缩包');
} catch {
  /* 清理失败不影响产物 */
}

console.log('打包完成：');
for (const p of paths) {
  console.log(' ', p);
  const exe = path.join(p, '大师小说工作台.exe');
  if (fs.existsSync(exe)) console.log('  可执行文件：', exe, `(${(fs.statSync(exe).size / 1024 / 1024).toFixed(1)} MB)`);
}
