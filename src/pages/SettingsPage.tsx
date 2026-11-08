import { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Database,
  HardDriveDownload,
  RotateCcw,
  Trash2,
  FolderOpen,
  Save,
  BookOpen,
  FileText,
  Info,
  ShieldCheck,
  FolderCog,
  ArrowRight,
  MonitorDown,
  Power,
  Headphones,
  Gauge,
  Volume2,
  Minimize2,
  FileArchive,
  X,
} from 'lucide-react';
import type { AppInfo, BackupInfo, ReadingSettings, UiSettings } from '@shared/types';
import { CLOSE_ACTION_LABEL, READING_RATE_OPTIONS } from '@shared/constants';
import { formatBytes, formatDateTime } from '@shared/text';
import { loadVoices, sortVoices, type ReaderVoice } from '../lib/reading';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { ConfirmDialog } from '../components/Modal';
import '../styles/project-transfer.css';

export function SettingsPage() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [stats, setStats] = useState<Record<string, number | string | null> | null>(null);
  const [settings, setSettings] = useState<UiSettings | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupInfo | null>(null);
  const [dataLoc, setDataLoc] = useState<{
    currentDir: string;
    defaultDir: string;
    bootstrapFile: string;
    isCustom: boolean;
    exists: boolean;
    dbSize: number;
    audioCount: number;
    backupCount: number;
  } | null>(null);
  const [movingDir, setMovingDir] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [voices, setVoices] = useState<ReaderVoice[]>([]);
  const [windowState, setWindowState] = useState<{ trayActive: boolean; closeAction: 'tray' | 'quit' } | null>(null);

  const refresh = async () => {
    try {
      const [i, s, ui, b, loc] = await Promise.all([
        api.info(),
        api.stats(),
        api.settings(),
        api.backups(),
        api.dataLocation(),
      ]);
      setInfo(i);
      setStats(s);
      setSettings(ui);
      setBackups(b.backups);
      setDataLoc(loc);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取设置失败');
    }
  };

  useEffect(() => {
    void refresh();
    void loadVoices().then((list) => setVoices(sortVoices(list)));
    void api.windowState().then((s) => setWindowState({ trayActive: s.trayActive, closeAction: s.closeAction })).catch(() => undefined);
  }, []);

  const updateGeneral = async (patch: Partial<UiSettings>) => {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    try {
      const saved = await api.updateSettings(patch);
      setSettings(saved);
      toast.success('设置已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存设置失败');
    }
  };

  const updateReading = async (patch: Partial<ReadingSettings>) => {
    if (!settings) return;
    const next = { ...settings, reading: { ...settings.reading, ...patch } };
    setSettings(next);
    try {
      const saved = await api.updateSettings({ reading: next.reading });
      setSettings(saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存朗读设置失败');
    }
  };

  const updateEditor = async (patch: Partial<UiSettings['editor']>) => {
    if (!settings) return;
    const next = { ...settings, editor: { ...settings.editor, ...patch } };
    setSettings(next);
    try {
      const saved = await api.updateSettings({ editor: next.editor });
      setSettings(saved);
      localStorage.setItem('dashi.editor.settings', JSON.stringify(saved.editor));
      toast.success('编辑器设置已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存设置失败');
    }
  };

  const createBackup = async () => {
    setBusy(true);
    try {
      const backup = await api.createBackup();
      await refresh();
      toast.success(`备份已创建：${backup.fileName}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建备份失败');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      const result = await api.restoreBackup(restoreTarget.fileName);
      setRestoreTarget(null);
      toast.success(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复备份失败');
    } finally {
      setBusy(false);
    }
  };

  const removeBackup = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteBackup(deleteTarget.fileName);
      await refresh();
      setDeleteTarget(null);
      toast.success('备份已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除备份失败');
    } finally {
      setBusy(false);
    }
  };

  const chooseExportFolder = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const chosen = await api.chooseExportFolder();
      if (chosen.canceled || !chosen.dir) return;
      const saved = await api.updateSettings({ exportFolder: chosen.dir });
      setSettings(saved);
      toast.success(`默认导出文件夹已设置为 ${chosen.dir}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '选择导出文件夹失败');
    } finally {
      setExportBusy(false);
    }
  };

  const clearExportFolder = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const saved = await api.updateSettings({ exportFolder: null });
      setSettings(saved);
      toast.success('已清除默认导出文件夹');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清除导出文件夹失败');
    } finally {
      setExportBusy(false);
    }
  };

  const changeDataDir = async (mode: 'move' | 'switch') => {
    if (!dataLoc) return;
    const chosen = await api.chooseDataDir(mode);
    if (chosen.canceled || !chosen.dir) return;
    setMovingDir(true);
    try {
      const result = await api.moveDataDir(chosen.dir, { mode });
      toast.success(result.message);
      toast.info('软件即将重启以使用新的数据位置…');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换数据目录失败');
      setMovingDir(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">
          <SettingsIcon size={19} style={{ color: 'var(--accent)' }} />
          设置与备份
          <span className="sub">数据位置、编辑器偏好与可靠性</span>
        </div>
      </div>
      <div className="settings-page">
        <div className="settings-grid">
          <div className="settings-card">
            <div className="settings-card-head">
              <span>
                <MonitorDown size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                关闭与托盘
              </span>
              <span className="badge" style={{ background: 'var(--bg-subtle)', color: 'var(--text-tertiary)' }}>
                {windowState?.trayActive ? '托盘已启用' : '托盘未启用'}
              </span>
            </div>
            <div className="settings-card-body">
              <div className="field" style={{ marginBottom: 10 }}>
                <label className="field-label">点击窗口关闭按钮时</label>
                <div className="radio-cards">
                  {(['tray', 'quit'] as const).map((mode) => (
                    <label
                      key={mode}
                      className={`radio-card${(settings?.closeAction ?? 'tray') === mode ? ' active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="closeAction"
                        checked={(settings?.closeAction ?? 'tray') === mode}
                        onChange={() => void updateGeneral({ closeAction: mode })}
                      />
                      <span className="radio-card-body">
                        <span className="radio-card-title">
                          {mode === 'tray' ? <Minimize2 size={13} /> : <Power size={13} />}
                          {CLOSE_ACTION_LABEL[mode].label}
                        </span>
                        <span className="radio-card-desc">{CLOSE_ACTION_LABEL[mode].description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    try {
                      const r = await api.hideToTray();
                      toast.success(r.trayActive ? '已收缩到系统托盘，点击托盘图标可恢复窗口' : '已收缩窗口');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : '收缩到托盘失败');
                    }
                  }}
                >
                  <Minimize2 size={13} /> 立即收缩到托盘
                </button>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const s = await api.windowState().catch(() => null);
                    setWindowState(s ? { trayActive: s.trayActive, closeAction: s.closeAction } : null);
                    toast.info(s?.trayActive ? '系统托盘中已有本软件图标' : '尚未创建托盘图标，执行一次关闭或点击左侧按钮即可');
                  }}
                >
                  检查托盘状态
                </button>
              </div>
              <div className="field-hint" style={{ marginTop: 8 }}>
                选择「收缩到系统托盘」时，关闭窗口不会结束进程，实时朗读与离线音频任务会继续运行；
                需要彻底退出请右键托盘图标选择「退出软件」，或在菜单「文件 → 退出」。
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <span>
                <Headphones size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                实时朗读
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>音频制作默认使用该配置</span>
            </div>
            <div className="settings-card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="field-label">
                    <Gauge size={12} /> 默认语速：{settings?.reading.rate ?? 1}×
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.05}
                    value={settings?.reading.rate ?? 1}
                    onChange={(e) => void updateReading({ rate: Number(e.target.value) })}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {READING_RATE_OPTIONS.filter((r) => r <= 1.5).map((r) => (
                      <button
                        key={r}
                        className={`reader-rate-preset${Math.abs((settings?.reading.rate ?? 1) - r) < 0.01 ? ' active' : ''}`}
                        onClick={() => void updateReading({ rate: r })}
                      >
                        {r}×
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="field-label">
                    <Volume2 size={12} /> 音量：{settings?.reading.volume ?? 100}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings?.reading.volume ?? 100}
                    onChange={(e) => void updateReading({ volume: Number(e.target.value) })}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <label className="field-label" style={{ marginTop: 6 }}>
                    音调：{(settings?.reading.pitch ?? 1).toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={1.6}
                    step={0.05}
                    value={settings?.reading.pitch ?? 1}
                    onChange={(e) => void updateReading({ pitch: Number(e.target.value) })}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="field-label">默认朗读声音</label>
                  <select
                    className="select"
                    value={settings?.reading.voiceId ?? ''}
                    onChange={(e) => void updateReading({ voiceId: e.target.value })}
                  >
                    <option value="">自动（优先中文）</option>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {/^zh/i.test(v.lang) ? ' · 中文' : ` · ${v.lang}`}
                      </option>
                    ))}
                  </select>
                  <div className="field-hint">
                    共检测到 {voices.length} 个系统语音，{voices.filter((v) => /^zh/i.test(v.lang)).length} 个中文语音。
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="field-label">朗读习惯</label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={settings?.rememberReading ?? true}
                      onChange={(e) => void updateGeneral({ rememberReading: e.target.checked })}
                    />
                    <span>记住每章听到的位置（下次打开继续）</span>
                  </label>
                  <label className="checkbox-row" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={settings?.reading.autoNext ?? true}
                      onChange={(e) => void updateReading({ autoNext: e.target.checked })}
                    />
                    <span>一章读完后自动接着读下一章</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <span>
                <FileText size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                编辑器
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>对章节编辑页与联动工作区生效</span>
            </div>
            <div className="settings-card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="field">
                  <label className="field-label">字号：{settings?.editor.fontSize ?? 18}px</label>
                  <input
                    type="range"
                    min={14}
                    max={26}
                    value={settings?.editor.fontSize ?? 18}
                    onChange={(e) => void updateEditor({ fontSize: Number(e.target.value) })}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                </div>
                <div className="field">
                  <label className="field-label">行距：{(settings?.editor.lineHeight ?? 1.9).toFixed(1)}</label>
                  <input
                    type="range"
                    min={1.4}
                    max={2.6}
                    step={0.1}
                    value={settings?.editor.lineHeight ?? 1.9}
                    onChange={(e) => void updateEditor({ lineHeight: Number(e.target.value) })}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                </div>
                <div className="field">
                  <label className="field-label">正文字体</label>
                  <select
                    className="select"
                    value={settings?.editor.fontFamily ?? 'serif'}
                    onChange={(e) => void updateEditor({ fontFamily: e.target.value as 'serif' | 'sans' })}
                  >
                    <option value="serif">宋体 / 衬线（推荐长篇）</option>
                    <option value="sans">黑体 / 无衬线</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">自动保存</label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={settings?.editor.autoSave ?? true}
                      onChange={(e) => void updateEditor({ autoSave: e.target.checked })}
                    />
                    <span>输入停顿约 1.2 秒后自动保存（推荐）</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <span>
                <Database size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                数据存储
              </span>
              <button className="btn btn-sm" onClick={() => void api.openDataDir()}>
                <FolderOpen size={12} /> 打开数据目录
              </button>
            </div>
            <div className="settings-card-body">
              <div className="kv-row">
                <span className="k">数据库</span>
                <span className="v" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                  {info?.dbPath ?? '—'}
                </span>
              </div>
              <div className="kv-row">
                <span className="k">数据目录</span>
                <span className="v" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                  {info?.dataDir ?? '—'}
                </span>
              </div>
              <div className="kv-row">
                <span className="k">数据库大小</span>
                <span className="v">{formatBytes(Number(stats?.dbSize ?? 0))}</span>
              </div>
              <div className="stat-grid" style={{ marginTop: 12 }}>
                <div className="stat">
                  <div className="k">项目</div>
                  <div className="v">{stats?.projects ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">章节</div>
                  <div className="v">{stats?.chapters ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">总字数</div>
                  <div className="v">{stats?.words ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">大纲节点</div>
                  <div className="v">{stats?.nodes ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">连线</div>
                  <div className="v">{stats?.edges ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">伏笔</div>
                  <div className="v">{stats?.foreshadows ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">音频任务</div>
                  <div className="v">{stats?.audioJobs ?? 0}</div>
                </div>
              </div>
              <div className="info-note" style={{ marginTop: 12, marginBottom: 0 }}>
                数据保存在本地 SQLite 数据库（WAL 模式，事务写入）。章节正文独立存储，长篇上千章也不会拖慢列表。软件意外退出不会破坏项目文件。
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <span>
                <FolderCog size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                数据存储位置
              </span>
              <span
                className="badge"
                style={{
                  background: dataLoc?.isCustom ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                  color: dataLoc?.isCustom ? 'var(--accent)' : 'var(--text-tertiary)',
                }}
              >
                {dataLoc?.isCustom ? '自定义位置' : '默认位置'}
              </span>
            </div>
            <div className="settings-card-body">
              <div className="kv-row">
                <span className="k">当前数据目录</span>
                <span className="v" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                  {dataLoc?.currentDir ?? '—'}
                </span>
              </div>
              <div className="kv-row">
                <span className="k">默认目录</span>
                <span className="v" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                  {dataLoc?.defaultDir ?? '—'}
                </span>
              </div>
              <div className="kv-row">
                <span className="k">目录内容</span>
                <span className="v">
                  数据库 {formatBytes(dataLoc?.dbSize ?? 0)} · 音频 {dataLoc?.audioCount ?? 0} 项 · 备份{' '}
                  {dataLoc?.backupCount ?? 0} 份
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-primary" onClick={() => void changeDataDir('move')} disabled={movingDir}>
                  {movingDir ? <span className="spinner" /> : <FolderCog size={13} />}
                  选择新位置并迁移数据
                </button>
                <button className="btn btn-sm" onClick={() => void changeDataDir('switch')} disabled={movingDir}>
                  <ArrowRight size={13} /> 仅切换到已有目录
                </button>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    try {
                      const r = await api.resetDataDir();
                      toast.success(r.message);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : '恢复默认失败');
                    }
                  }}
                >
                  恢复默认位置
                </button>
                <button className="btn btn-sm" onClick={() => void api.openDataDir()}>
                  <FolderOpen size={13} /> 打开目录
                </button>
              </div>
              <div className="warn-note" style={{ marginTop: 12, marginBottom: 0 }}>
                <b>迁移模式</b>会把当前数据库、全部音频与备份复制到新目录，校验成功后切换并自动重启软件；
                <b>仅切换模式</b>不会复制数据，适合目录中已有旧数据的情况。目标目录不能已存在 dashi.db。
                引导文件位于 <code>{dataLoc?.bootstrapFile ?? '—'}</code>，删除它即可恢复默认位置。
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <span>
                <FileArchive size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                项目导入导出
              </span>
              <span
                className="badge"
                style={{
                  background: settings?.exportFolder ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                  color: settings?.exportFolder ? 'var(--accent)' : 'var(--text-tertiary)',
                }}
              >
                {settings?.exportFolder ? '已设置' : '未设置'}
              </span>
            </div>
            <div className="settings-card-body">
              <div className="kv-row">
                <span className="k">默认导出文件夹</span>
                <span
                  className="v pt-folder-path"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}
                  title={settings?.exportFolder ?? ''}
                >
                  {settings?.exportFolder ?? '未设置（导出时会询问保存位置）'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-primary" onClick={() => void chooseExportFolder()} disabled={exportBusy}>
                  {exportBusy ? <span className="spinner" /> : <FolderOpen size={13} />}
                  选择文件夹
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => void clearExportFolder()}
                  disabled={exportBusy || !settings?.exportFolder}
                >
                  <X size={13} /> 清除
                </button>
              </div>
              <div className="info-note" style={{ marginTop: 12, marginBottom: 0 }}>
                设置后导出项目会直接保存到该文件夹，不再每次询问；未设置时由系统弹出保存对话框选择位置。
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <span>
                <HardDriveDownload size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                备份与恢复
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => void createBackup()} disabled={busy}>
                  {busy ? <span className="spinner" /> : <Save size={12} />} 立即备份
                </button>
              </div>
            </div>
            <div className="settings-card-body">
              <div className="field-hint" style={{ marginBottom: 10 }}>
                自动备份每 10 分钟最多执行一次，保留最近 20 份。恢复前会自动创建当前数据的安全备份。
              </div>
              {backups.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                  暂无备份。点击「立即备份」创建第一份。
                </div>
              ) : (
                backups.slice(0, 12).map((b) => (
                  <div className="backup-row" key={b.fileName}>
                    <span
                      className="badge"
                      style={{
                        background: b.auto ? 'var(--bg-subtle)' : 'var(--accent-soft)',
                        color: b.auto ? 'var(--text-tertiary)' : 'var(--accent)',
                      }}
                    >
                      {b.auto ? '自动' : '手动'}
                    </span>
                    <span className="nm" title={b.fileName}>
                      {b.fileName}
                    </span>
                    <span className="sz">{formatDateTime(b.createdAt)}</span>
                    <span className="sz">{formatBytes(b.size)}</span>
                    <button className="icon-btn" title="恢复此备份" onClick={() => setRestoreTarget(b)}>
                      <RotateCcw size={13} />
                    </button>
                    <button className="icon-btn" title="删除备份" onClick={() => setDeleteTarget(b)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <span>
                <Info size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                关于
              </span>
            </div>
            <div className="settings-card-body">
              <div className="kv-row">
                <span className="k">软件版本</span>
                <span className="v">{info?.appVersion ?? '1.0.0'}</span>
              </div>
              <div className="kv-row">
                <span className="k">API 版本</span>
                <span className="v">{info?.apiVersion ?? 'v1'}</span>
              </div>
              <div className="kv-row">
                <span className="k">运行环境</span>
                <span className="v">
                  Electron {info?.electron ?? '—'} · Node {info?.node ?? '—'} · Chromium {info?.chrome ?? '—'}
                </span>
              </div>
              <div className="kv-row">
                <span className="k">数据保留策略</span>
                <span className="v">章节正文仅保留当前版本 + 上一个版本，可随时回溯，更早版本自动清理。</span>
              </div>
              <div className="warn-note" style={{ marginTop: 12, marginBottom: 0 }}>
                <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                所有数据默认仅保存在本机，不上传云端。请定期把「备份」文件复制到其他磁盘。
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title="恢复备份"
        confirmText="恢复并覆盖当前数据"
        danger
        busy={busy}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void restore()}
        message={
          <>
            将使用备份「<b>{restoreTarget?.fileName}</b>」覆盖当前数据库。
            <br />
            系统会先自动创建一份当前数据的安全备份。恢复后请重新启动软件。
          </>
        }
      >
        <div className="danger-note">恢复会丢失备份时间点之后的所有修改，请确认。</div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除备份"
        confirmText="删除"
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void removeBackup()}
        message={<>确定删除备份「{deleteTarget?.fileName}」？该操作不可恢复。</>}
      />
    </div>
  );
}
