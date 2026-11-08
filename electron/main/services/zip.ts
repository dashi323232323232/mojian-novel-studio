/**
 * 极简 ZIP 容器编解码（纯函数，无 Electron / 无第三方依赖，可单测）。
 *
 * 写入：
 * - 只使用 store 模式（压缩方法 0），文件名 UTF-8，并设置通用位标记 bit 11 (0x0800)；
 * - 每个条目写出「本地文件头 + 数据」，末尾按序写出中央目录与 EOCD；
 * - 字段按 ZIP APPNOTE 规范使用小端序，兼容 Windows 资源管理器、7-Zip、macOS 归档工具等。
 *
 * 读取：
 * - 以中央目录为准（支持带 data descriptor 的条目，即 bit 3）；
 * - 支持 method 0 (store) 与 8 (deflate, zlib.inflateRawSync)；
 * - 跳过目录项与 __MACOSX 元数据；
 * - 拒绝路径穿越（..、绝对路径、盘符、反斜杠形式的 ..）；
 * - 单文件解压上限 64MB、总条目上限 2000，抵御 zip 炸弹；
 * - 校验 CRC32，损坏或截断的压缩包抛 Error，绝不静默返回空数组。
 */

import { inflateRawSync } from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_DATA_DESCRIPTOR = 0x08074b50;

const FLAG_DATA_DESCRIPTOR = 0x0008; // bit 3
const FLAG_UTF8 = 0x0800; // bit 11

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const MAX_ENTRIES = 2000;
const MAX_UNCOMPRESSED = 64 * 1024 * 1024; // 单文件 64MB
const MAX_EOCD_COMMENT = 0xffff; // 注释字段是 16 位无符号数

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/* ------------------------------ CRC32 ------------------------------ */

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** 标准 CRC-32 (IEEE 802.3)，与 zlib.crc32 / 各系统解压工具一致。 */
export function crc32(buffer: Buffer): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------ 写入 ------------------------------ */

/** 外部传入的名字一律按 ZIP 规范规范化为 '/' 分隔，避免反斜杠被各工具解释为不同语义。 */
function normalizeEntryName(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('ZIP 条目名不能为空');
  }
  const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.length === 0) throw new Error('ZIP 条目名不能为空');
  return normalized;
}

/**
 * 打包为 ZIP（store 模式）。
 * 生成的包不含目录项、不含 data descriptor，可被 Windows 资源管理器 / 7-Zip / unzip 直接打开。
 */
export function createZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  if (!Array.isArray(entries)) throw new Error('entries 必须是数组');
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIP 条目数量超过上限 (${MAX_ENTRIES})`);
  }

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const raw of entries) {
    const name = normalizeEntryName(raw.name);
    const data: Buffer = Buffer.isBuffer(raw.data) ? raw.data : Buffer.from(raw.data);
    if (data.length > 0xffffffff) throw new Error('ZIP 条目数据过大 (>4GB)');
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length > 0xffff) throw new Error('ZIP 条目名过长 (>65535 字节)');
    const crc = crc32(data);
    const flags = FLAG_UTF8;

    // DOS 日期/时间用固定有效值（1980-01-01 00:00:00），避免 1980-00-00 被部分工具判为非法。
    const dosTime = 0; // 00:00:00
    const dosDate = 0x0021; // 1980-01-01

    // 本地文件头：30 字节固定部分 + 文件名 + 数据
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(dosTime, 10); // last mod time
    local.writeUInt16LE(dosDate, 12); // last mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    nameBuf.copy(local, 30);

    locals.push(local, data);

    // 中央目录头：46 字节固定部分 + 文件名
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(central, 46);

    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const centralOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ------------------------------ 读取 ------------------------------ */

function readU16(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off);
}
function readU32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off);
}

/** 定位 EOCD：优先取文件末尾，随后在最大注释长度范围内向后搜索签名。 */
function findEocd(buffer: Buffer): number {
  const min = 22;
  if (buffer.length < min) throw new Error('ZIP 数据过短或已截断');
  const lastPossible = buffer.length - min;
  const scanStart = Math.max(0, lastPossible - MAX_EOCD_COMMENT);
  for (let i = lastPossible; i >= scanStart; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      const commentLen = readU16(buffer, i + 20);
      // 注释必须正好延伸到文件末尾，避免误匹配数据里的巧合字节
      if (i + 22 + commentLen === buffer.length) return i;
    }
  }
  throw new Error('未找到 ZIP 结束记录 (EOCD)，压缩包损坏或已截断');
}

/**
 * 路径安全校验：拒绝绝对路径、盘符、含 '..' 段（含反斜杠形式）以及 UNC 路径。
 * 返回规范化（'/' 分隔、无前导斜杠）的名称。
 */
export function safeZipName(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('ZIP 条目名无效');
  }
  const unified = raw.replace(/\\/g, '/');
  // 绝对路径、盘符 (C:)、UNC (//server)、反斜杠 UNC (\\server)
  if (unified.startsWith('/') || raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:/.test(unified)) {
    throw new Error(`ZIP 条目路径不合法（绝对路径）：${raw}`);
  }
  const segments = unified.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new Error(`ZIP 条目路径不合法（路径穿越）：${raw}`);
    }
  }
  return unified.replace(/^\/+/, '');
}

function decodeName(bytes: Buffer, flags: number): string {
  if ((flags & FLAG_UTF8) !== 0) return bytes.toString('utf8');
  // 未设置 UTF-8 位时按 CP437 解码（ZIP 历史默认）。用显式映射覆盖高位字符。
  return cp437Decode(bytes);
}

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀' +
  'ÓßÔÒõÕµþÞÚÛÙýÝ¯´≡±‗¾¶§÷¸°¨·¹³²■ ';

function cp437Decode(bytes: Buffer): string {
  let out = '';
  for (const b of bytes) {
    if (b < 0x80) out += String.fromCharCode(b);
    else out += CP437_HIGH[b - 0x80] ?? String.fromCharCode(b);
  }
  return out;
}

/**
 * 读取 ZIP，返回文件条目（已解压）。目录项、__MACOSX 元数据被跳过。
 * 任何结构损坏、CRC 不符、超限或加密/不支持的压缩方法都会抛 Error。
 */
export function readZip(buffer: Buffer): Array<{ name: string; data: Buffer }> {
  if (!Buffer.isBuffer(buffer)) throw new Error('readZip 需要 Buffer');
  const eocd = findEocd(buffer);
  const totalEntries = readU16(buffer, eocd + 10);
  if (totalEntries > MAX_ENTRIES) {
    throw new Error(`ZIP 条目数量超过上限 (${MAX_ENTRIES})`);
  }
  let centralSize = readU32(buffer, eocd + 12);
  let centralOffset = readU32(buffer, eocd + 16);

  // ZIP64 占位值：本实现只处理普通 32 位 ZIP，明确拒绝而不是误读。
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('不支持 ZIP64 压缩包，或中央目录信息已损坏');
  }

  // 兼容「前面有自解压前缀 / 拼接数据」的偏移量修正（常见于部分工具生成的包）。
  const expectedEocd = centralOffset + centralSize;
  if (expectedEocd !== eocd && centralOffset + centralSize <= eocd) {
    const delta = eocd - expectedEocd;
    centralOffset += delta;
  }

  if (centralOffset < 0 || centralOffset + centralSize > buffer.length) {
    throw new Error('ZIP 中央目录越界，压缩包已损坏');
  }

  const out: Array<{ name: string; data: Buffer }> = [];
  let cursor = centralOffset;
  let count = 0;

  while (count < totalEntries) {
    if (cursor + 46 > buffer.length) throw new Error('ZIP 中央目录被截断');
    if (readU32(buffer, cursor) !== SIG_CENTRAL) {
      throw new Error('ZIP 中央目录条目签名无效');
    }
    const flags = readU16(buffer, cursor + 8);
    const method = readU16(buffer, cursor + 10);
    const crc = readU32(buffer, cursor + 16);
    const compressedSize = readU32(buffer, cursor + 20);
    const uncompressedSize = readU32(buffer, cursor + 24);
    const nameLen = readU16(buffer, cursor + 28);
    const extraLen = readU16(buffer, cursor + 30);
    const commentLen = readU16(buffer, cursor + 32);
    const localOffset = readU32(buffer, cursor + 42);

    const headerEnd = cursor + 46;
    if (headerEnd + nameLen + extraLen + commentLen > buffer.length) {
      throw new Error('ZIP 中央目录条目被截断');
    }
    const nameRaw = buffer.subarray(headerEnd, headerEnd + nameLen);
    const rawName = decodeName(nameRaw, flags);
    cursor = headerEnd + nameLen + extraLen + commentLen;
    count += 1;

    // 加密条目无法解压，直接拒绝。
    if ((flags & 0x0001) !== 0) throw new Error(`ZIP 条目被加密，无法读取：${rawName}`);
    // 修补标志位（bit 13）表示数据经过特殊处理，本实现不支持。
    if ((flags & 0x2000) !== 0) throw new Error(`不支持的 ZIP 修补条目：${rawName}`);

    // 目录项与 macOS 元数据在安全校验前跳过（它们不是要落盘的文件）。
    const isDirectory = rawName.endsWith('/') || rawName.endsWith('\\');
    if (isDirectory) continue;
    const unifiedForSkip = rawName.replace(/\\/g, '/');
    if (unifiedForSkip.startsWith('__MACOSX/') || unifiedForSkip.includes('/__MACOSX/')) continue;

    const name = safeZipName(rawName); // 路径穿越 / 绝对路径在此抛错

    if (uncompressedSize > MAX_UNCOMPRESSED || compressedSize > MAX_UNCOMPRESSED * 2 + 4096) {
      throw new Error(`ZIP 条目解压后超过 64MB 上限：${name}`);
    }
    if (localOffset + 30 > buffer.length) throw new Error(`ZIP 本地文件头越界：${name}`);
    if (readU32(buffer, localOffset) !== SIG_LOCAL) {
      throw new Error(`ZIP 本地文件头签名无效：${name}`);
    }
    const localNameLen = readU16(buffer, localOffset + 26);
    const localExtraLen = readU16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart < 0 || dataStart + compressedSize > buffer.length) {
      throw new Error(`ZIP 条目数据越界或已截断：${name}`);
    }
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === METHOD_STORE) {
      data = Buffer.from(compressed);
    } else if (method === METHOD_DEFLATE) {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED + 1 });
      } catch (err) {
        throw new Error(`ZIP 条目解压失败：${name} (${(err as Error).message})`);
      }
      if (data.length > MAX_UNCOMPRESSED) {
        throw new Error(`ZIP 条目解压后超过 64MB 上限：${name}`);
      }
    } else {
      throw new Error(`不支持的 ZIP 压缩方法 ${method}：${name}`);
    }

    if (data.length !== uncompressedSize) {
      throw new Error(`ZIP 条目大小不匹配：${name}`);
    }
    if ((crc32(data) >>> 0) !== (crc >>> 0)) {
      throw new Error(`ZIP 条目 CRC 校验失败：${name}`);
    }

    out.push({ name, data });
    if (out.length > MAX_ENTRIES) {
      throw new Error(`ZIP 文件条目数量超过上限 (${MAX_ENTRIES})`);
    }
  }

  return out;
}
