import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTERS_PER_GROUP,
  UNASSIGNED_VOLUME_ID,
  buildChapterTree,
  formatVolumeLabel,
  groupKey,
} from '../../src/lib/chapterTree';
import type { Chapter, Stage } from '@shared/types';

/** 造一个最小可用的卷。 */
function stage(id: string, name: string, sortOrder = 0): Stage {
  return {
    id,
    projectId: 'p1',
    name,
    summary: '',
    sortOrder,
    chapterCount: 0,
    wordCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** 造一个最小可用的章。 */
function chapter(id: string, name: string, stageId: string | null, sortOrder = 0, wordCount = 0): Chapter {
  return {
    id,
    projectId: 'p1',
    stageId,
    name,
    summary: '',
    sortOrder,
    wordCount,
    contentUpdatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** 按 sortOrder 顺序生成 count 章，挂到 stageId 下，序号从 offset 开始。 */
function makeChapters(count: number, stageId: string | null, offset = 0): Chapter[] {
  const out: Chapter[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = offset + i + 1;
    out.push(chapter(stageId ? stageId + '-c' + n : 'u' + n, '第 ' + n + ' 章 标题', stageId, n - 1));
  }
  return out;
}

describe('卷册分级目录：buildChapterTree 结构', () => {
  test('空输入返回空数组', () => {
    assert.deepEqual(buildChapterTree([], []), []);
  });

  test('只有章节、没有卷时，全部归入「未分卷」', () => {
    const tree = buildChapterTree([], makeChapters(3, null));
    assert.equal(tree.length, 1);
    assert.equal(tree[0].id, UNASSIGNED_VOLUME_ID);
    assert.equal(tree[0].label, '未分卷');
    assert.equal(tree[0].stage, null);
    assert.equal(tree[0].chapterCount, 3);
  });

  test('没有章节的卷也生成节点，groups 为空', () => {
    const tree = buildChapterTree([stage('s1', '第一卷 战云密布')], []);
    assert.equal(tree.length, 1);
    assert.deepEqual(tree[0].groups, []);
    assert.equal(tree[0].chapterCount, 0);
    assert.equal(tree[0].wordCount, 0);
  });

  test('47 章切成 3 组：1–20、21–40、41–47', () => {
    const s = stage('s1', '战云密布');
    const tree = buildChapterTree([s], makeChapters(47, 's1'));
    assert.equal(tree.length, 1);
    const groups = tree[0].groups;
    assert.equal(groups.length, 3);
    assert.deepEqual(
      groups.map((g) => g.label),
      ['第 1–20 章', '第 21–40 章', '第 41–47 章'],
    );
    assert.deepEqual(
      groups.map((g) => [g.startIndex, g.endIndex]),
      [
        [1, 20],
        [21, 40],
        [41, 47],
      ],
    );
    assert.deepEqual(
      groups.map((g) => g.chapters.length),
      [20, 20, 7],
    );
    assert.equal(tree[0].chapterCount, 47);
    assert.equal(groups.reduce((n, g) => n + g.chapters.length, 0), 47, '分组不应丢失章节');
  });

  test('正好 20 章只有 1 组', () => {
    const tree = buildChapterTree([stage('s1', '战云密布')], makeChapters(20, 's1'));
    assert.equal(tree[0].groups.length, 1);
    assert.equal(tree[0].groups[0].label, '第 1–20 章');
    assert.equal(tree[0].groups[0].endIndex, 20);
  });

  test('21 章切成 2 组，末组只有 1 章', () => {
    const tree = buildChapterTree([stage('s1', '战云密布')], makeChapters(21, 's1'));
    assert.equal(tree[0].groups.length, 2);
    assert.deepEqual(
      tree[0].groups.map((g) => g.label),
      ['第 1–20 章', '第 21 章'],
    );
    assert.equal(tree[0].groups[1].chapters.length, 1);
  });

  test('40 章正好 2 组，末组边界是 40', () => {
    const tree = buildChapterTree([stage('s1', '战云密布')], makeChapters(40, 's1'));
    assert.equal(tree[0].groups.length, 2);
    assert.deepEqual(
      tree[0].groups.map((g) => g.label),
      ['第 1–20 章', '第 21–40 章'],
    );
  });

  test('只有 1 章时分组标题写「第 1 章」', () => {
    const tree = buildChapterTree([stage('s1', '战云密布')], makeChapters(1, 's1'));
    assert.equal(tree[0].groups.length, 1);
    assert.equal(tree[0].groups[0].label, '第 1 章');
    assert.equal(tree[0].groups[0].startIndex, 1);
    assert.equal(tree[0].groups[0].endIndex, 1);
  });

  test('分组 key 唯一，且等于 groupKey(卷 id, 组下标)', () => {
    const tree = buildChapterTree(
      [stage('s1', '甲'), stage('s2', '乙')],
      [...makeChapters(47, 's1'), ...makeChapters(21, 's2', 47)],
    );
    const allKeys: string[] = [];
    for (const volume of tree) {
      volume.groups.forEach((g, i) => {
        assert.equal(g.key, groupKey(volume.id, i));
        allKeys.push(g.key);
      });
    }
    assert.equal(new Set(allKeys).size, allKeys.length, '分组 key 必须全局唯一');
  });

  test('每卷按自己的 20 章切分，序号仍为全书连续序号', () => {
    // 第 1 卷 22 章（全书 1–22），第 2 卷 22 章（全书 23–44）
    const tree = buildChapterTree(
      [stage('s1', '甲'), stage('s2', '乙')],
      [...makeChapters(22, 's1'), ...makeChapters(22, 's2', 22)],
    );
    assert.equal(tree[0].groups.length, 2);
    assert.equal(tree[1].groups.length, 2);
    assert.deepEqual(
      tree[0].groups.map((g) => g.label),
      ['第 1–20 章', '第 21–22 章'],
    );
    assert.deepEqual(
      tree[1].groups.map((g) => g.label),
      ['第 23–42 章', '第 43–44 章'],
    );
    assert.equal(tree[1].groups[0].chapters[0].name, '第 23 章 标题');
  });

  test('卷内章节按 chapters 传入顺序取用，顺序与输入一致', () => {
    const s = stage('s1', '战云密布');
    const input = [chapter('c', '第三章', 's1', 2), chapter('a', '第一章', 's1', 0), chapter('b', '第二章', 's1', 1)];
    const tree = buildChapterTree([s], input);
    assert.deepEqual(
      tree[0].groups[0].chapters.map((c) => c.name),
      ['第三章', '第一章', '第二章'],
      '逻辑层不重新排序，严格按传入顺序',
    );
  });

  test('章节乱序（stageId 交错）时，各卷内部仍保持传入顺序', () => {
    const tree = buildChapterTree(
      [stage('s1', '甲'), stage('s2', '乙')],
      [
        chapter('a1', '甲一', 's1', 0),
        chapter('b1', '乙一', 's2', 1),
        chapter('a2', '甲二', 's1', 2),
        chapter('b2', '乙二', 's2', 3),
        chapter('a3', '甲三', 's1', 4),
      ],
    );
    assert.deepEqual(
      tree[0].groups[0].chapters.map((c) => c.id),
      ['a1', 'a2', 'a3'],
    );
    assert.deepEqual(
      tree[1].groups[0].chapters.map((c) => c.id),
      ['b1', 'b2'],
    );
  });

  test('未分卷章节归入「未分卷」卷，且排在最后', () => {
    const tree = buildChapterTree(
      [stage('s1', '甲'), stage('s2', '乙')],
      [
        chapter('u1', '散章一', null, 0),
        chapter('a1', '甲一', 's1', 1),
        chapter('ghost', '幽灵卷', 'missing-stage', 2),
        chapter('b1', '乙一', 's2', 3),
      ],
    );
    assert.deepEqual(
      tree.map((v) => v.id),
      ['s1', 's2', UNASSIGNED_VOLUME_ID],
    );
    const last = tree[tree.length - 1];
    assert.equal(last.label, '未分卷');
    assert.equal(last.stage, null);
    assert.deepEqual(
      last.groups[0].chapters.map((c) => c.id),
      ['u1', 'ghost'],
      'stageId 指向不存在的卷也要并入未分卷',
    );
    assert.equal(last.chapterCount, 2);
  });

  test('没有未分卷章节时不追加「未分卷」节点', () => {
    const tree = buildChapterTree([stage('s1', '甲')], makeChapters(3, 's1'));
    assert.equal(tree.length, 1);
    assert.equal(tree[0].id, 's1');
  });

  test('wordCount 按卷汇总，不修改入参数组', () => {
    const s = stage('s1', '甲');
    const input = makeChapters(3, 's1').map((c, i) => ({ ...c, wordCount: (i + 1) * 1000 }));
    const snapshot = JSON.stringify(input);
    const tree = buildChapterTree([s], input);
    assert.equal(tree[0].wordCount, 6000);
    assert.equal(JSON.stringify(input), snapshot, 'buildChapterTree 不应改动入参');
  });

  test('重复卷 id 只生成一个卷节点', () => {
    const tree = buildChapterTree([stage('s1', '甲'), stage('s1', '甲重复')], makeChapters(2, 's1'));
    assert.equal(tree.length, 1);
    assert.equal(tree[0].label, '第 1 卷 · 甲');
  });

  test('CHAPTERS_PER_GROUP 为 20', () => {
    assert.equal(CHAPTERS_PER_GROUP, 20);
  });
});

describe('卷册分级目录：formatVolumeLabel', () => {
  test('名字已以「第三卷」开头时不重复加前缀', () => {
    assert.equal(formatVolumeLabel(stage('s1', '第三卷 风起'), 0), '第三卷 风起');
    assert.equal(formatVolumeLabel(stage('s1', '第三卷 风起'), 5), '第三卷 风起');
  });

  test('名字以「卷」开头时不重复加前缀', () => {
    assert.equal(formatVolumeLabel(stage('s1', '卷一 战云密布'), 0), '卷一 战云密布');
    assert.equal(formatVolumeLabel(stage('s1', '卷'), 2), '第 3 卷');
  });

  test('普通名字拼成「第 2 卷 · 风起」', () => {
    assert.equal(formatVolumeLabel(stage('s1', '风起'), 1), '第 2 卷 · 风起');
    assert.equal(formatVolumeLabel(stage('s1', '风起'), 0), '第 1 卷 · 风起');
  });

  test('带空格的「第 3 卷」前缀也能识别', () => {
    assert.equal(formatVolumeLabel(stage('s1', '第 3 卷 · 风起'), 0), '第 3 卷 · 风起');
  });

  test('空名字退化为「第 N 卷」', () => {
    assert.equal(formatVolumeLabel(stage('s1', ''), 0), '第 1 卷');
    assert.equal(formatVolumeLabel(stage('s1', '   '), 3), '第 4 卷');
  });

  test('「第X章」之类不是卷前缀，仍会拼上卷号', () => {
    assert.equal(formatVolumeLabel(stage('s1', '第一章 开端'), 0), '第 1 卷 · 第一章 开端');
  });
});

describe('卷册分级目录：端到端示例（47 章）', () => {
  test('两卷共 47 章时的完整结构', () => {
    const tree = buildChapterTree(
      [stage('s1', '第一卷 战云密布'), stage('s2', '风起')],
      [...makeChapters(20, 's1'), ...makeChapters(27, 's2', 20)],
    );
    assert.equal(tree.length, 2);
    assert.equal(tree[0].label, '第一卷 战云密布');
    assert.equal(tree[0].chapterCount, 20);
    assert.deepEqual(
      tree[0].groups.map((g) => g.label),
      ['第 1–20 章'],
    );
    assert.equal(tree[1].label, '第 2 卷 · 风起');
    assert.equal(tree[1].chapterCount, 27);
    assert.deepEqual(
      tree[1].groups.map((g) => g.label),
      ['第 21–40 章', '第 41–47 章'],
    );
  });
});
