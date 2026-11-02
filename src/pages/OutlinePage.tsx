import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  FileText,
  LayoutList,
  ChevronLeft,
  ChevronRight,
  Flag,
  BookOpen,
  User,
  Lightbulb,
  StickyNote,
  Maximize2,
  Crosshair,
  Link2,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  Wand2,
  LayoutGrid,
  RotateCcw,
} from 'lucide-react';
import type { Foreshadow, NodeType, OutlineSnapshot, ProjectStructure } from '@shared/types';
import { NODE_TYPE_META, EDGE_RELATION_META } from '@shared/constants';
import { api } from '../lib/api';
import { confirmLeave } from '../lib/leaveGuard';
import { toast } from '../lib/toast';
import { OutlineCanvas, type OutlineCanvasHandle } from '../components/outline/OutlineCanvas';
import { LayoutDialog } from '../components/outline/LayoutDialog';
import { NodeDetails } from '../components/outline/NodeDetails';
import { ConfirmDialog } from '../components/Modal';
import { ForeshadowPanel } from '../components/ForeshadowPanel';
import { LinkWorkspace } from './LinkWorkspace';
import type { OutlineNode } from '@shared/types';

const TYPE_ICONS: Record<NodeType, React.ReactNode> = {
  stage: <Flag size={13} />,
  event: <BookOpen size={13} />,
  chapter: <FileText size={13} />,
  character: <User size={13} />,
  foreshadow: <Lightbulb size={13} />,
  note: <StickyNote size={13} />,
};

type Tab = 'canvas' | 'foreshadow';

interface Props {
  projectId: string;
  structure: ProjectStructure;
  snapshot: OutlineSnapshot;
  setSnapshot: (next: OutlineSnapshot) => void;
  foreshadows: Foreshadow[];
  reloadForeshadows: () => Promise<void>;
  reloadSnapshot: () => Promise<void>;
  reloadStructure: () => Promise<void>;
  /** 从外部（例如悬停列表点击章节）进入联动工作区 */
  enterLink: (nodeId: string, chapterId: string) => void;
  linkState: { nodeId: string; chapterId: string } | null;
  exitLink: () => void;
  onChapterUpdated: () => void;
}

export function OutlinePage({
  projectId,
  structure,
  snapshot,
  setSnapshot,
  foreshadows,
  reloadForeshadows,
  reloadSnapshot,
  reloadStructure,
  enterLink,
  linkState,
  exitLink,
  onChapterUpdated,
}: Props) {
  const [tab, setTab] = useState<Tab>('canvas');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ type: NodeType; nonce: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OutlineNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const canvasHandle = useRef<OutlineCanvasHandle | null>(null);
  const viewportSaveTimer = useRef<number | null>(null);
  const loadedViewport = useRef(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  /** 应用自动排版之前的节点位置，用于「恢复原来的位置」/「撤销排版」 */
  const originalPositions = useRef<Record<string, { x: number; y: number }> | null>(null);
  const [hasLayoutBackup, setHasLayoutBackup] = useState(false);

  // 读取项目级视口设置（只加载一次）
  useEffect(() => {
    let cancelled = false;
    void api
      .projectSettings(projectId)
      .then((s) => {
        if (cancelled) return;
        if (s.outlineViewport) setViewport(s.outlineViewport);
        loadedViewport.current = true;
      })
      .catch(() => {
        loadedViewport.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const saveViewport = useCallback(
    (next: { x: number; y: number; zoom: number }) => {
      if (!loadedViewport.current) return;
      if (viewportSaveTimer.current) window.clearTimeout(viewportSaveTimer.current);
      viewportSaveTimer.current = window.setTimeout(() => {
        void api.updateProjectSettings(projectId, { outlineViewport: next }).catch(() => undefined);
      }, 400);
    },
    [projectId],
  );

  const createNode = (type: NodeType) => {
    setPendingCreate({ type, nonce: Date.now() });
  };

  // 切换项目时清掉旧的排版备份，避免把 A 项目的坐标用到 B 项目
  useEffect(() => {
    originalPositions.current = null;
    setHasLayoutBackup(false);
    setLayoutOpen(false);
  }, [projectId]);

  /**
   * 应用自动排版：只更新已有节点的 x / y。
   * 首次应用前把当前位置存进 originalPositions；连续排版时保留最早的一份，
   * 保证「撤销排版」始终回到用户手动摆好的原始位置。
   */
  const applyOutlineLayout = (positions: Record<string, { x: number; y: number }>) => {
    if (!originalPositions.current) {
      const current = canvasHandle.current?.getNodePositions() ?? {};
      const backup: Record<string, { x: number; y: number }> = {};
      for (const node of snapshot.nodes) {
        const pos = current[node.id] ?? { x: node.x, y: node.y };
        backup[node.id] = { x: pos.x, y: pos.y };
      }
      if (!Object.keys(backup).length) return;
      originalPositions.current = backup;
    }
    setHasLayoutBackup(true);
    canvasHandle.current?.applyLayout(positions);
    setLayoutOpen(false);
    toast.success('已应用自动排版，可用工具栏「撤销排版」还原原来的位置');
  };

  /** 恢复应用排版之前的节点位置 */
  const restoreOutlineLayout = () => {
    const backup = originalPositions.current;
    if (!backup) return;
    canvasHandle.current?.applyLayout(backup);
    originalPositions.current = null;
    setHasLayoutBackup(false);
    setLayoutOpen(false);
    toast.success('已恢复自动排版之前的位置');
  };

  /** 按内容页的阶段/章节自动生成画布结构（阶段 → 章节，并连线） */
  const generateFromContent = async () => {
    if (!structure.stages.length && !structure.chapters.length) {
      toast.warn('内容页还没有阶段或章节，请先创建。');
      return;
    }
    setGenerating(true);
    try {
      const result = await api.generateStructure(projectId);
      await reloadSnapshot();
      if (result.createdStageNodes || result.createdChapterNodes || result.createdEdges) {
        toast.success(
          `已生成 ${result.createdStageNodes} 个阶段节点、${result.createdChapterNodes} 个章节节点、${result.createdEdges} 条连线`,
        );
      } else {
        toast.info('结构已是最新，没有需要新增的节点或连线。');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成结构失败');
    } finally {
      setGenerating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteNode(deleteTarget.id);
      setSnapshot({
        ...snapshot,
        nodes: snapshot.nodes.filter((n) => n.id !== deleteTarget.id),
        edges: snapshot.edges.filter((e) => e.sourceId !== deleteTarget.id && e.targetId !== deleteTarget.id),
        links: snapshot.links.filter((l) => l.nodeId !== deleteTarget.id),
      });
      if (selectedNodeId === deleteTarget.id) setSelectedNodeId(null);
      setDeleteTarget(null);
      toast.success('节点已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除节点失败');
    } finally {
      setDeleting(false);
    }
  };

  const openChapterFromNode = (chapterId: string, nodeId: string) => {
    enterLink(nodeId, chapterId);
  };

  const stats = useMemo(() => {
    const byType = new Map<NodeType, number>();
    for (const n of snapshot.nodes) byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
    return byType;
  }, [snapshot.nodes]);

  if (linkState) {
    return (
      <LinkWorkspace
        projectId={projectId}
        structure={structure}
        snapshot={snapshot}
        setSnapshot={setSnapshot}
        foreshadows={foreshadows}
        nodeId={linkState.nodeId}
        chapterId={linkState.chapterId}
        onExit={exitLink}
        onChapterUpdated={onChapterUpdated}
        onSelectChapter={(chapterId) => enterLink(linkState.nodeId, chapterId)}
        onSelectNode={(nodeId) => enterLink(nodeId, linkState.chapterId)}
      />
    );
  }

  return (
    <div className="page outline-page">
      <div className="page-header" style={{ paddingBottom: 10 }}>
        <div className="page-title">
          <LayoutList size={19} style={{ color: 'var(--accent)' }} />
          大纲
          <span className="sub">
            {snapshot.nodes.length} 节点 · {snapshot.edges.length} 连线 · {snapshot.links.length} 章节关联
          </span>
        </div>
        <div className="page-actions">
          <div className="outline-tabs">
            <button className={`outline-tab${tab === 'canvas' ? ' active' : ''}`} onClick={() => setTab('canvas')}>
              <ListTree size={14} /> 剧情画布
            </button>
            <button className={`outline-tab${tab === 'foreshadow' ? ' active' : ''}`} onClick={() => setTab('foreshadow')}>
              <Lightbulb size={14} /> 伏笔追踪
              <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{foreshadows.length}</span>
            </button>
          </div>
          <button className="btn btn-sm" onClick={() => void generateFromContent()} disabled={generating} title="按内容页的阶段与章节自动生成节点和顺序连线">
            {generating ? <span className="spinner" /> : <Wand2 size={13} />} 从内容生成结构
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setLayoutOpen(true)}
            disabled={!snapshot.nodes.length}
            title="一键重排节点，减少连线交叉与重叠（可预览、可撤销）"
          >
            <LayoutGrid size={13} /> 自动排版
          </button>
          {hasLayoutBackup ? (
            <button className="btn btn-sm" onClick={restoreOutlineLayout} title="还原到应用自动排版之前的位置">
              <RotateCcw size={13} /> 撤销排版
            </button>
          ) : null}
          <button className="btn btn-sm" onClick={() => canvasHandle.current?.fitView()}>
            <Maximize2 size={13} /> 适应画布
          </button>
        </div>
      </div>

      {tab === 'foreshadow' ? (
        <ForeshadowPanel
          projectId={projectId}
          structure={structure}
          snapshot={snapshot}
          foreshadows={foreshadows}
          reload={reloadForeshadows}
          onJumpToNode={(nodeId) => {
            setTab('canvas');
            setSelectedNodeId(nodeId);
            window.setTimeout(() => canvasHandle.current?.focusNode(nodeId), 120);
          }}
          onJumpToChapter={(chapterId, nodeId) => {
            if (nodeId) enterLink(nodeId, chapterId);
          }}
        />
      ) : (
        <div className="outline-layout">
          {paletteOpen ? (
            <div className="outline-palette">
              <div className="palette-title">节点模块</div>
              {Object.entries(NODE_TYPE_META).map(([key, meta]) => (
                <button
                  key={key}
                  className="palette-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-dashi-node', key);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => createNode(key as NodeType)}
                  title={`添加${meta.label}`}
                >
                  <span className="palette-icon" style={{ background: meta.bg, color: meta.color }}>
                    {TYPE_ICONS[key as NodeType]}
                  </span>
                  <span className="palette-text" style={{ minWidth: 0 }}>
                    <div className="palette-label">
                      {meta.label}
                      {stats.get(key as NodeType) ? (
                        <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 5 }}>
                          {stats.get(key as NodeType)}
                        </span>
                      ) : null}
                    </div>
                    <div className="palette-desc">{meta.description}</div>
                  </span>
                </button>
              ))}
              <div className="palette-hint">
                <b style={{ color: 'var(--text-secondary)' }}>怎么用：</b>
                <br />
                故事阶段＝长期时间段（高中三年）
                <br />
                剧情事件＝阶段里的小事（打了一架）
                <br />
                具体章节＝写成正文的地方
                <br />
                伏笔＝隔很多章才回收的线索
                <br />
                <span style={{ color: 'var(--text-tertiary)' }}>
                  用「包含」把阶段连到事件，用关联章节把事件连到章节。
                </span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="btn btn-sm" onClick={() => canvasHandle.current?.zoomIn()}>
                  <Plus size={12} /> 放大
                </button>
                <button className="btn btn-sm" onClick={() => canvasHandle.current?.zoomOut()}>
                  <ChevronLeft size={12} /> 缩小
                </button>
                <button className="btn btn-sm" onClick={() => setPaletteOpen(false)}>
                  <PanelLeftClose size={12} /> 收起工具栏
                </button>
              </div>
            </div>
          ) : (
            <div className="outline-palette" style={{ width: 44, flexBasis: 44, padding: '10px 6px', alignItems: 'center' }}>
              <button className="icon-btn" title="展开工具栏" onClick={() => setPaletteOpen(true)}>
                <PanelLeftOpen size={16} />
              </button>
              {Object.entries(NODE_TYPE_META).map(([key, meta]) => (
                <button
                  key={key}
                  className="palette-item"
                  style={{ justifyContent: 'center', padding: 6 }}
                  onClick={() => createNode(key as NodeType)}
                  title={meta.label}
                >
                  <span className="palette-icon" style={{ background: meta.bg, color: meta.color }}>
                    {TYPE_ICONS[key as NodeType]}
                  </span>
                </button>
              ))}
            </div>
          )}

          <OutlineCanvas
            projectId={projectId}
            snapshot={snapshot}
            structure={structure}
            foreshadows={foreshadows}
            selectedNodeId={selectedNodeId}
            onSelectNode={(id) => {
              setSelectedNodeId(id);
              setSelectedEdgeId(null);
            }}
            onSnapshotChange={setSnapshot}
            onOpenChapter={openChapterFromNode}
            onSelectEdge={(id) => {
              setSelectedEdgeId(id);
              setSelectedNodeId(null);
            }}
            initialViewport={viewport}
            onViewportChange={(next) => {
              setViewport(next);
              saveViewport(next);
            }}
            registerHandle={(handle) => {
              canvasHandle.current = handle;
            }}
            pendingCreate={pendingCreate}
            onPendingCreateHandled={() => setPendingCreate(null)}
          />

          <NodeDetails
            projectId={projectId}
            snapshot={snapshot}
            structure={structure}
            foreshadows={foreshadows}
            selectedNodeId={selectedNodeId}
            onSnapshotChange={setSnapshot}
            onSelectNode={(id) => {
              setSelectedNodeId(id);
              setSelectedEdgeId(null);
            }}
            onDeleteNode={(node) => setDeleteTarget(node)}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={setSelectedEdgeId}
            onStructureChanged={() => {
              void reloadStructure();
            }}
            onOpenChapter={openChapterFromNode}
            onEnterLinkMode={(nodeId) => {
              const linked = snapshot.links.find((l) => l.nodeId === nodeId);
              if (!linked) {
                toast.warn('该节点还没有关联章节，请先在右侧详情中添加关联。');
                return;
              }
              enterLink(nodeId, linked.chapterId);
            }}
          />
        </div>
      )}

      <LayoutDialog
        open={layoutOpen}
        nodes={snapshot.nodes}
        edges={snapshot.edges}
        hasBackup={hasLayoutBackup}
        onApply={applyOutlineLayout}
        onRestore={restoreOutlineLayout}
        onClose={() => setLayoutOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除大纲节点"
        confirmText="删除节点"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        message={
          <>
            即将删除节点「<b>{deleteTarget?.title}</b>」。
            <br />
            与它相连的所有连线和章节关联会一并删除，不可恢复。
          </>
        }
      >
        <div className="danger-note">如果只是暂时不需要，建议先复制节点或导出大纲。</div>
      </ConfirmDialog>
    </div>
  );
}
