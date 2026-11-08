/**
 * 卷册分级目录（受控展示组件）。
 *
 * 结构：卷（Stage）→ 每 20 章一个分组框 → 章节行。
 * 默认全部收缩：卷收缩、展开卷后其分组框仍是收缩的，避免一次铺开几百章。
 *
 * 折叠状态语义（collapsed 记录的 value）：
 * - 查不到 key → 收缩（默认）；
 * - value === false → 展开；
 * - value === true  → 收缩。
 * 折叠 key：卷为 'volume:<volumeId>'，分组为 'group:<groupKey>'。
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { Chapter, ProjectStructure } from '@shared/types';
import { buildChapterTree, type ChapterGroup, type VolumeNode } from '../lib/chapterTree';
import '../styles/chapter-tree.css';

export interface ChapterTreeProps {
  structure: ProjectStructure;
  selectedChapterId?: string | null;
  onSelectChapter: (chapterId: string) => void;
  /** 右侧附加信息，例如「1234 字」「已读 60%」 */
  renderMeta?: (chapter: Chapter) => ReactNode;
  /** 是否显示章节序号，默认 true */
  showIndex?: boolean;
  /** 额外的章节行右侧操作按钮，例如编辑/删除 */
  renderActions?: (chapter: Chapter) => ReactNode;
  /** 折叠状态外部受控（可选）；不传则组件内部自己管理 */
  collapsed?: Record<string, boolean>;
  onCollapsedChange?: (next: Record<string, boolean>) => void;
  className?: string;
  /** 搜索关键词，命中时自动展开并高亮 */
  keyword?: string;
  /** 每卷底部的「新建章节」入口（保持与旧版目录一致的快速入口） */
  renderVolumeFooter?: (volumeId: string) => ReactNode;
}

/** 卷的折叠 key。 */
export function volumeCollapseKey(volumeId: string): string {
  return 'volume:' + volumeId;
}

/** 分组的折叠 key。 */
export function groupCollapseKey(key: string): string {
  return 'group:' + key;
}

/** 数字加千分位，用于卷/组的字数摘要。 */
function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('zh-CN');
}

/**
 * 把章节名里的关键词包进 <mark>，其余部分按纯文本渲染。
 * 用 indexOf 做匹配（大小写不敏感），只产出 React 节点、不拼接 HTML，
 * 因此无需转义，也不使用 dangerouslySetInnerHTML。
 */
function renderHighlighted(text: string, keyword: string): ReactNode {
  if (!keyword) return text;
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const nodes: ReactNode[] = [];
  let from = 0;
  let at = lowerText.indexOf(lowerKeyword, from);
  let guard = 0;
  while (at !== -1 && guard < 500) {
    if (at > from) nodes.push(text.slice(from, at));
    nodes.push(
      <mark className="ct-mark" key={'m' + nodes.length}>
        {text.slice(at, at + keyword.length)}
      </mark>,
    );
    from = at + keyword.length;
    at = lowerText.indexOf(lowerKeyword, from);
    guard += 1;
  }
  if (from < text.length) nodes.push(text.slice(from));
  return nodes.length ? nodes : text;
}

export function ChapterTree({
  structure,
  selectedChapterId,
  onSelectChapter,
  renderMeta,
  showIndex = true,
  renderActions,
  collapsed,
  onCollapsedChange,
  className,
  keyword,
  renderVolumeFooter,
}: ChapterTreeProps) {
  const stages = structure?.stages ?? [];
  const chapters = structure?.chapters ?? [];
  const keywordText = (keyword ?? '').trim();

  const volumes = useMemo(() => buildChapterTree(stages, chapters), [stages, chapters]);

  /** 全书连续序号：chapter.id → 从 1 开始的序号。 */
  const chapterIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    chapters.forEach((chapter, i) => map.set(chapter.id, i + 1));
    return map;
  }, [chapters]);

  /** 命中的章节 id：只有关键词非空时才有内容。 */
  const matchedIds = useMemo(() => {
    const set = new Set<string>();
    if (!keywordText) return set;
    const needle = keywordText.toLowerCase();
    for (const chapter of chapters) {
      if (String(chapter?.name ?? '').toLowerCase().includes(needle)) set.add(chapter.id);
    }
    return set;
  }, [chapters, keywordText]);

  // 受控模式：collapsed 与 onCollapsedChange 都传了才完全交给外部；否则内部管理。
  const isControlled = collapsed !== undefined && onCollapsedChange !== undefined;
  const [innerCollapsed, setInnerCollapsed] = useState<Record<string, boolean>>(() => ({ ...(collapsed ?? {}) }));
  const collapsedState = isControlled ? (collapsed ?? {}) : innerCollapsed;

  const isExpanded = (key: string): boolean => collapsedState[key] === false;

  const toggle = (key: string) => {
    const next = { ...collapsedState, [key]: isExpanded(key) };
    if (isControlled) {
      onCollapsedChange?.(next);
      return;
    }
    setInnerCollapsed(next);
  };

  const isSelected = (chapterId: string): boolean => chapterId === selectedChapterId;

  const rootClass = className ? 'ct-root ' + className : 'ct-root';

  if (!volumes.length) {
    return (
      <div className={rootClass}>
        <div className="ct-empty">暂无卷册</div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      {volumes.map((volume: VolumeNode) => {
        const volumeKey = volumeCollapseKey(volume.id);
        const volumeHasMatch = volume.groups.some((group) =>
          group.chapters.some((chapter) => matchedIds.has(chapter.id)),
        );
        const volumeExpanded = volumeHasMatch || isExpanded(volumeKey);

        return (
          <div className="ct-volume stage-block" key={volume.id}>
            <button
              type="button"
              className="ct-volume-head stage-head"
              aria-expanded={volumeExpanded}
              onClick={() => toggle(volumeKey)}
              title={volume.label}
            >
              <span className="ct-caret" aria-hidden="true">
                {volumeExpanded ? '▾' : '▸'}
              </span>
              {/* stage-name：兼容旧版测试与用户脚本里使用的选择器 */}
              <span className="ct-volume-title stage-name">{volume.label}</span>
              <span className="ct-volume-count">{volume.chapterCount} 章</span>
              {volume.wordCount > 0 ? (
                <span className="ct-volume-words">{formatCount(volume.wordCount)} 字</span>
              ) : null}
            </button>

            {volumeExpanded ? (
              <div className="ct-volume-body">
                {volume.groups.length ? (
                  volume.groups.map((group: ChapterGroup) => {
                    const gkey = groupCollapseKey(group.key);
                    const groupHasMatch = group.chapters.some((chapter) => matchedIds.has(chapter.id));
                    const groupExpanded = groupHasMatch || isExpanded(gkey);

                    return (
                      <div className="ct-group" key={group.key}>
                        <button
                          type="button"
                          className="ct-group-head"
                          aria-expanded={groupExpanded}
                          onClick={() => toggle(gkey)}
                        >
                          <span className="ct-caret" aria-hidden="true">
                            {groupExpanded ? '▾' : '▸'}
                          </span>
                          <span className="ct-group-title">{group.label}</span>
                          <span className="ct-group-count">{group.chapters.length} 章</span>
                        </button>

                        {groupExpanded ? (
                          <div className="ct-group-body">
                            {group.chapters.map((chapter: Chapter) => {
                              const index = chapterIndexMap.get(chapter.id) ?? 0;
                              const selected = isSelected(chapter.id);
                              return (
                                <div
                                  className={selected ? 'ct-chapter-row chapter-row active' : 'ct-chapter-row chapter-row'}
                                  key={chapter.id}
                                >
                                  <button
                                    type="button"
                                    className={selected ? 'ct-chapter active' : 'ct-chapter'}
                                    onClick={() => onSelectChapter(chapter.id)}
                                    aria-current={selected ? 'true' : undefined}
                                    title={chapter.name}
                                  >
                                    {showIndex ? <span className="ct-index">{index}</span> : null}
                                    <span className="ct-text">
                                      <span className="ct-name chapter-title">
                                        {renderHighlighted(chapter.name, keywordText)}
                                      </span>
                                      {/* 章节简介：与「内容」页旧版保持一致，目录里直接可见 */}
                                      {chapter.summary ? (
                                        <span className="ct-summary chapter-summary">
                                          {renderHighlighted(chapter.summary, keywordText)}
                                        </span>
                                      ) : null}
                                    </span>
                                    {renderMeta ? <span className="ct-meta">{renderMeta(chapter)}</span> : null}
                                  </button>
                                  {renderActions ? (
                                    <div className="ct-chapter-actions chapter-actions">{renderActions(chapter)}</div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="ct-empty">本卷暂无章节</div>
                )}
                {/* 每卷底部的快速入口（新建章节等），与旧版目录保持一致 */}
                {renderVolumeFooter ? (
                  <div className="ct-volume-footer">{renderVolumeFooter(volume.id)}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
