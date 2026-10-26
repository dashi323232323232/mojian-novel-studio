import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
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
} from 'lucide-react';
import type { Foreshadow, NodeType, OutlineSnapshot, ProjectStructure } from '@shared/types';
import { NODE_TYPE_META, EDGE_RELATION_META } from '@shared/constants';
import { api } from '../lib/api';
import { confirmLeave } from '../lib/leaveGuard';
import { toast } from '../lib/toast';
import { OutlineCanvas, type OutlineCanvasHandle } from '../components/outline/OutlineCanvas';
import { NodeDetails } from '../components/outline/NodeDetails';
import { ConfirmDialog } from '../components/Modal';
import { ForeshadowPanel } from '../components/ForeshadowPanel';
import { LinkWorkspace } from './LinkWorkspace';
import type { OutlineNode } from '@shared/types';

const TYPE_ICONS: Record<NodeType, React.ReactNode> = {
  stage: <Flag size={13} />,
  event: <BookOpen size={13} />,
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
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const canvasHandle = useRef<OutlineCanvasHandle | null>(null);
  const viewportSaveTimer = useRef<number | null>(null);
  const loadedViewport = useRef(false);

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
                点击或拖拽到画布创建节点。
                <br />
                拖动节点圆点连线，滚轮缩放，空白处平移。
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
