import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { countWords } from '@shared/text';
import type { Chapter, ChapterVersionsPayload, ProjectStructure } from '@shared/types';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { setLeaveGuard } from '../../lib/leaveGuard';
import { Modal } from '../Modal';
import { CodeMirrorEditor } from './CodeMirrorEditor';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface ChapterEditorHandle {
  save: (opts?: { silent?: boolean }) => Promise<boolean>;
  hasUnsaved: () => boolean;
  reload: () => Promise<void>;
}

interface Props {
  chapter: Chapter;
  structure: ProjectStructure;
  settings: { fontSize: number; lineHeight: number; fontFamily: 'serif' | 'sans'; autoSave: boolean; showWordCount: boolean };
  onSwitchChapter: (chapterId: string) => void;
  onSaved?: (chapterId: string, wordCount: number) => void;
  /** 用于让父组件调用保存（例如顶部保存按钮、全局 Ctrl+S） */
  registerHandle?: (handle: ChapterEditorHandle | null) => void;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  hideDirectory?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  compact?: boolean;
}

const AUTOSAVE_DELAY = 1200;

/**
 * 章节编辑器核心：加载正文、编辑、自动保存（防抖 + 串行）、手动保存、版本回溯。
 * 通过 leaveGuard 统一处理切换章节/退出/关窗时的未保存保护。
 */
export function ChapterEditor({
  chapter,
  structure,
  settings,
  onSwitchChapter,
  onSaved,
  registerHandle,
  headerLeft,
  headerRight,
  hideDirectory = false,
  onDirtyChange,
  compact = false,
}: Props) {
  const [content, setContent] = useState('');
  const [loadedChapterId, setLoadedChapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [versions, setVersions] = useState<ChapterVersionsPayload | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<{ id: string; content: string; savedAt: string; wordCount: number; revision: number } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [conflict, setConflict] = useState<{ currentRevision: number; serverContent: string } | null>(null);
  const [leavePrompt, setLeavePrompt] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});

  const contentRef = useRef(content);
  contentRef.current = content;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const revisionRef = useRef(savedRevision);
  revisionRef.current = savedRevision;
  const saveTimer = useRef<number | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const mountedRef = useRef(true);
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;
  const loadedRef = useRef<string | null>(null);
  const stateRef = useRef<SaveState>('idle');

  const setSaveStateSafe = (next: SaveState) => {
    stateRef.current = next;
    setSaveState(next);
  };

  /** 同步主进程脏状态：关窗时主进程会先询问渲染层，避免未保存内容丢失。 */
  const syncWindowDirty = (value: boolean) => {
    try {
      window.dashi?.app?.setDirty(value);
    } catch {
      /* 非桌面环境忽略 */
    }
  };

  const load = useCallback(async (chapterId: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getContent(chapterId);
      if (!mountedRef.current) return;
      setContent(data.content);
      contentRef.current = data.content;
      setSavedRevision(data.revision);
      revisionRef.current = data.revision;
      setLastSavedAt(data.updatedAt);
      setDirty(false);
      dirtyRef.current = false;
      syncWindowDirty(false);
      setSaveStateSafe('idle');
      setLoadedChapterId(chapterId);
      loadedRef.current = chapterId;
      onDirtyChange?.(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载正文失败');
    } finally {
      setLoading(false);
    }
  }, [onDirtyChange]);

  // 切换章节时加载
  useEffect(() => {
    if (loadedChapterId === chapter.id) return;
    setContent('');
    contentRef.current = '';
    setDirty(false);
    void load(chapter.id);
  }, [chapter.id, load, loadedChapterId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearTimer = () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  };

  const doSave = useCallback(
    async (opts: { silent?: boolean; force?: boolean } = {}): Promise<boolean> => {
      if (savingRef.current) {
        pendingSaveRef.current = true;
        return false;
      }
      if (!loadedRef.current) return false;
      const chapterId = loadedRef.current;
      const text = contentRef.current;
      if (!dirtyRef.current && !opts.force) {
        return true;
      }
      savingRef.current = true;
      setSaveStateSafe('saving');
      try {
        const result = await api.saveContent(chapterId, {
          content: text,
          baseRevision: revisionRef.current,
          source: 'manual',
        });
        if (!mountedRef.current) return true;
        revisionRef.current = result.revision;
        setSavedRevision(result.revision);
        setLastSavedAt(result.savedAt);
        if (contentRef.current === text) {
          setDirty(false);
          onDirtyChange?.(false);
          dirtyRef.current = false;
          syncWindowDirty(false);
        }
        setSaveStateSafe('saved');
        if (!opts.silent) toast.success(result.unchanged ? '内容没有变化，无需保存' : '已保存');
        onSaved?.(chapterId, result.wordCount);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        const e = err as { code?: string; details?: unknown; message?: string };
        if (e.code === 'CONFLICT') {
          // 乐观锁冲突：拉取服务端最新内容，让用户选择
          try {
            const latest = await api.getContent(chapterId);
            setConflict({ currentRevision: latest.revision, serverContent: latest.content });
          } catch {
            /* ignore */
          }
        }
        setSaveStateSafe('error');
        if (!opts.silent) toast.error(e.message ?? '保存失败');
        return false;
      } finally {
        savingRef.current = false;
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          if (dirtyRef.current) {
            void doSave({ silent: true });
          }
        }
      }
    },
    [onDirtyChange, onSaved],
  );

  // 自动保存：输入停止 1.2s 后保存，避免逐字写盘
  const handleChange = (next: string) => {
    setContent(next);
    contentRef.current = next;
    const isDirty = next !== undefined;
    setDirty(isDirty);
    dirtyRef.current = isDirty;
    syncWindowDirty(isDirty);
    onDirtyChange?.(isDirty);
    if (stateRef.current !== 'error') setSaveStateSafe('dirty');
    clearTimer();
    if (settings.autoSave) {
      saveTimer.current = window.setTimeout(() => {
        void doSave({ silent: true });
      }, AUTOSAVE_DELAY);
    }
  };

  // 注册离开守卫：未保存时弹窗让用户选择
  useEffect(() => {
    const guard = async (): Promise<boolean> => {
      if (!dirtyRef.current) return true;
      // 先尝试自动保存
      clearTimer();
      const ok = await doSave({ silent: true });
      if (ok) return true;
      return new Promise<boolean>((resolve) => {
        setLeavePrompt({ resolve });
      });
    };
    setLeaveGuard(guard);
    return () => {
      setLeaveGuard(null);
    };
  }, [doSave]);

  // 全局 Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        clearTimer();
        void doSave({ silent: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSave]);

  useEffect(() => {
    if (registerHandle) {
      registerHandle({
        save: async (opts) => {
          clearTimer();
          return doSave({ silent: opts?.silent });
        },
        hasUnsaved: () => dirtyRef.current,
        reload: async () => {
          if (loadedRef.current) await load(loadedRef.current);
        },
      });
    }
    return () => registerHandle?.(null);
  }, [registerHandle, doSave, load]);

  // 组件卸载时清理定时器（守卫会确保已保存）
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  const openVersions = async () => {
    try {
      const payload = await api.versions(chapter.id);
      setVersions(payload);
      setPreviewVersion(null);
      setVersionsOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取版本失败');
    }
  };

  const previewPrevious = async () => {
    if (!versions?.previous) return;
    try {
      const v = await api.version(chapter.id, versions.previous.id);
      setPreviewVersion({ id: v.id, content: v.content, savedAt: v.savedAt, wordCount: v.wordCount, revision: v.revision });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取版本失败');
    }
  };

  const restorePrevious = async () => {
    if (!versions?.previous) return;
    setRestoring(true);
    try {
      const result = await api.restoreVersion(chapter.id, versions.previous.id);
      toast.success('已回滚到上一个版本');
      setVersionsOpen(false);
      setDirty(false);
      dirtyRef.current = false;
      setSavedRevision(result.revision);
      revisionRef.current = result.revision;
      setLastSavedAt(result.savedAt);
      await load(chapter.id);
      onSaved?.(chapter.id, result.wordCount);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回滚失败');
    } finally {
      setRestoring(false);
    }
  };

  const switchChapter = async (chapterId: string) => {
    if (chapterId === chapter.id) return;
    clearTimer();
    if (dirtyRef.current) {
      const ok = await doSave({ silent: true });
      if (!ok) {
        // 保存失败：明确让用户选择保存 / 放弃 / 取消，而不是静默取消
        const decision = await new Promise<boolean>((resolve) => {
          setLeavePrompt({ resolve });
        });
        if (!decision) return;
      }
    }
    onSwitchChapter(chapterId);
  };

  const wordCount = countWords(content);
  const currentStage = structure.stages.find((s) => s.id === chapter.stageId);

  return (
    <div className={hideDirectory ? 'editor-main' : 'editor-page'} style={hideDirectory ? { flex: 1, minHeight: 0 } : undefined}>
      {!hideDirectory ? (
        <div className="editor-dir">
          <div className="editor-dir-head">
            <span className="editor-dir-title" title={structure.project.name}>
              {structure.project.name}
            </span>
          </div>
          <div className="editor-dir-body">
            {structure.stages.map((stage) => {
              const chapters = structure.chapters.filter((c) => c.stageId === stage.id);
              const isCollapsed = collapsedStages[stage.id] ?? false;
              return (
                <div className="dir-stage" key={stage.id}>
                  <div
                    className="dir-stage-head"
                    onClick={() => setCollapsedStages((prev) => ({ ...prev, [stage.id]: !isCollapsed }))}
                    title={isCollapsed ? '展开阶段' : '折叠阶段'}
                  >
                    <span style={{ display: 'flex', color: 'var(--text-tertiary)' }}>
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {stage.name}
                    </span>
                    <span style={{ fontWeight: 400, fontSize: 10.5 }}>{chapters.length}</span>
                  </div>
                  {!isCollapsed && chapters.map((c) => (
                    <div
                      key={c.id}
                      className={`dir-chapter${c.id === chapter.id ? ' active' : ''}`}
                      onClick={() => void switchChapter(c.id)}
                      title={c.name}
                    >
                      <span className="nm">{c.name}</span>
                      {c.id === chapter.id && dirty ? (
                        <span style={{ width: 5, height: 5, borderRadius: 3, background: 'var(--warning)' }} />
                      ) : null}
                    </div>
                  ))}
                  {!isCollapsed && chapters.length === 0 ? (
                    <div style={{ padding: '4px 8px 6px 20px', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      此阶段暂无章节
                    </div>
                  ) : null}
                </div>
              );
            })}
            {structure.stages.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>尚无阶段与章节</div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="editor-main">
        <div className="editor-topbar">
          <button
            className="btn btn-primary"
            onClick={() => {
              clearTimer();
              void doSave();
            }}
            disabled={saveState === 'saving'}
            title="保存当前章节（Ctrl+S）"
          >
            {saveState === 'saving' ? <span className="spinner" /> : null}
            保存
          </button>
          <div className="title">
            {chapter.name}
            {currentStage ? (
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 8, fontSize: 12 }}>
                {currentStage.name}
              </span>
            ) : null}
          </div>
          <SaveIndicator state={saveState} dirty={dirty} lastSavedAt={lastSavedAt} />
          <button className="btn btn-ghost btn-sm" onClick={() => void openVersions()} title="查看上一个版本并回滚">
            版本回溯
          </button>
          {headerLeft}
          {headerRight}
        </div>

        <div className="editor-scroll">
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <span className="spinner lg" /> 正在加载正文…
            </div>
          ) : loadError ? (
            <div style={{ padding: 40, color: 'var(--danger)' }}>{loadError}</div>
          ) : (
            <div className="editor-paper" style={compact ? { padding: '24px 28px 80px' } : undefined}>
              {!compact ? (
                <>
                  <h1 className="editor-chapter-title">{chapter.name}</h1>
                  <div className="editor-chapter-meta">
                    <span>{currentStage?.name ?? '未分阶段'}</span>
                    <span>{wordCount} 字</span>
                    <span>第 {savedRevision} 版</span>
                  </div>
                </>
              ) : null}
              <CodeMirrorEditor
                value={content}
                onChange={handleChange}
                fontSize={settings.fontSize}
                lineHeight={settings.lineHeight}
                fontFamily={settings.fontFamily}
                autoFocus={!compact}
                minHeight={compact ? 420 : 560}
                placeholder="从这里开始写下第一句话…"
              />
            </div>
          )}
        </div>

        <div className="editor-foot">
          <span>{wordCount} 字</span>
          <span>·</span>
          <span>{content.length} 字符</span>
          {settings.autoSave ? (
            <>
              <span>·</span>
              <span>自动保存已开启</span>
            </>
          ) : (
            <>
              <span>·</span>
              <span style={{ color: 'var(--warning)' }}>自动保存已关闭</span>
            </>
          )}
          <div className="right">
            <span>当前版本 #{savedRevision}</span>
            <span>仅保留当前与上一版本</span>
          </div>
        </div>
      </div>

      {/* 版本回溯 */}
      <Modal
        open={versionsOpen}
        title="版本回溯"
        subtitle="按需求只保留「当前版本」和「上一个版本」，每次保存会归档上一版并清理更早版本。"
        onClose={() => setVersionsOpen(false)}
        width="lg"
        footer={
          <>
            <button className="btn" onClick={() => setVersionsOpen(false)}>
              关闭
            </button>
            {versions?.previous ? (
              <button className="btn btn-soft-danger" onClick={() => void restorePrevious()} disabled={restoring}>
                {restoring ? <span className="spinner" /> : null}
                回滚到上一个版本
              </button>
            ) : null}
          </>
        }
      >
        <div className="version-row">
          <div className="version-main">
            <div className="version-title">当前版本 · 第 {versions?.current.revision ?? savedRevision} 版</div>
            <div className="version-sub">
              {versions?.current.wordCount ?? wordCount} 字 · 保存于 {versions?.current.updatedAt ? new Date(versions.current.updatedAt).toLocaleString('zh-CN') : '—'}
            </div>
          </div>
          <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
            当前
          </span>
        </div>
        {versions?.previous ? (
          <div className="version-row">
            <div className="version-main">
              <div className="version-title">上一个版本 · 第 {versions.previous.revision} 版</div>
              <div className="version-sub">
                {versions.previous.wordCount} 字 · 保存于 {new Date(versions.previous.savedAt).toLocaleString('zh-CN')} · 来源 {versions.previous.source}
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => void previewPrevious()}>
              预览
            </button>
          </div>
        ) : (
          <div className="warn-note" style={{ marginTop: 12 }}>
            暂无上一个版本。进行第二次保存后，上一版正文会出现在这里。
          </div>
        )}
        {previewVersion ? (
          <div style={{ marginTop: 12 }}>
            <div className="field-label" style={{ marginBottom: 6 }}>
              上一版本内容预览（{previewVersion.wordCount} 字）
            </div>
            <div className="version-preview">{previewVersion.content || '（空白）'}</div>
          </div>
        ) : null}
      </Modal>

      {/* 保存冲突 */}
      <Modal
        open={Boolean(conflict)}
        title="保存冲突"
        onClose={() => setConflict(null)}
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                setConflict(null);
                if (loadedRef.current) void load(loadedRef.current);
              }}
            >
              放弃本地修改并重新加载
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const c = conflict;
                setConflict(null);
                if (!c) return;
                revisionRef.current = c.currentRevision;
                setSavedRevision(c.currentRevision);
                void doSave({ force: true });
              }}
            >
              以本地内容覆盖
            </button>
          </>
        }
      >
        <div className="warn-note">
          该章节已被其他窗口或 Agent 修改（服务器版本 #{conflict?.currentRevision}）。请选择如何处理，避免覆盖他人内容。
        </div>
        <div className="version-preview" style={{ maxHeight: 200 }}>
          {conflict?.serverContent || '（服务器内容为空）'}
        </div>
      </Modal>

      {/* 离开确认 */}
      <Modal
        open={Boolean(leavePrompt)}
        title="有未保存的修改"
        onClose={() => {
          leavePrompt?.resolve(false);
          setLeavePrompt(null);
        }}
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                leavePrompt?.resolve(false);
                setLeavePrompt(null);
              }}
            >
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setDirty(false);
                dirtyRef.current = false;
                syncWindowDirty(false);
                leavePrompt?.resolve(true);
                setLeavePrompt(null);
              }}
            >
              放弃修改
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                const ok = await doSave({ silent: false });
                leavePrompt?.resolve(ok);
                setLeavePrompt(null);
              }}
            >
              保存并继续
            </button>
          </>
        }
      >
        <div className="warn-note">
          当前章节「{chapter.name}」还有未保存的内容（约 {wordCount} 字）。离开将丢失这些修改，请选择保存或放弃。
        </div>
      </Modal>
    </div>
  );
}

function SaveIndicator({ state, dirty, lastSavedAt }: { state: SaveState; dirty: boolean; lastSavedAt: string | null }) {
  if (state === 'saving') {
    return (
      <span className="save-state">
        <span className="spinner" /> 正在保存…
      </span>
    );
  }
  if (state === 'error') {
    return <span className="save-state error">保存失败，请重试</span>;
  }
  if (dirty) {
    return <span className="save-state dirty">未保存的修改</span>;
  }
  if (state === 'saved') {
    return (
      <span className="save-state saved">
        <span className="dot-status" style={{ background: 'var(--success)' }} />
        已保存
      </span>
    );
  }
  return (
    <span className="save-state">
      {lastSavedAt ? `上次保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '空白章节'}
    </span>
  );
}
