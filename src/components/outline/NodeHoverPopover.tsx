import { useMemo } from 'react';
import { Link2, BookOpen, ExternalLink } from 'lucide-react';
import { NODE_TYPE_META } from '@shared/constants';
import type { OutlineNode } from '@shared/types';

interface ChapterItem {
  id: string;
  name: string;
  order: number;
  stageName: string | null;
  wordCount: number;
}

export function NodeHoverPopover({
  node,
  chapters,
  x,
  y,
  onMouseEnter,
  onMouseLeave,
  onOpenChapter,
}: {
  node: OutlineNode;
  chapters: ChapterItem[];
  x: number;
  y: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenChapter: (chapterId: string) => void;
}) {
  const meta = NODE_TYPE_META[node.type] ?? NODE_TYPE_META.note;
  const style = useMemo(() => {
    const width = 268;
    const left = Math.max(8, Math.min(x + 14, (window.innerWidth || 1200) - width - 320));
    const top = Math.max(8, Math.min(y + 12, (window.innerHeight || 800) - 280));
    return { left, top, width };
  }, [x, y]);

  return (
    <div
      className="node-hover-pop"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="node-hover-head">
        <span style={{ color: meta.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Link2 size={11} /> 关联章节
        </span>
        <span style={{ marginLeft: 'auto', fontWeight: 400 }}>{chapters.length} 个</span>
      </div>
      {chapters.length === 0 ? (
        <div style={{ padding: '8px 6px', fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          该节点还没有关联章节。可在右侧详情区添加。
        </div>
      ) : (
        <>
          <div className="hover-list">
            {chapters.map((c) => (
              <div key={c.id} className="hover-chapter" onClick={() => onOpenChapter(c.id)} title={`${c.stageName ?? ''} ${c.name}`}>
                <span className="idx">{String(c.order).padStart(2, '0')}</span>
                <span className="nm">{c.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{c.wordCount} 字</span>
              </div>
            ))}
          </div>
          <div
            style={{
              borderTop: '1px solid var(--border)',
              marginTop: 4,
              paddingTop: 5,
              fontSize: 10.5,
              color: 'var(--text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              paddingLeft: 5,
            }}
          >
            <BookOpen size={10} /> 点击章节进入大纲-正文联动编辑
            <ExternalLink size={9} style={{ marginLeft: 'auto' }} />
          </div>
        </>
      )}
    </div>
  );
}
