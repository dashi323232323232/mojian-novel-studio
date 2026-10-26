import type { Database } from '../db/database';
import { nowIso, parseJson, toJson } from '../util';
import type { UiSettings, ProjectUiSettings, AudioProviderConfigPublic, EditorSettings } from '@shared/types';
import { DEFAULT_EDITOR_SETTINGS } from '@shared/constants';

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
};

const DEFAULT_PROJECT_UI: ProjectUiSettings = {
  outlineViewport: null,
  linkSplitRatio: 0.5,
  lastChapterId: null,
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
    return {
      lastProjectId: parsed.lastProjectId ?? null,
      editor,
      audio,
    };
  }

  updateUi(patch: Partial<UiSettings>): UiSettings {
    const current = this.getUi();
    const next: UiSettings = {
      ...current,
      ...patch,
      editor: { ...current.editor, ...(patch.editor ?? {}) },
      audio: { ...current.audio, ...(patch.audio ?? {}) },
    };
    this.setAppRaw('ui', toJson(next));
    return next;
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
