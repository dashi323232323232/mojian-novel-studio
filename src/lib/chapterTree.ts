/**
 * 卷册分级目录：纯逻辑模块（无 React 依赖，可单元测试）。
 *
 * 数据模型：
 * - 「卷」= Stage，「章」= Chapter；
 * - chapters 已按 sortOrder 排序，本模块不重新排序，严格按传入顺序取用；
 * - stageId 为 null 或指向不存在的卷时，归入「未分卷」，且固定排在最后。
 *
 * 编号约定：
 * - 章节序号是全书连续序号（chapters 数组下标 + 1），与目录里显示的序号一致；
 * - 每卷内部按 CHAPTERS_PER_GROUP 章切一个分组框，分组的 startIndex / endIndex
 *   是「全书连续序号」的闭区间。例如第 2 卷有 22 章、占全书第 4–25 章，
 *   会被切成「第 4–23 章」与「第 24–25 章」两个框。
 */

import type { Chapter, Stage } from '@shared/types';

/** 每 20 章归为一个独立的可收缩分组框。 */
export const CHAPTERS_PER_GROUP = 20;

/** 「未分卷」卷节点的固定 id。 */
export const UNASSIGNED_VOLUME_ID = '__unassigned__';

/** 「未分卷」卷节点的标题。 */
export const UNASSIGNED_VOLUME_LABEL = '未分卷';

export interface ChapterGroup {
  /** 折叠状态用的分组 key，等于 groupKey(卷 id, 组下标) */
  key: string;
  /** 组内第一章的全书连续序号（从 1 开始，闭区间） */
  startIndex: number;
  /** 组内最后一章的全书连续序号（从 1 开始，闭区间） */
  endIndex: number;
  /** 形如「第 1–20 章」，只有一章时是「第 1 章」 */
  label: string;
  chapters: Chapter[];
}

export interface VolumeNode {
  id: string;
  label: string;
  /** 「未分卷」节点为 null */
  stage: Stage | null;
  groups: ChapterGroup[];
  chapterCount: number;
  wordCount: number;
}

/** 折叠状态 key：分组部分。 */
export function groupKey(volumeId: string, groupIndex: number): string {
  return volumeId + ':' + groupIndex;
}

/** 全角阿拉伯数字，识别前缀前先归一成半角。 */
const FULLWIDTH_DIGIT = /[０-９]/g;
/** 合法的卷次数字：阿拉伯数字或中文数字。 */
const NUMERAL_PART = /^[0-9零〇一二三四五六七八九十百千万两]+$/;

function isNumeralPart(text: string): boolean {
  const normalized = text.replace(FULLWIDTH_DIGIT, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return NUMERAL_PART.test(normalized);
}

/**
 * stage.name 是否已经自带卷次前缀（「第X卷」或「卷」开头）。
 * 「第 3 卷」「第三卷」「第３卷」都算；「第一章 开端」不算。
 */
function hasVolumePrefix(name: string): boolean {
  if (name.startsWith('卷')) return true;
  if (!name.startsWith('第')) return false;
  const rest = name.slice(1).trim();
  const end = rest.indexOf('卷');
  if (end <= 0) return false;
  return isNumeralPart(rest.slice(0, end).trim());
}

/**
 * 卷标题：
 * - stage.name 本身已以「第X卷」或「卷」开头时原样返回，不重复加前缀；
 * - 否则拼成「第 N 卷 · <stage.name>」（N 是卷在目录中的序号，从 1 开始）。
 */
export function formatVolumeLabel(stage: Stage, index: number): string {
  const ordinal = index + 1;
  const name = String(stage?.name ?? '').trim();
  if (!name || name === '卷') return '第 ' + ordinal + ' 卷';
  if (hasVolumePrefix(name)) return name;
  return '第 ' + ordinal + ' 卷 · ' + name;
}

/** 分组标题：单章写「第 1 章」，多章用 en dash 连接，如「第 1–20 章」。 */
function formatGroupLabel(startIndex: number, endIndex: number): string {
  if (startIndex === endIndex) return '第 ' + startIndex + ' 章';
  return '第 ' + startIndex + '–' + endIndex + ' 章';
}

interface ChapterEntry {
  chapter: Chapter;
  /** 全书连续序号（从 1 开始） */
  index: number;
}

function sumWordCount(entries: ChapterEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    const words = Number(entry.chapter?.wordCount);
    if (Number.isFinite(words)) total += words;
  }
  return total;
}

function buildGroups(volumeId: string, entries: ChapterEntry[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (let start = 0; start < entries.length; start += CHAPTERS_PER_GROUP) {
    const slice = entries.slice(start, start + CHAPTERS_PER_GROUP);
    if (!slice.length) continue;
    const first = slice[0].index;
    const last = slice[slice.length - 1].index;
    groups.push({
      key: groupKey(volumeId, groups.length),
      startIndex: first,
      endIndex: last,
      label: formatGroupLabel(first, last),
      chapters: slice.map((entry) => entry.chapter),
    });
  }
  return groups;
}

/**
 * 把 stages / chapters 组装成「卷 → 每 20 章一组」的目录树。
 *
 * - 卷的顺序严格按 stages 传入顺序；
 * - 每卷的章节按 chapters 传入顺序取用（已按 sortOrder 排好）；
 * - 空数组、20 的整数倍、章节乱序输入都能处理，且不修改入参。
 */
export function buildChapterTree(stages: Stage[], chapters: Chapter[]): VolumeNode[] {
  const safeStages: Stage[] = Array.isArray(stages) ? stages : [];
  const safeChapters: Chapter[] = Array.isArray(chapters) ? chapters : [];

  const buckets = new Map<string, ChapterEntry[]>();
  const knownStageIds = new Set<string>();

  for (const stage of safeStages) {
    if (!stage || typeof stage.id !== 'string') continue;
    if (knownStageIds.has(stage.id)) continue; // 重复 id 只认第一个
    knownStageIds.add(stage.id);
  }

  // 按传入顺序给章节编号，再按所属卷分桶；无法归属的一律进「未分卷」桶。
  safeChapters.forEach((chapter, i) => {
    if (!chapter || typeof chapter !== 'object') return;
    const bucketId =
      chapter.stageId != null && knownStageIds.has(chapter.stageId) ? chapter.stageId : UNASSIGNED_VOLUME_ID;
    const bucket = buckets.get(bucketId);
    if (bucket) bucket.push({ chapter, index: i + 1 });
    else buckets.set(bucketId, [{ chapter, index: i + 1 }]);
  });

  const volumes: VolumeNode[] = [];

  const pushedStageIds = new Set<string>();

  for (const stage of safeStages) {
    if (!stage || typeof stage.id !== 'string') continue;
    if (pushedStageIds.has(stage.id)) continue; // 重复 id 只生成一个卷节点
    pushedStageIds.add(stage.id);
    const entries = buckets.get(stage.id) ?? [];
    volumes.push({
      id: stage.id,
      label: formatVolumeLabel(stage, volumes.length),
      stage,
      groups: buildGroups(stage.id, entries),
      chapterCount: entries.length,
      wordCount: sumWordCount(entries),
    });
  }

  const unassigned = buckets.get(UNASSIGNED_VOLUME_ID);
  if (unassigned && unassigned.length) {
    volumes.push({
      id: UNASSIGNED_VOLUME_ID,
      label: UNASSIGNED_VOLUME_LABEL,
      stage: null,
      groups: buildGroups(UNASSIGNED_VOLUME_ID, unassigned),
      chapterCount: unassigned.length,
      wordCount: sumWordCount(unassigned),
    });
  }

  return volumes;
}
