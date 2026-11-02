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
  Download,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';
import type { Chapter, Project, ProjectStructure, Stage } from '@shared/types';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useAppStore } from '../store/app';
import { Modal, ConfirmDialog } from '../components/Modal';
import { ChapterTree, groupCollapseKey, volumeCollapseKey } from '../components/ChapterTree';
import { buildChapterTree } from '../lib/chapterTree';
import { DropdownMenu, EmptyState } from '../components/ui';
import { formatRelative } from '@shared/text';

/**
 * 最近一次打开的章节 id（存 sessionStorage）：内容页在「编辑页 ↔ 目录」之间会反复卸载重挂载，
 * 组件内 state/ref 与模块变量都可能因刷新而丢失，因此持久化到 sessionStorage，
 * 用于返回目录时自动展开该章所在的卷与 20 章分组。
 */
const LAST_CHAPTER_KEY = 'dashi.content.lastChapterId';

function readLastVisitedChapterId(): string | null {
  try {
    return sessionStorage.getItem(LAST_CHAPTER_KEY);
  } catch {
    return null;
  }
}



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

  // 勾选导出
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  /**
   * 自动展开「刚编辑过的那一章」所在的卷与 20 章分组。
   * 从编辑页返回时目录会重新挂载、折叠状态被重置，若不展开，用户会看到
   * 一个全部收缩、找不到刚才章节的列表。
   * 只有在章节数据已经就绪（能找到该章）时才展开，避免数据未刷新时静默失败。
   */
  useEffect(() => {
    const lastId = readLastVisitedChapterId();
    if (!lastId) return;
    const tree = buildChapterTree(structure.stages, structure.chapters);
    const volume = tree.find((v) => v.groups.some((g) => g.chapters.some((c) => c.id === lastId)));
    const group = volume?.groups.find((g) => g.chapters.some((c) => c.id === lastId));
    if (!volume || !group) return;
    setCollapsed((prev) => {
      const volumeKey = volumeCollapseKey(volume.id);
      const groupKey = groupCollapseKey(group.key);
      // 已经是展开状态就不重复 set，避免多余渲染
      if (prev[volumeKey] === false && prev[groupKey] === false) return prev;
      return { ...prev, [volumeKey]: false, [groupKey]: false };
    });
  }, [structure]);

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
  const allChapterIds = useMemo(() => structure.chapters.map((c) => c.id), [structure.chapters]);

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

  const createStage = async (name: string, summary: string) => {
    setBusy(true);
    try {
      await api.createStage(project.id, name, summary);
      await reload();
      setStageModal(null);
      toast.success('阶段已创建');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建阶段失败');
    } finally {
      setBusy(false);
    }
  };

  const renameStage = async (stage: Stage, name: string, summary: string) => {
    setBusy(true);
    try {
      await api.renameStage(stage.id, name, summary);
      await reload();
      setStageModal(null);
      toast.success('阶段已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存阶段失败');
    } finally {
      setBusy(false);
    }
  };

  const createChapter = async (name: string, summary: string, stageId: string | null) => {
    setBusy(true);
    try {
      const chapter = await api.createChapter(project.id, { name, summary, stageId });
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

  const renameChapter = async (chapter: Chapter, name: string, summary: string, stageId: string) => {
    setBusy(true);
    try {
      await api.updateChapter(chapter.id, {
        name,
        summary,
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
      const result = await api.exportChapters({
        projectId: project.id,
        chapterIds: [chapter.id],
        defaultName: `${chapter.name}.txt`,
      });
      if (!result.canceled) toast.success('章节已导出为 TXT');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    }
  };

  // ---------- 勾选导出 ----------
  const toggleChapter = (chapterId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const selectStage = (stageId: string, selectAll: boolean) => {
    const ids = (chaptersByStage.get(stageId) ?? []).map((c) => c.id);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selectAll) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const selectAllChapters = () => setSelected(new Set(allChapterIds));
  const clearSelection = () => setSelected(new Set());

  const doExportSelected = async (ids: string[]) => {
    if (!ids.length) {
      toast.error('请至少选择一个章节');
      return;
    }
    setExporting(true);
    try {
      const result = await api.exportChapters({
        projectId: project.id,
        chapterIds: ids,
        includeStageHeaders: true,
        defaultName: `${project.name}${ids.length === allChapterIds.length ? '（全书）' : ''}.txt`,
      });
      if (!result.canceled) {
        toast.success(`已导出 ${result.chapterCount ?? ids.length} 章到 ${result.filePath}`);
        setSelectMode(false);
        clearSelection();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const openAddMenu = (stageId?: string | null) => {
    setAddMenuOpen(false);
    setChapterModal({ mode: 'create', defaultStageId: stageId ?? structure.stages[0]?.id ?? null });
  };

  const exportSelectionCount = selected.size;

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
          {!selectMode ? (
            <button className="btn btn-sm" onClick={() => setSelectMode(true)} title="勾选章节或阶段导出为 TXT">
              <Download size={13} /> 导出 TXT
            </button>
          ) : null}
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
        {selectMode ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', height: 26 }}>
              已选 {exportSelectionCount} 章
            </span>
            <button className="btn btn-sm" onClick={selectAllChapters}>
              <CheckSquare size={13} /> 全选章节
            </button>
            <button className="btn btn-sm" onClick={() => setSelected(new Set(structure.stages.map((s) => s.id).flatMap((sid) => (chaptersByStage.get(sid) ?? []).map((c) => c.id))))}>
              <Layers size={13} /> 全选阶段
            </button>
            <button className="btn btn-sm" onClick={clearSelection} disabled={!exportSelectionCount}>
              <Square size={13} /> 清空
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void doExportSelected([...selected])}
              disabled={exporting || !exportSelectionCount}
            >
              {exporting ? <span className="spinner" /> : <Download size={13} />}
              导出所选（{exportSelectionCount}）
            </button>
            <button className="btn btn-sm" onClick={() => void doExportSelected(allChapterIds)} disabled={exporting || !allChapterIds.length}>
              导出全书
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setSelectMode(false);
                clearSelection();
              }}
            >
              <X size={13} /> 退出选择
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      <div className="page-body" style={{ padding: '18px 28px 60px' }}>
        {structure.stages.length === 0 && structure.chapters.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={24} />}
            title="从零开始你的第一本书"
            description="当前项目还没有阶段和章节。先创建「第一阶段」，再在其中新建章节开始写作。只需填写名称即可创建，简介可稍后补充。"
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
          <ChapterTree
            structure={structure}
            selectedChapterId={selectMode ? null : undefined}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            keyword={search.trim()}
            onSelectChapter={(chapterId) => {
              if (selectMode) {
                toggleChapter(chapterId);
                return;
              }
              onOpenChapter(chapterId);
            }}
            renderVolumeFooter={(volumeId) =>
              selectMode ? null : (
                <button
                  className="add-chapter-row"
                  onClick={() => openAddMenu(volumeId === '__unassigned__' ? null : volumeId)}
                >
                  <Plus size={13} /> 新建章节
                </button>
              )
            }
            renderMeta={(chapter) =>
              selectMode ? (
                <span style={{ display: 'flex', color: selected.has(chapter.id) ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                  {selected.has(chapter.id) ? <CheckSquare size={15} /> : <Square size={15} />}
                </span>
              ) : (
                <>
                  <span className="chapter-words">{chapter.wordCount} 字</span>
                  <span className="chapter-words" style={{ width: 62, textAlign: 'right' }}>
                    {chapter.contentUpdatedAt ? formatRelative(chapter.contentUpdatedAt) : '未开始'}
                  </span>
                </>
              )
            }
            renderActions={(chapter) =>
              selectMode ? null : (
                <DropdownMenu
                  label="章节操作"
                  align="right"
                  items={[
                    { key: 'open', label: '打开编辑', icon: <Pencil size={14} />, onClick: () => onOpenChapter(chapter.id) },
                    { key: 'rename', label: '编辑名称与简介', icon: <Pencil size={14} />, onClick: () => setChapterModal({ mode: 'rename', chapter }) },
                    { key: 'move', label: '移动到其他阶段', icon: <ArrowRightLeft size={14} />, onClick: () => setMoveChapter(chapter) },
                    { key: 'up', label: '上移', icon: <ArrowUp size={14} />, onClick: () => void shiftChapter(chapter, -1) },
                    { key: 'down', label: '下移', icon: <ArrowDown size={14} />, onClick: () => void shiftChapter(chapter, 1) },
                    'sep',
                    { key: 'export', label: '导出本章为 TXT', icon: <Copy size={14} />, onClick: () => void exportChapter(chapter) },
                    { key: 'delete', label: '删除章节', icon: <Trash2 size={14} />, danger: true, onClick: () => setDeleteChapter(chapter) },
                  ]}
                >
                  <MoreHorizontal size={15} />
                </DropdownMenu>
              )
            }
          />

          {!selectMode ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => setStageModal({ mode: 'create' })}>
                <Layers size={13} /> 新建卷（阶段）
              </button>
              <button className="btn btn-sm" onClick={() => openAddMenu()}>
                <Plus size={13} /> 新建章节
              </button>
            </div>
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
        onSubmit={(name, summary) => {
          if (stageModal?.mode === 'rename' && stageModal.stage) void renameStage(stageModal.stage, name, summary);
          else void createStage(name, summary);
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
        onSubmit={(name, summary, stageId) => {
          if (chapterModal?.mode === 'rename' && chapterModal.chapter)
            void renameChapter(chapterModal.chapter, name, summary, stageId);
          else void createChapter(name, summary, stageId === '__none__' ? null : stageId);
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
                <button className="btn btn-sm" disabled={busy} onClick={() => moveChapter && void moveChapterTo(moveChapter, s.id, 'top')}>
                  移到顶部
                </button>
              </div>
            ))}
            {structure.stages.length === 0 ? <div className="field-hint">还没有阶段，请先新建阶段。</div> : null}
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
  onSubmit: (name: string, summary: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  return (
    <Modal
      open={open}
      title={mode === 'create' ? '新建阶段' : '编辑阶段'}
      subtitle="只需填写名称即可创建；简介可选，后续可随时修改。"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => onSubmit(name.trim(), summary)}>
            {busy ? <span className="spinner" /> : null}
            {mode === 'create' ? '创建' : '保存'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">
          阶段名称 <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <input
          className="input"
          value={name}
          maxLength={120}
          placeholder="例如：第一阶段：战云密布"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onSubmit(name.trim(), summary);
          }}
        />
      </div>
      <div className="field">
        <label className="field-label">阶段简介（可选）</label>
        <textarea
          className="textarea"
          rows={3}
          value={summary}
          placeholder="这一阶段的故事梗概……与大纲中绑定的故事阶段节点互通"
          onChange={(e) => setSummary(e.target.value)}
        />
        <div className="field-hint">简介不填也能创建。填写后可在内容页看到，并与大纲同步。</div>
      </div>
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
  onSubmit: (name: string, summary: string, stageId: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [stageId, setStageId] = useState(initial?.stageId ?? defaultStageId ?? stages[0]?.id ?? '__none__');
  return (
    <Modal
      open={open}
      title={mode === 'create' ? '新建章节' : '编辑章节'}
      subtitle="只需填写章节名称即可创建，简介可稍后补充。简介与大纲中的具体章节节点互通。"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => onSubmit(name.trim(), summary, stageId)}
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
            if (e.key === 'Enter' && name.trim()) onSubmit(name.trim(), summary, stageId);
          }}
        />
      </div>
      <div className="field">
        <label className="field-label">本章简介（可选）</label>
        <textarea
          className="textarea"
          rows={3}
          value={summary}
          placeholder="这一章讲什么？与大纲中绑定的具体章节节点互通"
          onChange={(e) => setSummary(e.target.value)}
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
