import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Voice } from '@shared/types';
import { NovelError, internalError } from '../errors';

export interface SynthRequest {
  text: string;
  voiceId: string;
  rate: number; // -10..10
  volume: number; // 0..100
  outputPath: string;
  onProgress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
}

export interface SynthResult {
  filePath: string;
  durationMs: number;
  format: string;
}

export interface TtsProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): Promise<boolean>;
  listVoices(): Promise<Voice[]>;
  synthesize(request: SynthRequest): Promise<SynthResult>;
}

function runPowerShell(scriptPath: string, args: string[], timeoutMs = 180000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new NovelError('PROVIDER_ERROR', '语音合成超时（180 秒），请缩短章节或降低语速后重试。', 504));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(internalError(`无法启动系统语音引擎：${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new NovelError(
            'PROVIDER_ERROR',
            `系统语音合成失败（退出码 ${code}）：${(stderr || stdout).slice(-600) || '未知错误'}`,
            502,
          ),
        );
    });
  });
}

const SAPI_LIST_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @()
foreach ($v in $s.GetInstalledVoices()) {
  if ($v.Enabled) {
    $voices += [pscustomobject]@{
      name = $v.VoiceInfo.Name
      culture = $v.VoiceInfo.Culture.Name
      gender = $v.VoiceInfo.Gender.ToString()
      description = $v.VoiceInfo.Description
    }
  }
}
$voices | ConvertTo-Json -Compress
`;

const SAPI_SYNTH_SCRIPT = `
param([string]$TextFile, [string]$OutFile, [string]$VoiceName, [int]$Rate, [int]$Volume)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($VoiceName) {
    $match = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -eq $VoiceName } | Select-Object -First 1
    if ($match) { $s.SelectVoice($match.VoiceInfo.Name) }
  }
  $s.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
  $s.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile($OutFile, $format)
  $s.Speak($text)
  $s.SetOutputToNull()
  Write-Output "OK"
} finally {
  $s.Dispose()
}
`;

function writeTempScript(content: string): string {
  const dir = path.join(process.env.TEMP || process.env.TMP || '.', 'dashi-tts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `synth-${process.pid}-${Date.now()}.ps1`);
  // PowerShell 5 读取带 BOM 的 UTF-8 才稳定识别中文；脚本本身只含 ASCII 参数名。
  fs.writeFileSync(file, '\ufeff' + content, 'utf8');
  return file;
}

/** Windows 本地 SAPI 适配器：离线、免费，适合作为默认可用方案。 */
export class SapiTtsProvider implements TtsProvider {
  readonly id = 'sapi';
  readonly label = 'Windows 本地语音（SAPI）';

  async isConfigured(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    const voices = await this.listVoices().catch(() => []);
    return voices.length > 0;
  }

  async listVoices(): Promise<Voice[]> {
    if (process.platform !== 'win32') return [];
    const script = writeTempScript(SAPI_LIST_SCRIPT);
    try {
      const { stdout } = await runPowerShell(script, [], 30000);
      const trimmed = stdout.trim();
      if (!trimmed) return [];
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((v: { name: string; culture: string; gender?: string; description?: string }) => ({
        id: v.name,
        name: v.name,
        locale: v.culture || 'unknown',
        gender: v.gender,
        provider: 'sapi',
        description: v.description,
      }));
    } catch {
      return [];
    } finally {
      fs.rmSync(script, { force: true });
    }
  }

  async synthesize(req: SynthRequest): Promise<SynthResult> {
    if (process.platform !== 'win32') {
      throw new NovelError('PROVIDER_NOT_CONFIGURED', '当前系统不支持 Windows 本地语音，请配置在线语音服务。', 400);
    }
    fs.mkdirSync(path.dirname(req.outputPath), { recursive: true });
    const dir = path.join(process.env.TEMP || '.', 'dashi-tts');
    fs.mkdirSync(dir, { recursive: true });
    const textFile = path.join(dir, `text-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(textFile, req.text, 'utf8');
    const script = writeTempScript(SAPI_SYNTH_SCRIPT);
    try {
      req.onProgress?.(0.15, '正在调用本地语音引擎');
      await runPowerShell(script, [
        textFile,
        req.outputPath,
        req.voiceId,
        String(Math.round(req.rate)),
        String(Math.round(req.volume)),
      ]);
      req.onProgress?.(0.9, '正在整理音频文件');
      const durationMs = readWavDuration(req.outputPath);
      return { filePath: req.outputPath, durationMs, format: 'wav' };
    } finally {
      fs.rmSync(textFile, { force: true });
      fs.rmSync(script, { force: true });
    }
  }
}

export function readWavDuration(filePath: string): number {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(44);
    fs.readSync(fd, buffer, 0, 44, 0);
    fs.closeSync(fd);
    if (buffer.toString('ascii', 0, 4) !== 'RIFF') return 0;
    const byteRate = buffer.readUInt32LE(28);
    // 找到 data chunk
    const size = fs.statSync(filePath).size;
    let offset = 12;
    const fd2 = fs.openSync(filePath, 'r');
    try {
      while (offset < size - 8) {
        const header = Buffer.alloc(8);
        fs.readSync(fd2, header, 0, 8, offset);
        const id = header.toString('ascii', 0, 4);
        const chunkSize = header.readUInt32LE(4);
        if (id === 'data') {
          return byteRate > 0 ? Math.round((chunkSize / byteRate) * 1000) : 0;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
      }
    } finally {
      fs.closeSync(fd2);
    }
  } catch {
    /* 忽略解析失败 */
  }
  return 0;
}

export interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

/** OpenAI 兼容的在线语音适配器：可指向任何兼容 /audio/speech 的服务。 */
export class OpenAiTtsProvider implements TtsProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI 兼容在线语音';
  constructor(private getConfig: () => OpenAiConfig) {}

  async isConfigured(): Promise<boolean> {
    const cfg = this.getConfig();
    return Boolean(cfg.apiKey && cfg.baseUrl && cfg.model);
  }

  async listVoices(): Promise<Voice[]> {
    const cfg = this.getConfig();
    const names = cfg.voice ? [cfg.voice, 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] : ['alloy'];
    return Array.from(new Set(names)).map((name) => ({
      id: name,
      name: `在线音色 ${name}`,
      locale: 'multi',
      provider: 'openai',
      description: `模型 ${cfg.model}`,
    }));
  }

  async synthesize(req: SynthRequest): Promise<SynthResult> {
    const cfg = this.getConfig();
    if (!cfg.apiKey) {
      throw new NovelError(
        'PROVIDER_NOT_CONFIGURED',
        '尚未配置在线语音服务的 API 密钥。请到「音频制作 → 服务设置」填写密钥，或改用 Windows 本地语音。',
        400,
      );
    }
    if (!cfg.baseUrl) throw new NovelError('PROVIDER_NOT_CONFIGURED', '在线语音服务地址未配置。', 400);
    const url = `${cfg.baseUrl.replace(/\/+$/, '')}/audio/speech`;
    req.onProgress?.(0.1, '正在提交在线语音合成请求');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.model,
          voice: req.voiceId || cfg.voice,
          input: req.text,
          speed: Math.max(0.5, Math.min(2, 1 + req.rate / 20)),
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new NovelError(
          'PROVIDER_ERROR',
          `在线语音服务返回错误 ${res.status}：${body.slice(0, 400) || res.statusText}`,
          502,
          { status: res.status },
        );
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) throw new NovelError('PROVIDER_ERROR', '在线语音服务返回了空音频。', 502);
      fs.mkdirSync(path.dirname(req.outputPath), { recursive: true });
      fs.writeFileSync(req.outputPath, buffer);
      req.onProgress?.(0.9, '音频下载完成');
      return { filePath: req.outputPath, durationMs: estimateMp3Duration(buffer), format: 'mp3' };
    } catch (err) {
      if (err instanceof NovelError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('aborted')) {
        throw new NovelError('PROVIDER_ERROR', '在线语音服务超时，请稍后重试。', 504);
      }
      throw new NovelError('PROVIDER_ERROR', `在线语音合成失败：${message}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 粗略估算 MP3 时长（用于显示，不影响播放）。 */
export function estimateMp3Duration(buffer: Buffer): number {
  // 若无 ID3，按 128kbps 估算；仅用于 UI 展示。
  let offset = 0;
  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    offset = 10 + size;
  }
  const bitrate = 128000;
  return Math.round(((buffer.length - offset) * 8 * 1000) / bitrate);
}
