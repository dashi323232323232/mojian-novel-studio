import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  BookOpen,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowRightLeft,
  Search,
  FileText,
  Layers,
  Copy,
} from 'lucide-react';
import type { Chapter, Project, ProjectStructure, Stage } from '@shared/types';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useAppStore } from '../store/app';
import { Modal, ConfirmDialog } from '../components/Modal';
import { DropdownMenu, EmptyState } from '../components/ui';
import { formatRelative } from '@shared/text';

interface Props {
  project: Project;
  structure: ProjectStructure;
  reload: () => Promise<void>;
  onOpenChapter: (chapterId: string) => void;
}

export function ContentPage({ project, structure, reload, onOpenChapter }: Props) {
  const navigate = useAppStore((s) => s.navigate);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [stageModal, setStageModal] = useState<{ mode: 'create' | 'rename'; stage?: Stage } | null>(null);
  const [chapterModal, setChapterModal] = useState<{
    mode: 'create' | 'rename';
    chapter?: Chapter;
    defaultStageId?: string | null;
  } | null>(null);
  const [moveChapter, setMoveChapter] = useState<Chapter | null>(null);
  const [deleteChapter, setDeleteChapter] = useState<Chapter | null>(null);
  const [deleteStage, setDeleteStage] = useState<Stage | null>(null);
  const [deleteStageAction, setDeleteStageAction] = useState<'move' | 'delete'>('move');
  const [deleteStageTarget, setDeleteStageTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [searchHits, setSearchHits] = useState<
    Array<{ projectId: string; chapterId: string; chapterName: string; stageName: string | null; snippet: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const chaptersByStage = useMemo(() => {
    const map = new Map<string, Chapter[]>();
    for (const stage of structure.stages) map.set(stage.id, []);
    for (const c of structure.chapters) {
      const key = c.stageId ?? '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [structure]);

  const unassigned = chaptersByStage.get('__none__') ?? [];

  // 搜索防抖
  useEffect(() => {
    if (!search.trim()) {
      setSearchHits([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await api.search(search.trim(), project.id);
        setSearchHits(hits);
        setSearchOpen(true);
      } catch {
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [search, project.id]);

  const createStage = async (name: string) => {
    setBusy(true);
    try {
      await api.createStage(project.id, name);
      await reload();
      setStageModal(null);
      toast.success('阶段已创建');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建阶段失败');
    } finally {
      setBusy(false);
    }
  };

  const renameStage = async (stage: Stage, name: string) => {
    setBusy(true);
    try {
      await api.renameStage(stage.id, name);
      await reload();
      setStageModal(null);
      toast.success('阶段已重命名');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setBusy(false);
    }
  };

  const createChapter = async (name: string, stageId: string | null) => {
    setBusy(true);
    try {
      const chapter = await api.createChapter(project.id, { name, stageId });
      await reload();
      setChapterModal(null);
      toast.success(`章节「${chapter.name}」已创建`);
      onOpenChapter(chapter.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建章节失败');
    } finally {
      setBusy(false);
    }
  };

  const renameChapter = async (chapter: Chapter, name: string, stageId: string) => {
    setBusy(true);
    try {
      await api.updateChapter(chapter.id, {
        name,
        stageId: stageId === '__none__' ? null : stageId,
      });
      await reload();
      setChapterModal(null);
      toast.success('章节已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修改章节失败');
    } finally {
      setBusy(false);
    }
  };

  const moveChapterTo = async (chapter: Chapter, targetStageId: string | null, position: 'top' | 'bottom') => {
    setBusy(true);
    try {
      const siblings = (chaptersByStage.get(targetStageId ?? '__none__') ?? []).filter((c) => c.id !== chapter.id);
      const beforeChapterId = position === 'top' ? siblings[0]?.id ?? null : null;
      await api.moveChapter(chapter.id, { stageId: targetStageId, beforeChapterId });
      await reload();
      setMoveChapter(null);
      toast.success('章节已移动');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移动章节失败');
    } finally {
      setBusy(false);
    }
  };

  const shiftChapter = async (chapter: Chapter, direction: -1 | 1) => {
    const siblings = chaptersByStage.get(chapter.stageId ?? '__none__') ?? [];
    const index = siblings.findIndex((c) => c.id === chapter.id);
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    setBusy(true);
    try {
      const reordered = [...siblings];
      const [item] = reordered.splice(index, 1);
      reordered.splice(target, 0, item);
      const others = structure.chapters.filter((c) => (c.stageId ?? '__none__') !== (chapter.stageId ?? '__none__'));
      // 全局顺序：保持其他阶段位置，只调整本阶段内部
      const globalOrder: string[] = [];
      const stageIdKey = chapter.stageId ?? '__none__';
      let cursor = 0;
      for (const c of structure.chapters) {
        if ((c.stageId ?? '__none__') === stageIdKey) {
          globalOrder.push(reordered[cursor++].id);
        } else {
          globalOrder.push(c.id);
        }
      }
      await api.reorderChapters(project.id, globalOrder);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '调整顺序失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteChapter = async () => {
    if (!deleteChapter) return;
    setBusy(true);
    try {
      await api.deleteChapter(deleteChapter.id);
      await reload();
      toast.success('章节已删除');
      setDeleteChapter(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除章节失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteStage = async () => {
    if (!deleteStage) return;
    setBusy(true);
    try {
      const result = (await api.deleteStage(deleteStage.id, {
        confirm: true,
        chapterAction: deleteStageAction,
        targetStageId: deleteStageAction === 'move' ? deleteStageTarget || null : null,
      })) as { movedChapters: number; deletedChapters: number };
      await reload();
      toast.success(
        `阶段已删除${result.movedChapters ? `，${result.movedChapters} 个章节已移动` : ''}${
          result.deletedChapters ? `，${result.deletedChapters} 个章节已删除` : ''
        }`,
      );
      setDeleteStage(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除阶段失败');
    } finally {
      setBusy(false);
    }
  };

  const stageOptions = structure.stages.filter((s) => s.id !== deleteStage?.id);

  const exportChapter = async (chapter: Chapter) => {
    try {
      const data = await api.getContent(chapter.id);
      const result = await api.exportText(`${chapter.name}.txt`, data.content);
      if (!result.canceled) toast.success('章节已导出');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    }
  };

  const openAddMenu = (stageId?: string | null) => {
    setAddMenuOpen(false);
    setChapterModal({ mode: 'create', defaultStageId: stageId ?? structure.stages[0]?.id ?? null });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">
          <BookOpen size={19} style={{ color: 'var(--accent)' }} />
          {project.name}
          <span className="sub">
            {structure.chapters.length} 章 · {structure.chapters.reduce((sum, c) => sum + c.wordCount, 0)} 字
          </span>
        </div>
        <div className="page-actions">
          <div className="menu-anchor">
            <button className="floating-add" onClick={() => setAddMenuOpen((v) => !v)} title="新建章节或阶段">
              <Plus size={19} />
            </button>
            {addMenuOpen ? (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                  onClick={() => setAddMenuOpen(false)}
                  aria-hidden
                />
                <div className="menu right" style={{ top: 42, zIndex: 40 }}>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setAddMenuOpen(false);
                      setChapterModal({ mode: 'create', defaultStageId: structure.stages[0]?.id ?? null });
                    }}
                  >
                    <FileText size={15} /> 新建章节
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setAddMenuOpen(false);
                      setStageModal({ mode: 'create' });
                    }}
                  >
                    <Layers size={15} /> 新建阶段
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="content-toolbar">
        <div className="search-box">
          <Search size={14} />
          <input
            className="input"
            placeholder="搜索章节名称或正文…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => searchHits.length && setSearchOpen(true)}
          />
          {searchOpen && search.trim() ? (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setSearchOpen(false)} aria-hidden />
              <div className="search-results" style={{ zIndex: 45 }}>
                {searching ? (
                  <div style={{ padding: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>搜索中…</div>
                ) : searchHits.length === 0 ? (
                  <div style={{ padding: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>没有找到匹配内容</div>
                ) : (
                  searchHits.map((hit) => (
                    <div
                      key={`${hit.projectId}-${hit.chapterId}`}
                      className="search-hit"
                      onClick={() => {
                        setSearchOpen(false);
                        onOpenChapter(hit.chapterId);
                      }}
                    >
                      <div className="t">{hit.chapterName}</div>
                      <div className="s">
                        {hit.stageName ?? '未分阶段'} · {hit.snippet || '（正文为空）'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setStageModal({ mode: 'create' })}>
            <Layers size={14} /> 新建阶段
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => openAddMenu()}>
            <FileText size={14} /> 新建章节
          </button>
        </div>
      </div>

      <div className="page-body" style={{ padding: '18px 28px 60px' }}>
        {structure.stages.length === 0 && structure.chapters.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={24} />}
            title="从零开始你的第一本书"
            description="当前项目还没有阶段和章节。先创建「第一阶段」，再在其中新建章节开始写作。"
            action={
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={() => setStageModal({ mode: 'create' })}>
                  <Layers size={15} /> 新建阶段
                </button>
                <button className="btn btn-primary" onClick={() => setChapterModal({ mode: 'create', defaultStageId: null })}>
                  <Plus size={15} /> 新建章节
                </button>
              </div>
            }
          />
        ) : (
          <>
            {structure.stages.map((stage) => {
              const chapters = chaptersByStage.get(stage.id) ?? [];
              const isCollapsed = collapsed[stage.id] ?? false;
              return (
                <section className="stage-block" key={stage.id}>
                  <header className="stage-head" onClick={() => setCollapsed({ ...collapsed, [stage.id]: !isCollapsed })}>
                    <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
                      {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                    </span>
                    <span className="stage-name">
                      <Layers size={14} style={{ color: 'var(--accent)' }} />
                      {stage.name}
                      <span className="stage-meta">
                        {chapters.length} 章 · {chapters.reduce((s, c) => s + c.wordCount, 0)} 字
                      </span>
                    </span>
                    <div className="stage-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" title="在此阶段新建章节" onClick={() => openAddMenu(stage.id)}>
                        <Plus size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        title="重命名阶段"
                        onClick={() => setStageModal({ mode: 'rename', stage })}
                      >
                        <Pencil size={14} />
                      </button>
                      <button className="icon-btn" title="删除阶段" onClick={() => {
                        setDeleteStage(stage);
                        setDeleteStageAction(chapters.length ? 'move' : 'move');
                        setDeleteStageTarget(stageOptions[0]?.id ?? '');
                      }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </header>
                  {!isCollapsed ? (
                    <div className="chapter-list">
                      {chapters.length === 0 ? (
                        <div className="stage-empty">
                          <FileText size={14} /> 此阶段还没有章节。
                          <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => openAddMenu(stage.id)}>
                            新建章节
                          </button>
                        </div>
                      ) : (
                        chapters.map((chapter, index) => (
                          <div
                            className="chapter-row"
                            key={chapter.id}
                            onClick={() => onOpenChapter(chapter.id)}
                            title={chapter.name}
                          >
                            <span className="chapter-index">{String(index + 1).padStart(2, '0')}</span>
                            <span className="chapter-title">{chapter.name}</span>
                            <span className="chapter-words">{chapter.wordCount} 字</span>
                            <span className="chapter-words" style={{ width: 62, textAlign: 'right' }}>
                              {chapter.contentUpdatedAt ? formatRelative(chapter.contentUpdatedAt) : '未开始'}
                            </span>
                            <span className="chapter-actions" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu
                                label="章节操作"
                                align="right"
                                items={[
                                  {
                                    key: 'open',
                                    label: '打开编辑',
                                    icon: <Pencil size={14} />,
                                    onClick: () => onOpenChapter(chapter.id),
                                  },
                                  {
                                    key: 'rename',
                                    label: '重命名 / 修改阶段',
                                    icon: <Pencil size={14} />,
                                    onClick: () => setChapterModal({ mode: 'rename', chapter }),
                                  },
                                  {
                                    key: 'move',
                                    label: '移动到其他阶段',
                                    icon: <ArrowRightLeft size={14} />,
                                    onClick: () => setMoveChapter(chapter),
                                  },
                                  {
                                    key: 'up',
                                    label: '上移',
                                    icon: <ArrowUp size={14} />,
                                    disabled: index === 0,
                                    onClick: () => void shiftChapter(chapter, -1),
                                  },
                                  {
                                    key: 'down',
                                    label: '下移',
                                    icon: <ArrowDown size={14} />,
                                    disabled: index === chapters.length - 1,
                                    onClick: () => void shiftChapter(chapter, 1),
                                  },
                                  'sep',
                                  {
                                    key: 'export',
                                    label: '导出为 TXT',
                                    icon: <Copy size={14} />,
                                    onClick: () => void exportChapter(chapter),
                                  },
                                  {
                                    key: 'delete',
                                    label: '删除章节',
                                    icon: <Trash2 size={14} />,
                                    danger: true,
                                    onClick: () => setDeleteChapter(chapter),
                                  },
                                ]}
                              >
                                <MoreHorizontal size={15} />
                              </DropdownMenu>
                            </span>
                          </div>
                        ))
                      )}
                      <button className="add-chapter-row" onClick={() => openAddMenu(stage.id)}>
                        <Plus size={13} /> 新建章节
                      </button>
                    </div>
                  ) : null}
                </section>
              );
            })}

            {unassigned.length ? (
              <section className="stage-block">
                <header className="stage-head">
                  <span style={{ width: 15 }} />
                  <span className="stage-name">未分阶段</span>
                  <span className="stage-meta" style={{ marginLeft: 10 }}>{unassigned.length} 章</span>
                </header>
                <div className="chapter-list">
                  {unassigned.map((chapter) => (
                    <div className="chapter-row" key={chapter.id} onClick={() => onOpenChapter(chapter.id)}>
                      <span className="chapter-index">—</span>
                      <span className="chapter-title">{chapter.name}</span>
                      <span className="chapter-words">{chapter.wordCount} 字</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>

      {/* 新建/重命名阶段 */}
      <StageModal
        key={stageModal?.mode === 'rename' ? stageModal.stage?.id : 'create-stage'}
        open={Boolean(stageModal)}
        mode={stageModal?.mode ?? 'create'}
        initial={stageModal?.stage}
        busy={busy}
        onClose={() => setStageModal(null)}
        onSubmit={(name) => {
          if (stageModal?.mode === 'rename' && stageModal.stage) void renameStage(stageModal.stage, name);
          else void createStage(name);
        }}
      />

      {/* 新建/修改章节 */}
      <ChapterModal
        key={chapterModal?.mode === 'rename' ? chapterModal.chapter?.id : `create-${chapterModal?.defaultStageId ?? 'none'}`}
        open={Boolean(chapterModal)}
        mode={chapterModal?.mode ?? 'create'}
        stages={structure.stages}
        initial={chapterModal?.chapter}
        defaultStageId={chapterModal?.defaultStageId ?? null}
        busy={busy}
        onClose={() => setChapterModal(null)}
        onSubmit={(name, stageId) => {
          if (chapterModal?.mode === 'rename' && chapterModal.chapter) void renameChapter(chapterModal.chapter, name, stageId);
          else void createChapter(name, stageId === '__none__' ? null : stageId);
        }}
      />

      {/* 移动章节 */}
      <Modal
        open={Boolean(moveChapter)}
        title="移动章节"
        subtitle={moveChapter ? `将「${moveChapter.name}」移动到其他阶段` : undefined}
        onClose={() => setMoveChapter(null)}
        footer={
          <>
            <button className="btn" onClick={() => setMoveChapter(null)}>
              取消
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => moveChapter && void moveChapterTo(moveChapter, moveChapter.stageId, 'top')}
            >
              移到本阶段顶部
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => moveChapter && void moveChapterTo(moveChapter, moveChapter.stageId, 'bottom')}
            >
              移到本阶段末尾
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label">选择目标阶段</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {structure.stages.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 11px',
                  border: '1px solid var(--border)',
                  borderRadius: 7,
                  fontSize: 13,
                }}
              >
                <Layers size={14} style={{ color: 'var(--accent)' }} />
                <span style={{ flex: 1 }}>{s.name}</span>
                {moveChapter?.stageId === s.id ? (
                  <span className="badge" style={{ background: 'var(--bg-subtle)', color: 'var(--text-tertiary)' }}>
                    当前阶段
                  </span>
                ) : null}
                <button
                  className="btn btn-sm"
                  disabled={busy || moveChapter?.stageId === s.id}
                  onClick={() => moveChapter && void moveChapterTo(moveChapter, s.id, 'bottom')}
                >
                  移动到此阶段末尾
                </button>
                <button
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => moveChapter && void moveChapterTo(moveChapter, s.id, 'top')}
                >
                  移到顶部
                </button>
              </div>
            ))}
            {structure.stages.length === 0 ? (
              <div className="field-hint">还没有阶段，请先新建阶段。</div>
            ) : null}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteChapter)}
        title="删除章节"
        confirmText="删除章节"
        busy={busy}
        onCancel={() => setDeleteChapter(null)}
        onConfirm={() => void confirmDeleteChapter()}
        message={
          <>
            即将删除章节「<b>{deleteChapter?.name}</b>」（{deleteChapter?.wordCount ?? 0} 字）。
            <br />
            正文、上一版本、大纲关联与音频任务会一并删除，不可恢复。
          </>
        }
      >
        <div className="danger-note">如果只是暂时不需要，建议先导出章节或创建备份。</div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteStage)}
        title="删除阶段"
        confirmText={deleteStageAction === 'delete' ? '删除阶段及其章节' : '删除阶段'}
        busy={busy}
        onCancel={() => setDeleteStage(null)}
        onConfirm={() => void confirmDeleteStage()}
        message={
          <>
            即将删除阶段「<b>{deleteStage?.name}</b>」，其中包含{' '}
            <b>{(chaptersByStage.get(deleteStage?.id ?? '') ?? []).length}</b> 个章节。请选择这些章节的处理方式：
          </>
        }
      >
        <div className="field">
          <label className="checkbox-row">
            <input
              type="radio"
              name="stage-delete-action"
              checked={deleteStageAction === 'move'}
              onChange={() => setDeleteStageAction('move')}
            />
            <span>
              <b>移动章节到其他阶段</b>（推荐，不会丢失正文）
              {stageOptions.length === 0 ? (
                <div className="field-hint" style={{ color: 'var(--danger)' }}>
                  项目中没有其他阶段，请先创建新阶段或选择下方删除。
                </div>
              ) : (
                <div style={{ marginTop: 6 }}>
                  <select
                    className="select input-sm"
                    value={deleteStageTarget}
                    onChange={(e) => setDeleteStageTarget(e.target.value)}
                    disabled={deleteStageAction !== 'move'}
                  >
                    {stageOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </span>
          </label>
          <label className="checkbox-row" style={{ marginTop: 12 }}>
            <input
              type="radio"
              name="stage-delete-action"
              checked={deleteStageAction === 'delete'}
              onChange={() => setDeleteStageAction('delete')}
            />
            <span>
              <b>同时删除阶段内的所有章节</b>
              <div className="field-hint" style={{ color: 'var(--danger)' }}>
                章节正文、版本与关联将永久删除，不可恢复。
              </div>
            </span>
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function StageModal({
  open,
  mode,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'create' | 'rename';
  initial?: Stage;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  return (
    <Modal
      open={open}
      title={mode === 'create' ? '新建阶段' : '重命名阶段'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => onSubmit(name.trim())}>
            {busy ? <span className="spinner" /> : null}
            {mode === 'create' ? '创建' : '保存'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">阶段名称</label>
        <input
          className="input"
          value={name}
          maxLength={120}
          placeholder="例如：第一阶段：战云密布"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onSubmit(name.trim());
          }}
        />
      </div>
      <div className="field-hint">阶段用于组织章节顺序，可随时重命名或调整章节归属。</div>
    </Modal>
  );
}

function ChapterModal({
  open,
  mode,
  stages,
  initial,
  defaultStageId,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'create' | 'rename';
  stages: Stage[];
  initial?: Chapter;
  defaultStageId: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string, stageId: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [stageId, setStageId] = useState(initial?.stageId ?? defaultStageId ?? stages[0]?.id ?? '__none__');
  return (
    <Modal
      open={open}
      title={mode === 'create' ? '新建章节' : '修改章节'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => onSubmit(name.trim(), stageId)}
          >
            {busy ? <span className="spinner" /> : null}
            {mode === 'create' ? '创建并开始写作' : '保存'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">
          章节名称 <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <input
          className="input"
          value={name}
          maxLength={200}
          placeholder="例如：第一章 宣战"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onSubmit(name.trim(), stageId);
          }}
        />
      </div>
      <div className="field">
        <label className="field-label">所属阶段</label>
        <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="__none__">未分阶段</option>
        </select>
        {stages.length === 0 ? (
          <div className="field-hint" style={{ color: 'var(--warning)' }}>
            项目还没有阶段，章节会先归入「未分阶段」，稍后可在内容页创建阶段并移动。
          </div>
        ) : null}
      </div>
      <div className="field-hint">章节使用独立 ID 存储，重命名不会影响正文与大纲关联。</div>
    </Modal>
  );
}
