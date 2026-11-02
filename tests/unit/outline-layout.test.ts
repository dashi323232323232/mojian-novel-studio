import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, measureLayout } from '../../src/lib/outlineLayout';
import type { LayoutStrategy, LayoutOptions } from '../../src/lib/outlineLayout';
import type { NodeType, OutlineEdge, OutlineNode } from '../../shared/types';

const TYPES: NodeType[] = ['stage', 'event', 'chapter', 'character', 'foreshadow', 'note'];

function makeNode(
  id: string,
  type: NodeType = 'event',
  title = id,
  x = 0,
  y = 0,
  width = 220,
  height = 116,
): OutlineNode {
  return {
    id,
    projectId: 'p1',
    type,
    title,
    description: '',
    x,
    y,
    width,
    height,
    color: null,
    data: {},
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeEdge(id: string, sourceId: string, targetId: string): OutlineEdge {
  return {
    id,
    projectId: 'p1',
    sourceId,
    targetId,
    relation: 'sequence',
    label: '',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function assertNoOverlap(nodes: OutlineNode[], positions: Record<string, { x: number; y: number }>) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = { ...positions[nodes[i].id], width: nodes[i].width, height: nodes[i].height };
      const b = { ...positions[nodes[j].id], width: nodes[j].width, height: nodes[j].height };
      assert.equal(overlaps(a, b), false, '节点 ' + nodes[i].id + ' 与 ' + nodes[j].id + ' 不应重叠');
    }
  }
}

function assertFinitePositions(nodes: OutlineNode[], positions: Record<string, { x: number; y: number }>) {
  for (const node of nodes) {
    const p = positions[node.id];
    assert.ok(p, '节点 ' + node.id + ' 应该有坐标');
    assert.ok(Number.isFinite(p.x), '节点 ' + node.id + ' 的 x 必须是有限数字');
    assert.ok(Number.isFinite(p.y), '节点 ' + node.id + ' 的 y 必须是有限数字');
  }
}

/** 简单可复现的伪随机数，避免测试抖动 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('outlineLayout：基础输入', () => {
  test('空输入返回空坐标与零指标', () => {
    const result = computeLayout([], []);
    assert.deepEqual(result.positions, {});
    assert.equal(result.metrics.edgeCrossings, 0);
    assert.equal(result.metrics.overlappingNodes, 0);
    assert.equal(result.metrics.totalEdgeLength, 0);
  });

  test('单节点返回有限坐标', () => {
    const node = makeNode('a', 'stage', '起点', 100, 200, 250, 128);
    const result = computeLayout([node], []);
    assert.deepEqual(Object.keys(result.positions), ['a']);
    assert.ok(Number.isFinite(result.positions.a.x));
    assert.ok(Number.isFinite(result.positions.a.y));
    assert.equal(result.metrics.overlappingNodes, 0);
  });

  test('无边多节点在四种策略下都不重叠', () => {
    const nodes = TYPES.map((type, i) => makeNode('n' + i, type, '节点' + i, i * 40, i * 30));
    const strategies: LayoutStrategy[] = ['layered', 'radial', 'grouped', 'compact'];
    for (const strategy of strategies) {
      const result = computeLayout(nodes, [], { strategy });
      assertNoOverlap(nodes, result.positions);
      assertFinitePositions(nodes, result.positions);
      assert.equal(result.metrics.overlappingNodes, 0);
    }
  });

  test('不修改输入节点对象（兼容旧数据）', () => {
    const nodes = [makeNode('a', 'event', 'A', 10, 20), makeNode('b', 'event', 'B', 300, 20)];
    const before = JSON.stringify(nodes);
    computeLayout(nodes, [makeEdge('e1', 'a', 'b')], { strategy: 'layered' });
    assert.equal(JSON.stringify(nodes), before);
  });
});

describe('outlineLayout：分层布局', () => {
  test('链式 A→B→C 在 layered + TB 下 y 递增、x 相近', () => {
    const nodes = [makeNode('a', 'stage', 'A'), makeNode('b', 'event', 'B'), makeNode('c', 'chapter', 'C')];
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];
    const result = computeLayout(nodes, edges, { strategy: 'layered', direction: 'TB', align: 'center' });
    const pa = result.positions.a;
    const pb = result.positions.b;
    const pc = result.positions.c;
    assert.ok(pb.y > pa.y, 'B 应该在 A 下方');
    assert.ok(pc.y > pb.y, 'C 应该在 B 下方');
    assert.ok(Math.abs(pa.x - pb.x) <= 4, '同层链式节点 x 应相近');
    assert.ok(Math.abs(pb.x - pc.x) <= 4, '同层链式节点 x 应相近');
    assertNoOverlap(nodes, result.positions);
    assert.equal(result.metrics.edgeCrossings, 0);
  });

  test('同一层多个节点矩形不相交', () => {
    const root = makeNode('root', 'stage', '主线');
    const children = [0, 1, 2, 3, 4].map((i) =>
      makeNode('c' + i, TYPES[i % TYPES.length], '子事件' + i, 0, 0, 180 + i * 20, 100 + i * 8),
    );
    const nodes = [root, ...children];
    const edges = children.map((c, i) => makeEdge('e' + i, 'root', c.id));
    const result = computeLayout(nodes, edges, { strategy: 'layered', direction: 'TB' });
    assertNoOverlap(nodes, result.positions);
    for (const c of children) {
      assert.equal(result.positions[c.id].y, result.positions[children[0].id].y, '同层节点 y 相同');
    }
  });

  test('LR 方向下 x 递增、y 相近', () => {
    const nodes = [makeNode('a', 'stage', 'A'), makeNode('b', 'event', 'B'), makeNode('c', 'chapter', 'C')];
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];
    const result = computeLayout(nodes, edges, { strategy: 'layered', direction: 'LR' });
    assert.ok(result.positions.b.x > result.positions.a.x);
    assert.ok(result.positions.c.x > result.positions.b.x);
    assert.ok(Math.abs(result.positions.a.y - result.positions.b.y) <= 4);
  });

  test('groupByType 时同类型节点在同层内聚在一起', () => {
    // 无边时全部节点同属一层，按类型分组的效果最直观
    const nodes = [
      makeNode('a', 'character', '人物A'),
      makeNode('b', 'event', '事件B'),
      makeNode('c', 'character', '人物C'),
      makeNode('d', 'event', '事件D'),
    ];
    const result = computeLayout(nodes, [], {
      strategy: 'layered',
      groupByType: true,
      align: 'start',
    });
    const ordered = ['a', 'b', 'c', 'd']
      .map((id) => ({ id, x: result.positions[id].x }))
      .sort((p1, p2) => p1.x - p2.x)
      .map((p) => p.id);
    const events = ordered.filter((id) => id === 'b' || id === 'd');
    const characters = ordered.filter((id) => id === 'a' || id === 'c');
    assert.deepEqual(
      events,
      ['b', 'd'],
      '同类型事件节点应彼此相邻，实际顺序 ' + ordered.join(' > '),
    );
    assert.deepEqual(
      characters,
      ['a', 'c'],
      '同类型人物节点应彼此相邻，实际顺序 ' + ordered.join(' > '),
    );
    assertNoOverlap(nodes, result.positions);
  });
});

describe('outlineLayout：环与鲁棒性', () => {
  test('有环图不死循环、能返回结果', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge('e1', 'a', 'b'),
      makeEdge('e2', 'b', 'c'),
      makeEdge('e3', 'c', 'a'),
      makeEdge('e4', 'c', 'b'),
    ];
    const result = computeLayout(nodes, edges, { strategy: 'layered' });
    assert.equal(Object.keys(result.positions).length, 3);
    assertFinitePositions(nodes, result.positions);
    assertNoOverlap(nodes, result.positions);
  });

  test('自环与重复边、悬空边不会影响结果', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge('e1', 'a', 'a'),
      makeEdge('e2', 'a', 'b'),
      makeEdge('e3', 'a', 'b'),
      makeEdge('e4', 'a', 'ghost'),
    ];
    const result = computeLayout(nodes, edges, { strategy: 'radial' });
    assertFinitePositions(nodes, result.positions);
  });

  test('四种策略 + 两种方向都能产出有限坐标且不重叠', () => {
    const nodes: OutlineNode[] = [];
    for (let i = 0; i < 40; i++) {
      nodes.push(makeNode('n' + i, TYPES[i % TYPES.length], '节点' + i, (i % 8) * 260, Math.floor(i / 8) * 150));
    }
    const edges: OutlineEdge[] = [];
    for (let i = 1; i < 40; i++) {
      edges.push(makeEdge('e' + i, 'n' + (i % 10), 'n' + i));
    }
    const strategies: LayoutStrategy[] = ['layered', 'radial', 'grouped', 'compact'];
    for (const strategy of strategies) {
      for (const direction of ['TB', 'LR'] as const) {
        const options: LayoutOptions = { strategy, direction };
        const result = computeLayout(nodes, edges, options);
        assertFinitePositions(nodes, result.positions);
        assert.equal(result.metrics.overlappingNodes, 0, strategy + '/' + direction + ' 不应有重叠');
      }
    }
  });
});

describe('outlineLayout：measureLayout', () => {
  test('交叉场景能算出 > 0 的交叉数', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, width: 100, height: 60 },
      { id: 'b', x: 0, y: 200, width: 100, height: 60 },
      { id: 'c', x: 300, y: 0, width: 100, height: 60 },
      { id: 'd', x: 300, y: 200, width: 100, height: 60 },
    ];
    const edges = [makeEdge('e1', 'a', 'd'), makeEdge('e2', 'b', 'c')];
    const metrics = measureLayout(nodes, edges);
    assert.ok(metrics.edgeCrossings > 0, '交叉的两条对角线应被识别');
    assert.ok(metrics.totalEdgeLength > 0);
  });

  test('平行不交叉场景交叉数为 0', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, width: 100, height: 60 },
      { id: 'b', x: 0, y: 200, width: 100, height: 60 },
      { id: 'c', x: 300, y: 0, width: 100, height: 60 },
      { id: 'd', x: 300, y: 200, width: 100, height: 60 },
    ];
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'c', 'd')];
    assert.equal(measureLayout(nodes, edges).edgeCrossings, 0);
  });

  test('重叠节点对数与边总数统计正确', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, width: 200, height: 100 },
      { id: 'b', x: 10, y: 10, width: 200, height: 100 },
      { id: 'c', x: 500, y: 500, width: 200, height: 100 },
    ];
    const edges = [makeEdge('e1', 'a', 'c'), makeEdge('e2', 'b', 'c'), makeEdge('e3', 'a', 'c')];
    const metrics = measureLayout(nodes, edges);
    assert.equal(metrics.overlappingNodes, 1);
    assert.equal(metrics.totalEdgeLength > 0, true);
    assert.equal(metrics.edgeCrossings, 0, '共享端点的边不计为交叉');
  });

  test('空输入返回零指标', () => {
    assert.deepEqual(measureLayout([], []), { edgeCrossings: 0, overlappingNodes: 0, totalEdgeLength: 0 });
  });
});

describe('outlineLayout：性能与规模', () => {
  test('200 个随机节点在 2000ms 内完成', () => {
    const rand = makeRandom(20261103);
    const nodes: OutlineNode[] = [];
    for (let i = 0; i < 200; i++) {
      nodes.push(
        makeNode(
          'n' + i,
          TYPES[i % TYPES.length],
          '节点' + i,
          Math.round(rand() * 3000),
          Math.round(rand() * 2000),
          180 + Math.round(rand() * 60),
          100 + Math.round(rand() * 40),
        ),
      );
    }
    const edges: OutlineEdge[] = [];
    for (let i = 0; i < 260; i++) {
      const s = Math.floor(rand() * 200);
      const t = Math.floor(rand() * 200);
      if (s === t) continue;
      edges.push(makeEdge('e' + i, 'n' + s, 'n' + t));
    }
    const started = performance.now();
    const result = computeLayout(nodes, edges, { strategy: 'layered', direction: 'TB' });
    const elapsed = performance.now() - started;
    assert.equal(Object.keys(result.positions).length, 200);
    assertFinitePositions(nodes, result.positions);
    assert.ok(elapsed < 2000, '200 节点布局耗时 ' + Math.round(elapsed) + 'ms，应低于 2000ms');
    assert.equal(result.metrics.overlappingNodes, 0);
  });

  test('自动布局显著降低随机数据的交叉数', () => {
    const rand = makeRandom(778899);
    const nodes: OutlineNode[] = [];
    for (let i = 0; i < 60; i++) {
      nodes.push(
        makeNode('n' + i, TYPES[i % TYPES.length], '节点' + i, Math.round(rand() * 1200), Math.round(rand() * 800)),
      );
    }
    const edges: OutlineEdge[] = [];
    for (let i = 0; i < 70; i++) {
      const s = Math.floor(rand() * 60);
      const t = Math.floor(rand() * 60);
      if (s === t) continue;
      edges.push(makeEdge('e' + i, 'n' + s, 'n' + t));
    }
    const before = measureLayout(nodes, edges);
    const result = computeLayout(nodes, edges, { strategy: 'layered', direction: 'TB' });
    assert.ok(before.edgeCrossings > 0, '随机数据应该存在交叉');
    assert.ok(
      result.metrics.edgeCrossings < before.edgeCrossings,
      '布局后交叉数应从 ' + before.edgeCrossings + ' 降到更小值，实际 ' + result.metrics.edgeCrossings,
    );
  });

  test('500 个节点仍能完成且坐标有限', () => {
    const rand = makeRandom(424242);
    const nodes: OutlineNode[] = [];
    for (let i = 0; i < 500; i++) {
      nodes.push(makeNode('n' + i, TYPES[i % TYPES.length], '节点' + i, Math.round(rand() * 5000), Math.round(rand() * 3000)));
    }
    const edges: OutlineEdge[] = [];
    for (let i = 0; i < 500; i++) {
      const s = Math.floor(rand() * 500);
      const t = Math.floor(rand() * 500);
      if (s === t) continue;
      edges.push(makeEdge('e' + i, 'n' + s, 'n' + t));
    }
    const started = performance.now();
    const result = computeLayout(nodes, edges, { strategy: 'compact' });
    const elapsed = performance.now() - started;
    assert.equal(Object.keys(result.positions).length, 500);
    assertFinitePositions(nodes, result.positions);
    assert.ok(elapsed < 5000, '500 节点耗时 ' + Math.round(elapsed) + 'ms');
  });
});
