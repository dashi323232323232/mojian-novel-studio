import { memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { BookOpen, Flag, Lightbulb, User, StickyNote, Link2 } from 'lucide-react';
import { NODE_TYPE_META } from '@shared/constants';
import type { NodeType } from '@shared/types';

export interface OutlineNodePayload {
  title: string;
  description: string;
  nodeType: NodeType;
  chapterCount: number;
  foreshadowStatus?: string;
  [key: string]: unknown;
}

const ICONS: Record<NodeType, React.ReactNode> = {
  stage: <Flag size={11} />,
  event: <BookOpen size={11} />,
  character: <User size={11} />,
  foreshadow: <Lightbulb size={11} />,
  note: <StickyNote size={11} />,
};

export const OutlineNodeCard = memo(function OutlineNodeCard({ data, selected }: NodeProps) {
  const d = data as unknown as OutlineNodePayload;
  const meta = NODE_TYPE_META[d.nodeType] ?? NODE_TYPE_META.note;
  return (
    <div
      className={`node-card${selected ? ' selected' : ''}`}
      style={{ borderColor: selected ? meta.color : meta.border, background: '#fff' }}
    >
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={140}
        minHeight={70}
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{ width: 7, height: 7, borderRadius: 2, border: '1px solid #fff', background: meta.color }}
      />
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8, background: meta.color, border: '2px solid #fff' }} />
      <div className="node-card-head">
        <span className="node-type-tag" style={{ background: meta.bg, color: meta.color }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {ICONS[d.nodeType]}
            {meta.short}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        {d.chapterCount > 0 ? (
          <span className="node-card-badge" title={`关联 ${d.chapterCount} 个章节`}>
            <Link2 size={9} />
            {d.chapterCount}
          </span>
        ) : null}
      </div>
      <div className="node-card-title" title={d.title}>
        {d.title}
      </div>
      {d.description ? <div className="node-card-desc">{d.description}</div> : null}
      {d.foreshadowStatus ? (
        <div className="node-card-foot">
          <span className="node-card-badge">{d.foreshadowStatus}</span>
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8, background: meta.color, border: '2px solid #fff' }} />
    </div>
  );
});
