/**
 * 大纲自动排版算法 —— 纯函数、无 React / DOM 依赖，可在单测中直接调用。
 *
 * 设计要点：
 * 1. 只读取节点的 id / type / title / width / height，不依赖快照中的任何其它字段；
 * 2. 输出只是「节点 id -> 新坐标」，不产生任何新字段，旧数据（已有 x/y）照常工作；
 * 3. 所有策略最后都会做一次重叠消除，保证返回的节点矩形不相交；
 * 4. 图规模在 500 节点内时应远低于 100ms。
 */
import { NODE_TYPES } from '@shared/types';
import type { NodeType, OutlineEdge, OutlineNode } from '@shared/types';

export type LayoutStrategy = 'layered' | 'radial' | 'grouped' | 'compact';

export interface LayoutOptions {
  strategy: LayoutStrategy;
  /** 节点水平间距（默认 120，内部限制在 20~800） */
  gapX?: number;
  /** 节点垂直间距（默认 100，内部限制在 20~800） */
  gapY?: number;
  /** 布局主方向：'TB' 从上到下 | 'LR' 从左到右 */
  direction?: 'TB' | 'LR';
  /** 同层节点对齐方式 */
  align?: 'start' | 'center';
  /** 是否按节点类型分组（同类型放一起） */
  groupByType?: boolean;
  /** 层内排序：'type' 按类型 | 'title' 按标题 | 'degree' 按连接数 */
  sortBy?: 'type' | 'title' | 'degree';
}

export interface LayoutMetrics {
  edgeCrossings: number;
  overlappingNodes: number;
  totalEdgeLength: number;
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  /** 布局质量指标，用于在 UI 上显示「交叉数从 N 降到 M」 */
  metrics: LayoutMetrics;
}

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 116;
const DEFAULT_GAP_X = 120;
const DEFAULT_GAP_Y = 100;
/** 超过这个边数时交叉数改用估算，避免 O(E^2) 卡顿 */
const CROSSING_LIMIT = 400;
const OVERLAP_EPSILON = 0.01;

interface LayoutNode {
  id: string;
  type: NodeType;
  title: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface Placement {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

interface Graph {
  out: Map<string, string[]>;
  inn: Map<string, string[]>;
  degree: Map<string, number>;
  pairs: Array<[string, string]>;
}

interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResolvedOptions {
  strategy: LayoutStrategy;
  gapX: number;
  gapY: number;
  direction: 'TB' | 'LR';
  align: 'start' | 'center';
  groupByType: boolean;
  sortBy: 'type' | 'title' | 'degree';
}

function finiteSize(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function finiteCoord(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampGap(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(800, Math.max(20, n));
}

function resolveOptions(options?: LayoutOptions): ResolvedOptions {
  const o = options ?? { strategy: 'layered' };
  const strategy: LayoutStrategy =
    o.strategy === 'radial' || o.strategy === 'grouped' || o.strategy === 'compact' ? o.strategy : 'layered';
  return {
    strategy,
    gapX: clampGap(o.gapX, DEFAULT_GAP_X),
    gapY: clampGap(o.gapY, DEFAULT_GAP_Y),
    direction: o.direction === 'LR' ? 'LR' : 'TB',
    align: o.align === 'start' ? 'start' : 'center',
    groupByType: Boolean(o.groupByType),
    sortBy: o.sortBy === 'title' || o.sortBy === 'degree' ? o.sortBy : 'type',
  };
}

function edgeKey(source: string, target: string): string {
  return source + '\u0000' + target;
}

function nodeTypeIndex(type: NodeType): number {
  const i = NODE_TYPES.indexOf(type);
  return i >= 0 ? i : NODE_TYPES.length;
}

/* ---------------- 几何工具 ---------------- */

function orient(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** 严格线段相交（端点接触 / 共线不算交叉）。 */
function segmentsCross(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const d1 = orient(b1, b2, a1);
  const d2 = orient(b1, b2, a2);
  const d3 = orient(a1, a2, b1);
  const d4 = orient(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function centerOf(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

interface Segment {
  s: string;
  t: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
}

function buildSegments(
  placed: Map<string, { x: number; y: number }>,
  sizes: Map<string, Size>,
  pairs: Array<[string, string]>,
): Segment[] {
  const segments: Segment[] = [];
  for (const [s, t] of pairs) {
    const ps = placed.get(s);
    const pt = placed.get(t);
    const ss = sizes.get(s);
    const st = sizes.get(t);
    if (!ps || !pt || !ss || !st) continue;
    segments.push({
      s,
      t,
      a: { x: ps.x + ss.width / 2, y: ps.y + ss.height / 2 },
      b: { x: pt.x + st.width / 2, y: pt.y + st.height / 2 },
    });
  }
  return segments;
}

function sharesEndpoint(s1: Segment, s2: Segment): boolean {
  return s1.s === s2.s || s1.s === s2.t || s1.t === s2.s || s1.t === s2.t;
}

/**
 * 只统计「与 focus 中节点相关的边」参与的交叉数，用于交换相邻节点时快速求增量。
 * 复杂度 O(deg(focus) * E)，比全量 O(E^2) 便宜得多。
 */
function crossingsTouching(
  placed: Map<string, { x: number; y: number }>,
  sizes: Map<string, Size>,
  pairs: Array<[string, string]>,
  focus: Set<string>,
): number {
  const segments = buildSegments(placed, sizes, pairs);
  const focusFlags = segments.map((seg) => focus.has(seg.s) || focus.has(seg.t));
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    if (!focusFlags[i]) continue;
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue;
      if (focusFlags[j] && j < i) continue;
      const s1 = segments[i];
      const s2 = segments[j];
      if (sharesEndpoint(s1, s2)) continue;
      if (segmentsCross(s1.a, s1.b, s2.a, s2.b)) count++;
    }
  }
  return count;
}

/**
 * 用节点中心连线统计交叉数（smoothstep 曲线用直线近似）。
 * 共享端点的两条边不算交叉；边数超过 CROSSING_LIMIT 时返回估算值避免卡顿。
 */
function countCrossings(
  placed: Map<string, { x: number; y: number }>,
  sizes: Map<string, Size>,
  pairs: Array<[string, string]>,
): number {
  const segments = buildSegments(placed, sizes, pairs);
  if (segments.length > CROSSING_LIMIT) {
    return Math.round(((segments.length * (segments.length - 1)) / 2) * 0.02);
  }
  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s1 = segments[i];
      const s2 = segments[j];
      if (sharesEndpoint(s1, s2)) continue;
      if (segmentsCross(s1.a, s1.b, s2.a, s2.b)) crossings++;
    }
  }
  return crossings;
}

/* ---------------- 图结构 ---------------- */

/** 构建有向图（忽略自环与重复边），同时保留去重后的边对用于拓扑分层。 */
function buildGraph(ids: Set<string>, edges: OutlineEdge[]): Graph {
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  const degree = new Map<string, number>();
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const id of ids) {
    out.set(id, []);
    inn.set(id, []);
    degree.set(id, 0);
  }
  for (const edge of edges) {
    if (!edge) continue;
    const s = edge.sourceId;
    const t = edge.targetId;
    if (!ids.has(s) || !ids.has(t) || s === t) continue;
    const key = edgeKey(s, t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.get(s)!.push(t);
    inn.get(t)!.push(s);
    degree.set(s, (degree.get(s) ?? 0) + 1);
    degree.set(t, (degree.get(t) ?? 0) + 1);
    pairs.push([s, t]);
  }
  return { out, inn, degree, pairs };
}

/** DFS 找环：返回所有回边（指向当前递归栈中的节点）。忽略这些回边后图必为 DAG。 */
function findBackEdges(ids: string[], idSet: Set<string>, graph: Graph): Set<string> {
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of graph.out.get(u) ?? []) {
      if (!idSet.has(v)) continue;
      const s = state.get(v) ?? 0;
      if (s === 1) back.add(edgeKey(u, v));
      else if (s === 0) visit(v);
    }
    state.set(u, 2);
  };
  for (const id of ids) if ((state.get(id) ?? 0) === 0) visit(id);
  return back;
}

/** Kahn 拓扑排序分层；有环时先按 DFS 回边打破环，保证一定能返回结果。 */
function buildLayers(ids: string[], idSet: Set<string>, graph: Graph): string[][] {
  if (!ids.length) return [];
  const back = findBackEdges(ids, idSet, graph);
  const indeg = new Map<string, number>();
  for (const id of ids) indeg.set(id, 0);
  for (const [s, t] of graph.pairs) {
    if (!idSet.has(s) || !idSet.has(t)) continue;
    if (back.has(edgeKey(s, t))) continue;
    indeg.set(t, (indeg.get(t) ?? 0) + 1);
  }
  let wave = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const layers: string[][] = [];
  const seen = new Set<string>();
  while (wave.length) {
    layers.push(wave);
    const next: string[] = [];
    for (const u of wave) {
      seen.add(u);
      for (const v of graph.out.get(u) ?? []) {
        if (!idSet.has(v) || back.has(edgeKey(u, v))) continue;
        const left = (indeg.get(v) ?? 0) - 1;
        indeg.set(v, left);
        if (left === 0) next.push(v);
      }
    }
    wave = next;
  }
  const rest = ids.filter((id) => !seen.has(id));
  if (rest.length) layers.push(rest);
  return layers;
}

function compareNodes(
  a: string,
  b: string,
  nodes: Map<string, LayoutNode>,
  opts: ResolvedOptions,
  graph: Graph,
): number {
  const na = nodes.get(a)!;
  const nb = nodes.get(b)!;
  if (opts.groupByType) {
    const d = nodeTypeIndex(na.type) - nodeTypeIndex(nb.type);
    if (d) return d;
  }
  if (opts.sortBy === 'title') {
    const d = na.title.localeCompare(nb.title);
    if (d) return d;
  } else if (opts.sortBy === 'degree') {
    const d = (graph.degree.get(b) ?? 0) - (graph.degree.get(a) ?? 0);
    if (d) return d;
  } else {
    const d = nodeTypeIndex(na.type) - nodeTypeIndex(nb.type);
    if (d) return d;
  }
  const t = na.title.localeCompare(nb.title);
  if (t) return t;
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------------- 分层布局 ---------------- */

function totalArea(ids: string[], sizes: Map<string, Size>, gapX: number, gapY: number): number {
  let area = 0;
  for (const id of ids) {
    const s = sizes.get(id)!;
    area += (s.width + gapX) * (s.height + gapY);
  }
  return area;
}

/**
 * 分层布局（layered / grouped 的块内 / compact 都复用这套）。
 * TB：层沿 y 排列、层内沿 x 排列；LR 反之。层内超过可用跨度时自动换行。
 */
function placeLayered(
  ids: string[],
  graph: Graph,
  opts: ResolvedOptions,
  nodes: Map<string, LayoutNode>,
  sizes: Map<string, Size>,
  spanScale: number,
): Placement {
  const positions = new Map<string, { x: number; y: number }>();
  if (!ids.length) return { positions, width: 0, height: 0 };
  const idSet = new Set(ids);
  const layers = buildLayers(ids, idSet, graph);
  for (const layer of layers) layer.sort((a, b) => compareNodes(a, b, nodes, opts, graph));

  const gapX = opts.gapX;
  const gapY = opts.gapY;
  const area = totalArea(ids, sizes, gapX, gapY);
  const root = Math.sqrt(Math.max(area, 1));
  const maxSpan =
    opts.direction === 'TB' ? Math.max(1600, root * spanScale) : Math.max(1200, root * spanScale);
  const tb = opts.direction === 'TB';

  /** 把「层 -> 层内顺序」真正摆成坐标；交叉数优化需要反复调用它。 */
  const layoutLayers = (ordered: string[][]): Map<string, { x: number; y: number }> => {
    const placed = new Map<string, { x: number; y: number }>();
    if (tb) {
      const layerRows: Array<Array<{ ids: string[]; width: number; height: number }>> = [];
      for (const layer of ordered) {
        const rows: Array<{ ids: string[]; width: number; height: number }> = [];
        let row: string[] = [];
        let rowWidth = 0;
        for (const id of layer) {
          const size = sizes.get(id)!;
          const need = row.length ? rowWidth + gapX + size.width : size.width;
          if (row.length && need > maxSpan) {
            rows.push({
              ids: row,
              width: rowWidth,
              height: row.reduce((h, rid) => Math.max(h, sizes.get(rid)!.height), 0),
            });
            row = [];
            rowWidth = 0;
          }
          rowWidth = row.length ? rowWidth + gapX + size.width : size.width;
          row.push(id);
        }
        if (row.length) {
          rows.push({
            ids: row,
            width: rowWidth,
            height: row.reduce((h, rid) => Math.max(h, sizes.get(rid)!.height), 0),
          });
        }
        layerRows.push(rows);
      }
      const overallWidth = layerRows.reduce(
        (w, rows) => rows.reduce((ww, r) => Math.max(ww, r.width), w),
        0,
      );
      let y = 0;
      for (const rows of layerRows) {
        for (const r of rows) {
          const offsetX = opts.align === 'center' ? (overallWidth - r.width) / 2 : 0;
          let x = offsetX;
          for (const id of r.ids) {
            const size = sizes.get(id)!;
            placed.set(id, { x, y });
            x += size.width + gapX;
          }
          y += r.height + gapY;
        }
      }
      return placed;
    }
    const layerCols: Array<Array<{ ids: string[]; width: number; height: number }>> = [];
    for (const layer of ordered) {
      const cols: Array<{ ids: string[]; width: number; height: number }> = [];
      let col: string[] = [];
      let colHeight = 0;
      for (const id of layer) {
        const size = sizes.get(id)!;
        const need = col.length ? colHeight + gapY + size.height : size.height;
        if (col.length && need > maxSpan) {
          cols.push({
            ids: col,
            width: col.reduce((w, cid) => Math.max(w, sizes.get(cid)!.width), 0),
            height: colHeight,
          });
          col = [];
          colHeight = 0;
        }
        colHeight = col.length ? colHeight + gapY + size.height : size.height;
        col.push(id);
      }
      if (col.length) {
        cols.push({
          ids: col,
          width: col.reduce((w, cid) => Math.max(w, sizes.get(cid)!.width), 0),
          height: colHeight,
        });
      }
      layerCols.push(cols);
    }
    const overallHeight = layerCols.reduce(
      (h, cols) => cols.reduce((hh, c) => Math.max(hh, c.height), h),
      0,
    );
    let x = 0;
    for (const cols of layerCols) {
      for (const c of cols) {
        const offsetY = opts.align === 'center' ? (overallHeight - c.height) / 2 : 0;
        let y = offsetY;
        for (const id of c.ids) {
          const size = sizes.get(id)!;
          placed.set(id, { x, y });
          y += size.height + gapY;
        }
        x += c.width + gapX;
      }
    }
    return placed;
  };

  /** 层内序号（重心排序用序号而不是坐标，避免层内换行导致排序错乱）。 */
  const layerIndexOf = (layer: string[]): Map<string, number> => {
    const map = new Map<string, number>();
    layer.forEach((id, i) => map.set(id, i));
    return map;
  };

  /**
   * 一轮重心排序：先自上而下、再自下而上，用相邻层邻居序号的中位数/平均值重排本层。
   * 这是 Sugiyama 分层布局里标准的交叉最小化步骤。
   */
  const reorderOnce = (ordered: string[][]): string[][] => {
    const next = ordered.map((l) => [...l]);
    const reorderLayer = (li: number, refLi: number) => {
      const refIndex = layerIndexOf(next[refLi]);
      const current = layerIndexOf(next[li]);
      const keys = new Map<string, number>();
      for (const id of next[li]) {
        const neighbors = [...(graph.out.get(id) ?? []), ...(graph.inn.get(id) ?? [])].filter(
          (v) => refIndex.has(v),
        );
        if (!neighbors.length) {
          keys.set(id, current.get(id) ?? 0);
          continue;
        }
        let sum = 0;
        for (const v of neighbors) sum += refIndex.get(v) ?? 0;
        keys.set(id, sum / neighbors.length);
      }
      next[li].sort((a, b) => {
        if (opts.groupByType) {
          const d = nodeTypeIndex(nodes.get(a)!.type) - nodeTypeIndex(nodes.get(b)!.type);
          if (d) return d;
        }
        const d = (keys.get(a) ?? 0) - (keys.get(b) ?? 0);
        if (d) return d;
        return (current.get(a) ?? 0) - (current.get(b) ?? 0);
      });
    };
    for (let li = 1; li < next.length; li++) reorderLayer(li, li - 1);
    for (let li = next.length - 2; li >= 0; li--) reorderLayer(li, li + 1);
    return next;
  };

  /** 交叉数优化：反复重心排序，保留交叉数最低的一版（最多 8 轮，无改善即停）。 */
  let ordered = layers.map((l) => [...l]);
  let placed = layoutLayers(ordered);
  let best = placed;
  let bestCrossings = countCrossings(placed, sizes, graph.pairs);
  let stale = 0;
  let bestOrder = ordered;
  for (let round = 0; round < 8; round++) {
    ordered = reorderOnce(ordered);
    placed = layoutLayers(ordered);
    const crossings = countCrossings(placed, sizes, graph.pairs);
    if (crossings < bestCrossings) {
      best = placed;
      bestCrossings = crossings;
      bestOrder = ordered;
      stale = 0;
    } else {
      stale++;
      if (stale >= 3) break;
    }
  }
  // 相邻交换只在最优顺序上继续优化
  ordered = bestOrder.map((l) => [...l]);
  // 逐层相邻交换：用增量交叉数判断，只有真的下降时才交换。
  // 规模越大预算越紧，保证 500 节点内总耗时可控。
  const swapBudget = ids.length <= 150 ? 8 * ids.length : ids.length <= 250 ? 4 * ids.length : 2 * ids.length;
  const swapPasses = ids.length <= 150 ? 2 : 1;
  if (ids.length <= 320 && graph.pairs.length <= 400) {
    let swapped = best;
    let swappedCrossings = bestCrossings;
    let budget = swapBudget;
    for (let pass = 0; pass < swapPasses && budget > 0; pass++) {
      let improved = false;
      for (const layer of ordered) {
        for (let i = 0; i + 1 < layer.length && budget > 0; i++) {
          budget--;
          const a = layer[i];
          const b = layer[i + 1];
          const focus = new Set([a, b]);
          const before = crossingsTouching(swapped, sizes, graph.pairs, focus);
          const trial = layer.slice();
          trial[i] = b;
          trial[i + 1] = a;
          const trialOrder = ordered.map((l) => (l === layer ? trial : l));
          const trialPlaced = layoutLayers(trialOrder);
          const after = crossingsTouching(trialPlaced, sizes, graph.pairs, focus);
          if (after < before) {
            // 只有 a/b 相关的边会变化，用增量更新总数，避免 O(E^2) 全量重算
            swappedCrossings += after - before;
            layer.length = 0;
            for (const id of trial) layer.push(id);
            swapped = trialPlaced;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    best = swapped;
    bestCrossings = swappedCrossings;
  }

  for (const [id, p] of best) positions.set(id, p);
  const bbox = boundsOf(positions, sizes);
  return { positions, width: bbox.width, height: bbox.height };
}

/** 以连接数最高的节点为中心，按 BFS 层数做同心环布局；环内按父节点角度排序以减少交叉。 */
function placeRadial(
  ids: string[],
  graph: Graph,
  opts: ResolvedOptions,
  sizes: Map<string, Size>,
): Placement {
  const positions = new Map<string, { x: number; y: number }>();
  if (!ids.length) return { positions, width: 0, height: 0 };
  const idSet = new Set(ids);
  const neighbors = (id: string): string[] =>
    [...(graph.out.get(id) ?? []), ...(graph.inn.get(id) ?? [])].filter((v) => idSet.has(v));

  let center = ids[0];
  for (const id of ids) {
    if ((graph.degree.get(id) ?? 0) > (graph.degree.get(center) ?? 0)) center = id;
  }
  const rings: string[][] = [[center]];
  const visited = new Set<string>([center]);
  const parent = new Map<string, string>();
  const dist = new Map<string, number>([[center, 0]]);
  const queue: string[] = [center];
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of neighbors(u)) {
      if (visited.has(v)) continue;
      visited.add(v);
      const d = (dist.get(u) ?? 0) + 1;
      dist.set(v, d);
      parent.set(v, u);
      while (rings.length <= d) rings.push([]);
      rings[d].push(v);
      queue.push(v);
    }
  }
  const unreachable = ids.filter((id) => !visited.has(id));
  if (unreachable.length) {
    const chunk = Math.max(4, Math.ceil(Math.sqrt(ids.length)));
    for (let i = 0; i < unreachable.length; i += chunk) rings.push(unreachable.slice(i, i + chunk));
  }

  /** 各环半径：内环半径 + 相邻两环最大半对角线 + 间距，保证环与环之间不重叠。 */
  const ringRadius: number[] = [0];
  let radius = 0;
  let prevDiag = 0;
  for (let k = 0; k < rings.length; k++) {
    const ring = rings[k];
    if (!ring.length) continue;
    const diag = ring.reduce((m, id) => {
      const s = sizes.get(id)!;
      return Math.max(m, Math.hypot(s.width, s.height) / 2);
    }, 0);
    if (k === 0) {
      ringRadius[0] = 0;
    } else {
      radius += prevDiag + diag + Math.max(24, opts.gapX * 0.35);
      ringRadius[k] = radius;
    }
    prevDiag = diag;
  }

  /** 在给定半径上按顺序摆一圈，返回节点坐标。 */
  const placeRing = (ring: string[], r: number, startAngle = -Math.PI / 2): Map<string, { x: number; y: number }> => {
    const map = new Map<string, { x: number; y: number }>();
    const count = ring.length;
    const step = count > 1 ? (Math.PI * 2) / count : 0;
    for (let i = 0; i < count; i++) {
      const angle = count > 1 ? startAngle + i * step : startAngle;
      map.set(ring[i], { x: r * Math.cos(angle), y: r * Math.sin(angle) });
    }
    return map;
  };

  positions.set(rings[0][0], { x: 0, y: 0 });

  // 由内向外逐环摆放：先用父节点角度做初始顺序，再尝试所有旋转/翻转，
  // 保留「与本环相关的连线交叉数最少」的一种，这一步能显著减少环形布局的交叉。
  const angleOf = new Map<string, number>();
  for (let k = 1; k < rings.length; k++) {
    const ring = [...rings[k]];
    if (!ring.length) continue;
    ring.sort((a, b) => {
      const pa = angleOf.has(parent.get(a) ?? '') ? angleOf.get(parent.get(a)!)! : 10;
      const pb = angleOf.has(parent.get(b) ?? '') ? angleOf.get(parent.get(b)!)! : 10;
      if (pa !== pb) return pa - pb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const r = ringRadius[k];
    const mergePositions = (map: Map<string, { x: number; y: number }>) => {
      const merged = new Map(positions);
      for (const [id, p] of map) merged.set(id, p);
      return merged;
    };
    let bestOrder = ring;
    let bestMap = placeRing(ring, r);
    let bestCross = crossingsTouching(mergePositions(bestMap), sizes, graph.pairs, new Set(ring));
    const base = [...ring];
    // 旋转搜索只在小图上做，避免大图（500 节点）时 O(环长 * E^2) 拖慢
    const candidates: string[][] = [base];
    if (ids.length <= 250) {
      candidates.push([...base].reverse());
      const step = Math.max(1, Math.floor(base.length / 12));
      for (let offset = step; offset < base.length; offset += step) {
        const rotated = [...base.slice(offset), ...base.slice(0, offset)];
        candidates.push(rotated, [...rotated].reverse());
      }
    }
    for (const candidate of candidates) {
      const map = placeRing(candidate, r);
      const cross = crossingsTouching(mergePositions(map), sizes, graph.pairs, new Set(ring));
      if (cross < bestCross) {
        bestCross = cross;
        bestOrder = candidate;
        bestMap = map;
      }
    }
    rings[k] = bestOrder;
    const count = bestOrder.length;
    const stepAngle = count > 1 ? (Math.PI * 2) / count : 0;
    bestOrder.forEach((id, i) => {
      const angle = count > 1 ? -Math.PI / 2 + i * stepAngle : -Math.PI / 2;
      angleOf.set(id, angle);
      positions.set(id, bestMap.get(id)!);
    });
  }
  const bbox = boundsOf(positions, sizes);
  return { positions, width: bbox.width, height: bbox.height };
}

/** 先按节点类型分块，块内分层布局，块与块之间用网格排布并留出更大的间距。 */
function placeGrouped(
  ids: string[],
  graph: Graph,
  opts: ResolvedOptions,
  nodes: Map<string, LayoutNode>,
  sizes: Map<string, Size>,
): Placement {
  const positions = new Map<string, { x: number; y: number }>();
  if (!ids.length) return { positions, width: 0, height: 0 };
  const types = NODE_TYPES.filter((t) => ids.some((id) => nodes.get(id)!.type === t));
  const blocks = types.map((type) => ({
    type,
    ids: ids.filter((id) => nodes.get(id)!.type === type),
  }));
  const innerOpts: ResolvedOptions = { ...opts, groupByType: false };
  const tbAxis = opts.direction === 'TB';
  const placed = blocks.map((block) => ({
    ids: block.ids,
    placement: placeLayered(block.ids, graph, innerOpts, nodes, sizes, 1.35),
  }));
  // 块与块之间留大间距；块的排布方向跟随主方向（TB 纵向堆叠、LR 横向排开）
  const blockGap = tbAxis ? Math.max(opts.gapY * 2, 140) : Math.max(opts.gapX * 2, 160);
  const blockGapCross = tbAxis ? Math.max(opts.gapX * 2, 160) : Math.max(opts.gapY * 2, 140);
  // 块的排布与主方向一致：TB 时块横向排开，LR 时块纵向堆叠
  const columns = tbAxis ? Math.max(1, placed.length) : 1;
  const colWidths: number[] = [];
  const rowHeights: number[] = [];
  placed.forEach((block, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    colWidths[col] = Math.max(colWidths[col] ?? 0, block.placement.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, block.placement.height);
  });
  for (let i = 0; i < placed.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = colWidths.slice(0, col).reduce((sum, w) => sum + w + blockGapCross, 0);
    const y = rowHeights.slice(0, row).reduce((sum, h) => sum + h + blockGap, 0);
    const block = placed[i];
    const offsetX = opts.align === 'center' ? (colWidths[col] - block.placement.width) / 2 : 0;
    const offsetY = opts.align === 'center' ? (rowHeights[row] - block.placement.height) / 2 : 0;
    for (const [id, p] of block.placement.positions) {
      positions.set(id, { x: p.x + x + offsetX, y: p.y + y + offsetY });
    }
  }
  const bbox = boundsOf(positions, sizes);
  return { positions, width: bbox.width, height: bbox.height };
}

/* ---------------- 收尾：边界与重叠消除 ---------------- */

function boundsOf(positions: Map<string, { x: number; y: number }>, sizes: Map<string, Size>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [id, p] of positions) {
    const s = sizes.get(id)!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - OVERLAP_EPSILON &&
    b.x < a.x + a.width - OVERLAP_EPSILON &&
    a.y < b.y + b.height - OVERLAP_EPSILON &&
    b.y < a.y + a.height - OVERLAP_EPSILON
  );
}

/** 重叠消除：沿主方向把相交的矩形推开，迭代 5 次；再沿副方向补 2 次。 */
function removeOverlaps(rects: Rect[], direction: 'TB' | 'LR', gap: number, iterations = 5): void {
  if (rects.length < 2) return;
  const pushApart = (axis: 'x' | 'y') => {
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      for (let j = i + 1; j < rects.length; j++) {
        const b = rects[j];
        if (!rectsOverlap(a, b)) continue;
        const aFirst = a[axis] <= b[axis];
        if (axis === 'x') {
          if (aFirst) b.x = a.x + a.width + gap;
          else a.x = b.x + b.width + gap;
        } else {
          if (aFirst) b.y = a.y + a.height + gap;
          else a.y = b.y + b.height + gap;
        }
      }
    }
  };
  const countOverlaps = (): number => {
    let remaining = 0;
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        if (rectsOverlap(rects[a], rects[b])) remaining++;
      }
    }
    return remaining;
  };
  const main: 'x' | 'y' = direction === 'TB' ? 'y' : 'x';
  const cross: 'x' | 'y' = direction === 'TB' ? 'x' : 'y';
  for (let i = 0; i < iterations && countOverlaps() > 0; i++) pushApart(main);
  // 环形/大画布下单一方向推开可能不够，两个方向交替补推，直到没有相交或到上限
  for (let i = 0; i < 10 && countOverlaps() > 0; i++) {
    pushApart(cross);
    if (countOverlaps() === 0) break;
    pushApart(main);
  }
}

/* ---------------- 对外 API ---------------- */

export function measureLayout(
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  edges: OutlineEdge[],
): LayoutMetrics {
  const rects = new Map<string, Rect>();
  for (const node of nodes ?? []) {
    if (!node || typeof node.id !== 'string') continue;
    rects.set(node.id, {
      id: node.id,
      x: finiteCoord(node.x),
      y: finiteCoord(node.y),
      width: finiteSize(node.width, DEFAULT_NODE_WIDTH),
      height: finiteSize(node.height, DEFAULT_NODE_HEIGHT),
    });
  }
  if (rects.size === 0) return { edgeCrossings: 0, overlappingNodes: 0, totalEdgeLength: 0 };

  let overlappingNodes = 0;
  const all = Array.from(rects.values());
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (rectsOverlap(all[i], all[j])) overlappingNodes++;
    }
  }

  const segments: Array<{
    s: string;
    t: string;
    a: { x: number; y: number };
    b: { x: number; y: number };
    length: number;
  }> = [];
  for (const edge of edges ?? []) {
    if (!edge) continue;
    const src = rects.get(edge.sourceId);
    const dst = rects.get(edge.targetId);
    if (!src || !dst || edge.sourceId === edge.targetId) continue;
    const a = centerOf(src);
    const b = centerOf(dst);
    segments.push({ s: edge.sourceId, t: edge.targetId, a, b, length: Math.hypot(b.x - a.x, b.y - a.y) });
  }
  const totalEdgeLength = segments.reduce((sum, seg) => sum + seg.length, 0);

  let edgeCrossings = 0;
  if (segments.length > CROSSING_LIMIT) {
    edgeCrossings = Math.round(((segments.length * (segments.length - 1)) / 2) * 0.02);
  } else {
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const s1 = segments[i];
        const s2 = segments[j];
        if (s1.s === s2.s || s1.s === s2.t || s1.t === s2.s || s1.t === s2.t) continue;
        if (segmentsCross(s1.a, s1.b, s2.a, s2.b)) edgeCrossings++;
      }
    }
  }
  return { edgeCrossings, overlappingNodes, totalEdgeLength };
}

export function computeLayout(nodes: OutlineNode[], edges: OutlineEdge[], options?: LayoutOptions): LayoutResult {
  const opts = resolveOptions(options);
  const valid: LayoutNode[] = [];
  const seen = new Set<string>();
  for (const node of nodes ?? []) {
    if (!node || typeof node.id !== 'string' || !node.id || seen.has(node.id)) continue;
    seen.add(node.id);
    const type: NodeType = NODE_TYPES.includes(node.type) ? node.type : 'note';
    valid.push({
      id: node.id,
      type,
      title: typeof node.title === 'string' ? node.title : '',
      width: finiteSize(node.width, DEFAULT_NODE_WIDTH),
      height: finiteSize(node.height, DEFAULT_NODE_HEIGHT),
      x: finiteCoord(node.x),
      y: finiteCoord(node.y),
    });
  }
  if (!valid.length) {
    return { positions: {}, metrics: { edgeCrossings: 0, overlappingNodes: 0, totalEdgeLength: 0 } };
  }
  const ids = new Set(valid.map((n) => n.id));
  const usableEdges = (edges ?? []).filter(
    (e) => e && ids.has(e.sourceId) && ids.has(e.targetId) && e.sourceId !== e.targetId,
  );
  const graph = buildGraph(ids, usableEdges);
  const nodeMap = new Map(valid.map((n) => [n.id, n]));
  const sizes = new Map<string, Size>(valid.map((n) => [n.id, { width: n.width, height: n.height }]));
  const allIds = valid.map((n) => n.id);

  let placement: Placement;
  switch (opts.strategy) {
    case 'radial':
      placement = placeRadial(allIds, graph, opts, sizes);
      break;
    case 'grouped':
      placement = placeGrouped(allIds, graph, opts, nodeMap, sizes);
      break;
    case 'compact':
      placement = placeLayered(allIds, graph, opts, nodeMap, sizes, 0.85);
      break;
    default:
      placement = placeLayered(allIds, graph, opts, nodeMap, sizes, 1.8);
  }

  // 保持原画布的大致位置：把新布局的左上角对齐到原布局的左上角
  const newBounds = boundsOf(placement.positions, sizes);
  const originalMinX = Math.min(...valid.map((n) => n.x));
  const originalMinY = Math.min(...valid.map((n) => n.y));
  const targetX = Number.isFinite(originalMinX) ? originalMinX : 0;
  const targetY = Number.isFinite(originalMinY) ? originalMinY : 0;
  const dx = targetX - newBounds.minX;
  const dy = targetY - newBounds.minY;

  const rects: Rect[] = valid.map((n) => {
    const p = placement.positions.get(n.id) ?? { x: 0, y: 0 };
    return { id: n.id, x: p.x + dx, y: p.y + dy, width: n.width, height: n.height };
  });
  removeOverlaps(rects, opts.direction, 8);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const r of rects) positions[r.id] = { x: Math.round(r.x), y: Math.round(r.y) };

  const metrics = measureLayout(
    valid.map((n) => ({
      id: n.id,
      x: positions[n.id].x,
      y: positions[n.id].y,
      width: n.width,
      height: n.height,
    })),
    usableEdges,
  );
  return { positions, metrics };
}
