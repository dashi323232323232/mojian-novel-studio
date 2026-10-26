import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronRight, GripVertical, Link2, X } from 'lucide-react';
import type { Chapter, Foreshadow, OutlineSnapshot, ProjectStructure } from '@shared/types';
import { NODE_TYPE_META } from '@shared/constants';
import { api } from '../lib/api';
import { confirmLeave } from '../lib/leaveGuard';
import { toast } from '../lib/toast';
import { ChapterEditor } from '../components/editor/ChapterEditor';
import { OutlineCanvas } from '../components/outline/OutlineCanvas';

interface Props {
  projectId: string;
  structure: ProjectStructure;
  snapshot: OutlineSnapshot;
  setSnapshot: (next: OutlineSnapshot) => void;
  foreshadows: Foreshadow[];
  nodeId: string;
  chapterId: string;
  onExit: () => void;
  onSelectChapter: (chapterId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onChapterUpdated: () => void;
}

/**
 * 大纲-正文联动工作区：左侧画布、右侧编辑器、中间可连续拖动的分隔条。
 * 分栏比例保存在项目设置中（0.2 ~ 0.8 连续值），重新打开自动恢复。
 */
export function LinkWorkspace({
  projectId,
  structure,
  snapshot,
  setSnapshot,
  foreshadows,
  nodeId,
  chapterId,
  onExit,
  onSelectChapter,
  onSelectNode,
  onChapterUpdated,
}: Props) {
  const [ratio, setRatio] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chapterSearch, setChapterSearch] = useState('');
  const [settings, setSettings] = useState({
    fontSize: 18,
    lineHeight: 1.9,
    fontFamily: 'serif' as 'serif' | 'sans',
    autoSave: true,
    showWordCount: true,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const saveTimer = useRef<number | null>(null);

  const node = snapshot.nodes.find((n) => n.id === nodeId) ?? null;
  const chapter = structure.chapters.find((c) => c.id === chapterId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void api
      .projectSettings(projectId)
      .then((s) => {
        if (!cancelled) setRatio(Math.min(0.8, Math.max(0.2, s.linkSplitRatio ?? 0.5)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    void api
      .settings()
      .then((s) => setSettings(s.editor))
      .catch(() => undefined);
  }, []);

  /** 切换章节前确保当前正文已保存（或用户确认放弃）。 */
  const safeSelectChapter = useCallback(
    async (id: string) => {
      if (id === chapterId) return;
      if (await confirmLeave()) onSelectChapter(id);
    },
    [chapterId, onSelectChapter],
  );

  const persistRatio = useCallback(
    (value: number) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void api.updateProjectSettings(projectId, { linkSplitRatio: value }).catch(() => undefined);
      }, 500);
    },
    [projectId],
  );

  const safeExit = useCallback(async () => {
    if (await confirmLeave()) onExit();
  }, [onExit]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const pct = (ev.clientX - rect.left) / rect.width;
      const next = Math.min(0.8, Math.max(0.2, pct));
      setRatio(next);
      ratioRef.current = next;
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persistRatio(ratioRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const nodeChapters = useMemo(() => {
    if (!node) return [];
    const ids = snapshot.links.filter((l) => l.nodeId === node.id).map((l) => l.chapterId);
    return structure.chapters.filter((c) => ids.includes(c.id));
  }, [node, snapshot.links, structure.chapters]);

  const allChapters = useMemo(() => {
    const q = chapterSearch.trim().toLowerCase();
    return structure.chapters.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 80);
  }, [structure.chapters, chapterSearch]);

  if (!node || !chapter) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="page-title">联动工作区</div>
          <button className="btn btn-sm" onClick={() => void safeExit()}>
            <ArrowLeft size={14} /> 返回大纲
          </button>
        </div>
        <div className="empty-state" style={{ padding: 60 }}>
          <h3>{!node ? '节点不存在或已被删除' : '章节不存在或已被删除'}</h3>
          <p>请返回大纲重新选择要联动的节点与章节。</p>
          <button className="btn" onClick={() => void safeExit()}>
            返回大纲
          </button>
        </div>
      </div>
    );
  }

  const meta = NODE_TYPE_META[node.type];

  return (
    <div className="link-page">
      <div className="page-header" style={{ padding: '10px 18px' }}>
        <div className="page-title" style={{ fontSize: 14.5 }}>
          <button className="icon-btn" onClick={() => void safeExit()} title="退出联动工作区">
            <ArrowLeft size={16} />
          </button>
          <Link2 size={16} style={{ color: 'var(--accent)' }} />
          大纲-正文联动
          <span className="sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <span style={{ color: meta.color, fontWeight: 600 }}>{node.title}</span>
            <ChevronRight size={12} />
            {chapter.name}
          </span>
        </div>
        <div className="page-actions">
          <div style={{ position: 'relative' }}>
            <button className="btn btn-sm" onClick={() => setPickerOpen((v) => !v)}>
              <BookOpen size={13} /> 关联章节 ({nodeChapters.length})
            </button>
            {pickerOpen ? (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={() => setPickerOpen(false)} aria-hidden />
                <div className="menu right" style={{ width: 320, zIndex: 70, top: 36, padding: 8 }}>
                  <input
                    className="input input-sm"
                    placeholder="搜索章节…"
                    value={chapterSearch}
                    onChange={(e) => setChapterSearch(e.target.value)}
                    style={{ marginBottom: 6 }}
                  />
                  <div className="menu-label">当前节点关联的章节</div>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {nodeChapters.length === 0 ? (
                      <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                        该节点尚未关联章节
                      </div>
                    ) : (
                      nodeChapters.map((c) => (
                        <button
                          key={c.id}
                          className="menu-item"
                          style={{ height: 34 }}
                          onClick={() => {
                            setPickerOpen(false);
                            void safeSelectChapter(c.id);
                          }}
                        >
                          <BookOpen size={13} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                          {c.id === chapterId ? <Check size={13} style={{ color: 'var(--accent)' }} /> : null}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="menu-sep" />
                  <div className="menu-label">全部章节（切换后仍保留当前节点）</div>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {allChapters.map((c) => (
                      <button
                        key={c.id}
                        className="menu-item"
                        style={{ height: 32 }}
                        onClick={() => {
                          setPickerOpen(false);
                          void safeSelectChapter(c.id);
                        }}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                        {c.id === chapterId ? <Check size={13} style={{ color: 'var(--accent)' }} /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <button className="btn btn-sm" onClick={() => void safeExit()}>
            <X size={14} /> 退出
          </button>
        </div>
      </div>

      <div className="link-body">
        <div className="split-pane" ref={containerRef}>
          <div className="split-left" style={{ width: `${ratio * 100}%`, flex: `0 0 ${ratio * 100}%`, position: 'relative' }}>
            <div className="split-label">剧情画布</div>
            <OutlineCanvas
              projectId={projectId}
              snapshot={snapshot}
              structure={structure}
              foreshadows={foreshadows}
              selectedNodeId={nodeId}
              onSelectNode={async (id) => {
                if (!id) return;
                if (!(await confirmLeave())) return;
                onSelectNode(id);
                const linked = snapshot.links.filter((l) => l.nodeId === id).map((l) => l.chapterId);
                if (linked.length === 0) {
                  toast.warn('该节点还没有关联章节，右侧仍显示当前章节。');
                  return;
                }
                // 当前章节已关联到该节点时保持不动；只有唯一关联章节时才自动切换；
                // 多个章节时必须由用户在章节列表中明确选择，不擅自随机选择。
                if (linked.includes(chapterId)) return;
                if (linked.length === 1) {
                  onSelectChapter(linked[0]);
                } else {
                  setPickerOpen(true);
                  toast.info(`该节点关联 ${linked.length} 个章节，请在列表中选择要编辑的章节。`);
                }
              }}
              onSnapshotChange={setSnapshot}
              onOpenChapter={async (cid, nid) => {
                if (!(await confirmLeave())) return;
                onSelectNode(nid);
                onSelectChapter(cid);
              }}
              showMiniMap={false}
            />
          </div>

          <div
            className={`split-divider${dragging ? ' dragging' : ''}`}
            onPointerDown={startDrag}
            onDoubleClick={() => {
              setRatio(0.5);
              persistRatio(0.5);
            }}
            title="拖动调整分栏比例（双击恢复 50:50）"
          >
            <GripVertical size={11} style={{ color: 'var(--text-tertiary)', position: 'absolute', pointerEvents: 'none' }} />
          </div>

          <div className="split-right" style={{ width: `${(1 - ratio) * 100}%`, flex: `0 0 ${(1 - ratio) * 100}%` }}>
            <div
              style={{
                padding: '5px 10px',
                borderBottom: '1px solid var(--border)',
                background: '#fbfbfc',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                overflowX: 'auto',
                flex: '0 0 auto',
              }}
            >
              <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', flex: '0 0 auto' }}>节点章节：</span>
              {nodeChapters.length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>暂无关联，可在右侧正文中继续写作</span>
              ) : (
                nodeChapters.map((c) => (
                  <button
                    key={c.id}
                    className={`btn btn-sm${c.id === chapterId ? ' btn-primary' : ''}`}
                    style={{ height: 24, padding: '0 8px', fontSize: 11.5, flex: '0 0 auto' }}
                    onClick={() => void safeSelectChapter(c.id)}
                    title={c.name}
                  >
                    {c.name}
                  </button>
                ))
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <ChapterEditor
                key={chapter.id}
                chapter={chapter}
                structure={structure}
                settings={settings}
                onSwitchChapter={(id) => void safeSelectChapter(id)}
                hideDirectory
                compact
                onSaved={() => onChapterUpdated()}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
