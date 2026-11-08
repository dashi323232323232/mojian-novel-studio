import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppCore } from '../../electron/main/core';
import { createZip, readZip } from '../../electron/main/services/zip';

interface Fixture {
  core: AppCore;
  dir: string;
  zipPath: string;
  projectId: string;
  projectName: string;
  stageIds: string[];
  chapterIds: string[];
  contents: string[];
  nodeIds: string[];
  edgeIds: string[];
  foreshadowId: string;
  fsNodeId: string;
  charNodeId: string;
}

function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashi-transfer-'));
  const core = new AppCore(dir);

  const project = core.projects.create({
    name: '测试项目·红楼',
    description: '用于导出/导入验收',
    genre: '古典',
  });
  const projectId = project.id;
  const stages = core.projects.structure(projectId).stages;
  const stage2 = core.structure.createStage(projectId, { name: '第二阶段', summary: '转折' });
  const stageIds = [stages[0].id, stage2.id];

  const ch1 = core.structure.createChapter(projectId, { name: '第一章', stageId: stageIds[0], summary: '开端' });
  const ch2 = core.structure.createChapter(projectId, { name: '第二章', stageId: stageIds[1], summary: '发展' });
  const chapterIds = [ch1.id, ch2.id];
  const contents = ['第一章正文：\n大观园里春风起，中文与 English 混排。', '第二章正文：\n秋雨连绵，伏笔渐显。'];
  core.structure.saveContent(ch1.id, { content: contents[0] });
  core.structure.saveContent(ch2.id, { content: contents[1] });

  // 大纲：事件节点、绑定真实阶段的节点、绑定真实章节的节点、伏笔节点、人物节点
  const nEvent = core.outline.createNode(projectId, { type: 'event', title: '事件甲', x: 10, y: 20 });
  const nStage = core.outline.createNode(projectId, {
    type: 'stage',
    title: '占位',
    stageId: stageIds[0],
    data: { goal: '完成铺垫', stageId: stageIds[0] },
  });
  const nChapter = core.outline.createNode(projectId, {
    type: 'chapter',
    title: '占位',
    chapterId: ch1.id,
    data: { chapterId: ch1.id },
  });
  const fsNode = core.outline.createNode(projectId, { type: 'foreshadow', title: '伏笔节点' });
  const charNode = core.outline.createNode(projectId, { type: 'character', title: '人物甲' });
  const nodeIds = [nEvent.id, nStage.id, nChapter.id, fsNode.id, charNode.id];

  const edge = core.outline.createEdge(projectId, {
    sourceId: nEvent.id,
    targetId: nStage.id,
    relation: 'causal',
    label: '因果',
  });
  const edge2 = core.outline.createEdge(projectId, {
    sourceId: nChapter.id,
    targetId: fsNode.id,
    relation: 'setup',
  });
  const edgeIds = [edge.id, edge2.id];

  core.outline.linkChapter(nEvent.id, ch1.id);
  core.outline.linkChapter(nEvent.id, ch2.id);
  core.outline.linkChapter(nChapter.id, ch1.id);

  // 伏笔：覆盖全部外键 / 数组 / chapterRefs 字段
  const foreshadow = core.foreshadow.create(projectId, {
    name: '染血的军旗',
    description: '贯穿全书',
    status: 'planted',
    plantedChapterId: ch1.id,
    plannedResolveChapterId: ch2.id,
    plannedResolveStageId: stageIds[1],
    nodeId: fsNode.id,
    characterNodeIds: [charNode.id, nEvent.id],
    chapterIds: [ch1.id, ch2.id],
    chapterRefs: [
      { chapterId: ch1.id, role: 'planted' },
      { chapterId: ch2.id, role: 'resolved' },
    ],
    notes: '决战回收',
  });

  // 项目级设置：包含 chapterId 引用（readingProgress 的键 + lastChapterId）
  core.settings.updateProjectSettings(projectId, { linkSplitRatio: 0.66, lastChapterId: ch1.id });
  core.settings.recordReadingProgress(projectId, { chapterId: ch1.id, charIndex: 12, charTotal: 40 });

  const zipPath = path.join(dir, 'export.zip');
  return {
    core,
    dir,
    zipPath,
    projectId,
    projectName: project.name,
    stageIds,
    chapterIds,
    contents,
    nodeIds,
    edgeIds,
    foreshadowId: foreshadow.id,
    fsNodeId: fsNode.id,
    charNodeId: charNode.id,
  };
}

/** 读取 zip 并替换某个 json 条目的内容，重新打包（用于构造损坏样本）。 */
function rebuildZip(zipPath: string, replace: (name: string, data: Buffer) => Buffer): Buffer {
  const entries = readZip(fs.readFileSync(zipPath));
  const next = entries.map((e) => ({ name: e.name, data: replace(e.name, e.data) }));
  const out = createZip(next);
  const tmp = `${zipPath}.rebuilt.zip`;
  fs.writeFileSync(tmp, out);
  return out;
}

describe('项目导出 / 导入：底层服务', () => {
  let f: Fixture;

  before(async () => {
    f = makeFixture();
    await f.core.transfer.exportProject(f.projectId, f.zipPath);
  });

  after(() => {
    f.core.close();
    fs.rmSync(f.dir, { recursive: true, force: true });
  });

  test('zip 已生成，含全部必备条目，manifest 字段正确', () => {
    assert.ok(fs.existsSync(f.zipPath));
    const names = readZip(fs.readFileSync(f.zipPath)).map((e) => e.name);
    for (const required of [
      'manifest.json',
      'project.json',
      'stages.json',
      'chapters.json',
      'contents.json',
      'outline.json',
      'foreshadows.json',
      'project-settings.json',
    ]) {
      assert.ok(names.includes(required), `缺少条目 ${required}`);
    }
    const manifest = JSON.parse(
      readZip(fs.readFileSync(f.zipPath)).find((e) => e.name === 'manifest.json')!.data.toString('utf8'),
    );
    assert.equal(manifest.format, 'dashi-project');
    assert.equal(manifest.version, 1);
    assert.equal(manifest.appVersion, '1.6.0');
    assert.equal(manifest.projectName, f.projectName);
    assert.equal(manifest.chapters, f.chapterIds.length);
    assert.equal(manifest.stages, f.stageIds.length);
    assert.equal(manifest.entries.length, 7);
    assert.ok(manifest.entries.every((e: { sha256: string; bytes: number }) => /^[0-9a-f]{64}$/.test(e.sha256)));
    assert.ok(!Number.isNaN(Date.parse(manifest.exportedAt)));
  });

  test('inspect 只读 manifest，返回正确预览信息', () => {
    const info = f.core.transfer.inspect(f.zipPath);
    assert.equal(info.projectName, f.projectName);
    assert.equal(info.chapters, f.chapterIds.length);
    assert.equal(info.version, 1);
    assert.ok(!Number.isNaN(Date.parse(info.exportedAt)));
    // inspect 不写库
    assert.equal(f.core.projects.list().length, 1);
  });

  test('importProject 完整还原数据（正文 / 章节 / 阶段 / 大纲 / 伏笔 / 关联）', async () => {
    const result = await f.core.transfer.importProject(f.zipPath);
    assert.notEqual(result.projectId, f.projectId);
    assert.equal(result.chapters, f.chapterIds.length);
    assert.equal(result.stages, f.stageIds.length);
    assert.equal(result.projectName, `${f.projectName}（导入）`);

    const newId = result.projectId;
    const structure = f.core.projects.structure(newId);
    assert.equal(structure.stages.length, f.stageIds.length);
    assert.equal(structure.chapters.length, f.chapterIds.length);
    assert.deepEqual(structure.chapters.map((c) => c.name), ['第一章', '第二章']);
    assert.deepEqual(
      structure.chapters.map((c) => f.core.structure.getContent(c.id).content),
      f.contents,
    );

    const snapshot = f.core.outline.snapshot(newId);
    assert.equal(snapshot.nodes.length, f.nodeIds.length);
    assert.equal(snapshot.edges.length, f.edgeIds.length);
    assert.equal(snapshot.links.length, 3);
    assert.deepEqual(snapshot.edges.map((e) => e.relation).sort(), ['causal', 'setup']);

    const foreshadows = f.core.foreshadow.list(newId);
    assert.equal(foreshadows.length, 1);
    const nf = foreshadows[0];
    assert.equal(nf.name, '染血的军旗');
    assert.equal(nf.status, 'planted');
    assert.equal(nf.notes, '决战回收');
    assert.equal(nf.chapterIds.length, 2);
    assert.equal(nf.chapterRefs.length, 2);
    assert.equal(nf.characterNodeIds.length, 2);
    assert.ok(nf.plantedChapterId);
    assert.ok(nf.plannedResolveChapterId);
    assert.ok(nf.plannedResolveStageId);
    assert.ok(nf.nodeId);

    // 项目级设置也还原了
    const settings = f.core.settings.getProjectSettings(newId);
    assert.equal(settings.linkSplitRatio, 0.66);
    assert.ok(settings.lastChapterId);
  });

  test('id 全部重映射：实体 id 与所有引用字段都指向新 id，且不指向旧 id', async () => {
    // 第一次导入的结果
    const imported = f.core.projects.list().find((p) => p.name === `${f.projectName}（导入）`);
    assert.ok(imported);
    const newId = imported!.id;
    const structure = f.core.projects.structure(newId);
    const newStageIds = new Set(structure.stages.map((s) => s.id));
    const newChapterIds = new Set(structure.chapters.map((c) => c.id));
    const snapshot = f.core.outline.snapshot(newId);
    const newNodeIds = new Set(snapshot.nodes.map((n) => n.id));

    // 所有旧 id 都不应出现在新项目里
    const allOld = [
      ...f.stageIds,
      ...f.chapterIds,
      ...f.nodeIds,
      ...f.edgeIds,
      f.foreshadowId,
      f.projectId,
    ];
    for (const old of allOld) {
      assert.ok(!newStageIds.has(old), `旧 stage id 泄漏: ${old}`);
      assert.ok(!newChapterIds.has(old), `旧 chapter id 泄漏: ${old}`);
      assert.ok(!newNodeIds.has(old), `旧 node id 泄漏: ${old}`);
    }

    // 章节的 stageId 指向新阶段
    for (const c of structure.chapters) {
      assert.ok(c.stageId === null || newStageIds.has(c.stageId), '章节 stageId 未重映射');
    }
    // 连线的 sourceId / targetId 指向新节点
    for (const e of snapshot.edges) {
      assert.ok(newNodeIds.has(e.sourceId), '连线 sourceId 未重映射');
      assert.ok(newNodeIds.has(e.targetId), '连线 targetId 未重映射');
    }
    // links 的 nodeId / chapterId 指向新实体
    for (const l of snapshot.links) {
      assert.ok(newNodeIds.has(l.nodeId), 'link.nodeId 未重映射');
      assert.ok(newChapterIds.has(l.chapterId), 'link.chapterId 未重映射');
    }
    // 伏笔的所有引用字段
    const nf = f.core.foreshadow.list(newId)[0];
    assert.ok(newChapterIds.has(nf.plantedChapterId!), 'plantedChapterId 未重映射');
    assert.ok(newChapterIds.has(nf.plannedResolveChapterId!), 'plannedResolveChapterId 未重映射');
    assert.ok(newStageIds.has(nf.plannedResolveStageId!), 'plannedResolveStageId 未重映射');
    assert.ok(newNodeIds.has(nf.nodeId!), 'nodeId 未重映射');
    for (const id of nf.characterNodeIds) assert.ok(newNodeIds.has(id), 'characterNodeIds 未重映射');
    for (const id of nf.chapterIds) assert.ok(newChapterIds.has(id), 'chapterIds 未重映射');
    for (const ref of nf.chapterRefs) assert.ok(newChapterIds.has(ref.chapterId), 'chapterRefs 未重映射');

    // 绑定节点的 stage_id / chapter_id 与 data 里的引用
    const boundNodes = f.core.db.all<{ id: string; stage_id: string | null; chapter_id: string | null; data: string }>(
      'SELECT id, stage_id, chapter_id, data FROM outline_nodes WHERE project_id = ?',
      newId,
    );
    const stageNode = boundNodes.find((n) => n.stage_id !== null)!;
    const chapterNode = boundNodes.find((n) => n.chapter_id !== null)!;
    assert.ok(stageNode && newStageIds.has(stageNode.stage_id!), '绑定节点 stage_id 未重映射');
    assert.ok(chapterNode && newChapterIds.has(chapterNode.chapter_id!), '绑定节点 chapter_id 未重映射');
    assert.ok(newStageIds.has(JSON.parse(stageNode.data).stageId), 'data.stageId 未重映射');
    assert.ok(newChapterIds.has(JSON.parse(chapterNode.data).chapterId), 'data.chapterId 未重映射');

    // 项目设置里的 chapterId 引用
    const settings = f.core.settings.getProjectSettings(newId);
    assert.ok(newChapterIds.has(settings.lastChapterId!), 'lastChapterId 未重映射');
    const progressKeys = Object.keys(settings.readingProgress);
    assert.ok(progressKeys.length > 0);
    for (const key of progressKeys) assert.ok(newChapterIds.has(key), 'readingProgress 键未重映射');
  });

  test('重复导入两次得到两个不同 id 的项目，原项目数据未被改动', async () => {
    const r1 = await f.core.transfer.importProject(f.zipPath);
    const r2 = await f.core.transfer.importProject(f.zipPath);
    assert.notEqual(r1.projectId, r2.projectId);
    assert.notEqual(r1.projectName, r2.projectName); // （导入 2）/（导入 3）
    assert.notEqual(r1.projectId, f.projectId);
    assert.notEqual(r2.projectId, f.projectId);

    // 原项目完好：名称、章节、正文、节点数
    const original = f.core.projects.get(f.projectId);
    assert.equal(original.name, f.projectName);
    const structure = f.core.projects.structure(f.projectId);
    assert.equal(structure.chapters.length, f.chapterIds.length);
    assert.deepEqual(
      structure.chapters.map((c) => f.core.structure.getContent(c.id).content),
      f.contents,
    );
    assert.equal(f.core.outline.snapshot(f.projectId).nodes.length, f.nodeIds.length);
    assert.equal(f.core.foreshadow.list(f.projectId).length, 1);

    // 两个新项目都数据完整
    for (const r of [r1, r2]) {
      assert.equal(f.core.projects.structure(r.projectId).chapters.length, f.chapterIds.length);
      assert.equal(f.core.outline.snapshot(r.projectId).nodes.length, f.nodeIds.length);
    }
  });

  test('空项目（只有默认阶段）也能导出并导入', async () => {
    const empty = f.core.projects.create({ name: '空项目' });
    const emptyZip = path.join(f.dir, 'empty.zip');
    const exported = await f.core.transfer.exportProject(empty.id, emptyZip);
    assert.ok(exported.size > 0);
    const info = f.core.transfer.inspect(emptyZip);
    assert.equal(info.chapters, 0);
    assert.equal(info.projectName, '空项目');
    const imported = await f.core.transfer.importProject(emptyZip);
    const structure = f.core.projects.structure(imported.projectId);
    assert.equal(structure.chapters.length, 0);
    assert.equal(structure.stages.length, 1);
  });

  test('manifest 格式不兼容时抛 NovelError(VALIDATION_ERROR)', async () => {
    const bad = path.join(f.dir, 'bad-format.zip');
    const out = rebuildZip(f.zipPath, (name, data) => {
      if (name === 'manifest.json') {
        const m = JSON.parse(data.toString('utf8'));
        m.format = 'other-tool';
        return Buffer.from(JSON.stringify(m));
      }
      return data;
    });
    fs.writeFileSync(bad, out);
    await assert.rejects(
      () => f.core.transfer.importProject(bad),
      (err: Error & { code?: string }) => err.code === 'VALIDATION_ERROR' && /格式不兼容/.test(err.message),
    );
  });

  test('version > 1 时抛格式不兼容', async () => {
    const bad = path.join(f.dir, 'bad-version.zip');
    const out = rebuildZip(f.zipPath, (name, data) => {
      if (name === 'manifest.json') {
        const m = JSON.parse(data.toString('utf8'));
        m.version = 99;
        return Buffer.from(JSON.stringify(m));
      }
      return data;
    });
    fs.writeFileSync(bad, out);
    await assert.rejects(
      () => f.core.transfer.importProject(bad),
      (err: Error & { code?: string }) => err.code === 'VALIDATION_ERROR' && /格式不兼容/.test(err.message),
    );
  });

  test('entry 内容被篡改（sha256 不符）时抛「项目压缩包已损坏」', async () => {
    const bad = path.join(f.dir, 'bad-sha.zip');
    const out = rebuildZip(f.zipPath, (name, data) => {
      if (name === 'chapters.json') {
        return Buffer.from(data.toString('utf8').replace('第一章', '被篡改的章节'));
      }
      return data;
    });
    fs.writeFileSync(bad, out);
    await assert.rejects(
      () => f.core.transfer.importProject(bad),
      (err: Error & { code?: string }) => err.code === 'VALIDATION_ERROR' && /已损坏/.test(err.message),
    );
  });

  test('导出到不存在的目录会自动创建，且原子替换不残留 .tmp', async () => {
    const nested = path.join(f.dir, 'a', 'b', 'again.zip');
    const r = await f.core.transfer.exportProject(f.projectId, nested);
    assert.ok(fs.existsSync(r.filePath));
    assert.equal(r.size, fs.statSync(r.filePath).size);
    assert.ok(!fs.existsSync(`${r.filePath}.tmp`));
    // 覆盖导出同一路径
    const r2 = await f.core.transfer.exportProject(f.projectId, nested);
    assert.ok(fs.existsSync(r2.filePath));
    assert.ok(!fs.existsSync(`${r2.filePath}.tmp`));
  });
});
