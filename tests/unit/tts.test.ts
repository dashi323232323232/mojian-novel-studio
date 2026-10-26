import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SapiTtsProvider, readWavDuration } from '../../electron/main/adapters/tts';

describe('Windows SAPI 语音适配器', () => {
  const provider = new SapiTtsProvider();

  test('能列出系统已安装的中文声音', async () => {
    const voices = await provider.listVoices();
    assert.ok(voices.length > 0, '系统应至少有一个 SAPI 声音');
    assert.ok(voices.every((v) => v.provider === 'sapi'));
    assert.ok(voices.some((v) => v.locale.startsWith('zh')), '应包含中文声音');
  });

  test('能真实合成 WAV 文件并可解析时长', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojian-tts-'));
    const out = path.join(dir, 'sample.wav');
    const voices = await provider.listVoices();
    const zh = voices.find((v) => v.locale.startsWith('zh')) ?? voices[0];
    const progress: number[] = [];
    const result = await provider.synthesize({
      text: '墨笺小说工作台，语音合成测试。',
      voiceId: zh.id,
      rate: 0,
      volume: 100,
      outputPath: out,
      onProgress: (p) => progress.push(p),
    });
    assert.ok(fs.existsSync(out));
    const size = fs.statSync(out).size;
    assert.ok(size > 1000, `音频文件应大于 1KB，实际 ${size}`);
    assert.equal(result.format, 'wav');
    assert.ok(result.durationMs > 0, '应能解析出时长');
    assert.ok(progress.length > 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('无效声音回退到默认声音仍能生成', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojian-tts2-'));
    const out = path.join(dir, 'fallback.wav');
    const result = await provider.synthesize({
      text: '回退测试。',
      voiceId: '不存在的语音',
      rate: 0,
      volume: 100,
      outputPath: out,
    });
    assert.ok(fs.existsSync(out));
    assert.ok(result.durationMs >= 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
