
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Voice } from '@shared/types';
import { NovelError } from '../errors';
import type { SynthRequest, SynthResult, TtsProvider } from './tts';
import { readWavDuration } from './tts';

/** 克隆音色包里的元信息（由软件外的训练工具导出）。 */
export interface ClonedVoiceMeta {
  id: string;
  name: string;
  locale?: string;
  gender?: string;
  description?: string;
  sampleRate?: number;
  backend?: string;
  createdAt?: string;
}

/** 单个克隆音色的目录结构（训练工具导出的约定）。 */
interface ClonedVoiceEntry {
  dir: string;
  meta: ClonedVoiceMeta;
  gptPath: string | null;
  sovitsPath: string | null;
  referencePath: string | null;
  referenceText: string;
  available: boolean;
  missingReason: string;
}

/**
 * 本地克隆音色适配器。
 *
 * 音色包放在 <dataDir>/voices/<音色名>/ 下，结构由软件外的训练工具产出：
 *   voice.json / gpt.ckpt / sovits.pth / reference.wav / reference.txt
 *
 * 推理通过调用本机的 Python（GPT-SoVITS）完成。找不到 Python 或 GPT-SoVITS 时，
 * 适配器仍然会把音色列出来并标记为不可用，而不是静默消失——这样用户能明白
 * 是「没训练好」还是「没装推理环境」。
 */
export class ClonedVoiceTtsProvider implements TtsProvider {
  readonly id = 'cloned';
  readonly label = '本地克隆音色';

  constructor(
    private getVoicesDir: () => string,
    private getInferScript: () => string,
    private getPythonPath: () => string,
  ) {}

  private listEntries(): ClonedVoiceEntry[] {
    const dir = this.getVoicesDir();
    if (!fs.existsSync(dir)) return [];
    const out: ClonedVoiceEntry[] = [];
    for (const name of fs.readdirSync(dir)) {
      const voiceDir = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(voiceDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let meta: ClonedVoiceMeta = { id: name, name };
      const metaFile = path.join(voiceDir, 'voice.json');
      if (fs.existsSync(metaFile)) {
        try {
          meta = { ...meta, ...(JSON.parse(fs.readFileSync(metaFile, 'utf8')) as ClonedVoiceMeta) };
        } catch {
          /* 元信息损坏时用目录名兜底 */
        }
      }

      const gptPath = existsAny(voiceDir, ['gpt.ckpt', '*.ckpt']);
      const sovitsPath = existsAny(voiceDir, ['sovits.pth', '*.pth']);
      const referencePath = existsAny(voiceDir, ['reference.wav', 'ref.wav', '*.wav']);
      const textFile = existsAny(voiceDir, ['reference.txt', 'ref.txt']);
      const referenceText = textFile ? fs.readFileSync(textFile, 'utf8').trim() : '';

      let missingReason = '';
      if (!gptPath) missingReason = '缺少 gpt.ckpt';
      else if (!sovitsPath) missingReason = '缺少 sovits.pth';
      else if (!referencePath) missingReason = '缺少 reference.wav';
      else if (!referenceText) missingReason = '缺少 reference.txt（参考音频的文字）';

      out.push({
        dir: voiceDir,
        meta,
        gptPath,
        sovitsPath,
        referencePath,
        referenceText,
        available: !missingReason,
        missingReason,
      });
    }
    return out;
  }

  async isConfigured(): Promise<boolean> {
    return this.listEntries().length > 0;
  }

  async listVoices(): Promise<Voice[]> {
    return this.listEntries().map((entry) => ({
      id: entry.meta.id || path.basename(entry.dir),
      name: entry.meta.name || path.basename(entry.dir),
      locale: entry.meta.locale || 'zh-CN',
      gender: entry.meta.gender,
      provider: this.id,
      description: entry.available
        ? entry.meta.description || '自定义克隆音色'
        : '不可用：' + entry.missingReason,
    }));
  }

  async synthesize(req: SynthRequest): Promise<SynthResult> {
    const entries = this.listEntries();
    const entry = entries.find((item) => (item.meta.id || path.basename(item.dir)) === req.voiceId);
    if (!entry) {
      throw new NovelError('NOT_FOUND', `克隆音色不存在：${req.voiceId}`, 404);
    }
    if (!entry.available) {
      throw new NovelError(
        'PROVIDER_NOT_CONFIGURED',
        `克隆音色「${entry.meta.name}」不完整：${entry.missingReason}。请用训练工具重新导出。`,
        400,
      );
    }

    const inferScript = this.getInferScript();
    if (!inferScript || !fs.existsSync(inferScript)) {
      throw new NovelError(
        'PROVIDER_NOT_CONFIGURED',
        '未找到克隆音色推理脚本。请确认软件外已安装「音色克隆训练工具」，或在设置中指定路径。',
        400,
      );
    }
    const python = this.getPythonPath();
    if (!python || !fs.existsSync(python)) {
      throw new NovelError(
        'PROVIDER_NOT_CONFIGURED',
        '未找到克隆音色使用的 Python 环境。请先运行训练工具的 setup.ps1 创建 .venv。',
        400,
      );
    }

    fs.mkdirSync(path.dirname(req.outputPath), { recursive: true });
    req.onProgress?.(0.1, '正在加载克隆音色');

    await runPython(python, [
      inferScript,
      '--name', entry.meta.name || path.basename(entry.dir),
      '--gpt', entry.gptPath as string,
      '--sovits', entry.sovitsPath as string,
      '--reference', entry.referencePath as string,
      '--reference-text', entry.referenceText,
      '--text', req.text,
      '--out', req.outputPath,
      '--speed', String(clampSpeed(req.rate)),
    ], (line) => {
      // 透传 Python 的进度：约定以 [progress] 开头
      const match = /^\[progress\]\s*([\d.]+)\s*(.*)$/.exec(line.trim());
      if (match) req.onProgress?.(Math.min(0.95, 0.1 + Number(match[1]) * 0.85), match[2] || '合成中');
    });

    req.onProgress?.(0.97, '正在整理音频文件');
    if (!fs.existsSync(req.outputPath)) {
      throw new NovelError('PROVIDER_ERROR', '克隆音色合成结束但没有生成音频文件。', 502);
    }
    return {
      filePath: req.outputPath,
      durationMs: readWavDuration(req.outputPath),
      format: 'wav',
    };
  }
}

/** 在目录里按候选名（支持简单通配）找第一个存在的文件。 */
function existsAny(dir: string, candidates: string[]): string | null {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    if (candidate.includes('*')) {
      const suffix = candidate.replace('*', '').toLowerCase();
      const hit = names.find((n) => n.toLowerCase().endsWith(suffix));
      if (hit) return path.join(dir, hit);
    } else if (names.includes(candidate)) {
      return path.join(dir, candidate);
    }
  }
  return null;
}

/** 把软件里的 -10..10 语速映射成 TTS 的 0.5~2.0 倍率。 */
function clampSpeed(rate: number): number {
  const normalized = 1 + (Number.isFinite(rate) ? rate : 0) / 20;
  return Math.min(2, Math.max(0.5, normalized));
}

/** 运行 Python 推理脚本，逐行透传输出。 */
function runPython(python: string, args: string[], onLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new NovelError('PROVIDER_ERROR', '克隆音色合成超时（10 分钟），请缩短文本或检查显卡状态。', 504));
    }, 10 * 60 * 1000);

    child.stdout.on('data', (data: Buffer) => {
      for (const line of data.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) onLine?.(line);
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new NovelError('PROVIDER_ERROR', `无法启动 Python 推理进程：${err.message}`, 502));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (exitCode === 0) return resolve();
      reject(
        new NovelError(
          'PROVIDER_ERROR',
          `克隆音色合成失败（退出码 ${exitCode}）：${stderr.slice(-600) || '未知错误'}`,
          502,
        ),
      );
    });
  });
}
