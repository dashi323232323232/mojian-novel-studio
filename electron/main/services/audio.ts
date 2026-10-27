import fs from 'node:fs';
import path from 'node:path';
import type { ServiceContext } from './projects';
import { NovelError, notFound, validationError } from '../errors';
import { makeId, nowIso } from '../util';
import { countWords } from '@shared/text';
import type { AudioJob, AudioJobStatus, AudioJobWithFile, Voice } from '@shared/types';
import { OpenAiTtsProvider, SapiTtsProvider, type TtsProvider } from '../adapters/tts';

interface AudioJobRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  chapter_name: string;
  status: AudioJobStatus;
  progress: number;
  message: string;
  provider: string;
  voice_id: string;
  voice_name: string;
  rate: number;
  volume: number;
  format: string;
  file_name: string | null;
  file_path: string | null;
  duration_ms: number | null;
  char_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function mapJob(row: AudioJobRow): AudioJob {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    chapterName: row.chapter_name,
    status: row.status,
    progress: Number(row.progress ?? 0),
    message: row.message ?? '',
    provider: row.provider,
    voiceId: row.voice_id,
    voiceName: row.voice_name,
    rate: Number(row.rate ?? 0),
    volume: Number(row.volume ?? 100),
    format: row.format,
    fileName: row.file_name,
    filePath: row.file_path,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    charCount: Number(row.char_count ?? 0),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const MAX_TTS_CHARS = 60000;

export class AudioService {
  private queue: string[] = [];
  private running = false;
  private providers: Map<string, TtsProvider> = new Map();

  constructor(
    private ctx: ServiceContext,
    private getOpenAiConfig: () => { baseUrl: string; apiKey: string; model: string; voice: string },
    private getSapiRate: () => number,
  ) {
    this.providers.set('sapi', new SapiTtsProvider());
    this.providers.set('openai', new OpenAiTtsProvider(getOpenAiConfig));
    this.recoverInterruptedJobs();
  }

  private recoverInterruptedJobs(): void {
    const ts = nowIso();
    this.ctx.db.run(
      `UPDATE audio_jobs SET status = 'failed', error = '应用上次退出时任务尚未完成，请重新生成。',
         message = '任务中断', updated_at = ?, finished_at = ? WHERE status IN ('queued', 'running')`,
      ts,
      ts,
    );
  }

  private audioDir(projectId: string): string {
    const dir = path.join(this.ctx.dataDir, 'audio', projectId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getJob(id: string): AudioJobWithFile {
    const row = this.ctx.db.get<AudioJobRow>('SELECT * FROM audio_jobs WHERE id = ?', id);
    if (!row) throw notFound(`音频任务不存在：${id}`);
    return this.withFile(mapJob(row));
  }

  private withFile(job: AudioJob): AudioJobWithFile {
    let exists = false;
    let size: number | null = null;
    if (job.filePath) {
      try {
        const stat = fs.statSync(job.filePath);
        exists = stat.isFile();
        size = stat.size;
      } catch {
        exists = false;
      }
    }
    const mediaUrl =
      exists && job.filePath
        ? `novel-media://audio/${encodeURIComponent(job.projectId)}/${encodeURIComponent(path.basename(job.filePath))}`
        : null;
    return { ...job, exists, size, mediaUrl };
  }

  listJobs(projectId: string, chapterId?: string): AudioJobWithFile[] {
    const project = this.ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
    if (!project) throw notFound(`项目不存在：${projectId}`);
    const rows = chapterId
      ? this.ctx.db.all<AudioJobRow>(
          'SELECT * FROM audio_jobs WHERE project_id = ? AND chapter_id = ? ORDER BY created_at DESC',
          projectId,
          chapterId,
        )
      : this.ctx.db.all<AudioJobRow>(
          'SELECT * FROM audio_jobs WHERE project_id = ? ORDER BY created_at DESC',
          projectId,
        );
    return rows.map((r) => this.withFile(mapJob(r)));
  }

  async listVoices(providerId?: string): Promise<{ provider: string; label: string; configured: boolean; voices: Voice[]; error?: string }[]> {
    const ids = providerId ? [providerId] : ['sapi', 'openai'];
    const out: { provider: string; label: string; configured: boolean; voices: Voice[]; error?: string }[] = [];
    for (const id of ids) {
      const provider = this.providers.get(id);
      if (!provider) throw validationError(`未知语音服务：${id}`);
      try {
        const configured = await provider.isConfigured();
        const voices = configured ? await provider.listVoices() : [];
        out.push({ provider: provider.id, label: provider.label, configured, voices });
      } catch (err) {
        out.push({
          provider: provider.id,
          label: provider.label,
          configured: false,
          voices: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }

  async createJob(
    projectId: string,
    input: { chapterId: string; voiceId: string; provider?: string; rate?: number; volume?: number },
  ): Promise<AudioJobWithFile> {
    const project = this.ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
    if (!project) throw notFound(`项目不存在：${projectId}`);
    if (!input?.chapterId) throw validationError('chapterId 必填');
    if (!input.voiceId) throw validationError('voiceId 必填，请先选择配音声音');
    const chapter = this.ctx.db.get<{ id: string; name: string; project_id: string }>(
      'SELECT id, name, project_id FROM chapters WHERE id = ?',
      input.chapterId,
    );
    if (!chapter) throw notFound(`章节不存在：${input.chapterId}`);
    if (chapter.project_id !== projectId) throw validationError('章节不属于该项目');
    const content = this.ctx.db.get<{ content: string }>(
      'SELECT content FROM chapter_contents WHERE chapter_id = ?',
      input.chapterId,
    );
    const text = (content?.content ?? '').trim();
    if (!text) {
      throw new NovelError('VALIDATION_ERROR', `章节「${chapter.name}」正文为空，无法生成音频。请先写作并保存正文。`, 400);
    }
    if (text.length > MAX_TTS_CHARS) {
      throw new NovelError(
        'VALIDATION_ERROR',
        `章节正文 ${text.length} 字，超过单次合成上限 ${MAX_TTS_CHARS} 字。请拆分章节或等待批量分段功能。`,
        400,
      );
    }
    const providerId = input.provider ?? 'sapi';
    const provider = this.providers.get(providerId);
    if (!provider) throw validationError(`未知语音服务：${providerId}，可选 sapi / openai`);
    const configured = await provider.isConfigured();
    if (!configured) {
      throw new NovelError(
        'PROVIDER_NOT_CONFIGURED',
        providerId === 'openai'
          ? '在线语音服务尚未配置。请在「音频制作 → 服务设置」中填写 API 密钥、服务地址与模型。'
          : '未检测到可用的 Windows 本地语音。请在系统「设置 → 时间和语言 → 语音」中安装语音包，或配置在线语音服务。',
        400,
        { provider: providerId },
      );
    }
    const voices = await provider.listVoices();
    const voice = voices.find((v) => v.id === input.voiceId);
    if (!voice) {
      throw validationError(`声音「${input.voiceId}」在 ${provider.label} 中不存在，请刷新声音列表。`, {
        available: voices.map((v) => v.id),
      });
    }
    const rate = Math.max(-10, Math.min(10, Math.round(Number(input.rate ?? this.getSapiRate()) || 0)));
    const volume = Math.max(0, Math.min(100, Math.round(Number(input.volume ?? 100) || 100)));
    const id = makeId('aud');
    const ts = nowIso();
    const charCount = countWords(text);
    this.ctx.db.run(
      `INSERT INTO audio_jobs (id, project_id, chapter_id, chapter_name, status, progress, message, provider,
         voice_id, voice_name, rate, volume, format, char_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 0, '等待生成', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      projectId,
      chapter.id,
      chapter.name,
      providerId,
      voice.id,
      voice.name,
      rate,
      volume,
      providerId === 'openai' ? 'mp3' : 'wav',
      charCount,
      ts,
      ts,
    );
    this.ctx.changes.emitChange({ scope: 'audio', projectId, action: 'job.create', chapterId: chapter.id });
    this.queue.push(id);
    this.drain();
    return this.getJob(id);
  }

  cancelJob(id: string): AudioJobWithFile {
    const job = this.getJob(id);
    if (job.status === 'succeeded' || job.status === 'failed') {
      throw validationError('任务已结束，无法取消');
    }
    this.queue = this.queue.filter((q) => q !== id);
    this.ctx.db.run(
      `UPDATE audio_jobs SET status = 'canceled', message = '已取消', updated_at = ?, finished_at = ? WHERE id = ?`,
      nowIso(),
      nowIso(),
      id,
    );
    this.ctx.changes.emitChange({ scope: 'audio', projectId: job.projectId, action: 'job.cancel' });
    return this.getJob(id);
  }

  deleteJob(id: string): { deleted: true; id: string } {
    const job = this.getJob(id);
    if (job.status === 'running' || job.status === 'queued') {
      this.cancelJob(id);
    }
    if (job.filePath) {
      try {
        fs.rmSync(job.filePath, { force: true });
      } catch {
        /* 文件可能已被用户移动 */
      }
    }
    this.ctx.db.run('DELETE FROM audio_jobs WHERE id = ?', id);
    this.ctx.changes.emitChange({ scope: 'audio', projectId: job.projectId, action: 'job.delete' });
    return { deleted: true, id };
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        await this.processJob(id);
      }
    } finally {
      this.running = false;
    }
  }

  private update(id: string, patch: Partial<AudioJobRow> & { status?: AudioJobStatus }): void {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
    fields.push('updated_at = ?');
    params.push(nowIso(), id);
    this.ctx.db.run(`UPDATE audio_jobs SET ${fields.join(', ')} WHERE id = ?`, ...params);
    const row = this.ctx.db.get<AudioJobRow>('SELECT * FROM audio_jobs WHERE id = ?', id);
    if (row) {
      this.ctx.changes.emitChange({
        scope: 'audio',
        projectId: row.project_id,
        action: 'job.progress',
      });
    }
  }

  private async processJob(id: string): Promise<void> {
    const row = this.ctx.db.get<AudioJobRow>('SELECT * FROM audio_jobs WHERE id = ?', id);
    if (!row) return;
    if (row.status === 'canceled') return;
    const startedAt = nowIso();
    this.update(id, { status: 'running', progress: 0.02, message: '准备合成', started_at: startedAt, error: null });
    const provider = this.providers.get(row.provider);
    if (!provider) {
      this.update(id, {
        status: 'failed',
        progress: 0,
        message: '失败',
        error: `未知语音服务：${row.provider}`,
        finished_at: nowIso(),
      });
      return;
    }
    try {
      const contentRow = this.ctx.db.get<{ content: string }>(
        'SELECT content FROM chapter_contents WHERE chapter_id = ?',
        row.chapter_id,
      );
      const text = (contentRow?.content ?? '').trim();
      if (!text) throw new NovelError('VALIDATION_ERROR', '章节正文为空，无法生成音频。', 400);
      const ext = row.format === 'mp3' ? 'mp3' : 'wav';
      const fileName = `${row.id}.${ext}`;
      const outputPath = path.join(this.audioDir(row.project_id), fileName);
      this.update(id, { progress: 0.08, message: '正在合成语音' });
      const result = await provider.synthesize({
        text,
        voiceId: row.voice_id,
        rate: row.rate,
        volume: row.volume,
        outputPath,
        onProgress: (progress, message) => {
          const current = this.ctx.db.get<{ status: string }>('SELECT status FROM audio_jobs WHERE id = ?', id);
          if (current?.status === 'canceled') return;
          this.update(id, { progress: Math.min(0.95, 0.08 + progress * 0.85), message });
        },
      });
      const stat = fs.statSync(result.filePath);
      this.update(id, {
        status: 'succeeded',
        progress: 1,
        message: '生成完成',
        file_name: fileName,
        file_path: result.filePath,
        duration_ms: result.durationMs,
        finished_at: nowIso(),
        error: null,
      });
      this.ctx.changes.emitChange({ scope: 'audio', projectId: row.project_id, action: 'job.succeeded' });
      void stat;
    } catch (err) {
      const message = err instanceof NovelError ? err.message : err instanceof Error ? err.message : String(err);
      this.update(id, {
        status: 'failed',
        progress: 0,
        message: '生成失败',
        error: message,
        finished_at: nowIso(),
      });
      this.ctx.changes.emitChange({ scope: 'audio', projectId: row.project_id, action: 'job.failed' });
    }
  }

  /**
   * 试听声音样本：用一句短文本真实合成，生成独立临时文件，不进入任务列表。
   * 这样试听成本低，也不会污染章节音频记录。
   */
  async previewVoice(
    projectId: string,
    input: { voiceId: string; provider?: string; rate?: number; volume?: number; text?: string },
  ): Promise<{ filePath: string; mediaUrl: string; durationMs: number; provider: string; voiceId: string }> {
    const project = this.ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
    if (!project) throw notFound(`项目不存在：${projectId}`);
    if (!input?.voiceId) throw validationError('voiceId 必填');
    const providerId = input.provider ?? 'sapi';
    const provider = this.providers.get(providerId);
    if (!provider) throw validationError(`未知语音服务：${providerId}`);
    const configured = await provider.isConfigured();
    if (!configured) {
      throw new NovelError(
        'PROVIDER_NOT_CONFIGURED',
        providerId === 'openai'
          ? '在线语音服务尚未配置，请先在「服务设置」中填写 API 密钥。'
          : '未检测到 Windows 本地语音，请在系统中安装语音包。',
        400,
      );
    }
    const voices = await provider.listVoices();
    const voice = voices.find((v) => v.id === input.voiceId);
    if (!voice) throw validationError(`声音「${input.voiceId}」不存在`);
    const text = (input.text ?? '这是大师小说工作台的试听样本。愿你的故事，从这里开始。').slice(0, 200);
    const fileName = `preview-${Date.now()}.${providerId === 'openai' ? 'mp3' : 'wav'}`;
    const filePath = path.join(this.audioDir(projectId), fileName);
    const result = await provider.synthesize({
      text,
      voiceId: voice.id,
      rate: Math.max(-10, Math.min(10, Number(input.rate ?? 0) || 0)),
      volume: Math.max(0, Math.min(100, Number(input.volume ?? 100) || 100)),
      outputPath: filePath,
    });
    // 清理旧的试听文件，避免无限增长
    try {
      const dir = this.audioDir(projectId);
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith('preview-') && f !== fileName) fs.rmSync(path.join(dir, f), { force: true });
      }
    } catch {
      /* ignore */
    }
    return {
      filePath: result.filePath,
      mediaUrl: `novel-media://audio/${encodeURIComponent(projectId)}/${encodeURIComponent(path.basename(result.filePath))}`,
      durationMs: result.durationMs,
      provider: providerId,
      voiceId: voice.id,
    };
  }

  /** 导出音频到用户选择的位置（由主进程调用，返回目标路径）。 */
  exportJob(id: string, targetPath: string): { exported: true; targetPath: string } {
    const job = this.getJob(id);
    if (!job.filePath || !job.exists) {
      throw new NovelError('NOT_FOUND', '音频文件不存在，可能已被移动或删除，请重新生成。', 404);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(job.filePath, targetPath);
    return { exported: true, targetPath };
  }
}
