import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Gauge,
  Volume2,
  BookOpen,
  RotateCcw,
  Settings2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import type { Chapter, ProjectStructure, ReadingProgress, ReadingSettings } from '@shared/types';
import { READING_RATE_OPTIONS } from '@shared/constants';
import {
  SpeechReader,
  SPEAK_RESTART_DELAY_MS,
  findSegmentIndex,
  formatClock,
  isSpeechSupported,
  loadVoices,
  sortVoices,
  type ReaderProgress,
  type ReaderVoice,
} from '../../lib/reading';
import { buildChapterTree } from '../../lib/chapterTree';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';

interface Props {
  projectId: string;
  structure: ProjectStructure;
  settings: ReadingSettings;
  rememberReading: boolean;
  progressMap: Record<string, ReadingProgress>;
  onSettingsChange: (patch: Partial<ReadingSettings>) => void;
  onProgressSaved: (progress: ReadingProgress) => void;
  onOpenConfig: () => void;
}

/** 进度保存：防抖 1.2s，但连续朗读时最多 8s 必须落盘一次。 */
const SAVE_DEBOUNCE_MS = 1200;
const FORCE_SAVE_MS = 8000;

const EMPTY_PROGRESS: ReaderProgress = {
  state: 'idle',
  charIndex: 0,
  charTotal: 0,
  segmentIndex: -1,
  elapsedMs: 0,
  totalMs: 0,
};

/** 提词器窗口的行数上限（按窗口高度动态收敛，避免小窗裁切、大窗大片留白）。 */
const MAX_LINES_BEFORE = 6;
const MAX_LINES_AFTER = 16;
/** 单行占用的估算高度（px）：字号 21 × 行高 1.9 + 上下内边距。 */
const LINE_HEIGHT_PX = 21 * 1.9 + 14;

function formatRate(rate: number): string {
  return String(Number(rate.toFixed(2)));
}

/**
 * 系统语音名很长（如「Microsoft Huihui - Chinese (Simplified, PRC)」），
 * 下拉框里只保留可辨识的部分，完整名称放到 title 里。
 */
export function shortVoiceName(name: string): string {
  const parts = name.split(' - ');
  const head = (parts[0] ?? name).replace(/^Microsoft\s+/i, '').trim();
  if (parts.length < 2) return head || name;
  const locale = parts[1];
  const lang = /Chinese \(Simplified/i.test(locale)
    ? '中文'
    : /Chinese \(Traditional/i.test(locale)
      ? '繁中'
      : /English/i.test(locale)
        ? 'EN'
        : /Japanese/i.test(locale)
          ? '日文'
          : locale.split(' ')[0];
  return `${head} · ${lang}`;
}

export function ReaderView({
  projectId,
  structure,
  settings,
  rememberReading,
  progressMap,
  onSettingsChange,
  onProgressSaved,
  onOpenConfig,
}: Props) {
  const chapters = structure.chapters;
  const [chapterId, setChapterId] = useState<string | null>(
    settings.chapterId && chapters.some((c) => c.id === settings.chapterId)
      ? settings.chapterId
      : chapters[0]?.id ?? null,
  );
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ReaderProgress>(EMPTY_PROGRESS);
  const [voices, setVoices] = useState<ReaderVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [dragChar, setDragChar] = useState<number | null>(null);
  const [resumeHint, setResumeHint] = useState<number | null>(null);
  const [rateOpen, setRateOpen] = useState(false);

  const readerRef = useRef<SpeechReader | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const linesRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);
  const chapterRef = useRef<string | null>(chapterId);
  const saveTimer = useRef<number | null>(null);
  const lastSaved = useRef<number>(-1);
  const lastSaveAt = useRef<number>(0);
  /** 供朗读器回调读取的最新 props 快照（避免闭包拿到首次渲染的旧值）。 */
  const latestRef = useRef({ chapters, autoNext: settings.autoNext });
  /** 上一章自然读完、需要自动接着朗读下一章时为 true */
  const autoContinueRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [windowHeight, setWindowHeight] = useState(0);

  const chapter: Chapter | null = useMemo(
    () => chapters.find((c) => c.id === chapterId) ?? null,
    [chapters, chapterId],
  );

  // 渲染期间直接写 ref 在并发渲染下不严谨，改到提交后同步
  useEffect(() => {
    chapterRef.current = chapterId;
  }, [chapterId]);

  useEffect(() => {
    latestRef.current = { chapters, autoNext: settings.autoNext };
  }, [chapters, settings.autoNext]);

  // 卷册分级目录：卷 → 每 20 章一组（与内容页共用同一套切分规则）
  const chapterTree = useMemo(() => buildChapterTree(structure.stages, chapters), [structure.stages, chapters]);
  const stageName = useMemo(() => {
    if (!chapter?.stageId) return null;
    return structure.stages.find((s) => s.id === chapter.stageId)?.name ?? null;
  }, [chapter, structure.stages]);

  const chapterIndex = chapters.findIndex((c) => c.id === chapterId);
  const nextChapter = chapterIndex >= 0 ? chapters[chapterIndex + 1] ?? null : null;

  // ---------- 保存朗读进度 ----------
  // 三处配合：① 防抖 1.2s 内的最后一次位置；② 强制节流，连续朗读时至少每 8s 落盘一次；
  // ③ 章节 id 在「安排保存」时就锁定，避免旧章的计时器把进度写进新章。
  const saveProgressNow = useCallback(
    (cid: string | null, charIndex: number, charTotal: number, force = false) => {
      if (!cid || !rememberReading || charTotal <= 0) return;
      if (!force && Math.abs(charIndex - lastSaved.current) < 8) return;
      lastSaved.current = charIndex;
      const savedAt = Date.now();
      lastSaveAt.current = savedAt;
      void api
        .readingProgress(projectId, {
          chapterId: cid,
          charIndex,
          charTotal,
          percent: charTotal > 0 ? charIndex / charTotal : 0,
        })
        .then(onProgressSaved)
        .catch(() => {
          // 失败时回退标记，下次进度变化会重试，避免该位置永久丢失
          if (lastSaveAt.current === savedAt) lastSaved.current = -1;
        });
    },
    [projectId, rememberReading, onProgressSaved],
  );

  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const scheduleSave = useCallback(
    (charIndex: number, charTotal: number) => {
      const cid = chapterRef.current;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      // 连续朗读（boundary 持续触发）时不能一直推迟，超过 8s 立刻落盘
      const sinceLast = Date.now() - lastSaveAt.current;
      if (sinceLast >= FORCE_SAVE_MS) {
        saveTimer.current = null;
        saveProgressNow(cid, charIndex, charTotal);
        return;
      }
      const delay = Math.min(SAVE_DEBOUNCE_MS, FORCE_SAVE_MS - sinceLast);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        saveProgressNow(cid, charIndex, charTotal);
      }, delay);
    },
    [saveProgressNow],
  );

  // ---------- 初始化朗读器 ----------
  useEffect(() => {
    const reader = new SpeechReader({
      onProgress: (p) => {
        setProgress(p);
        if (p.state === 'playing') scheduleSave(p.charIndex, p.charTotal);
      },
      onError: (message) => toast.error(message),
      onFinished: () => {
        // 从最新快照里取章节列表与开关，避免闭包捕获首次渲染的旧数据
        const { chapters: latest, autoNext } = latestRef.current;
        const current = chapterRef.current;
        const idx = latest.findIndex((c) => c.id === current);
        const next = idx >= 0 ? latest[idx + 1] : null;
        if (autoNext && next) {
          // 标记「自动续读」：下一章正文加载完成后要接着 play()，
          // 否则 load() 会把状态重置为 idle，用户看到的是下一章只载入不发声。
          autoContinueRef.current = true;
          toast.info(`本章读完，继续朗读《${next.name}》`);
          setChapterId(next.id);
        }
      },
    });
    readerRef.current = reader;
    return () => {
      // 卸载时必须先落盘再销毁朗读器，否则最后一段进度会丢
      cancelPendingSave();
      saveProgressNow(chapterRef.current, reader.currentCharIndex, reader.charTotal, true);
      reader.dispose();
      readerRef.current = null;
    };
    // 只创建一次；章节/设置变化通过下面的 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelPendingSave, saveProgressNow]);

  // 语音列表
  useEffect(() => {
    let alive = true;
    void loadVoices().then((list) => {
      if (!alive) return;
      setVoices(sortVoices(list));
      setVoicesLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---------- 载入章节正文 ----------
  useEffect(() => {
    if (!chapterId) {
      setContent('');
      setProgress(EMPTY_PROGRESS);
      return;
    }
    let alive = true;
    setLoading(true);
    setResumeHint(null);
    cancelPendingSave();
    void api
      .getContent(chapterId)
      .then((data) => {
        if (!alive) return;
        const text = data.content ?? '';
        setContent(text);
        const saved = rememberReading ? progressMap[chapterId] : undefined;
        const startChar = saved && saved.charIndex > 0 && saved.charIndex < text.length ? saved.charIndex : 0;
        lastSaved.current = startChar;
        const reader = readerRef.current;
        // 只有「上一章自然读完、自动切到下一章」时才自动继续播放。
        // 不能拿「进度为 0」来推断：首次打开一个没有进度的章节也是 0，
        // 那样会导致每次进入音频页都自动朗读，并与用户手动点击播放产生竞态。
        const shouldAutoContinue = autoContinueRef.current;
        autoContinueRef.current = false;
        const resumeAt = shouldAutoContinue ? 0 : startChar;
        reader?.load(text, resumeAt);
        if (shouldAutoContinue) {
          // 延后一拍，让 load() 内部的 cancel 与 React 状态提交先完成，再启动播放
          window.setTimeout(() => {
            if (alive) readerRef.current?.play();
          }, SPEAK_RESTART_DELAY_MS + 40);
        }
        setResumeHint(!shouldAutoContinue && startChar > 0 ? startChar : null);
      })
      .catch((err) => {
        if (!alive) return;
        toast.error(err instanceof Error ? err.message : '读取章节正文失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // progressMap 只用于首次定位，不参与依赖，避免进度保存后重载正文
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, rememberReading, cancelPendingSave]);

  // ---------- 同步朗读参数 ----------
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader) return;
    reader.setRate(settings.rate);
    reader.setPitch(settings.pitch);
    reader.setVolume(settings.volume);
    if (settings.voiceId) reader.setVoiceByName(settings.voiceId);
  }, [settings.rate, settings.pitch, settings.volume, settings.voiceId]);

  // 默认选中一个中文声音
  useEffect(() => {
    if (settings.voiceId || !voices.length) return;
    onSettingsChange({ voiceId: voices[0].id });
  }, [voices, settings.voiceId, onSettingsChange]);

  // 记录当前章节，下次打开直接回到这一章
  useEffect(() => {
    if (!chapterId || settings.chapterId === chapterId) return;
    onSettingsChange({ chapterId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  // ---------- 键盘控制 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        readerRef.current?.toggle();
      } else if (e.key === 'ArrowRight' && e.altKey) {
        e.preventDefault();
        readerRef.current?.stepSentence(1);
      } else if (e.key === 'ArrowLeft' && e.altKey) {
        e.preventDefault();
        readerRef.current?.stepSentence(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const segments = readerRef.current?.segmentList ?? [];
  const charTotal = progress.charTotal || content.length;
  const charIndex = dragChar ?? progress.charIndex;
  const ratio = charTotal > 0 ? Math.min(1, Math.max(0, charIndex / charTotal)) : 0;
  const elapsedMs = charTotal > 0 ? (charIndex / charTotal) * progress.totalMs : 0;
  const playing = progress.state === 'playing';
  const ended = progress.state === 'ended';

  // 拖动时预览目标句，松手后朗读器再真正跳转
  const focusIndex = useMemo(() => {
    if (!segments.length) return -1;
    const at = dragChar ?? progress.charIndex;
    return findSegmentIndex(segments, at);
  }, [segments, dragChar, progress.charIndex]);

  // 按可用高度决定显示几行：当前句停在中线偏上，上下行数随窗口自动收敛
  const capacity = Math.max(3, Math.floor((windowHeight || 600) / LINE_HEIGHT_PX));
  const linesBefore = Math.min(MAX_LINES_BEFORE, Math.max(1, Math.floor(capacity * 0.35)));
  const linesAfter = Math.min(MAX_LINES_AFTER, Math.max(2, capacity - linesBefore - 1));
  const windowStart = Math.max(0, focusIndex - linesBefore);
  const windowEnd = Math.min(segments.length, focusIndex + linesAfter + 1);
  const visible = segments.slice(windowStart, windowEnd);

  // 提词器滚动：当前句停在中线偏上，但不让文字滚出内容区（开头/结尾都不会留大片空白）
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const active = activeRef.current;
    const lines = linesRef.current;
    if (!stage || !active || !lines) return;
    const anchor = stage.clientHeight * 0.42;
    const activeCenter = active.offsetTop + active.offsetHeight / 2;
    const maxOffset = Math.min(0, stage.clientHeight - lines.scrollHeight);
    // 内容不足一屏时贴顶显示，避免大窗口里文字飘在中间、下方大片空白
    const target = lines.scrollHeight <= stage.clientHeight
      ? 0
      : Math.max(maxOffset, Math.min(0, anchor - activeCenter));
    setOffset(target);
  }, [focusIndex, windowStart, content, windowHeight, linesAfter, linesBefore]);

  // 窗口尺寸变化时重新计算，避免拉伸窗口后文字跑偏
  useEffect(() => {
    const onResize = () => setWindowHeight(stageRef.current?.clientHeight ?? 0);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const seekTo = (char: number, commit: boolean) => {
    const reader = readerRef.current;
    if (!reader) return;
    reader.seek(char);
    if (commit) {
      // 拖动/点句是明确的用户意图，直接落盘，不等防抖
      cancelPendingSave();
      saveProgressNow(chapterRef.current, char, reader.charTotal, true);
    }
  };

  const ratioFromEvent = (clientX: number, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  };

  const currentVoice = voices.find((v) => v.id === settings.voiceId) ?? voices[0] ?? null;
  const supported = isSpeechSupported();

  return (
    <div className="reader-layout">
      <div className="reader-main">
        <div className="reader-stage" ref={stageRef}>
          {loading ? (
            <div className="reader-placeholder">正在载入正文…</div>
          ) : !content.trim() ? (
            <div className="reader-placeholder">
              <BookOpen size={26} />
              <div>本章还没有正文</div>
              <div style={{ fontSize: 12 }}>请先在「内容」中写作并保存，再回来朗读。</div>
            </div>
          ) : (
            <div className="reader-lines" ref={linesRef} style={{ transform: `translateY(${offset}px)` }}>
              {visible.map((seg, i) => {
                const idx = windowStart + i;
                const active = idx === focusIndex;
                const read = seg.end <= charIndex;
                return (
                  <div
                    key={`${seg.start}-${idx}`}
                    ref={active ? activeRef : undefined}
                    className={`reader-line${active ? ' active' : ''}${read ? ' read' : ''}`}
                    onClick={() => seekTo(seg.start, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        seekTo(seg.start, true);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title="点击或回车从此处开始朗读"
                  >
                    {seg.text}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {resumeHint !== null && charTotal > 0 ? (
          <div className="reader-resume">
            <Sparkles size={13} />
            上次读到 {Math.round((resumeHint / charTotal) * 100)}%
            <button
              className="btn btn-sm"
              onClick={() => {
                readerRef.current?.seek(0);
                setResumeHint(null);
                cancelPendingSave();
                saveProgressNow(chapterRef.current, 0, charTotal, true);
              }}
            >
              <RotateCcw size={12} /> 从头开始
            </button>
            <button className="icon-btn" onClick={() => setResumeHint(null)} title="继续上次位置">
              ×
            </button>
          </div>
        ) : null}
      </div>

      <div className="reader-controls">
        <div
          className="reader-progress"
          role="slider"
          aria-label="本章朗读进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuetext={`${Math.round(ratio * 100)}%，${formatClock(elapsedMs)} / ${formatClock(progress.totalMs)}`}
          aria-orientation="horizontal"
          tabIndex={0}
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 某些环境不支持指针捕获，退化为普通拖动 */
            }
            const r = ratioFromEvent(e.clientX, e.currentTarget);
            setDragChar(Math.round(r * charTotal));
          }}
          onPointerMove={(e) => {
            if (dragChar === null) return;
            const r = ratioFromEvent(e.clientX, e.currentTarget);
            setDragChar(Math.round(r * charTotal));
          }}
          onPointerUp={(e) => {
            const el = e.currentTarget;
            try {
              if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            } catch {
              /* 忽略 */
            }
            if (dragChar === null) return;
            const r = ratioFromEvent(e.clientX, el);
            const target = Math.round(r * charTotal);
            setDragChar(null);
            seekTo(target, true);
          }}
          onPointerCancel={(e) => {
            try {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            } catch {
              /* 忽略 */
            }
            setDragChar(null);
          }}
          onKeyDown={(e) => {
            const page = Math.max(1, Math.round(charTotal * 0.1));
            const small = Math.max(1, Math.round(charTotal * 0.02));
            let target: number | null = null;
            if (e.key === 'ArrowRight') target = charIndex + small;
            else if (e.key === 'ArrowLeft') target = charIndex - small;
            else if (e.key === 'PageUp') target = charIndex + page;
            else if (e.key === 'PageDown') target = charIndex - page;
            else if (e.key === 'Home') target = 0;
            else if (e.key === 'End') target = charTotal;
            if (target === null) return;
            e.preventDefault();
            seekTo(Math.min(charTotal, Math.max(0, target)), true);
          }}
        >
          <div className="reader-progress-track">
            <div className="reader-progress-fill" style={{ width: `${ratio * 100}%` }} />
            <div className="reader-progress-thumb" style={{ left: `${ratio * 100}%` }} />
          </div>
          <div className="reader-progress-meta">
            <span>{formatClock(elapsedMs)}</span>
            <span className="reader-progress-chapter">
              {chapter ? `${chapter.name} · ${Math.round(ratio * 100)}%` : '未选择章节'}
            </span>
            <span>{formatClock(progress.totalMs)}</span>
          </div>
        </div>

        <div className="reader-bar">
          <div className="reader-bar-group reader-bar-left">
            <label className="reader-pill" title="选择要朗读的章节">
              <BookOpen size={14} />
              <select
                className="reader-select"
                value={chapterId ?? ''}
                onChange={(e) => {
                  const p = readerRef.current;
                  // 先把旧章节的进度落盘，并清掉可能残留的防抖计时器，避免写进新章节
                  cancelPendingSave();
                  if (p) saveProgressNow(chapterRef.current, p.currentCharIndex, p.charTotal, true);
                  setChapterId(e.target.value || null);
                }}
              >
                {chapters.length === 0 ? <option value="">暂无章节</option> : null}
                {/* 卷 → 每 20 章一个分组，与「内容」页目录层级保持一致 */}
                {chapterTree.map((volume) => (
                  <optgroup key={volume.id} label={volume.label}>
                    {volume.groups.map((group) =>
                      group.chapters.map((c) => {
                        const saved = progressMap[c.id];
                        const pct = saved ? Math.round(saved.percent * 100) : 0;
                        return (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {pct > 0 ? `（已读 ${pct}%）` : ''}
                          </option>
                        );
                      }),
                    )}
                  </optgroup>
                ))}
              </select>
            </label>

            <div className="reader-pill reader-rate" title="语速（朗读中也可以随时调整）">
              <Gauge size={14} />
              <button className="reader-rate-value" onClick={() => setRateOpen((v) => !v)}>
                {formatRate(settings.rate)}×
              </button>
              {rateOpen ? (
                <div className="reader-rate-pop" onMouseLeave={() => setRateOpen(false)}>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.05}
                    value={settings.rate}
                    onChange={(e) => onSettingsChange({ rate: Number(e.target.value) })}
                  />
                  <div className="reader-rate-presets">
                    {READING_RATE_OPTIONS.map((r) => (
                      <button
                        key={r}
                        className={`reader-rate-preset${Math.abs(settings.rate - r) < 0.01 ? ' active' : ''}`}
                        onClick={() => onSettingsChange({ rate: r })}
                      >
                        {r}×
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="reader-bar-group reader-bar-center">
            <button className="icon-btn" onClick={() => readerRef.current?.stepSentence(-1)} title="上一句（Alt + ←）">
              <SkipBack size={16} />
            </button>
            <button
              className="reader-play"
              onClick={() => readerRef.current?.toggle()}
              disabled={!supported || !content.trim()}
              title={playing ? '暂停（空格）' : ended ? '重新朗读（空格）' : '开始朗读（空格）'}
            >
              {playing ? <Pause size={22} /> : <Play size={22} style={{ marginLeft: 2 }} />}
            </button>
            <button className="icon-btn" onClick={() => readerRef.current?.stepSentence(1)} title="下一句（Alt + →）">
              <SkipForward size={16} />
            </button>
          </div>

          <div className="reader-bar-group reader-bar-right">
            <label className="reader-pill" title="朗读声音">
              <Volume2 size={14} />
              <select
                className="reader-select reader-select-voice"
                value={settings.voiceId}
                onChange={(e) => onSettingsChange({ voiceId: e.target.value })}
                disabled={voicesLoading || voices.length === 0}
              >
                {voices.length === 0 ? <option value="">未检测到系统语音</option> : null}
                {voices.map((v) => (
                  <option key={v.id} value={v.id} title={v.name}>
                    {shortVoiceName(v.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="reader-pill" title="音量">
              <input
                type="range"
                min={0}
                max={100}
                value={settings.volume}
                onChange={(e) => onSettingsChange({ volume: Number(e.target.value) })}
                className="reader-volume"
              />
            </label>
            <button className="icon-btn" onClick={onOpenConfig} title="语音服务设置">
              <Settings2 size={15} />
            </button>
          </div>
        </div>

        {!supported ? (
          <div className="reader-warn">
            <AlertCircle size={13} />
            当前系统未启用实时朗读能力，请改用「离线音频」生成后再播放。
          </div>
        ) : !voicesLoading && voices.length === 0 ? (
          <div className="reader-warn">
            <AlertCircle size={13} />
            未检测到系统语音。请到 Windows「设置 → 时间和语言 → 语音」安装中文语音包。
          </div>
        ) : null}
        {stageName || chapter ? (
          <div className="reader-footnote">
            {stageName ? `${stageName} · ` : ''}
            {chapter?.name ?? ''}
            {chapter?.wordCount ? ` · ${chapter.wordCount} 字` : ''}
            {currentVoice ? ` · 当前声音：${currentVoice.name}` : ''}
            {nextChapter ? ` · 读完自动继续《${nextChapter.name}》` : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}
