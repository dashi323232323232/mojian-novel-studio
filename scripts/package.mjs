import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-packaged');

if (!fs.existsSync(path.join(root, 'dist/renderer/index.html'))) {
  console.error('请先运行 npm run build');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });

// 打包离线：把本地 electron 二进制目录直接作为 electronZip 使用
const localElectronDir = path.join(root, 'node_modules/electron/dist');
if (!fs.existsSync(path.join(localElectronDir, 'electron.exe'))) {
  console.error('未找到本地 Electron 运行时，请先安装依赖');
  process.exit(1);
}

const paths = await packager({
  dir: root,
  out: outDir,
  name: 'DashiNovelStudio',
  executableName: '大师小说工作台',
  appVersion: '1.0.0',
  platform: 'win32',
  arch: 'x64',
  icon: path.join(root, 'assets/icon.ico'),
  overwrite: true,
  electronZipDir: path.join(root, '.cache/electron-dist'),
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

console.log('打包完成：');
for (const p of paths) {
  console.log(' ', p);
  const exe = path.join(p, '大师小说工作台.exe');
  if (fs.existsSync(exe)) console.log('  可执行文件：', exe, `(${(fs.statSync(exe).size / 1024 / 1024).toFixed(1)} MB)`);
}
