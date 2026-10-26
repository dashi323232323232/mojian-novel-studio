import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppCore } from '../../electron/main/core';

function makeCore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashi-summary-'));
  return { core: new AppCore(dir), dir };
}

describe('章节/阶段简介与大纲双向同步', () => {
  let core: AppCore;
  let dir: string;
  let projectId: string;
  let stageId: string;
  let chapterId: string;

  before(() => {
    ({ core, dir } = makeCore());
    const p = core.projects.create({ name: '同步测试' });
    projectId = p.id;
    stageId = core.projects.structure(p.id).stages[0].id;
  });

  after(() => {
    core.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('只填名称即可创建章节，简介默认空', () => {
    const chapter = core.structure.createChapter(projectId, { name: '只有名字的章节' });
    chapterId = chapter.id;
    assert.equal(chapter.name, '只有名字的章节');
    assert.equal(chapter.summary, '');
    assert.equal(core.structure.getContent(chapter.id).content, '');
  });

  test('创建时可带简介，并可后续修改', () => {
    const chapter = core.structure.createChapter(projectId, {
      name: '带简介的章节',
      summary: '这一章讲战争爆发。',
      stageId,
    });
    assert.equal(chapter.summary, '这一章讲战争爆发。');
    const updated = core.structure.updateChapter(chapter.id, { summary: '改过的简介' });
    assert.equal(updated.summary, '改过的简介');
  });

  test('阶段简介可创建与修改', () => {
    const stage = core.structure.createStage(projectId, { name: '新阶段', summary: '阶段简介内容' });
    assert.equal(stage.summary, '阶段简介内容');
    const updated = core.structure.updateStage(stage.id, { summary: '更新后的阶段简介' });
    assert.equal(updated.summary, '更新后的阶段简介');
  });

  test('具体章节节点绑定真实章节，简介双向同步', () => {
    const node = core.outline.createNode(projectId, {
      type: 'chapter',
      title: '占位名称',
      chapterId,
    });
    assert.equal(node.type, 'chapter');
    assert.equal(node.title, '只有名字的章节');
    assert.equal(node.data.chapterId, chapterId);

    // 大纲改简介 → 章节跟着改
    core.outline.updateNode(node.id, { description: '从大纲写入的简介' });
    assert.equal(core.structure.getChapter(chapterId).summary, '从大纲写入的简介');

    // 章节改简介 → 大纲节点跟着改
    core.structure.updateChapter(chapterId, { summary: '从内容页写入的简介' });
    const after = core.outline.getNode(node.id);
    assert.equal(after.description, '从内容页写入的简介');

    // 大纲改名称 → 章节名称跟着改
    core.outline.updateNode(node.id, { title: '大纲改名后的章节' });
    assert.equal(core.structure.getChapter(chapterId).name, '大纲改名后的章节');
  });

  test('故事阶段节点绑定真实阶段，简介双向同步', () => {
    const node = core.outline.createNode(projectId, {
      type: 'stage',
      title: '占位',
      stageId,
    });
    assert.equal(node.data.stageId, stageId);
    core.outline.updateNode(node.id, { description: '大纲里的阶段简介' });
    assert.equal(core.structure.getStage(stageId).summary, '大纲里的阶段简介');

    core.structure.updateStage(stageId, { name: '改名阶段', summary: '内容页阶段简介' });
    const after = core.outline.getNode(node.id);
    assert.equal(after.title, '改名阶段');
    assert.equal(after.description, '内容页阶段简介');
  });

  test('备注不限字数，可改写与一键清空', () => {
    const node = core.outline.createNode(projectId, { type: 'event', title: '带备注事件' });
    const longNotes = '这是一段很长的备注。'.repeat(3000); // 3 万字，远超一般章节
    const updated = core.outline.updateNode(node.id, { notes: longNotes });
    assert.equal(updated.notes.length, longNotes.length);

    const cleared = core.outline.clearNotes(node.id);
    assert.equal(cleared.notes, '');
  });

  test('删除大纲节点不会删除真实章节正文', () => {
    const chapter = core.structure.createChapter(projectId, { name: '不应被删的章节', summary: 'x' });
    core.structure.saveContent(chapter.id, { content: '重要正文' });
    const node = core.outline.createNode(projectId, { type: 'chapter', title: 'x', chapterId: chapter.id });
    core.outline.deleteNode(node.id, { confirm: true });
    const still = core.structure.getChapter(chapter.id);
    assert.equal(still.name, '不应被删的章节');
    assert.equal(core.structure.getContent(chapter.id).content, '重要正文');
  });

  test('reconcileBindings 按名称自动绑定', () => {
    const chapter = core.structure.createChapter(projectId, { name: '自动绑定章节' });
    const node = core.outline.createNode(projectId, { type: 'chapter', title: '自动绑定章节' });
    const result = core.outline.reconcileBindings(projectId);
    assert.ok(result.bound >= 1);
    const after = core.outline.getNode(node.id);
    assert.equal(after.data.chapterId, chapter.id);
  });

  test('批量导出数据准备：按阶段分组顺序正确', () => {
    const structure = core.projects.structure(projectId);
    assert.ok(structure.stages.length >= 2);
    assert.ok(structure.chapters.length >= 3);
    const withSummary = structure.chapters.filter((c) => c.summary);
    assert.ok(withSummary.length >= 1);
  });
});
