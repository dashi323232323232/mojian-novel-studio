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

const APP_DIR = path.join(root, 'dist-packaged', 'DashiNovelStudio-win32-x64');
const EXE_NAME = '大师小说工作台.exe';
const EXE_PATH = path.join(APP_DIR, EXE_NAME);
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
if (!fs.existsSync(EXE_PATH)) {
  fail('打包失败', '未找到 ' + EXE_PATH + '，请先运行 npm run package');
  process.exit(1);
}
log('已找到可执行程序：' + EXE_PATH);

// os.tmpdir() 依赖 TEMP/TMP 环境变量；极端环境下可能不可用，退回项目内临时目录。
function tempBase() {
  const base = os.tmpdir();
  try { fs.mkdirSync(base, { recursive: true }); return base; } catch { /* 下面兜底 */ }
  const fallback = path.join(root, '.cache', 'installer-tmp');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}
const workDir = fs.mkdtempSync(path.join(tempBase(), 'dashi-installer-'));
log('临时工作目录：' + workDir);

// ---------------------------------------------------------------------------
// 1. 最小 zip 容器编码（零外部依赖，仅用 node:zlib）
//    保留 dist-packaged/DashiNovelStudio-win32-x64/ 的完整目录结构：
//    解压后得到同名目录，直接运行里面的 exe 即可，属于便携安装包。
//    每个文件逐个尝试 deflate（method 8），压不动就 store（method 0）。
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c | 0;
  }
  return t;
})();

function crc32Buf(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0);
}

function dosDateTime(mtimeMs) {
  const d = new Date(mtimeMs);
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}

function listFilesRecursive(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    const arc = base ? base + '/' + name : name;
    if (st.isDirectory()) listFilesRecursive(full, arc, out);
    else out.push({ full, arc, mode: st.mode, mtimeMs: st.mtimeMs });
  }
}

function createZip(srcDir, outFile) {
  const entries = [];
  // 顶层包一层目录名：解压后得到独立的 DashiNovelStudio-win32-x64 文件夹，
  // 不会把 exe、resources 等散落到用户目录里。
  const topDir = path.basename(srcDir);
  listFilesRecursive(srcDir, topDir, entries);
  const parts = [];
  const centralParts = [];
  let offset = 0;
  let count = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.arc, 'utf8');
    const raw = fs.readFileSync(e.full);
    const def = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = def.length < raw.length;
    const data = useDeflate ? def : raw;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosDateTime(e.mtimeMs);
    const crc = crc32Buf(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);   // UTF-8 文件名标志，保证中文名可解压
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);   // 压缩后大小
    local.writeUInt32LE(raw.length, 22);    // 原始大小
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4);       // made by: UNIX / zip 2.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);           // extra len
    cd.writeUInt16LE(0, 32);           // comment len
    cd.writeUInt16LE(0, 34);           // disk start
    cd.writeUInt16LE(0, 36);           // internal attrs
    cd.writeUInt32LE(((e.mode & 0o777) || 0o644) << 16, 38);
    cd.writeUInt32LE(offset, 42);
    centralParts.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
    count++;
    if (count % 200 === 0) log('  已写入 ' + count + ' / ' + entries.length + ' 个文件…');
  }
  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  fs.writeFileSync(outFile, Buffer.concat([...parts, centralBuf, end]));
  return { count, size: fs.statSync(outFile).size };
}

// ---------------------------------------------------------------------------
// 2. 生成单个安装包：先试 iexpress，失败自动回退到 zip
// ---------------------------------------------------------------------------
function tryIExpress() {
  const iexpress = 'C:/Windows/System32/iexpress.exe';
  if (process.platform !== 'win32' || !fs.existsSync(iexpress)) {
    warn('未找到 iexpress.exe（或非 Windows 环境），跳过自解压 exe，直接回退 zip 便携版');
    return null;
  }
  const exeName = '大师小说工作台-' + version + '-win64-安装版.exe';
  const sedPath = path.join(workDir, 'setup.sed');
  const target = path.join(workDir, exeName);
  const stageDir = path.join(workDir, 'stage');
  try {
    fs.mkdirSync(stageDir, { recursive: true });
    // 复制到纯 ASCII 的临时 stage，尽量规避中文路径 / 长文件名问题。
    fs.cpSync(APP_DIR, stageDir, { recursive: true });
    const lines = [
      '[Version]',
      'Class=IEXPRESS',
      'SEDVersion=3',
      '[Options]',
      'PackagePurpose=InstallApp',
      'ShowInstallProgramWindow=0',
      'HideExtractAnimation=1',
      'UseLongFileName=1',
      'InsideCompressed=0',
      'CAB_FixedSize=0',
      'CAB_ResvCodeSigning=0',
      'RebootMode=N',
      'InstallPrompt=正在安装 大师小说工作台，请稍候',
      'DisplayLicense=',
      'FinishMessage=解压完成，请运行目录中的 大师小说工作台.exe',
      'TargetName=' + target,
      'FriendlyTitle=大师小说工作台 ' + version + ' 安装',
      'AppLaunched=cmd.exe /c echo 安装完成',
      'PostInstallCmd=<None>',
      'AdminQuietInstCmd=',
      'UserQuietInstCmd=',
      'SourceFiles=SourceFiles',
      '[Strings]',
      'InstallPrompt=正在安装 大师小说工作台，请稍候',
      'FinishMessage=解压完成，请运行目录中的 大师小说工作台.exe',
      'FriendlyTitle=大师小说工作台 ' + version + ' 安装',
      'AppLaunched=cmd.exe /c echo 安装完成',
      '[SourceFiles]',
      'SourceFiles0=' + stageDir,
      '[SourceFiles0]',
    ];
    for (const f of fs.readdirSync(stageDir)) lines.push('%SourceFiles0%' + path.sep + f + '=');
    fs.writeFileSync(sedPath, lines.join('\r\n') + '\r\n', 'utf8');
    log('尝试方式 A：调用 iexpress.exe /N /Q 生成自解压 exe…');
    execFileSync(iexpress, ['/N', '/Q', sedPath], { stdio: 'ignore', timeout: 5 * 60 * 1000 });
  } catch (e) {
    warn('iexpress 生成失败（大文件 / 长文件名 / 中文路径常见）：' + (e && e.message ? e.message : String(e)));
    return null;
  }
  if (!fs.existsSync(target) || fs.statSync(target).size < 1024 * 1024) {
    warn('iexpress 未产出有效 exe，回退到 zip 便携版');
    return null;
  }
  log('iexpress 成功，安装包：' + target);
  return { file: target, name: exeName, fmt: '自解压 EXE（iexpress）' };
}

function buildZip() {
  const name = '大师小说工作台-' + version + '-win64-便携版.zip';
  const out = path.join(workDir, name);
  log('方式 B：用内置 zip 编码把整个程序目录打成单个 zip（保留目录结构）…');
  const info = createZip(APP_DIR, out);
  log('zip 完成：' + info.count + ' 个文件，' + (info.size / 1024 / 1024).toFixed(1) + ' MB');
  return { file: out, name, fmt: '便携版 ZIP' };
}

let artifact = null;
try {
  artifact = tryIExpress();
  if (!artifact) {
    log('自动回退到 zip 便携版（单个文件，解压后直接运行 exe）。');
    artifact = buildZip();
  }
  if (!fs.existsSync(artifact.file) || fs.statSync(artifact.file).size === 0) {
    throw new Error('生成的安装包为空');
  }
} catch (e) {
  fail('打包失败', (e && e.message ? e.message : String(e)));
  process.exit(1);
}
log('最终安装包：' + artifact.name + '（' + artifact.fmt + '，单个文件）');

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
  const uploadName = 'DashiNovelStudio-' + version + '-win64-portable' + path.extname(assetName);
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

