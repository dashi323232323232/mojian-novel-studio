import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppCore } from '../../electron/main/core';

function makeCore(): { core: AppCore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashi-test-'));
  const core = new AppCore(dir);
  return { core, dir };
}

describe('数据层：项目 / 阶段 / 章节', () => {
  let core: AppCore;
  let dir: string;

  before(() => {
    ({ core, dir } = makeCore());
  });

  after(() => {
    core.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('创建项目会自动生成第一阶段，且数据相互隔离', () => {
    const a = core.projects.create({ name: '项目 A' });
    const b = core.projects.create({ name: '项目 B' });
    assert.notEqual(a.id, b.id);
    const sa = core.projects.structure(a.id);
    const sb = core.projects.structure(b.id);
    assert.equal(sa.stages.length, 1);
    assert.equal(sb.stages.length, 1);
    assert.notEqual(sa.stages[0].id, sb.stages[0].id);

    const chapter = core.structure.createChapter(a.id, { name: '第一章', stageId: sa.stages[0].id });
    const sb2 = core.projects.structure(b.id);
    assert.equal(sb2.chapters.length, 0);
    assert.equal(core.projects.structure(a.id).chapters[0].id, chapter.id);
  });

  test('项目名称修改与空名称校验', () => {
    const p = core.projects.create({ name: '旧名字' });
    const updated = core.projects.update(p.id, { name: '新名字' });
    assert.equal(updated.name, '新名字');
    assert.throws(() => core.projects.update(p.id, { name: '   ' }), /项目名称不能为空/);
  });

  test('阶段与章节排序持久化', () => {
    const p = core.projects.create({ name: '排序测试' });
    const s1 = core.projects.structure(p.id).stages[0];
    const s2 = core.structure.createStage(p.id, { name: '第二阶段' });
    const c1 = core.structure.createChapter(p.id, { name: '第一章', stageId: s1.id });
    const c2 = core.structure.createChapter(p.id, { name: '第二章', stageId: s1.id });
    core.structure.reorderChapters(p.id, [c2.id, c1.id]);
    const after = core.structure.listChapters(p.id);
    assert.deepEqual(after.map((c) => c.id), [c2.id, c1.id]);

    core.structure.reorderStages(p.id, [s2.id, s1.id]);
    assert.deepEqual(core.structure.listStages(p.id).map((s) => s.id), [s2.id, s1.id]);
  });

  test('章节移动会同时更新阶段归属和全局顺序', () => {
    const p = core.projects.create({ name: '移动测试' });
    const s1 = core.projects.structure(p.id).stages[0];
    const s2 = core.structure.createStage(p.id, { name: '第二阶段' });
    const c1 = core.structure.createChapter(p.id, { name: '一', stageId: s1.id });
    const c2 = core.structure.createChapter(p.id, { name: '二', stageId: s1.id });
    const c3 = core.structure.createChapter(p.id, { name: '三', stageId: s1.id });
    core.structure.moveChapter(c3.id, { stageId: s2.id, beforeChapterId: c1.id });
    const chapters = core.structure.listChapters(p.id);
    assert.equal(chapters[0].id, c3.id);
    assert.equal(chapters[0].stageId, s2.id);
    assert.deepEqual(chapters.map((c) => c.id).sort(), [c1.id, c2.id, c3.id].sort());
  });

  test('删除阶段必须指定章节处理方式，move 不会丢数据', () => {
    const p = core.projects.create({ name: '删除阶段' });
    const s1 = core.projects.structure(p.id).stages[0];
    const s2 = core.structure.createStage(p.id, { name: '接收阶段' });
    const c1 = core.structure.createChapter(p.id, { name: '第一章', stageId: s1.id });
    assert.throws(() => core.structure.deleteStage(s1.id, {}), /需要显式确认/);
    const result = core.structure.deleteStage(s1.id, { confirm: true, chapterAction: 'move', targetStageId: s2.id });
    assert.equal(result.movedChapters, 1);
    const chapters = core.structure.listChapters(p.id);
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].id, c1.id);
    assert.equal(chapters[0].stageId, s2.id);
  });

  test('删除项目需要确认且会级联删除数据', () => {
    const p = core.projects.create({ name: '待删除项目' });
    const s = core.projects.structure(p.id).stages[0];
    core.structure.createChapter(p.id, { name: '章节', stageId: s.id });
    assert.throws(() => core.projects.delete(p.id, {}), /需要显式确认/);
    core.projects.delete(p.id, { confirm: true, confirmName: '待删除项目' });
    assert.throws(() => core.projects.get(p.id), /项目不存在/);
  });
});

describe('正文保存与双版本保留策略', () => {
  let core: AppCore;
  let dir: string;
  let chapterId: string;

  before(() => {
    ({ core, dir } = makeCore());
    const p = core.projects.create({ name: '版本测试' });
    const s = core.projects.structure(p.id).stages[0];
    chapterId = core.structure.createChapter(p.id, { name: '第一章', stageId: s.id }).id;
  });

  after(() => {
    core.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('首次保存后无上一版本，第二次保存后保留上一版本，多次保存只保留 1 个旧版本', () => {
    core.structure.saveContent(chapterId, { content: '第一版内容' });
    let versions = core.structure.listVersions(chapterId);
    assert.equal(versions.current.revision, 1);
    assert.equal(versions.previous, null);

    core.structure.saveContent(chapterId, { content: '第二版内容' });
    versions = core.structure.listVersions(chapterId);
    assert.equal(versions.current.revision, 2);
    assert.ok(versions.previous);
    assert.equal(core.structure.getVersion(versions.previous!.id).content, '第一版内容');

    for (let i = 3; i <= 8; i++) {
      core.structure.saveContent(chapterId, { content: `第${i}版内容` });
    }
    versions = core.structure.listVersions(chapterId);
    assert.equal(versions.current.revision, 8);
    assert.ok(versions.previous);
    assert.equal(core.structure.getVersion(versions.previous!.id).content, '第7版内容');
    const rows = core.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM chapter_versions WHERE chapter_id = ?', chapterId);
    assert.equal(Number(rows[0].n), 1, '只应保留一个历史版本');
    const content = core.structure.getContent(chapterId);
    assert.equal(content.content, '第8版内容');
  });

  test('相同内容重复保存不产生新版本（幂等）', () => {
    const before = core.structure.listVersions(chapterId);
    const result = core.structure.saveContent(chapterId, { content: '第8版内容' });
    assert.equal(result.unchanged, true);
    assert.equal(result.revision, before.current.revision);
  });

  test('乐观锁冲突检测', () => {
    const current = core.structure.getContent(chapterId);
    assert.throws(
      () => core.structure.saveContent(chapterId, { content: '冲突内容', baseRevision: current.revision - 1 }),
      /已被其他操作修改/,
    );
  });

  test('回滚到上一个版本，且回滚前内容成为新的上一版本', () => {
    const before = core.structure.listVersions(chapterId);
    const prevId = before.previous!.id;
    const prevContent = core.structure.getVersion(prevId).content;
    const result = core.structure.restoreVersion(chapterId, prevId);
    assert.equal(core.structure.getContent(chapterId).content, prevContent);
    assert.equal(result.revision, before.current.revision + 1);
    const after = core.structure.listVersions(chapterId);
    assert.ok(after.previous);
    // 回滚前的内容（第8版）成为新的「上一个版本」，可再次回滚
    assert.equal(core.structure.getVersion(after.previous!.id).content, '第8版内容');
  });

  test('中文与英文混合字数统计', () => {
    core.structure.saveContent(chapterId, { content: '你好世界 hello world 123' });
    const content = core.structure.getContent(chapterId);
    assert.equal(content.wordCount, 7); // 4 汉字 + hello + world + 123
  });
});

describe('大纲 / 关联 / 伏笔', () => {
  let core: AppCore;
  let dir: string;
  let projectId: string;
  let chapter1: string;
  let chapter2: string;

  before(() => {
    ({ core, dir } = makeCore());
    const p = core.projects.create({ name: '大纲测试' });
    projectId = p.id;
    const s = core.projects.structure(p.id).stages[0];
    chapter1 = core.structure.createChapter(p.id, { name: '第一章', stageId: s.id }).id;
    chapter2 = core.structure.createChapter(p.id, { name: '第二章', stageId: s.id }).id;
  });

  after(() => {
    core.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('节点、连线、位置持久化', () => {
    const n1 = core.outline.createNode(projectId, { type: 'event', title: '宣战', x: 100, y: 80 });
    const n2 = core.outline.createNode(projectId, { type: 'event', title: '色当战役', x: 400, y: 80 });
    const edge = core.outline.createEdge(projectId, { sourceId: n1.id, targetId: n2.id, relation: 'causal' });
    assert.equal(edge.relation, 'causal');

    core.outline.updatePositions(projectId, [{ id: n1.id, x: 260, y: 320, width: 260, height: 130 }]);
    const snapshot = core.outline.snapshot(projectId);
    const updated = snapshot.nodes.find((n) => n.id === n1.id)!;
    assert.equal(updated.x, 260);
    assert.equal(updated.width, 260);
    assert.equal(snapshot.edges.length, 1);
  });

  test('节点类型校验与自连拒绝', () => {
    assert.throws(() => core.outline.createNode(projectId, { type: 'bad' as never, title: 'x' }), /节点类型无效/);
    const n = core.outline.createNode(projectId, { type: 'note', title: '备注' });
    assert.throws(() => core.outline.createEdge(projectId, { sourceId: n.id, targetId: n.id }), /自身/);
  });

  test('节点与章节多对多关联', () => {
    const nodes = core.outline.listNodes(projectId);
    const a = nodes[0];
    core.outline.linkChapter(a.id, chapter1);
    core.outline.linkChapter(a.id, chapter2);
    core.outline.linkChapter(nodes[1].id, chapter1);
    const chaptersOfA = core.outline.chaptersForNode(a.id);
    assert.equal(chaptersOfA.length, 2);
    const nodesOfChapter1 = core.outline.nodesForChapter(chapter1);
    assert.equal(nodesOfChapter1.length, 2);
    const snapshot = core.outline.snapshot(projectId);
    assert.equal(snapshot.links.length, 3);
    core.outline.unlinkChapter(a.id, chapter2);
    assert.equal(core.outline.chaptersForNode(a.id).length, 1);
  });

  test('复制节点会复制章节关联', () => {
    const node = core.outline.listNodes(projectId)[0];
    const copy = core.outline.duplicateNode(node.id);
    assert.equal(copy.title, `${node.title} 副本`);
    assert.equal(core.outline.chaptersForNode(copy.id).length, 1);
  });

  test('删除节点需要确认并级联删除连线', () => {
    const node = core.outline.listNodes(projectId)[0];
    assert.throws(() => core.outline.deleteNode(node.id, {}), /需要显式确认/);
    core.outline.deleteNode(node.id, { confirm: true });
    const snapshot = core.outline.snapshot(projectId);
    assert.ok(!snapshot.nodes.some((n) => n.id === node.id));
    assert.ok(!snapshot.edges.some((e) => e.sourceId === node.id || e.targetId === node.id));
  });

  test('伏笔完整字段、多章节关联与状态流转', () => {
    const f = core.foreshadow.create(projectId, {
      name: '染血的军旗',
      description: '第一章出现的军旗',
      status: 'planted',
      plantedChapterId: chapter1,
      plannedResolveChapterId: chapter2,
      chapterIds: [chapter1, chapter2],
      notes: '决战回收',
    });
    assert.equal(f.chapterIds.length, 2);
    assert.equal(f.status, 'planted');

    const updated = core.foreshadow.update(f.id, { status: 'developing', notes: '推进中' });
    assert.equal(updated.status, 'developing');
    assert.equal(updated.notes, '推进中');

    const list = core.foreshadow.list(projectId, { status: 'developing' });
    assert.equal(list.length, 1);

    const attached = core.foreshadow.attachToOutline(f.id);
    assert.ok(attached.nodeId);
    const snapshot = core.outline.snapshot(projectId);
    assert.ok(snapshot.nodes.some((n) => n.id === attached.nodeId && n.type === 'foreshadow'));
  });

  test('无效状态被拒绝', () => {
    assert.throws(() => core.foreshadow.create(projectId, { name: 'x', status: 'bad' as never }), /伏笔状态无效/);
  });
});

describe('设置与备份', () => {
  let core: AppCore;
  let dir: string;

  before(() => {
    ({ core, dir } = makeCore());
  });

  after(() => {
    core.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('项目级分栏比例持久化并限制范围', () => {
    const p = core.projects.create({ name: '布局测试' });
    core.settings.updateProjectSettings(p.id, { linkSplitRatio: 0.72 });
    assert.equal(core.settings.getProjectSettings(p.id).linkSplitRatio, 0.72);
    core.settings.updateProjectSettings(p.id, { linkSplitRatio: 0.95 });
    assert.ok(core.settings.getProjectSettings(p.id).linkSplitRatio <= 0.8);
    core.settings.updateProjectSettings(p.id, { outlineViewport: { x: 10, y: 20, zoom: 1.2 } });
    assert.deepEqual(core.settings.getProjectSettings(p.id).outlineViewport, { x: 10, y: 20, zoom: 1.2 });
  });

  test('创建备份并可列出', () => {
    const backup = core.backup.create('manual');
    assert.ok(fs.existsSync(backup.filePath));
    assert.ok(backup.size > 0);
    assert.ok(core.backup.list().some((b) => b.fileName === backup.fileName));
  });

  test('统计信息正确', () => {
    const stats = core.stats();
    assert.ok(stats.projects >= 1);
    assert.ok(stats.dbSize > 0);
  });
});
