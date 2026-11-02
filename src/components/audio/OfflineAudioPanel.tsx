import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Play,
  Pause,
  Download,
  RefreshCw,
  Trash2,
  Volume2,
  AlertCircle,
  Clock,
  Mic,
  FileAudio,
  ExternalLink,
} from 'lucide-react';
import type { AudioJobWithFile, ProjectStructure, Voice } from '@shared/types';
import { AUDIO_STATUS_META } from '@shared/constants';
import { formatBytes, formatDuration } from '@shared/text';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Spinner } from '../ui';

interface Props {
  projectId: string;
  structure: ProjectStructure;
  provider: 'sapi' | 'openai';
  /** 实时朗读使用的声音（系统语音名称），离线音频不覆盖它 */
  readerVoiceId: string;
  onProviderChange: (provider: 'sapi' | 'openai') => void;
  onOpenConfig: () => void;
}

/**
 * 离线音频：把章节合成为本地音频文件（可导出、可分发）。
 * 与「实时朗读」共用同一套声音与语速设置，但生成结果会保存到磁盘。
 */
export function OfflineAudioPanel({
  projectId,
  structure,
  provider,
  readerVoiceId,
  onProviderChange,
  onOpenConfig,
}: Props) {
  const [chapterId, setChapterId] = useState<string | null>(structure.chapters[0]?.id ?? null);
  // 离线音频有自己的一套声音与语速，避免把实时朗读的设置改掉
  const [voiceId, setVoiceId] = useState<string>('');
  const [rate, setRate] = useState(0);
  const [providers, setProviders] = useState<
    Array<{ provider: string; label: string; configured: boolean; voices: Voice[]; error?: string }>
  >([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [jobs, setJobs] = useState<AudioJobWithFile[]>([]);
  const [creating, setCreating] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<number | null>(null);

  const chapter = structure.chapters.find((c) => c.id === chapterId) ?? null;
  const chaptersByStage = useMemo(() => {
    const map = new Map<string, typeof structure.chapters>();
    for (const s of structure.stages) map.set(s.id, []);
    for (const c of structure.chapters) {
      const key = c.stageId ?? '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [structure]);

  const loadJobs = useCallback(async () => {
    try {
      const list = await api.audioJobs(projectId);
      setJobs(list);
      return list;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取音频任务失败');
      return [];
    }
  }, [projectId]);

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    try {
      const list = await api.voices();
      setProviders(list);
      const active = list.find((p) => p.provider === provider);
      const fallback = list.find((p) => p.configured);
      if (!active?.configured && fallback && fallback.provider !== provider) {
        onProviderChange(fallback.provider as 'sapi' | 'openai');
        setVoiceId(fallback.voices[0]?.id ?? '');
      } else if (active?.voices.length && !active.voices.some((v) => v.id === voiceId)) {
        // 优先选与实时朗读同一声音，保证两种模式听起来一致
        const same = active.voices.find((v) => readerVoiceId && v.name.startsWith(readerVoiceId.split(' - ')[0]));
        setVoiceId(same?.id ?? active.voices[0].id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取声音列表失败');
    } finally {
      setLoadingVoices(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, voiceId, readerVoiceId]);

  useEffect(() => {
    void loadVoices();
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!hasPending) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(() => {
      void loadJobs();
    }, 1500);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobs, loadJobs]);

  const activeProvider = providers.find((p) => p.provider === provider);
  const voices = activeProvider?.voices ?? [];
  const configured = providers.some((p) => p.configured);

  const createJob = async () => {
    if (!chapter) {
      toast.error('请先选择要制作音频的章节');
      return;
    }
    if (!chapter.wordCount) {
      toast.error('该章节正文为空，请先写作并保存正文');
      return;
    }
    if (!voiceId) {
      toast.error('请选择配音声音');
      return;
    }
    setCreating(true);
    try {
      const job = await api.createAudioJob(projectId, { chapterId: chapter.id, voiceId, provider, rate, volume: 100 });
      toast.success('音频任务已创建，正在生成…');
      await loadJobs();
      setPlayingId(job.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建音频任务失败');
    } finally {
      setCreating(false);
    }
  };

  const playJob = (job: AudioJobWithFile) => {
    if (!job.mediaUrl) {
      toast.warn('音频文件不存在，可能已被移动或删除。');
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const audio = new Audio(job.mediaUrl);
    audioRef.current = audio;
    setPlayingId(job.id);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => {
      setPlayingId(null);
      toast.error('音频播放失败，文件可能已损坏。');
    };
    void audio.play().catch(() => {
      setPlayingId(null);
      toast.error('无法播放音频');
    });
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const exportJob = async (job: AudioJobWithFile) => {
    try {
      const result = await api.exportAudioJob(job.id);
      if (!result.canceled) toast.success(`音频已导出到 ${result.filePath}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    }
  };

  const deleteJob = async (job: AudioJobWithFile) => {
    try {
      await api.deleteAudioJob(job.id);
      await loadJobs();
      toast.success('任务已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="audio-offline">
      {!configured && !loadingVoices ? (
        <div className="warn-note">
          <b>未检测到可用的语音服务。</b> Windows 本地语音需要安装中文语音包；在线语音需要配置 API 密钥。
          请点击「服务设置」完成配置后再生成音频。系统不会在未配置时伪造生成结果。
        </div>
      ) : null}

      <div className="audio-offline-grid">
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <FileAudio size={14} /> 1. 选择章节
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{structure.chapters.length} 章</span>
          </div>
          <div className="chapter-pick-list">
            {structure.chapters.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                项目中还没有章节，请先在「内容」中创建章节并写作。
              </div>
            ) : (
              structure.stages.map((stage) => {
                const list = chaptersByStage.get(stage.id) ?? [];
                if (!list.length) return null;
                return (
                  <div key={stage.id}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', padding: '6px 9px 3px', fontWeight: 600 }}>
                      {stage.name}
                    </div>
                    {list.map((c) => (
                      <div
                        key={c.id}
                        className={`chapter-pick${c.id === chapterId ? ' active' : ''}`}
                        onClick={() => setChapterId(c.id)}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name}
                        </span>
                        <span style={{ fontSize: 10.5, color: c.wordCount ? 'var(--text-tertiary)' : 'var(--warning)' }}>
                          {c.wordCount ? `${c.wordCount} 字` : '空章节'}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <Mic size={14} /> 2. 声音与语速
            </div>
            <button className="btn btn-sm" onClick={() => void loadVoices()} disabled={loadingVoices}>
              <RefreshCw size={12} /> 刷新
            </button>
          </div>
          <div className="card-body">
            <div className="field">
              <label className="field-label">语音服务</label>
              <select
                className="select"
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as 'sapi' | 'openai';
                  onProviderChange(next);
                  const p = providers.find((x) => x.provider === next);
                  setVoiceId(p?.voices[0]?.id ?? '');
                }}
              >
                {providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.label}
                    {p.configured ? '' : '（未配置）'}
                  </option>
                ))}
              </select>
            </div>
            {loadingVoices ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
                <Spinner /> 正在检测可用声音…
              </div>
            ) : !activeProvider?.configured ? (
              <div className="warn-note" style={{ marginBottom: 0 }}>
                {provider === 'sapi'
                  ? '未检测到 Windows 本地语音。请到系统「设置 → 时间和语言 → 语音」安装语音包，或切换到在线语音服务。'
                  : '在线语音服务未配置。请点击「服务设置」填写 API 密钥、服务地址与模型。'}
                {activeProvider?.error ? <div style={{ marginTop: 4 }}>错误：{activeProvider.error}</div> : null}
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={onOpenConfig}>
                    打开服务设置
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="voice-grid">
                  {voices.map((v) => (
                    <div
                      key={v.id}
                      className={`voice-card${v.id === voiceId ? ' active' : ''}`}
                      onClick={() => setVoiceId(v.id)}
                    >
                      <div className="vn">
                        <Volume2 size={12} />
                        {v.name}
                      </div>
                      <div className="vm">
                        {v.locale}
                        {v.gender ? ` · ${v.gender}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
                  <label className="field-label">语速：{rate > 0 ? `+${rate}` : rate}</label>
                  <input
                    type="range"
                    min={-10}
                    max={10}
                    step={1}
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <AudioLines size={14} /> 3. 生成离线音频
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {chapter ? `${chapter.name} · ${chapter.wordCount} 字` : '未选择章节'}
          </span>
        </div>
        <div className="card-body">
          {chapter?.wordCount ? (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.7 }}>
              将使用章节已保存的正文合成语音文件，可导出为 MP3 / WAV。按中文朗读速度估算约{' '}
              {Math.max(1, Math.round(chapter.wordCount / 3.2 / 60))} 分钟。
            </div>
          ) : (
            <div className="warn-note">当前章节正文为空，无法生成音频。请先在内容页写作并保存。</div>
          )}
          <button
            className="btn btn-primary btn-lg"
            onClick={() => void createJob()}
            disabled={creating || !configured || !chapter?.wordCount || !voiceId}
            style={{ width: '100%' }}
          >
            {creating ? <span className="spinner" /> : <AudioLines size={16} />}
            生成离线音频
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <Clock size={14} /> 生成任务
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
                ? '生成中…'
                : `${jobs.length} 条记录`}
            </span>
            <button className="btn btn-sm" onClick={() => void loadJobs()}>
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
        <div className="card-body" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {jobs.length === 0 ? (
            <div className="empty-state" style={{ padding: '36px 12px' }}>
              <div className="icon-wrap">
                <AudioLines size={20} />
              </div>
              <h3>还没有离线音频</h3>
              <p style={{ fontSize: 12 }}>选择章节和声音后点击「生成离线音频」，任务会显示在这里。</p>
            </div>
          ) : (
            jobs.map((job) => {
              const meta = AUDIO_STATUS_META[job.status];
              const pending = job.status === 'queued' || job.status === 'running';
              return (
                <div className="job-row" key={job.id}>
                  <div className="job-head">
                    <span className="badge" style={{ background: meta.bg, color: meta.color }}>
                      {pending ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : null}
                      {meta.label}
                    </span>
                    <span className="job-name" title={job.chapterName}>
                      {job.chapterName}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                      {job.provider === 'sapi' ? '本地语音' : '在线语音'} · {job.voiceName}
                    </span>
                    <button className="icon-btn" onClick={() => void deleteJob(job)} title="删除任务">
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {pending ? (
                    <>
                      <div className="progress">
                        <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
                      </div>
                      <div className="job-meta">
                        <span>
                          {job.message || '处理中'} · {Math.round(job.progress * 100)}%
                        </span>
                      </div>
                    </>
                  ) : job.status === 'failed' ? (
                    <div className="job-error">
                      <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                      {job.error || '生成失败'}
                    </div>
                  ) : job.status === 'succeeded' ? (
                    <div className="audio-player" style={{ marginTop: 6 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => (playingId === job.id ? stopAudio() : playJob(job))}
                        disabled={!job.mediaUrl}
                        title={job.mediaUrl ? '播放' : '文件不存在'}
                      >
                        {playingId === job.id ? <Pause size={13} /> : <Play size={13} />}
                        {playingId === job.id ? '暂停' : '播放'}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {job.format.toUpperCase()} · {formatDuration(job.durationMs)} · {formatBytes(job.size)}
                        </div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: 'var(--text-tertiary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {job.filePath ?? '文件位置未知'}
                        </div>
                      </div>
                      <button className="btn btn-sm" onClick={() => void exportJob(job)}>
                        <Download size={12} /> 导出
                      </button>
                      {job.filePath ? (
                        <button
                          className="icon-btn"
                          onClick={() => void api.showItemInFolder(job.filePath!)}
                          title="在文件夹中显示"
                        >
                          <ExternalLink size={13} />
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="job-meta">
                      <span>{job.message || '已取消'}</span>
                    </div>
                  )}
                  <div className="job-meta" style={{ marginTop: 5 }}>
                    <span>{new Date(job.createdAt).toLocaleString('zh-CN')}</span>
                    <span>{job.charCount} 字</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
