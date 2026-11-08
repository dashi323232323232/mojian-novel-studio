import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { OutlineNodeCard } from './OutlineNodeCard';
import { NODE_TYPE_META, EDGE_RELATION_META, FORESHADOW_STATUS_META } from '@shared/constants';
import type {
  EdgeRelation,
  Foreshadow,
  NodeType,
  OutlineEdge,
  OutlineNode,
  OutlineSnapshot,
  ProjectStructure,
} from '@shared/types';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { NodeHoverPopover } from './NodeHoverPopover';

const nodeTypes = { outlineNode: OutlineNodeCard };

export interface OutlineCanvasHandle {
  focusNode: (nodeId: string) => void;
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getViewport: () => { x: number; y: number; zoom: number } | null;
  /** 应用自动排版结果：更新节点位置并走一次 updatePositions 保存（不新增任何数据字段） */
  applyLayout: (positions: Record<string, { x: number; y: number }>) => void;
  /** 读取当前画布上各节点的实时位置（包含尚未保存的拖动） */
  getNodePositions: () => Record<string, { x: number; y: number }>;
}

interface Props {
  projectId: string;
  snapshot: OutlineSnapshot;
  structure: ProjectStructure;
  foreshadows: Foreshadow[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onSnapshotChange: (next: OutlineSnapshot) => void;
  onEditNode?: (nodeId: string) => void;
  onOpenChapter?: (chapterId: string, nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  initialViewport?: { x: number; y: number; zoom: number } | null;
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void;
  registerHandle?: (handle: OutlineCanvasHandle | null) => void;
  showMiniMap?: boolean;
  /** 新建节点时插入到该位置（画布坐标） */
  pendingCreate?: { type: NodeType; position?: { x: number; y: number }; nonce: number } | null;
  onPendingCreateHandled?: () => void;
}

function buildNodes(
  snapshot: OutlineSnapshot,
  structure: ProjectStructure,
  foreshadows: Foreshadow[],
): Node[] {
  const linkCount = new Map<string, number>();
  for (const link of snapshot.links) linkCount.set(link.nodeId, (linkCount.get(link.nodeId) ?? 0) + 1);
  return snapshot.nodes.map((n) => {
    const fs = n.data?.foreshadowId ? foreshadows.find((f) => f.id === n.data.foreshadowId) : undefined;
    return {
      id: n.id,
      type: 'outlineNode',
      position: { x: n.x, y: n.y },
      width: n.width,
      height: n.height,
      style: { width: n.width, height: n.height },
      data: {
        title: n.title,
        description: n.description,
        nodeType: n.type,
        chapterCount: linkCount.get(n.id) ?? 0,
        hasNotes: Boolean(n.notes && n.notes.trim()),
        boundChapterId: n.data?.chapterId ?? null,
        boundStageId: n.data?.stageId ?? null,
        foreshadowStatus: fs ? FORESHADOW_STATUS_META[fs.status]?.label : undefined,
        raw: n,
      },
    };
  });
}

function buildEdges(snapshot: OutlineSnapshot): Edge[] {
  return snapshot.edges.map((e) => {
    const meta = EDGE_RELATION_META[e.relation] ?? EDGE_RELATION_META.sequence;
    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: 'smoothstep',
      label: e.label || meta.label,
      labelStyle: { fontSize: 10, fill: meta.color, fontWeight: 600 },
      labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      style: { stroke: meta.color, strokeWidth: 1.6, strokeDasharray: meta.dashed ? '5 4' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 16, height: 16 },
      data: { relation: e.relation, raw: e },
    };
  });
}

export function OutlineCanvas({
  projectId,
  snapshot,
  structure,
  foreshadows,
  selectedNodeId,
  onSelectNode,
  onSnapshotChange,
  onOpenChapter,
  onSelectEdge,
  initialViewport,
  onViewportChange,
  registerHandle,
  showMiniMap = true,
  pendingCreate,
  onPendingCreateHandled,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(buildNodes(snapshot, structure, foreshadows));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(buildEdges(snapshot));
  const [hovered, setHovered] = useState<{ node: OutlineNode; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const dragSnapshot = useRef<Map<string, { x: number; y: number }>>(new Map());
  const saveTimer = useRef<number | null>(null);
  const lastSnapshotSig = useRef('');
  const viewportTimer = useRef<number | null>(null);

  // 外部数据变化时同步画布（保留用户当前视口）
  useEffect(() => {
    const sig = JSON.stringify({
      nodes: snapshot.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height, n.title, n.type, n.description, n.data]),
      edges: snapshot.edges.map((e) => [e.id, e.sourceId, e.targetId, e.relation, e.label]),
      links: snapshot.links,
      fs: foreshadows.map((f) => [f.id, f.status]),
    });
    if (sig === lastSnapshotSig.current) return;
    lastSnapshotSig.current = sig;
    setNodes((current) => {
      const built = buildNodes(snapshot, structure, foreshadows);
      // 保留正在拖动的节点位置，避免与本地交互冲突
      const dragging = new Set(
        current.filter((n) => (n as Node & { dragging?: boolean }).dragging).map((n) => n.id),
      );
      return built.map((n) => {
        if (dragging.has(n.id)) {
          const cur = current.find((c) => c.id === n.id);
          return cur ? { ...n, position: cur.position } : n;
        }
        return n;
      });
    });
    setEdges(buildEdges(snapshot));
  }, [snapshot, structure, foreshadows, setNodes, setEdges]);

  const persistPositions = useCallback(
    (items: Array<{ id: string; x: number; y: number; width?: number; height?: number }>) => {
      if (!items.length) return;
      void api
        .updatePositions(projectId, items)
        .catch((err) => toast.error(err instanceof Error ? err.message : '保存节点位置失败'));
    },
    [projectId],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        for (const change of changes) {
          if (change.type === 'position' && change.position) {
            dragSnapshot.current.set(change.id, change.position);
          }
          if (change.type === 'dimensions' && change.dimensions && change.resizing) {
            const node = next.find((n) => n.id === change.id);
            if (node) {
              dragSnapshot.current.set(change.id, node.position);
            }
          }
        }
        return next;
      });
      const hasDragEnd =
        changes.some((c) => c.type === 'position' && (c as { dragging?: boolean }).dragging === false) ||
        changes.some((c) => c.type === 'dimensions' && (c as { resizing?: boolean }).resizing === false);
      if (hasDragEnd) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          const items = Array.from(dragSnapshot.current.entries()).map(([id, pos]) => {
            const node = nodes.find((n) => n.id === id);
            return {
              id,
              x: pos.x,
              y: pos.y,
              ...(node?.measured?.width ? { width: node.measured.width } : {}),
              ...(node?.measured?.height ? { height: node.measured.height } : {}),
            };
          });
          dragSnapshot.current.clear();
          persistPositions(items);
        }, 260);
      }
    },
    [setNodes, persistPositions, nodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));
      for (const change of changes) {
        if (change.type === 'remove') {
          void api.deleteEdge(change.id).catch((err) => toast.error(err instanceof Error ? err.message : '删除连线失败'));
        }
      }
    },
    [setEdges],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) {
        toast.warn('不能把节点连接到自身');
        return;
      }
      try {
        const edge = await api.createEdge(projectId, {
          sourceId: connection.source,
          targetId: connection.target,
          relation: 'sequence',
        });
        const meta = EDGE_RELATION_META[edge.relation];
        setEdges((eds) =>
          addEdge(
            {
              id: edge.id,
              source: edge.sourceId,
              target: edge.targetId,
              type: 'smoothstep',
              label: edge.label || meta.label,
              labelStyle: { fontSize: 10, fill: meta.color, fontWeight: 600 },
              labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
              style: { stroke: meta.color, strokeWidth: 1.6 },
              markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 16, height: 16 },
              data: { relation: edge.relation, raw: edge },
            },
            eds,
          ),
        );
        toast.success(`已创建「${meta.label}」连线，可在右侧修改关系类型`);
        onSelectEdge?.(edge.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建连线失败');
      }
    },
    [projectId, setEdges, onSelectEdge],
  );

  // 新建节点（来自左侧工具栏或右键）
  useEffect(() => {
    if (!pendingCreate) return;
    const type = pendingCreate.type;
    const meta = NODE_TYPE_META[type];
    const rect = wrapperRef.current?.getBoundingClientRect();
    // screenToFlowPosition 需要视口（client）坐标，而不是容器内相对坐标
    const center =
      flowRef.current?.screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
      }) ?? { x: 200, y: 200 };
    const position = pendingCreate.position ?? {
      x: Math.round(center.x - 110),
      y: Math.round(center.y - 60),
    };
    // 避免与已有节点重叠：按 36px 阶梯错开
    if (!pendingCreate.position) {
      let tries = 0;
      while (
        tries < 24 &&
        snapshot.nodes.some(
          (n) => Math.abs(n.x - position.x) < 60 && Math.abs(n.y - position.y) < 46,
        )
      ) {
        position.x += 36;
        position.y += 30;
        tries++;
      }
    }
    onPendingCreateHandled?.();
    void (async () => {
      try {
        const node = await api.createNode(projectId, {
          type,
          title: `新${meta.short}`,
          description: '',
          x: Math.round(position.x),
          y: Math.round(position.y),
        });
        onSnapshotChange({
          ...snapshot,
          nodes: [...snapshot.nodes, node],
        });
        onSelectNode(node.id);
        if (snapshot.nodes.length === 0) {
          window.setTimeout(() => flowRef.current?.setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom: 1, duration: 200 }), 60);
        }
        toast.success(`已添加${meta.label}节点`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建节点失败');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCreate?.nonce]);

  useEffect(() => {
    if (!registerHandle) return;
    registerHandle({
      focusNode: (nodeId: string) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node || !flowRef.current) return;
        flowRef.current.setCenter(node.position.x + 110, node.position.y + 60, { zoom: 1.1, duration: 300 });
      },
      fitView: () => flowRef.current?.fitView({ duration: 300, padding: 0.2, minZoom: 0.02, maxZoom: 4 }),
      // 缩放范围放宽到 0.02~8 后，默认步长（约 1.2 倍）需要点很多次才能到两端，
      // 这里用 1.35 倍手动步进，兼顾「点几下就能缩到全貌」与精细调整。
      // 不做动画：连续点击时动画会互相打断，导致实际倍率跟不上点击次数
      zoomIn: () => {
        const flow = flowRef.current;
        if (!flow) return;
        const vp = flow.getViewport();
        flow.zoomTo(Math.min(8, vp.zoom * 1.35), { duration: 0 });
      },
      zoomOut: () => {
        const flow = flowRef.current;
        if (!flow) return;
        const vp = flow.getViewport();
        flow.zoomTo(Math.max(0.02, vp.zoom / 1.35), { duration: 0 });
      },
      getViewport: () => flowRef.current?.getViewport() ?? null,
      applyLayout: (positions) => {
        const entries = Object.entries(positions).filter(
          ([, pos]) => pos && Number.isFinite(pos.x) && Number.isFinite(pos.y),
        );
        if (!entries.length) return;
        const nextById = new Map(entries.map(([id, pos]) => [id, pos]));
        setNodes((current) =>
          current.map((n) => {
            const pos = nextById.get(n.id);
            return pos ? { ...n, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : n;
          }),
        );
        // 只更新已有节点的 x / y，不写入任何新字段
        onSnapshotChange({
          ...snapshot,
          nodes: snapshot.nodes.map((n) => {
            const pos = nextById.get(n.id);
            return pos ? { ...n, x: Math.round(pos.x), y: Math.round(pos.y) } : n;
          }),
        });
        // 只写回 x / y：节点尺寸与内容完全不动，保证与旧数据兼容
        persistPositions(
          entries.map(([id, pos]) => ({ id, x: Math.round(pos.x), y: Math.round(pos.y) })),
        );
      },
      getNodePositions: () => {
        const map: Record<string, { x: number; y: number }> = {};
        for (const n of nodes) map[n.id] = { x: n.position.x, y: n.position.y };
        return map;
      },
    });
    return () => registerHandle(null);
  }, [registerHandle, nodes, snapshot, onSnapshotChange, persistPositions]);

  const onMoveEnd = useCallback(
    (_: unknown, viewport: { x: number; y: number; zoom: number }) => {
      if (!onViewportChange) return;
      if (viewportTimer.current) window.clearTimeout(viewportTimer.current);
      viewportTimer.current = window.setTimeout(() => onViewportChange(viewport), 500);
    },
    [onViewportChange],
  );

  const showHover = useCallback(
    (nodeId: string, event: React.MouseEvent) => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      const raw = snapshot.nodes.find((n) => n.id === nodeId);
      if (!raw) return;
      const rect = wrapperRef.current?.getBoundingClientRect();
      const x = event.clientX - (rect?.left ?? 0);
      const y = event.clientY - (rect?.top ?? 0);
      hoverTimer.current = window.setTimeout(() => {
        setHovered({ node: raw, x, y });
      }, 320);
    },
    [snapshot.nodes],
  );

  const hideHover = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(null), 240);
  }, []);

  const hoverChapters = useMemo(() => {
    if (!hovered) return [];
    const ids = snapshot.links.filter((l) => l.nodeId === hovered.node.id).map((l) => l.chapterId);
    return structure.chapters
      .filter((c) => ids.includes(c.id))
      .map((c, i) => ({
        id: c.id,
        name: c.name,
        order: i + 1,
        stageName: structure.stages.find((s) => s.id === c.stageId)?.name ?? null,
        wordCount: c.wordCount,
      }));
  }, [hovered, snapshot.links, structure]);

  return (
    <div className="outline-canvas-wrap" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId }))}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-dashi-node')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData('application/x-dashi-node');
          if (!raw) return;
          e.preventDefault();
          const type = raw as NodeType;
          if (!NODE_TYPE_META[type]) return;
          const rect = wrapperRef.current?.getBoundingClientRect();
          const pos = flowRef.current?.screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          }) ?? { x: 100, y: 100 };
          void (async () => {
            try {
              const node = await api.createNode(projectId, {
                type,
                title: `新${NODE_TYPE_META[type].short}`,
                description: '',
                x: Math.round(pos.x - 110),
                y: Math.round(pos.y - 58),
              });
              onSnapshotChange({ ...snapshot, nodes: [...snapshot.nodes, node] });
              onSelectNode(node.id);
              toast.success(`已添加${NODE_TYPE_META[type].label}节点`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : '创建节点失败');
            }
          })();
          void rect;
        }}
        onInit={(instance) => {
          flowRef.current = instance as unknown as ReactFlowInstance<Node, Edge>;
          if (initialViewport) {
            instance.setViewport(initialViewport);
          } else if (snapshot.nodes.length) {
            window.setTimeout(() => instance.fitView({ padding: 0.25, duration: 0, minZoom: 0.02, maxZoom: 4 }), 80);
          }
        }}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onEdgeClick={(_, edge) => {
          onSelectEdge?.(edge.id);
        }}
        onNodeMouseEnter={(e, node) => showHover(node.id, e)}
        onNodeMouseLeave={hideHover}
        onPaneClick={() => {
          onSelectNode(null);
          setHovered(null);
        }}
        onMoveEnd={onMoveEnd}
        defaultViewport={initialViewport ?? { x: 0, y: 0, zoom: 1 }}
        // 缩放范围放宽：大画布（上百节点）也要能缩到看清全貌，
        // 放大也要能看清单个节点的详情。两端都留出足够余量。
        minZoom={0.02}
        maxZoom={8}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        panOnScroll
        selectionOnDrag={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        snapToGrid
        snapGrid={[8, 8]}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#d5dae4" />
        <Controls showInteractive={false} position="bottom-right" style={{ display: 'flex', flexDirection: 'column' }} />
        {showMiniMap ? (
          <MiniMap
            position="bottom-right"
            style={{ width: 140, height: 92, bottom: 12, right: 56, background: '#fff' }}
            nodeColor={(n) => {
              const d = n.data as unknown as { nodeType: NodeType };
              return NODE_TYPE_META[d.nodeType]?.color ?? '#999';
            }}
            maskColor="rgba(240,242,246,0.75)"
            pannable
            zoomable
          />
        ) : null}
      </ReactFlow>
      {hovered ? (
        <NodeHoverPopover
          node={hovered.node}
          chapters={hoverChapters}
          x={hovered.x}
          y={hovered.y}
          onMouseEnter={() => {
            if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
          }}
          onMouseLeave={hideHover}
          onOpenChapter={(chapterId) => {
            setHovered(null);
            onOpenChapter?.(chapterId, hovered.node.id);
          }}
        />
      ) : null}
    </div>
  );
}
