import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Gauge,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react';
import type { Project, ProjectStructure, ReadingProgress, ReadingSettings } from '@shared/types';
import {
  SpeechReader,
  formatClock,
  isSpeechSupported,
  loadVoices,
  sortVoices,
  type ReaderProgress,
  type ReaderVoice,
} from '../lib/reading';
import { MAX_RATE, MIN_RATE, RATE_PRESETS, clampRate, formatRate } from '../lib/readingRate';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { ToastHost } from '../components/ui';

/** 进度保存：防抖 1.2s；连续朗读时最多 8s 必须落盘一次（与主窗口朗读器一致）。 */
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

const DEFAULT_READING: ReadingSettings = {
  engine: 'web',
  provider: 'sapi',
  voiceId: '',
  rate: 1,
  pitch: 1,
  volume: 100,
  chapterId: null,
  autoNext: true,
};

/** 解析 hash 路由里的查询串：#/mini-reader?projectId=xxx&chapterId=yyy */
function readHashQuery(): URLSearchParams {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const at = hash.indexOf('?');
  return new URLSearchParams(at >= 0 ? hash.slice(at + 1) : '');
}

/**
 * 系统语音名很长（「Microsoft Huihui - Chinese (Simplified, PRC)」），
 * 下拉框里只显示可辨识的短名；完整名称放到 option 的 title 里。
 */
function shortVoiceName(name: string): string {
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

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

export function MiniReaderPage() {
  // ---------- 数据 ----------
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [structure, setStructure] = useState<ProjectStructure | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, ReadingProgress>>({});

  // ---------- 朗读状态 ----------
  const [progress, setProgress] = useState<ReaderProgress>(EMPTY_PROGRESS);
  const [dragChar, setDragChar] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [loadingProject, setLoadingProject] = useState(true);

  // ---------- 偏好 ----------
  const [rememberReading, setRememberReading] = useState(true);
  const [autoNext, setAutoNext] = useState(true);
  const [rate, setRate] = useState(1);
  const [rateText, setRateText] = useState('1');
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(100);
  const [voiceId, setVoiceId] = useState('');
  const [voices, setVoices] = useState<ReaderVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);

  // ---------- 提示 ----------
  const [savedPct, setSavedPct] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---------- refs（供朗读器回调读取最新值，避免闭包拿到首次渲染的旧数据） ----------
  const readerRef = useRef<SpeechReader | null>(null);
  const projectIdRef = useRef<string | null>(null);
  const chapterRef = useRef<string | null>(null);
  const rememberRef = useRef(true);
  const readingRef = useRef<ReadingSettings>({ ...DEFAULT_READING });
  const rateRef = useRef(1);
  const progressMapRef = useRef<Record<string, ReadingProgress>>({});
  const latestRef = useRef<{ chapters: ProjectStructure['chapters']; autoNext: boolean }>({
    chapters: [],
    autoNext: true,
  });
  const desiredChapterRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSaved = useRef<number>(-1);
  const lastSaveAt = useRef<number>(0);
  const persistTimer = useRef<number | null>(null);
  const dragRef = useRef<number | null>(null);
  /** 上一次的朗读状态：只在「播放中 → 暂停/读完」这个停点上强制落盘 */
  const prevStateRef = useRef<ReaderProgress['state']>('idle');

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);
  useEffect(() => {
    chapterRef.current = chapterId;
  }, [chapterId]);
  useEffect(() => {
    rememberRef.current = rememberReading;
  }, [rememberReading]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  useEffect(() => {
    latestRef.current = { chapters: structure?.chapters ?? [], autoNext };
  }, [structure, autoNext]);
  useEffect(() => {
    dragRef.current = dragChar;
  }, [dragChar]);

  // ---------- 保存朗读进度 ----------
  const saveProgressNow = useCallback(
    (cid: string | null, charIndex: number, charTotal: number, force = false) => {
      const pid = projectIdRef.current;
      if (!cid || !pid || !rememberRef.current || charTotal <= 0) return;
      if (!force && Math.abs(charIndex - lastSaved.current) < 8) return;
      lastSaved.current = charIndex;
      const savedAt = Date.now();
      lastSaveAt.current = savedAt;
      const percent = charTotal > 0 ? Math.min(1, Math.max(0, charIndex / charTotal)) : 0;
      void api
        .readingProgress(pid, { chapterId: cid, charIndex, charTotal, percent })
        .then((saved) => {
          progressMapRef.current = { ...progressMapRef.current, [saved.chapterId]: saved };
          setProgressMap(progressMapRef.current);
          setSavedPct(Math.round(saved.percent * 100));
        })
        .catch((err: unknown) => {
          if (lastSaveAt.current === savedAt) lastSaved.current = -1;
          const message = errorText(err, '保存朗读进度失败');
          setErrorMsg(message);
          toast.error(message);
        });
    },
    [],
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

  /** 立刻把「当前章节 + 朗读器位置」落盘（切章、暂停、卸载、拖动结束时调用）。 */
  const saveCurrentProgress = useCallback(() => {
    const reader = readerRef.current;
    if (!reader) return;
    cancelPendingSave();
    saveProgressNow(chapterRef.current, reader.currentCharIndex, reader.charTotal, true);
  }, [cancelPendingSave, saveProgressNow]);

  // ---------- 偏好落盘（防抖 400ms，避免拖动音量时疯狂写库） ----------
  const persistReading = useCallback((patch: Partial<ReadingSettings>) => {
    readingRef.current = { ...readingRef.current, ...patch };
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      const snapshot = readingRef.current;
      void api.updateSettings({ reading: snapshot }).catch((err: unknown) => {
        const message = errorText(err, '保存朗读偏好失败');
        setErrorMsg(message);
        toast.error(message);
      });
    }, 400);
  }, []);

  // ---------- 切章 / 切书 ----------
  const switchChapter = useCallback(
    (nextId: string | null) => {
      if (!nextId || nextId === chapterRef.current) return;
      saveCurrentProgress();
      setChapterId(nextId);
      persistReading({ chapterId: nextId });
    },
    [saveCurrentProgress, persistReading],
  );

  const switchProject = useCallback(
    (nextId: string) => {
      if (!nextId || nextId === projectIdRef.current) return;
      saveCurrentProgress();
      desiredChapterRef.current = null;
      setStructure(null);
      setChapterId(null);
      setProjectId(nextId);
      persistReading({ chapterId: null });
      void api.updateSettings({ lastProjectId: nextId }).catch((err: unknown) => {
        const message = errorText(err, '记住项目失败');
        setErrorMsg(message);
        toast.error(message);
      });
    },
    [saveCurrentProgress, persistReading],
  );

  // ---------- 朗读器（只创建一次） ----------
  // 回调里一律走 ref 取最新状态，避免依赖变化把朗读器重建（重建会打断正在播放的语音）
  const switchChapterRef = useRef(switchChapter);
  useEffect(() => {
    switchChapterRef.current = switchChapter;
  }, [switchChapter]);

  useEffect(() => {
    const reader = new SpeechReader({
      onProgress: (p) => {
        setProgress(p);
        if (p.state === 'playing') {
          scheduleSave(p.charIndex, p.charTotal);
        } else if (
          prevStateRef.current === 'playing' &&
          (p.state === 'paused' || p.state === 'ended')
        ) {
          // 暂停 / 读完是明确的停点，立即落盘，不等防抖
          cancelPendingSave();
          saveProgressNow(chapterRef.current, p.charIndex, p.charTotal, true);
        }
        prevStateRef.current = p.state;
      },
      onError: (message) => {
        setErrorMsg(message);
        toast.error(message);
      },
      onFinished: () => {
        const { chapters, autoNext: follow } = latestRef.current;
        const current = chapterRef.current;
        const idx = chapters.findIndex((c) => c.id === current);
        const next = idx >= 0 ? chapters[idx + 1] ?? null : null;
        if (follow && next) {
          toast.info(`本章读完，继续朗读《${next.name}》`);
          switchChapterRef.current(next.id);
        }
      },
    });
    readerRef.current = reader;
    return () => {
      // 卸载：先落盘再销毁，否则最后一段进度会丢
      cancelPendingSave();
      saveProgressNow(chapterRef.current, reader.currentCharIndex, reader.charTotal, true);
      reader.dispose();
      readerRef.current = null;
    };
    // 只创建一次；章节/偏好变化由各自的 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelPendingSave, saveProgressNow, scheduleSave]);

  // ---------- 初始化：偏好 + 项目列表 + URL 参数 ----------
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [settings, list] = await Promise.all([api.settings(), api.listProjects()]);
        if (!alive) return;
        const query = readHashQuery();
        const reading = { ...DEFAULT_READING, ...(settings.reading ?? {}) };
        readingRef.current = reading;
        setProjects(list);
        setRememberReading(settings.rememberReading !== false);
        setAutoNext(reading.autoNext !== false);
        setRate(clampRate(reading.rate));
        setRateText(formatRate(clampRate(reading.rate)));
        setPitch(Number.isFinite(reading.pitch) ? reading.pitch : 1);
        setVolume(Number.isFinite(reading.volume) ? Math.min(100, Math.max(0, reading.volume)) : 100);
        setVoiceId(reading.voiceId ?? '');
        const wantedProject =
          (query.get('projectId') && list.some((p) => p.id === query.get('projectId'))
            ? query.get('projectId')
            : null) ??
          (settings.lastProjectId && list.some((p) => p.id === settings.lastProjectId)
            ? settings.lastProjectId
            : null) ??
          list[0]?.id ??
          null;
        desiredChapterRef.current = query.get('chapterId') ?? reading.chapterId ?? null;
        setProjectId(wantedProject);
        if (!wantedProject) {
          setLoadingProject(false);
          setErrorMsg('还没有任何项目，请先在主窗口新建一本书。');
        }
      } catch (err) {
        if (!alive) return;
        const message = errorText(err, '初始化朗读窗口失败');
        setErrorMsg(message);
        toast.error(message);
        setLoadingProject(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---------- 载入项目结构 + 已保存进度 ----------
  useEffect(() => {
    if (!projectId) {
      setLoadingProject(false);
      return;
    }
    let alive = true;
    setLoadingProject(true);
    void (async () => {
      try {
        const [st, ps] = await Promise.all([api.projectStructure(projectId), api.projectSettings(projectId)]);
        if (!alive) return;
        progressMapRef.current = ps.readingProgress ?? {};
        setProgressMap(progressMapRef.current);
        setStructure(st);
        const wanted = desiredChapterRef.current;
        desiredChapterRef.current = null;
        const target = wanted && st.chapters.some((c) => c.id === wanted) ? wanted : st.chapters[0]?.id ?? null;
        setChapterId(target);
        if (target) persistReading({ chapterId: target });
        if (!st.chapters.length) setErrorMsg('这本书还没有章节，请先在主窗口新建章节。');
        else setErrorMsg(null);
      } catch (err) {
        if (!alive) return;
        const message = errorText(err, '加载书籍结构失败');
        setErrorMsg(message);
        toast.error(message);
      } finally {
        if (alive) setLoadingProject(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, persistReading]);

  // ---------- 载入章节正文 ----------
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader) return;
    if (!chapterId) {
      setText('');
      setProgress(EMPTY_PROGRESS);
      reader.load('', 0);
      return;
    }
    let alive = true;
    setLoadingChapter(true);
    setDragChar(null);
    cancelPendingSave();
    void (async () => {
      try {
        const data = await api.getContent(chapterId);
        if (!alive) return;
        const next = data.content ?? '';
        setText(next);
        const saved = rememberRef.current ? progressMapRef.current[chapterId] : undefined;
        const startChar = saved && saved.charIndex > 0 && saved.charIndex < next.length ? saved.charIndex : 0;
        lastSaved.current = startChar;
        reader.load(next, startChar);
        if (startChar > 0 && next.length > 0) {
          setSavedPct(Math.round((startChar / next.length) * 100));
        } else {
          setSavedPct(null);
        }
      } catch (err) {
        if (!alive) return;
        const message = errorText(err, '读取章节正文失败');
        setErrorMsg(message);
        toast.error(message);
      } finally {
        if (alive) setLoadingChapter(false);
      }
    })();
    return () => {
      alive = false;
    };
    // progressMap 只用于首次定位，不参与依赖，避免保存进度后重新加载正文
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, rememberReading, cancelPendingSave]);

  // ---------- 同步朗读参数（语速在播放中改会立即从当前句重读） ----------
  useEffect(() => {
    readerRef.current?.setRate(rate);
  }, [rate]);
  useEffect(() => {
    readerRef.current?.setPitch(pitch);
  }, [pitch]);
  useEffect(() => {
    readerRef.current?.setVolume(volume);
  }, [volume]);
  useEffect(() => {
    if (!voiceId) return;
    readerRef.current?.setVoiceByName(voiceId);
  }, [voiceId]);

  // ---------- 系统语音 ----------
  useEffect(() => {
    let alive = true;
    void loadVoices()
      .then((list) => {
        if (!alive) return;
        const sorted = sortVoices(list);
        setVoices(sorted);
        setVoicesLoading(false);
        if (!readingRef.current.voiceId && sorted[0]) {
          setVoiceId(sorted[0].id);
          persistReading({ voiceId: sorted[0].id });
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setVoicesLoading(false);
        const message = errorText(err, '读取系统语音失败');
        setErrorMsg(message);
        toast.error(message);
      });
    return () => {
      alive = false;
    };
    // 只在打开弹窗时检测一次系统语音
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 保存的音色可能已经不在这台机器上（换设备 / 卸载语音包），回落到第一个可用声音
  useEffect(() => {
    if (voicesLoading || !voices.length) return;
    if (voiceId && voices.some((v) => v.id === voiceId)) return;
    const fallback = voices[0].id;
    setVoiceId(fallback);
    readerRef.current?.setVoiceByName(fallback);
    persistReading({ voiceId: fallback });
  }, [voices, voicesLoading, voiceId, persistReading]);

  // ---------- 键盘：空格播放/暂停，Alt+←/→ 上/下一句 ----------
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

  // ---------- 卸载兜底：把还没落盘的偏好改动立刻写掉 ----------
  useEffect(() => {
    return () => {
      if (!persistTimer.current) return;
      window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
      const snapshot = readingRef.current;
      void api.updateSettings({ reading: snapshot }).catch(() => {
        /* 关闭瞬间的失败不再打扰用户 */
      });
    };
  }, []);

  // ---------- 派生值 ----------
  const chapters = structure?.chapters ?? [];
  const chapter = useMemo(() => chapters.find((c) => c.id === chapterId) ?? null, [chapters, chapterId]);
  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  const charTotal = progress.charTotal || text.length;
  const charIndex = dragChar ?? progress.charIndex;
  const ratio = charTotal > 0 ? Math.min(1, Math.max(0, charIndex / charTotal)) : 0;
  const elapsedMs = charTotal > 0 ? ratio * progress.totalMs : 0;
  const percent = Math.round(ratio * 100);
  const playing = progress.state === 'playing';
  const ended = progress.state === 'ended';
  const supported = isSpeechSupported();
  const hasText = text.trim().length > 0;
  const busy = loadingProject || loadingChapter;

  const seekTo = (char: number, commit: boolean) => {
    const reader = readerRef.current;
    if (!reader) return;
    reader.seek(char);
    if (commit) {
      cancelPendingSave();
      saveProgressNow(chapterRef.current, char, reader.charTotal, true);
    }
  };

  const ratioFromEvent = (clientX: number, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  };

  const applyRate = (raw: unknown) => {
    const next = clampRate(raw, rateRef.current);
    setRate(next);
    setRateText(formatRate(next));
    readerRef.current?.setRate(next);
    persistReading({ rate: next });
  };

  const commitRateText = () => {
    const next = clampRate(rateText, rateRef.current);
    applyRate(next);
    setRateText(formatRate(next));
  };

  return (
    <div className="mr-root">
      <header className="mr-head">
        <div className="mr-title" title={project || chapter ? `${project?.name ?? ''} · ${chapter?.name ?? ''}` : '朗读'}>
          {project?.name ?? '未选择书籍'}
          {chapter ? <span className="mr-title-sep"> · </span> : null}
          {chapter?.name ?? ''}
        </div>
        <button
          className="mr-icon-btn"
          title="切到主窗口"
          aria-label="切到主窗口"
          onClick={() => {
            void api.showWindow().catch((err: unknown) => {
              const message = errorText(err, '切换主窗口失败');
              setErrorMsg(message);
              toast.error(message);
            });
          }}
        >
          <Maximize2 size={14} />
        </button>
      </header>

      <section className="mr-stage">
        <div className="mr-percent" aria-label="朗读进度百分比">
          {percent}
          <span className="mr-percent-unit">%</span>
        </div>
        <div className="mr-clock">
          {formatClock(elapsedMs)}
          <span className="mr-clock-sep"> / </span>
          {formatClock(progress.totalMs)}
        </div>

        <div
          className="mr-progress"
          role="slider"
          aria-label="本章朗读进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent}%，${formatClock(elapsedMs)} / ${formatClock(progress.totalMs)}`}
          aria-orientation="horizontal"
          tabIndex={0}
          onPointerDown={(e) => {
            if (charTotal <= 0) return;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 某些环境不支持指针捕获，退化为普通拖动 */
            }
            setDragChar(Math.round(ratioFromEvent(e.clientX, e.currentTarget) * charTotal));
          }}
          onPointerMove={(e) => {
            if (dragRef.current === null || charTotal <= 0) return;
            setDragChar(Math.round(ratioFromEvent(e.clientX, e.currentTarget) * charTotal));
          }}
          onPointerUp={(e) => {
            const el = e.currentTarget;
            try {
              if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            } catch {
              /* 忽略 */
            }
            if (dragRef.current === null || charTotal <= 0) {
              setDragChar(null);
              return;
            }
            const target = Math.round(ratioFromEvent(e.clientX, el) * charTotal);
            setDragChar(null);
            seekTo(target, true);
          }}
          onPointerCancel={(e) => {
            try {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* 忽略 */
            }
            setDragChar(null);
          }}
          onKeyDown={(e) => {
            if (charTotal <= 0) return;
            const small = Math.max(1, Math.round(charTotal * 0.02));
            const page = Math.max(1, Math.round(charTotal * 0.1));
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
          <div className="mr-track">
            <div className="mr-fill" style={{ width: `${ratio * 100}%` }} />
            <div className="mr-thumb" style={{ left: `${ratio * 100}%` }} />
          </div>
        </div>

        {loadingChapter ? (
          <div className="mr-note">正在载入正文…</div>
        ) : !hasText ? (
          <div className="mr-note">
            <BookOpen size={13} /> {chapter ? '本章还没有正文' : '未选择章节'}
          </div>
        ) : null}
      </section>

      <section className="mr-controls">
        <button
          className="mr-skip"
          title="上一句（Alt + ←）"
          aria-label="上一句"
          disabled={!hasText}
          onClick={() => readerRef.current?.stepSentence(-1)}
        >
          <SkipBack size={18} />
        </button>
        <button
          className="mr-play"
          onClick={() => readerRef.current?.toggle()}
          disabled={!supported || !hasText}
          title={playing ? '暂停（空格）' : ended ? '重新朗读（空格）' : '开始朗读（空格）'}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? <Pause size={22} /> : <Play size={22} style={{ marginLeft: 2 }} />}
        </button>
        <button
          className="mr-skip"
          title="下一句（Alt + →）"
          aria-label="下一句"
          disabled={!hasText}
          onClick={() => readerRef.current?.stepSentence(1)}
        >
          <SkipForward size={18} />
        </button>
      </section>

      <section className="mr-settings" aria-label="朗读设置">
        <div className="mr-row">
          <span className="mr-label">换书</span>
          <select
            className="mr-select"
            value={projectId ?? ''}
            onChange={(e) => switchProject(e.target.value)}
            disabled={!projects.length}
          >
            {projects.length === 0 ? <option value="">暂无书籍</option> : null}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mr-row">
          <span className="mr-label">换章</span>
          <select
            className="mr-select"
            value={chapterId ?? ''}
            onChange={(e) => switchChapter(e.target.value || null)}
            disabled={!chapters.length}
          >
            {chapters.length === 0 ? <option value="">暂无章节</option> : null}
            {(structure?.stages ?? []).map((stage) => {
              const list = chapters.filter((c) => c.stageId === stage.id);
              if (!list.length) return null;
              return (
                <optgroup key={stage.id} label={stage.name}>
                  {list.map((c) => {
                    const saved = progressMap[c.id];
                    const pct = saved ? Math.round(saved.percent * 100) : 0;
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {pct > 0 ? `（已读 ${pct}%）` : ''}
                      </option>
                    );
                  })}
                </optgroup>
              );
            })}
            {chapters.some((c) => !c.stageId) ? (
              <optgroup label="未分阶段">
                {chapters
                  .filter((c) => !c.stageId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ) : null}
          </select>
        </div>

        <div className="mr-row">
          <span className="mr-label">
            <Volume2 size={12} /> 音色
          </span>
          <select
            className="mr-select"
            value={voiceId}
            onChange={(e) => {
              const next = e.target.value;
              setVoiceId(next);
              readerRef.current?.setVoiceByName(next);
              persistReading({ voiceId: next });
            }}
            disabled={voicesLoading || voices.length === 0}
          >
            {voices.length === 0 ? <option value="">{voicesLoading ? '正在检测…' : '未检测到系统语音'}</option> : null}
            {voices.map((v) => (
              <option key={v.id} value={v.id} title={v.name}>
                {shortVoiceName(v.name)}
              </option>
            ))}
          </select>
        </div>

        <div className="mr-row mr-rate-row">
          <span className="mr-label">
            <Gauge size={12} /> 语速
          </span>
          <input
            className="mr-num"
            type="number"
            inputMode="decimal"
            step={0.05}
            min={MIN_RATE}
            max={MAX_RATE}
            value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            onBlur={commitRateText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRateText();
                e.currentTarget.blur();
              }
            }}
            aria-label="朗读语速"
          />
          <span className="mr-unit">×</span>
        </div>
        <div className="mr-presets">
          {RATE_PRESETS.map((preset) => (
            <button
              key={preset}
              className={`mr-preset${Math.abs(rate - preset) < 0.01 ? ' active' : ''}`}
              onClick={() => applyRate(preset)}
              title={`${formatRate(preset)} 倍速`}
            >
              {formatRate(preset)}
            </button>
          ))}
        </div>

        <div className="mr-row">
          <span className="mr-label">
            <Volume2 size={12} /> 音量
          </span>
          <input
            className="mr-volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(e) => {
              const next = Math.min(100, Math.max(0, Number(e.target.value) || 0));
              setVolume(next);
              readerRef.current?.setVolume(next);
            }}
            onPointerUp={(e) => persistReading({ volume: Number(e.currentTarget.value) })}
            onKeyUp={(e) => persistReading({ volume: Number(e.currentTarget.value) })}
            onBlur={(e) => persistReading({ volume: Number(e.currentTarget.value) })}
            aria-label="朗读音量"
          />
          <span className="mr-volume-value">{volume}</span>
        </div>
      </section>

      {!supported ? (
        <div className="mr-warn">
          <AlertCircle size={13} /> 当前环境不支持实时朗读，请在主窗口使用「离线音频」。
        </div>
      ) : null}
      {errorMsg ? (
        <div className="mr-warn" role="alert">
          <AlertCircle size={13} />
          <span className="mr-warn-text">{errorMsg}</span>
          <button className="mr-warn-close" onClick={() => setErrorMsg(null)} aria-label="关闭提示">
            <X size={12} />
          </button>
        </div>
      ) : null}

      <footer className="mr-foot">
        <span className="mr-saved">
          {busy ? '正在载入…' : savedPct !== null ? `已保存进度 ${savedPct}%` : '尚未保存进度'}
        </span>
        <button
          className="mr-close"
          onClick={() => {
            window.close();
          }}
          title="关闭朗读弹窗"
        >
          关闭
        </button>
      </footer>

      <ToastHost />
    </div>
  );
}

export default MiniReaderPage;
