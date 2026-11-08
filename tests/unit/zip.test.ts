import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { createZip, readZip, crc32, safeZipName } from '../../electron/main/services/zip';

/** 读取 createZip 产物中某条目的本地头 CRC 字段偏移，用于构造 CRC 损坏样本。 */
function corruptCrc(zip: Buffer, entryIndex: number): Buffer {
  const out = Buffer.from(zip);
  let off = 0;
  for (let i = 0; i <= entryIndex; i += 1) {
    if (out.readUInt32LE(off) !== 0x04034b50) throw new Error('本地头定位失败');
    const nameLen = out.readUInt16LE(off + 26);
    const extraLen = out.readUInt16LE(off + 28);
    const compressedSize = out.readUInt32LE(off + 18);
    if (i === entryIndex) {
      out.writeUInt32LE(0xdeadbeef, off + 14); // 篡改本地头 CRC
      // 同步篡改中央目录对应条目的 CRC（保持一致，确保触发的是「数据 CRC 不符」）
      const eocd = out.length - 22;
      const centralOffset = out.readUInt32LE(eocd + 16);
      let c = centralOffset;
      for (let k = 0; k < entryIndex; k += 1) {
        c += 46 + out.readUInt16LE(c + 28) + out.readUInt16LE(c + 30) + out.readUInt16LE(c + 32);
      }
      out.writeUInt32LE(0xdeadbeef, c + 16);
      return out;
    }
    off += 30 + nameLen + extraLen + compressedSize;
  }
  throw new Error('未找到目标条目');
}

/** 手工构造一个 method 8 (deflate) 且带 data descriptor (bit 3) 的 zip。 */
function makeDeflateZipWithDescriptor(name: string, plain: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const compressed = deflateRawSync(plain);
  const crc = crc32(plain) >>> 0;
  const flags = 0x0008 | 0x0800; // data descriptor + UTF-8

  // 本地头：size/CRC 字段填 0，真实值稍后放在 data descriptor 里。
  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(0, 18);
  local.writeUInt32LE(0, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  nameBuf.copy(local, 30);

  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(compressed.length, 8);
  descriptor.writeUInt32LE(plain.length, 12);

  // 中央目录记录真实大小（readZip 必须以此为准，不能依赖本地头）。
  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(plain.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  nameBuf.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + compressed.length + descriptor.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, compressed, descriptor, central, eocd]);
}

/** 手工构造一个含指定条目名的 zip（用于路径穿越 / 目录项 / __MACOSX 测试）。 */
function makeStoreZip(name: string, data: Buffer): Buffer {
  return createZip([{ name, data }]);
}

/** 手工构造 store 模式 zip，条目名原样写入（不经过 createZip 规范化），用于模拟外部恶意 zip。 */
function makeRawStoreZip(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const flags = 0x0800;
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(local, 30);
  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  nameBuf.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, eocd]);
}

describe('zip：写入与往返', () => {
  test('中文文件名往返', () => {
    const zip = createZip([{ name: '项目/第一章.txt', data: Buffer.from('你好，世界！', 'utf8') }]);
    const entries = readZip(zip);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, '项目/第一章.txt');
    assert.equal(entries[0].data.toString('utf8'), '你好，世界！');
  });

  test('二进制内容往返（含 0x00 / 0xff）', () => {
    const bytes = Buffer.from([0, 1, 2, 3, 0xff, 0xfe, 0x7f, 0x80, 0x0a, 0x0d, 0x00]);
    const zip = createZip([{ name: 'bin.dat', data: bytes }]);
    const entries = readZip(zip);
    assert.deepEqual(entries[0].data, bytes);
  });

  test('多条目往返且顺序与内容一致', () => {
    const input = [
      { name: 'a.txt', data: Buffer.from('AAA') },
      { name: '目录/b.txt', data: Buffer.from('中文 BBB') },
      { name: 'c.json', data: Buffer.from('{"k":1}') },
    ];
    const zip = createZip(input);
    const entries = readZip(zip);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((e) => e.name), ['a.txt', '目录/b.txt', 'c.json']);
    for (let i = 0; i < input.length; i += 1) {
      assert.deepEqual(entries[i].data, input[i].data);
    }
  });

  test('空 zip 返回空数组', () => {
    const zip = createZip([]);
    assert.equal(readZip(zip).length, 0);
    // EOCD 仍存在，是一个合法空压缩包
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  });

  test('createZip 输出设置 UTF-8 位 (bit 11) 与 store 方法', () => {
    const zip = createZip([{ name: 'x.txt', data: Buffer.from('x') }]);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
    assert.equal(zip.readUInt16LE(8), 0); // method = store
  });

  test('crc32 与已知常量一致', () => {
    assert.equal(crc32(Buffer.from('123456789')) >>> 0, 0xcbf43926);
    assert.equal(crc32(Buffer.alloc(0)) >>> 0, 0);
  });
});

describe('zip：读取外部 zip', () => {
  test('deflate 条目（method 8）可解，且支持 data descriptor', () => {
    const plain = Buffer.from('这是一段需要被 deflate 压缩的中文文本，重复重复重复重复。', 'utf8');
    const zip = makeDeflateZipWithDescriptor('压缩/正文.txt', plain);
    const entries = readZip(zip);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, '压缩/正文.txt');
    assert.deepEqual(entries[0].data, plain);
  });

  test('跳过目录项与 __MACOSX 元数据', () => {
    const zip = createZip([
      { name: 'folder/', data: Buffer.alloc(0) },
      { name: '__MACOSX/._folder', data: Buffer.from('junk') },
      { name: 'folder/real.txt', data: Buffer.from('real') },
    ]);
    const entries = readZip(zip);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'folder/real.txt');
    assert.equal(entries[0].data.toString(), 'real');
  });
});

describe('zip：安全与损坏', () => {
  test('路径穿越（含 ..）被拒绝', () => {
    const zip = makeStoreZip('../evil.txt', Buffer.from('x'));
    assert.throws(() => readZip(zip), /路径穿越|不合法/);
  });

  test('反斜杠形式的 .. 被拒绝', () => {
    const zip = makeStoreZip('dir\\..\\evil.txt', Buffer.from('x'));
    assert.throws(() => readZip(zip), /路径穿越|不合法/);
  });

  test('绝对路径与盘符被拒绝', () => {
    assert.throws(() => readZip(makeRawStoreZip('/etc/passwd', Buffer.from('x'))), /绝对路径/);
    assert.throws(() => readZip(makeRawStoreZip('C:/Windows/win.ini', Buffer.from('x'))), /绝对路径/);
    assert.throws(() => safeZipName('/root/x'), /绝对路径/);
    assert.throws(() => safeZipName('D:\\evil'), /绝对路径/);
  });

  test('CRC 错误被拒绝', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('hello world') }]);
    assert.throws(() => readZip(corruptCrc(zip, 0)), /CRC/);
  });

  test('截断的 zip 抛错，不静默返回空数组', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    assert.throws(() => readZip(zip.subarray(0, zip.length - 1)), /损坏|截断|EOCD/);
    assert.throws(() => readZip(Buffer.from('not a zip at all')), /过短|EOCD|损坏/);
    assert.throws(() => readZip(Buffer.alloc(0)), /过短/);
  });

  test('中央目录损坏抛错', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    const broken = Buffer.from(zip);
    const eocd = broken.length - 22;
    broken.writeUInt32LE(0xffffffff, eocd + 16); // 中央目录偏移越界
    assert.throws(() => readZip(broken), /越界|损坏|截断|ZIP64/);
  });
});
