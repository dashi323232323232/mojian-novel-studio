import type { Database } from '../db/database';
import { nowIso, parseJson, toJson } from '../util';
import type {
  UiSettings,
  ProjectUiSettings,
  AudioProviderConfigPublic,
  EditorSettings,
  ReadingSettings,
  ReadingProgress,
} from '@shared/types';
import { DEFAULT_EDITOR_SETTINGS, DEFAULT_READING_SETTINGS } from '@shared/constants';

const DEFAULT_UI: UiSettings = {
  lastProjectId: null,
  editor: { ...DEFAULT_EDITOR_SETTINGS },
  audio: {
    provider: 'sapi',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-4o-mini-tts',
    openaiVoice: 'alloy',
    openaiApiKeySet: false,
    sapiRate: 0,
  },
  // 默认关闭时收缩到系统托盘，符合「后台继续朗读/写作」的使用习惯
  closeAction: 'tray',
  rememberReading: true,
  reading: { ...DEFAULT_READING_SETTINGS },
};

/** 把数值夹在合法区间；非法输入回退到当前值，避免越界数据写库后 UI 与存储不一致。 */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 朗读设置统一校验：语速 0.5~2、音调 0.5~1.6、音量 0~100，字符串/越界值一律纠正。 */
function sanitizeReading(input: ReadingSettings, fallback: ReadingSettings): ReadingSettings {
  const provider = input.provider === 'openai' ? 'openai' : input.provider === 'sapi' ? 'sapi' : fallback.provider;
  const engine = input.engine === 'sapi' ? 'sapi' : input.engine === 'web' ? 'web' : fallback.engine;
  return {
    engine,
    provider,
    voiceId: typeof input.voiceId === 'string' ? input.voiceId : fallback.voiceId,
    rate: clampNumber(input.rate, 0.5, 2, fallback.rate),
    pitch: clampNumber(input.pitch, 0.5, 1.6, fallback.pitch),
    volume: clampNumber(input.volume, 0, 100, fallback.volume),
    chapterId: typeof input.chapterId === 'string' ? input.chapterId : null,
    autoNext: input.autoNext === undefined ? fallback.autoNext : input.autoNext !== false,
  };
}

const DEFAULT_PROJECT_UI: ProjectUiSettings = {
  outlineViewport: null,
  linkSplitRatio: 0.5,
  lastChapterId: null,
  readingProgress: {},
};

export class SettingsService {
  constructor(private db: Database) {}

  private getAppRaw(key: string): string | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key);
    return row?.value ?? null;
  }

  private setAppRaw(key: string, value: string): void {
    this.db.run(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  getUi(): UiSettings {
    const raw = this.getAppRaw('ui');
    const parsed = parseJson<Partial<UiSettings>>(raw, {});
    const editor = { ...DEFAULT_EDITOR_SETTINGS, ...(parsed.editor ?? {}) };
    const audio = { ...DEFAULT_UI.audio, ...(parsed.audio ?? {}) };
    const reading: ReadingSettings = sanitizeReading(
      { ...DEFAULT_READING_SETTINGS, ...(parsed.reading ?? {}) },
      DEFAULT_READING_SETTINGS,
    );
    return {
      lastProjectId: parsed.lastProjectId ?? null,
      editor,
      audio,
      closeAction: parsed.closeAction === 'quit' ? 'quit' : 'tray',
      rememberReading: parsed.rememberReading !== false,
      reading,
    };
  }

  updateUi(patch: Partial<UiSettings>): UiSettings {
    const current = this.getUi();
    const next: UiSettings = {
      ...current,
      ...patch,
      editor: { ...current.editor, ...(patch.editor ?? {}) },
      audio: { ...current.audio, ...(patch.audio ?? {}) },
      reading: sanitizeReading({ ...current.reading, ...(patch.reading ?? {}) }, current.reading),
      closeAction: patch.closeAction === 'quit' ? 'quit' : patch.closeAction === 'tray' ? 'tray' : current.closeAction,
      // 传 0 / '' / null 这类"假值"按用户意图理解为关闭，只有明确的 true 才是开启
      rememberReading:
        patch.rememberReading === undefined
          ? current.rememberReading
          : Boolean(patch.rememberReading) && patch.rememberReading !== false,
    };
    this.setAppRaw('ui', toJson(next));
    return next;
  }

  /** 关闭行为：默认收缩到系统托盘。 */
  getCloseAction(): 'tray' | 'quit' {
    return this.getUi().closeAction;
  }

  getReadingSettings(): ReadingSettings {
    return this.getUi().reading;
  }

  updateReadingSettings(patch: Partial<ReadingSettings>): ReadingSettings {
    const next = this.updateUi({ reading: { ...this.getUi().reading, ...patch } });
    return next.reading;
  }

  getEditorSettings(): EditorSettings {
    return this.getUi().editor;
  }

  getAudioConfig(): AudioProviderConfigPublic & { openaiApiKey?: string } {
    const base = this.getUi().audio;
    const key = this.getAppRaw('audio.openaiKey') ?? '';
    return { ...base, openaiApiKey: key || undefined, openaiApiKeySet: Boolean(key) };
  }

  setAudioConfig(patch: Partial<AudioProviderConfigPublic> & { openaiApiKey?: string | null }): AudioProviderConfigPublic {
    const current = this.getUi();
    const next = {
      ...current.audio,
      ...patch,
    } as AudioProviderConfigPublic;
    delete (next as { openaiApiKey?: string }).openaiApiKey;
    this.updateUi({ audio: next });
    if (patch.openaiApiKey !== undefined) {
      if (patch.openaiApiKey === null || patch.openaiApiKey === '') {
        this.db.run('DELETE FROM app_settings WHERE key = ?', 'audio.openaiKey');
      } else {
        this.setAppRaw('audio.openaiKey', patch.openaiApiKey);
      }
    }
    return this.getAudioConfig();
  }

  getApiToken(): string {
    return this.getAppRaw('api.token') ?? '';
  }

  setApiToken(token: string): void {
    this.setAppRaw('api.token', token);
  }

  getApiSettings(): { allowDestructive: boolean; enabled: boolean } {
    const raw = this.getAppRaw('api.settings');
    const parsed = parseJson<{ allowDestructive?: boolean; enabled?: boolean }>(raw, {});
    return {
      allowDestructive: parsed.allowDestructive ?? false,
      enabled: parsed.enabled ?? true,
    };
  }

  updateApiSettings(patch: { allowDestructive?: boolean; enabled?: boolean }): {
    allowDestructive: boolean;
    enabled: boolean;
  } {
    const current = this.getApiSettings();
    const next = { ...current, ...patch };
    this.setAppRaw('api.settings', toJson(next));
    return next;
  }

  getProjectSettings(projectId: string): ProjectUiSettings {
    const rows = this.db.all<{ key: string; value: string }>(
      'SELECT key, value FROM project_settings WHERE project_id = ?',
      projectId,
    );
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const viewport = parseJson<ProjectUiSettings['outlineViewport']>(map.get('outlineViewport') ?? null, null);
    const ratio = Number(map.get('linkSplitRatio') ?? '0.5');
    return {
      outlineViewport: viewport,
      linkSplitRatio: Number.isFinite(ratio) ? Math.min(0.8, Math.max(0.2, ratio)) : 0.5,
      lastChapterId: map.get('lastChapterId') ?? null,
      readingProgress: parseJson<Record<string, ReadingProgress>>(map.get('readingProgress') ?? null, {}),
    };
  }

  updateProjectSettings(projectId: string, patch: Partial<ProjectUiSettings>): ProjectUiSettings {
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        this.db.run(
          `INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
          projectId,
          key,
          typeof value === 'string' ? value : toJson(value),
        );
      }
    });
    return this.getProjectSettings(projectId);
  }

  /** 记住某章的朗读位置（按字符偏移保存，换引擎/变速都能接着读）。 */
  recordReadingProgress(projectId: string, progress: Omit<ReadingProgress, 'updatedAt'>): ReadingProgress {
    const current = this.getProjectSettings(projectId).readingProgress;
    const entry: ReadingProgress = {
      chapterId: progress.chapterId,
      charIndex: Math.max(0, Math.round(progress.charIndex)),
      charTotal: Math.max(0, Math.round(progress.charTotal)),
      percent:
        progress.charTotal > 0 ? Math.min(1, Math.max(0, progress.charIndex / progress.charTotal)) : 0,
      updatedAt: nowIso(),
    };
    const next = { ...current, [entry.chapterId]: entry };
    this.updateProjectSettings(projectId, { readingProgress: next });
    return entry;
  }

  clearReadingProgress(projectId: string, chapterId: string): void {
    const current = this.getProjectSettings(projectId).readingProgress;
    if (!current[chapterId]) return;
    const next = { ...current };
    delete next[chapterId];
    this.updateProjectSettings(projectId, { readingProgress: next });
  }

  setLastProject(projectId: string | null): void {
    this.updateUi({ lastProjectId: projectId });
  }

  recordLastChapter(projectId: string, chapterId: string | null): void {
    this.db.run(
      `INSERT INTO project_settings (project_id, key, value) VALUES (?, 'lastChapterId', ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
      projectId,
      chapterId ?? '',
    );
  }

  getAllProjectSettings(): Record<string, ProjectUiSettings> {
    const projects = this.db.all<{ id: string }>('SELECT id FROM projects');
    const out: Record<string, ProjectUiSettings> = {};
    for (const p of projects) out[p.id] = this.getProjectSettings(p.id);
    return out;
  }

  /** 维护类：清理请求日志，最多保留 500 条。 */
  trimApiLogs(max = 500): void {
    this.db.run(
      `DELETE FROM api_request_log WHERE id NOT IN (SELECT id FROM api_request_log ORDER BY id DESC LIMIT ?)`,
      max,
    );
  }

  recordApiRequest(entry: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    actor: string;
    ip: string;
    summary: string;
  }): void {
    this.db.run(
      `INSERT INTO api_request_log (ts, method, path, status, duration_ms, actor, ip, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      nowIso(),
      entry.method,
      entry.path,
      entry.status,
      Math.round(entry.durationMs),
      entry.actor,
      entry.ip,
      entry.summary,
    );
  }

  listApiLogs(limit = 100): Array<{
    id: number;
    ts: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    actor: string;
    ip: string;
    summary: string;
  }> {
    const rows = this.db.all<{
      id: number;
      ts: string;
      method: string;
      path: string;
      status: number;
      duration_ms: number;
      actor: string;
      ip: string;
      summary: string;
    }>('SELECT * FROM api_request_log ORDER BY id DESC LIMIT ?', limit);
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      method: r.method,
      path: r.path,
      status: r.status,
      durationMs: r.duration_ms,
      actor: r.actor,
      ip: r.ip,
      summary: r.summary,
    }));
  }
}
