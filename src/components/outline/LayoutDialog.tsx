import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import type { OutlineEdge, OutlineNode } from '@shared/types';
import { NODE_TYPE_META, EDGE_RELATION_META } from '@shared/constants';
import { computeLayout, measureLayout } from '../../lib/outlineLayout';
import type { LayoutOptions, LayoutStrategy } from '../../lib/outlineLayout';
import { Modal } from '../Modal';
import '../../styles/outline-layout.css';

interface Props {
  open: boolean;
  nodes: OutlineNode[];
  edges: OutlineEdge[];
  /** 是否已经应用过布局（此时「恢复原来的位置」可用） */
  hasBackup: boolean;
  onApply: (positions: Record<string, { x: number; y: number }>) => void;
  onRestore: () => void;
  onClose: () => void;
}

interface PreviewRect {
  node: OutlineNode;
  x: number;
  y: number;
  meta: { color: string; bg: string; short: string };
}

interface PreviewLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  dashed: boolean;
}

interface StrategyMeta {
  value: LayoutStrategy;
  title: string;
  icon: typeof LayoutGrid;
  description: string;
}

const STRATEGIES: StrategyMeta[] = [
  {
    value: 'layered',
    title: '分层流程',
    icon: Wand2,
    description: '按剧情先后分层，同层并排，最清晰，适合主线与伏笔穿插。',
  },
  {
    value: 'radial',
    title: '环形辐射',
    icon: Sparkles,
    description: '以连接最多的人物/事件为中心，其余按关系远近向外展开。',
  },
  {
    value: 'grouped',
    title: '类型分组',
    icon: LayoutGrid,
    description: '阶段、事件、章节、人物、伏笔各自成块，块内再分层。',
  },
  {
    value: 'compact',
    title: '紧凑排布',
    icon: LayoutGrid,
    description: '优先缩小整体面积，节点多、画布大时更省空间。',
  },
];

const SORT_OPTIONS: Array<{ value: NonNullable<LayoutOptions['sortBy']>; label: string }> = [
  { value: 'type', label: '按节点类型' },
  { value: 'title', label: '按标题' },
  { value: 'degree', label: '按连接数' },
];

function numberLabel(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('zh-CN');
}

export function LayoutDialog({
  open,
  nodes,
  edges,
  hasBackup,
  onApply,
  onRestore,
  onClose,
}: Props) {
  const [strategy, setStrategy] = useState<LayoutStrategy>('layered');
  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [align, setAlign] = useState<'start' | 'center'>('center');
  const [gapX, setGapX] = useState(120);
  const [gapY, setGapY] = useState(100);
  const [groupByType, setGroupByType] = useState(false);
  const [sortBy, setSortBy] = useState<NonNullable<LayoutOptions['sortBy']>>('type');

  const options = useMemo<LayoutOptions>(
    () => ({ strategy, direction, align, gapX, gapY, groupByType, sortBy }),
    [strategy, direction, align, gapX, gapY, groupByType, sortBy],
  );

  // 滑块拖动时避免每一帧都跑一次布局：稍作防抖，预览仍然跟手；打开弹窗时立即计算
  const [settledOptions, setSettledOptions] = useState<LayoutOptions>(options);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      setSettledOptions(options);
      return;
    }
    const timer = window.setTimeout(() => setSettledOptions(options), 140);
    return () => window.clearTimeout(timer);
  }, [open, options]);

  const result = useMemo(
    () => (open ? computeLayout(nodes, edges, settledOptions) : null),
    [open, nodes, edges, settledOptions],
  );

  const before = useMemo(
    () => (open ? measureLayout(nodes, edges) : null),
    [open, nodes, edges],
  );

  const preview = useMemo(() => {
    if (!open || !result) return null;
    const pad = 24;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const p = result.positions[node.id];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + node.width);
      maxY = Math.max(maxY, p.y + node.height);
    }
    if (!Number.isFinite(minX)) return null;
    const width = Math.max(1, maxX - minX + pad * 2);
    const height = Math.max(1, maxY - minY + pad * 2);
    const rects: PreviewRect[] = [];
    for (const node of nodes) {
      const p = result.positions[node.id];
      if (!p) continue;
      rects.push({ node, x: p.x, y: p.y, meta: NODE_TYPE_META[node.type] ?? NODE_TYPE_META.note });
    }
    const byId = new Map(rects.map((r) => [r.node.id, r]));
    const lines: PreviewLine[] = [];
    for (const edge of edges) {
      const s = byId.get(edge.sourceId);
      const t = byId.get(edge.targetId);
      if (!s || !t) continue;
      const meta = EDGE_RELATION_META[edge.relation] ?? EDGE_RELATION_META.sequence;
      lines.push({
        id: edge.id,
        x1: s.x + s.node.width / 2,
        y1: s.y + s.node.height / 2,
        x2: t.x + t.node.width / 2,
        y2: t.y + t.node.height / 2,
        color: meta.color,
        dashed: Boolean(meta.dashed),
      });
    }
    return {
      viewBox: minX - pad + ' ' + (minY - pad) + ' ' + width + ' ' + height,
      rects,
      lines,
    };
  }, [open, nodes, edges, result]);

  const crossingsBefore = before?.edgeCrossings ?? 0;
  const crossingsAfter = result?.metrics.edgeCrossings ?? 0;
  const overlapBefore = before?.overlappingNodes ?? 0;
  const overlapAfter = result?.metrics.overlappingNodes ?? 0;
  const lengthBefore = before?.totalEdgeLength ?? 0;
  const lengthAfter = result?.metrics.totalEdgeLength ?? 0;
  const radial = strategy === 'radial';
  const sortDisabled = radial;
  const groupDisabled = strategy === 'grouped';

  return (
    <Modal
      open={open}
      title="自动排版"
      subtitle={
        nodes.length
          ? '调整风格与间距，右侧实时预览；应用后只更新节点的 x / y，不会改动节点内容与连线。'
          : '当前画布还没有节点，先添加节点后再排版。'
      }
      width="xl"
      onClose={onClose}
      footer={
        <>
          <div className="left">
            <button
              className="btn"
              onClick={onRestore}
              disabled={!hasBackup}
              title={hasBackup ? '还原到应用自动排版之前的位置' : '还没有应用过自动排版'}
            >
              <RotateCcw size={13} /> 恢复原来的位置
            </button>
          </div>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={!nodes.length || !result}
            onClick={() => result && onApply(result.positions)}
          >
            <Wand2 size={13} /> 应用布局
          </button>
        </>
      }
    >
      <div className="layout-dialog">
        <div className="layout-dialog-main">
          <div className="layout-section-title">布局风格</div>
          <div className="layout-strategies">
            {STRATEGIES.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  className={'layout-strategy-card' + (strategy === item.value ? ' active' : '')}
                  onClick={() => setStrategy(item.value)}
                  aria-pressed={strategy === item.value}
                >
                  <span className="layout-strategy-head">
                    <Icon size={14} />
                    {item.title}
                  </span>
                  <span className="layout-strategy-desc">{item.description}</span>
                </button>
              );
            })}
          </div>

          <div className="layout-section-title">方向与对齐</div>
          <div className="layout-row">
            <span className="layout-label">主方向</span>
            <div className="layout-seg">
              {(['TB', 'LR'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={'layout-seg-item' + (direction === value ? ' active' : '')}
                  onClick={() => setDirection(value)}
                  disabled={radial}
                >
                  {value === 'TB' ? '从上到下' : '从左到右'}
                </button>
              ))}
            </div>
            {radial ? <span className="layout-hint">环形布局不使用方向</span> : null}
          </div>
          <div className="layout-row">
            <span className="layout-label">同层对齐</span>
            <div className="layout-seg">
              {(['center', 'start'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={'layout-seg-item' + (align === value ? ' active' : '')}
                  onClick={() => setAlign(value)}
                  disabled={radial}
                >
                  {value === 'center' ? '居中' : '左/上对齐'}
                </button>
              ))}
            </div>
          </div>

          <div className="layout-section-title">间距</div>
          <div className="layout-row">
            <span className="layout-label">水平间距</span>
            <input
              className="layout-slider"
              type="range"
              min={40}
              max={400}
              step={10}
              value={gapX}
              onChange={(e) => setGapX(Number(e.target.value))}
            />
            <span className="layout-value">{gapX}px</span>
          </div>
          <div className="layout-row">
            <span className="layout-label">垂直间距</span>
            <input
              className="layout-slider"
              type="range"
              min={40}
              max={400}
              step={10}
              value={gapY}
              onChange={(e) => setGapY(Number(e.target.value))}
            />
            <span className="layout-value">{gapY}px</span>
          </div>

          <div className="layout-section-title">分组与排序</div>
          <div className="layout-row">
            <span className="layout-label">层内排序</span>
            <select
              className="select"
              value={sortBy}
              disabled={sortDisabled}
              onChange={(e) => setSortBy(e.target.value as NonNullable<LayoutOptions['sortBy']>)}
            >
              {SORT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            {sortDisabled ? <span className="layout-hint">环形布局不使用层内排序</span> : null}
          </div>
          <label className="layout-row layout-check">
            <input
              type="checkbox"
              checked={groupByType || groupDisabled}
              disabled={groupDisabled}
              onChange={(e) => setGroupByType(e.target.checked)}
            />
            按节点类型分组（同类型放一起）
            {groupDisabled ? <span className="layout-hint">类型分组布局已默认分组</span> : null}
          </label>
          <div className="layout-preview-tip" style={{ marginTop: 8 }}>
            排序方式只决定初始顺序，算法会在此基础上继续微调，尽量让连线少交叉。
          </div>
        </div>

        <div className="layout-dialog-preview">
          <div className="layout-section-title">实时预览</div>
          {preview ? (
            <svg
              className="layout-preview"
              viewBox={preview.viewBox}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="自动排版预览"
            >
              {preview.lines.map((line) => (
                <line
                  key={line.id}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={line.color}
                  strokeWidth={2}
                  strokeOpacity={0.6}
                  strokeDasharray={line.dashed ? '6 5' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {preview.rects.map((rect) => (
                <g key={rect.node.id}>
                  <rect
                    x={rect.x}
                    y={rect.y}
                    width={rect.node.width}
                    height={rect.node.height}
                    rx={10}
                    fill={rect.meta.bg}
                    stroke={rect.meta.color}
                    strokeWidth={1.5}
                    strokeOpacity={0.7}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={rect.x + 12}
                    y={rect.y + 22}
                    fontSize={14}
                    fill={rect.meta.color}
                    style={{ fontWeight: 600 }}
                  >
                    {rect.node.title.length > 8 ? rect.node.title.slice(0, 8) + '…' : rect.node.title}
                  </text>
                  <text x={rect.x + 12} y={rect.y + 40} fontSize={11} fill="#8a94a3">
                    {rect.meta.short}
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <div className="layout-preview layout-preview-empty">暂无可预览的节点</div>
          )}

          <div className="layout-section-title">布局质量对比</div>
          <div className="layout-metrics">
            <div className="layout-metric">
              <span className="layout-metric-label">连线交叉</span>
              <span className="layout-metric-value">
                {numberLabel(crossingsBefore)}
                <span className="layout-metric-arrow">→</span>
                <b className={crossingsAfter <= crossingsBefore ? 'good' : 'bad'}>{numberLabel(crossingsAfter)}</b>
              </span>
            </div>
            <div className="layout-metric">
              <span className="layout-metric-label">重叠节点</span>
              <span className="layout-metric-value">
                {numberLabel(overlapBefore)}
                <span className="layout-metric-arrow">→</span>
                <b className={overlapAfter <= overlapBefore ? 'good' : 'bad'}>{numberLabel(overlapAfter)}</b>
              </span>
            </div>
            <div className="layout-metric">
              <span className="layout-metric-label">连线总长度</span>
              <span className="layout-metric-value">
                {numberLabel(lengthBefore)}
                <span className="layout-metric-arrow">→</span>
                <b className={lengthAfter <= lengthBefore ? 'good' : 'bad'}>{numberLabel(lengthAfter)}</b>
              </span>
            </div>
          </div>
          <div className="layout-preview-tip">
            指标基于节点中心连线近似估算，仅用于比较布局效果。
          </div>
        </div>
      </div>
    </Modal>
  );
}
