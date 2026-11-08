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

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Chapter, ProjectStructure } from '@shared/types';
import { buildChapterTree, UNASSIGNED_VOLUME_ID, type ChapterGroup, type VolumeNode } from '../lib/chapterTree';
import { formatRelative } from '@shared/text';
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
  /** 卷标题行右侧：编辑此卷（改名 / 改简介） */
  onEditVolume?: (volumeId: string) => void;
  /** 卷标题行右侧：在此卷新建章节 */
  onAddChapterToVolume?: (volumeId: string) => void;
  /** 卷标题行右侧：删除此卷 */
  onDeleteVolume?: (volumeId: string) => void;
  /** 关闭章节简介悬浮窗（例如批量勾选导出时），默认 false */
  disableTooltip?: boolean;
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

/** 卷序号：取「第 N 卷」里的 N，取不到就退回目录中的顺序。 */
function volumeOrdinal(label: string, index: number): string {
  const at = label.indexOf('卷');
  if (at > 0) {
    const part = label.slice(0, at).replace(/^第/, '').trim();
    if (part) return part;
  }
  return String(index + 1);
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

/** 单个悬浮窗数据：章节 + 鼠标位置（视口坐标）。 */
interface ChapterTooltip {
  chapter: Chapter;
  x: number;
  y: number;
}

/** 悬浮窗相对鼠标的偏移，以及离窗口边缘的最小留白。 */
const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 16;
const TOOLTIP_EDGE_GAP = 8;
/** 简介浮层显示前的悬停延迟（毫秒）。 */
const TOOLTIP_DELAY_MS = 250;

/** 把固定定位的浮层夹在窗口可视区域内，避免右侧 / 底部溢出。 */
function clampTooltip(x: number, y: number, width: number, height: number): { left: number; top: number } {
  const vw = typeof window === 'undefined' ? 0 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 0 : window.innerHeight;
  let left = x + TOOLTIP_OFFSET_X;
  let top = y + TOOLTIP_OFFSET_Y;
  if (left + width > vw - TOOLTIP_EDGE_GAP) left = x - width - TOOLTIP_OFFSET_X;
  if (top + height > vh - TOOLTIP_EDGE_GAP) top = y - height - TOOLTIP_OFFSET_Y;
  return {
    left: Math.max(TOOLTIP_EDGE_GAP, Math.min(left, Math.max(TOOLTIP_EDGE_GAP, vw - width - TOOLTIP_EDGE_GAP))),
    top: Math.max(TOOLTIP_EDGE_GAP, Math.min(top, Math.max(TOOLTIP_EDGE_GAP, vh - height - TOOLTIP_EDGE_GAP))),
  };
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
  onEditVolume,
  onAddChapterToVolume,
  onDeleteVolume,
  disableTooltip = false,
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

  // ---------- 章节简介悬浮窗：整棵树只渲染一个浮层 ----------
  const [tooltip, setTooltip] = useState<ChapterTooltip | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const hoveredChapter = useRef<Chapter | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  /** 记录鼠标位置；浮层出现后再移动鼠标时用于重新定位。 */
  const hoverXY = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const hideTooltip = () => {
    clearHoverTimer();
    hoveredChapter.current = null;
    setTooltip(null);
  };

  const showTooltip = (chapter: Chapter, x: number, y: number) => {
    setTooltip({ chapter, x, y });
  };

  const handleChapterEnter = (chapter: Chapter, x: number, y: number) => {
    if (disableTooltip) return;
    hoveredChapter.current = chapter;
    hoverXY.current = { x, y };
    clearHoverTimer();
    // 换章时先隐藏旧浮层，再按 250ms 延迟重新显示，避免旧内容闪一下。
    setTooltip((prev) => (prev && prev.chapter.id !== chapter.id ? null : prev));
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      if (hoveredChapter.current?.id !== chapter.id) return;
      showTooltip(chapter, hoverXY.current.x, hoverXY.current.y);
    }, TOOLTIP_DELAY_MS);
  };

  const handleChapterMove = (x: number, y: number) => {
    if (disableTooltip) return;
    hoverXY.current = { x, y };
    // 浮层显示后跟随鼠标；未显示时只记坐标，留给定时器使用。
    setTooltip((prev) => (prev ? { ...prev, x, y } : prev));
  };

  /*
   * 浮层按实际渲染尺寸做边界 clamp：先以 visibility: hidden 渲染一帧拿到
   * offsetWidth/offsetHeight 并算好位置，再显示，避免右下角溢出或闪一下。
   */
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!tooltip || !el) {
      setTooltipPos(null);
      return;
    }
    // 先按隐藏状态量一次尺寸再给位置，避免出现一帧偏出窗口的浮层。
    setTooltipPos(clampTooltip(tooltip.x, tooltip.y, el.offsetWidth, el.offsetHeight));
  }, [tooltip]);

  // 简介长短变化 / 窗口缩放时按最新鼠标坐标重新夹一次边界。
  useEffect(() => {
    const el = tooltipRef.current;
    if (!tooltip || !el) return;
    const remeasure = () => {
      setTooltipPos(clampTooltip(hoverXY.current.x, hoverXY.current.y, el.offsetWidth, el.offsetHeight));
    };
    window.addEventListener('resize', remeasure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', remeasure);
      observer?.disconnect();
    };
  }, [tooltip?.chapter.id]);

  // 组件卸载时清掉定时器与滚动监听，避免卸载后 setState。
  useEffect(() => {
    const onScroll = () => hideTooltip();
    window.addEventListener('scroll', onScroll, true);
    return () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

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
      {volumes.map((volume: VolumeNode, volumeIndex: number) => {
        const volumeKey = volumeCollapseKey(volume.id);
        const volumeHasMatch = volume.groups.some((group) =>
          group.chapters.some((chapter) => matchedIds.has(chapter.id)),
        );
        const volumeExpanded = volumeHasMatch || isExpanded(volumeKey);
        const isUnassigned = volume.id === UNASSIGNED_VOLUME_ID;
        const ordinal = volumeOrdinal(volume.label, volumeIndex);
        const hasVolumeActions = Boolean(onEditVolume || onAddChapterToVolume || onDeleteVolume);

        return (
          <div className="ct-volume stage-block" key={volume.id}>
            {/* stage-head：兼容旧版测试与用户脚本里使用的选择器 */}
            <div className="ct-volume-head-row stage-head">
              <button
                type="button"
                className="ct-volume-head"
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

              {/* 悬停时出现的文字入口：点一下直接打开「编辑此卷」，与铅笔按钮等价 */}
              {onEditVolume && !isUnassigned ? (
                <button
                  type="button"
                  className="ct-volume-edit-hint"
                  title={`编辑第 ${ordinal} 卷（改名 / 改简介）`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditVolume(volume.id);
                  }}
                >
                  点此编辑
                </button>
              ) : null}

              {hasVolumeActions ? (
                <div className="ct-volume-actions stage-actions">
                  {onEditVolume && !isUnassigned ? (
                    <button
                      type="button"
                      className="icon-btn ct-volume-action"
                      title={`编辑第 ${ordinal} 卷（改名 / 改简介）`}
                      aria-label={`编辑第 ${ordinal} 卷`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditVolume(volume.id);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  ) : null}
                  {onAddChapterToVolume ? (
                    <button
                      type="button"
                      className="icon-btn ct-volume-action"
                      title={isUnassigned ? '新建未分卷章节' : `在第 ${ordinal} 卷新建章节`}
                      aria-label={isUnassigned ? '新建未分卷章节' : `在此卷新建章节（第 ${ordinal} 卷）`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddChapterToVolume(volume.id);
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  ) : null}
                  {onDeleteVolume && !isUnassigned ? (
                    <button
                      type="button"
                      className="icon-btn ct-volume-action ct-volume-action-danger"
                      title={`删除第 ${ordinal} 卷`}
                      aria-label={`删除第 ${ordinal} 卷`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteVolume(volume.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

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
                                  onMouseEnter={(e) => handleChapterEnter(chapter, e.clientX, e.clientY)}
                                  onMouseMove={(e) => handleChapterMove(e.clientX, e.clientY)}
                                  onMouseLeave={hideTooltip}
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

      {/* 章节简介悬浮窗：整棵树只有一个浮层，跟随鼠标、pointer-events: none */}
      {tooltip ? (
        <div
          ref={tooltipRef}
          className="ct-tooltip"
          role="tooltip"
          style={{ left: tooltipPos?.left ?? 0, top: tooltipPos?.top ?? 0, visibility: tooltipPos ? 'visible' : 'hidden' }}
        >
          <div className="ct-tooltip-title">{renderHighlighted(tooltip.chapter.name, keywordText)}</div>
          {tooltip.chapter.summary ? (
            <div className="ct-tooltip-summary">{renderHighlighted(tooltip.chapter.summary, keywordText)}</div>
          ) : (
            <div className="ct-tooltip-summary ct-tooltip-empty">本章还没有简介</div>
          )}
          <div className="ct-tooltip-meta">
            <span>{formatCount(tooltip.chapter.wordCount)} 字</span>
            <span>
              最近编辑：{tooltip.chapter.contentUpdatedAt ? formatRelative(tooltip.chapter.contentUpdatedAt) : '未开始'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
