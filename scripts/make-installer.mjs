// scripts/make-installer.mjs
// 制作「大师小说工作台」单个安装包并分发：H:\软件安装包（只留最新一份）+ GitHub Release。
// 依赖：Node >= 22（原生 fetch / zlib / fs.cpSync），不安装任何新依赖。
// 运行：npm run make-installer（需先 npm run package 产出 dist-packaged 目录）
// 注意：本脚本会真实删除 H 盘旧安装包并访问 GitHub，请确认后再执行。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const tag = 'v' + version;

const EXE_NAME = '大师小说工作台.exe';
const LOCAL_DIR = 'H:/软件安装包';
const REPO = 'dashi323232323232/mojian-novel-studio';
const API_BASE = 'https://api.github.com';
const PROXY_FALLBACK = 'http://127.0.0.1:7897';
const INSTALLER_EXT = ['.exe', '.zip', '.7z', '.msi'];
// 只匹配明确带有本软件名字的文件，宁可少删不可误删；
// 同目录里 123pan / Chrome / Steam / TABLE游戏厅 等别人的安装包一概不匹配。
const NAME_RE = /大师小说工作台|dashi|novel/i;

function log(msg) { console.log('[安装包] ' + msg); }
function warn(msg) { console.warn('[安装包] 警告：' + msg); }
function fail(stage, msg) { console.error('[安装包] ' + stage + '：' + msg); }

// ---------------------------------------------------------------------------
// 0. 前置校验
// ---------------------------------------------------------------------------
log('版本 ' + version + '，Release 标签 ' + tag);
if (!fs.existsSync(path.join(root, 'dist/renderer/index.html'))) {
  fail('打包失败', '未找到 dist/renderer/index.html，请先运行 npm run build');
  process.exit(1);
}
// 用 electron-builder 产出真正的 Windows 安装程序（NSIS），而不是便携版 zip：
// 双击后走标准安装向导，可选安装目录、创建桌面与开始菜单快捷方式、可从「应用和功能」卸载。
const BUILDER_CONFIG = path.join(root, 'electron-builder.json');
const OUT_DIR = path.join(root, 'dist-installer');
if (!fs.existsSync(BUILDER_CONFIG)) {
  fail('打包失败', '未找到 electron-builder.json');
  process.exit(1);
}

/**
 * 调用 electron-builder 生成 NSIS 安装程序。
 * 返回 { file, name, fmt }。任何失败都抛错，由外层捕获。
 */
function buildNsisInstaller() {
  log('开始构建 Windows 安装程序（NSIS）…');
  // 清掉上一次的产物，避免旧版本文件被误当成本次结果
  try { fs.rmSync(OUT_DIR, { recursive: true, force: true }); } catch { /* 目录被占用时跳过，后面按文件名匹配 */ }
  // Windows 上直接用 npx.cmd 调起子进程会被 EINVAL 拒绝（Node 的 spawn 安全限制），
  // 这里改走 electron-builder 的 JS 入口，跨平台且不依赖 shell。
  const builderEntry = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  if (!fs.existsSync(builderEntry)) {
    throw new Error('未找到 electron-builder，请先运行 npm install');
  }
  try {
    execFileSync(
      process.execPath,
      [builderEntry, '--win', 'nsis', '--x64', '--config', 'electron-builder.json'],
      { cwd: root, stdio: 'inherit', timeout: 20 * 60 * 1000 },
    );
  } catch (e) {
    throw new Error('electron-builder 执行失败：' + (e && e.message ? e.message : String(e)));
  }
  // 产物名形如「大师小说工作台-1.6.1-安装程序.exe」
  const candidates = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter((f) => f.toLowerCase().endsWith('.exe') && !f.includes('__uninstaller'))
    : [];
  if (!candidates.length) throw new Error('electron-builder 未产出 .exe 安装程序');
  // 取体积最大的那个（安装程序 vs 可能的临时文件）
  let hit = null;
  let maxSize = 0;
  for (const f of candidates) {
    const full = path.join(OUT_DIR, f);
    const size = fs.statSync(full).size;
    if (size > maxSize) { maxSize = size; hit = full; }
  }
  if (!hit || maxSize < 10 * 1024 * 1024) {
    throw new Error('产出的安装程序体积异常（' + (maxSize / 1024 / 1024).toFixed(1) + ' MB）');
  }
  log('安装程序已生成：' + path.basename(hit) + '（' + (maxSize / 1024 / 1024).toFixed(1) + ' MB）');
  return { file: hit, name: path.basename(hit), fmt: 'Windows 安装程序（NSIS，标准安装向导）' };
}

let artifact = null;
try {
  artifact = buildNsisInstaller();
  if (!fs.existsSync(artifact.file) || fs.statSync(artifact.file).size === 0) {
    throw new Error('生成的安装程序为空');
  }
} catch (e) {
  fail('打包失败', (e && e.message ? e.message : String(e)));
  process.exit(1);
}
log('最终安装包：' + artifact.name + '（' + artifact.fmt + '）');

// ---------------------------------------------------------------------------
// 3. 复制到 H:\软件安装包，并只保留本软件最新一份
// ---------------------------------------------------------------------------
let localPath = '';
try {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  localPath = path.join(LOCAL_DIR, artifact.name);
  fs.copyFileSync(artifact.file, localPath);
  log('已保存到本地：' + localPath);

  const keep = path.resolve(localPath).toLowerCase();
  const victims = [];
  for (const name of fs.readdirSync(LOCAL_DIR)) {
    const full = path.join(LOCAL_DIR, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    if (path.resolve(full).toLowerCase() === keep) continue;
    if (!NAME_RE.test(name)) continue;
    if (!INSTALLER_EXT.includes(path.extname(name).toLowerCase())) continue;
    victims.push(full);
  }
  if (victims.length === 0) {
    log('H 盘无需清理（没有匹配到本软件的其它旧安装包）。');
  } else {
    log('将删除以下本软件的旧安装包（共 ' + victims.length + ' 个，删除前先列出）：');
    for (const v of victims) log('  - ' + v);
    for (const v of victims) {
      try { fs.unlinkSync(v); log('  已删除：' + v); }
      catch (e) { warn('删除失败（不影响最新一份）：' + v + ' -> ' + (e && e.message ? e.message : String(e))); }
    }
  }
  log('H 盘当前仅保留最新一份：' + localPath);
} catch (e) {
  fail('打包失败', '写入 H 盘失败：' + (e && e.message ? e.message : String(e)));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. 上传 GitHub Release
// ---------------------------------------------------------------------------
function readToken() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const m = /^password=(.+)$/m.exec(out);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function proxyUrl() {
  return process.env.HTTPS_PROXY || process.env.https_proxy ||
         process.env.HTTP_PROXY || process.env.http_proxy || PROXY_FALLBACK;
}

// 网络准备：不安装任何新依赖。
// 先探测直连是否可用（本机直连常常可用，代理反而可能没开），
// 直连不通时再启用代理。这样两种网络环境都能上传。
async function makeDispatcher() {
  const hadProxy = !!(process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy);
  if (!hadProxy) {
    try {
      const probe = await fetch(API_BASE + '/repos/' + REPO, {
        signal: AbortSignal.timeout(6000),
      });
      await probe.arrayBuffer().catch(() => undefined);
      if (probe.ok) {
        log('GitHub 直连可用，不使用代理');
        return null;
      }
    } catch { /* 直连不通，继续尝试代理 */ }
  }
  const p = proxyUrl();
  if (!hadProxy) {
    process.env.HTTPS_PROXY = p;
    process.env.HTTP_PROXY = p;
    log('直连不可用，启用代理 ' + p);
  } else {
    log('使用已有代理变量：' + p);
  }
  if (!process.env.NODE_USE_ENV_PROXY) process.env.NODE_USE_ENV_PROXY = '1';
  try {
    const undici = await import('undici');
    if (typeof undici.ProxyAgent === 'function') {
      log('检测到 undici，额外启用 ProxyAgent 兜底');
      return new undici.ProxyAgent(p);
    }
  } catch { /* 没有 undici 也没关系，原生 fetch 已走环境变量代理 */ }
  return null;
}

async function apiFetch(url, options, dispatcher) {
  const init = { ...options };
  if (dispatcher) init.dispatcher = dispatcher;
  const res = await fetch(url, init);
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body && body.message ? body.message :
      (typeof body === 'string' && body ? body.slice(0, 300) : res.statusText);
    throw new Error('HTTP ' + res.status + ' ' + res.statusText + '：' + msg);
  }
  return { res, body };
}

function releaseUrl(rel) {
  return (rel && rel.html_url) ? rel.html_url :
    'https://github.com/' + REPO + '/releases/tag/' + tag;
}

async function githubUpload(assetName, assetPath) {
  if (typeof fetch !== 'function') { warn('当前 Node 无原生 fetch，跳过上传'); return null; }
  // GitHub 的 asset 名走 URL query，中文在部分网络环境下会被破坏成乱码。
  // 本地 H 盘仍保留中文名，但上传时统一转成纯 ASCII 名，保证下载链接可用。
  const uploadName = 'DashiNovelStudio-' + version + '-win64-setup' + path.extname(assetName);
  assetName = uploadName;
  log('上传用文件名（ASCII）：' + uploadName);
  const token = readToken();
  if (!token) { warn('未能从 git credential fill 读取 GitHub token，跳过上传（不打印、不落盘）'); return null; }
  const dispatcher = await makeDispatcher();
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dashi-make-installer',
  };

  let rel = null;
  try {
    const { body } = await apiFetch(API_BASE + '/repos/' + REPO + '/releases/tags/' + tag,
      { method: 'GET', headers }, dispatcher);
    rel = body;
    log('已存在 Release ' + tag + '，复用并替换同名 asset');
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/HTTP 404/.test(msg)) log('未找到 Release ' + tag + '，准备新建…');
    else warn('查询 Release 失败：' + msg + '，仍尝试新建');
    try {
      const payload = JSON.stringify({
        tag_name: tag,
        name: '大师小说工作台 ' + version,
        body: '大师小说工作台 ' + version + ' Windows x64 安装包（单个文件）。\n\n便携版：解压后运行 大师小说工作台.exe 即可。',
        draft: false,
        prerelease: false,
      });
      const { body: created } = await apiFetch(API_BASE + '/repos/' + REPO + '/releases', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: payload,
      }, dispatcher);
      rel = created;
      log('已创建 Release：' + tag);
    } catch (e2) {
      throw new Error('创建 Release 失败：' + (e2 && e2.message ? e2.message : String(e2)));
    }
  }

  // 删除同名旧 asset（GitHub 不允许同名 asset 重复上传）
  if (rel && Array.isArray(rel.assets)) {
    for (const a of rel.assets) {
      if (a.name !== assetName) continue;
      log('删除同名旧 asset：' + a.name);
      try {
        await apiFetch(API_BASE + '/repos/' + REPO + '/releases/assets/' + a.id,
          { method: 'DELETE', headers }, dispatcher);
      } catch (e) { warn('删除旧 asset 失败：' + (e && e.message ? e.message : String(e))); }
    }
  }

  const data = fs.readFileSync(assetPath);
  log('正在上传安装包（' + (data.length / 1024 / 1024).toFixed(1) + ' MB）…');
  const uploadBase = (rel.upload_url ||
    (API_BASE + '/repos/' + REPO + '/releases/' + rel.id + '/assets')).replace(/\{[^}]*\}/, '');
  const uploadUrl = uploadBase + '?name=' + encodeURIComponent(assetName);
  const { body: asset } = await apiFetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(data.length),
    },
    body: data,
  }, dispatcher);
  log('上传完成：' + (asset && asset.browser_download_url ? asset.browser_download_url : assetName));
  return releaseUrl(rel);
}

let releasePage = null;
try {
  releasePage = await githubUpload(artifact.name, artifact.file);
  if (releasePage) log('GitHub Release：' + releasePage);
  else warn('本次未上传 GitHub（已按要求跳过，不视为失败）');
} catch (e) {
  const msg = String(e && e.message ? e.message : e);
  // 按验收标准：网络不通 / 代理不可达一律「警告并跳过上传」，不视为脚本失败。
  const networkDown = /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|network|代理|connect/i.test(msg);
  if (networkDown) {
    warn('GitHub 网络不通，已按要求跳过上传（不视为失败）：' + msg);
    warn('可设置 HTTPS_PROXY / HTTP_PROXY（默认也会尝试 ' + PROXY_FALLBACK + '）后重跑上传；本地安装包不受影响。');
  } else {
    fail('上传失败', msg);
    warn('上传失败不影响本地安装包，H 盘那一份仍然可用：' + localPath);
  }
}

log('完成。本地安装包：' + localPath);
log('产物格式：' + artifact.fmt + '（单个文件）');
if (releasePage) log('GitHub Release：' + releasePage);
log('提示：便携版 zip 解压后直接运行目录中的 ' + EXE_NAME + ' 即可。');

