import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Link2,
  Trash2,
  Copy,
  Search,
  Plus,
  Unlink,
  X,
  Check,
  Lightbulb,
  Save,
} from 'lucide-react';
import type {
  EdgeRelation,
  Foreshadow,
  NodeType,
  OutlineEdge,
  OutlineNode,
  OutlineSnapshot,
  ProjectStructure,
} from '@shared/types';
import { EDGE_RELATION_META, NODE_TYPE_META, FORESHADOW_STATUS_META } from '@shared/constants';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';

interface Props {
  projectId: string;
  snapshot: OutlineSnapshot;
  structure: ProjectStructure;
  foreshadows: Foreshadow[];
  selectedNodeId: string | null;
  onSnapshotChange: (next: OutlineSnapshot) => void;
  onSelectNode: (id: string | null) => void;
  onDeleteNode: (node: OutlineNode) => void;
  onOpenChapter?: (chapterId: string, nodeId: string) => void;
  onEnterLinkMode?: (nodeId: string) => void;
  focusChapterId?: string | null;
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string | null) => void;
}

const FIELD_BY_TYPE: Record<NodeType, Array<{ key: string; label: string; placeholder?: string; multiline?: boolean }>> = {
  stage: [
    { key: 'goal', label: '阶段目标', placeholder: '这一阶段要完成什么…', multiline: true },
    { key: 'notes', label: '相关备注', placeholder: '补充说明', multiline: true },
  ],
  event: [
    { key: 'time', label: '时间', placeholder: '例如：1870 年 9 月' },
    { key: 'location', label: '地点', placeholder: '例如：色当' },
    { key: 'notes', label: '相关备注', placeholder: '补充说明', multiline: true },
  ],
  character: [
    { key: 'role', label: '身份', placeholder: '例如：法兰西第二帝国皇帝' },
    { key: 'age', label: '年龄', placeholder: '例如：62' },
    { key: 'appearance', label: '外貌', placeholder: '外貌特征', multiline: true },
    { key: 'personality', label: '性格', placeholder: '性格特征', multiline: true },
    { key: 'notes', label: '相关备注', placeholder: '补充说明', multiline: true },
  ],
  foreshadow: [
    { key: 'notes', label: '相关备注', placeholder: '伏笔的埋设与回收说明', multiline: true },
  ],
  note: [{ key: 'notes', label: '相关备注', placeholder: '自由文本', multiline: true }],
};

export function NodeDetails({
  projectId,
  snapshot,
  structure,
  foreshadows,
  selectedNodeId,
  onSnapshotChange,
  onSelectNode,
  onDeleteNode,
  onOpenChapter,
  onEnterLinkMode,
  focusChapterId,
  selectedEdgeId,
  onSelectEdge,
}: Props) {
  const node = snapshot.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [type, setType] = useState<NodeType>('event');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [chapterQuery, setChapterQuery] = useState('');
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [edgeLabel, setEdgeLabel] = useState('');
  const [edgeDesc, setEdgeDesc] = useState('');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!node) return;
    setTitle(node.title);
    setDescription(node.description);
    setData({ ...(node.data ?? {}) });
    setType(node.type);
    setDirty(false);
    setChapterPickerOpen(false);
    setChapterQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  const relatedEdges = useMemo(() => {
    if (!node) return [];
    return snapshot.edges.filter((e) => e.sourceId === node.id || e.targetId === node.id);
  }, [snapshot.edges, node]);

  const selectedEdge: OutlineEdge | null = useMemo(() => {
    if (!selectedEdgeId) return null;
    return snapshot.edges.find((e) => e.id === selectedEdgeId) ?? null;
  }, [snapshot.edges, selectedEdgeId]);

  useEffect(() => {
    if (selectedEdge) {
      setEdgeLabel(selectedEdge.label);
      setEdgeDesc(selectedEdge.description);
    }
  }, [selectedEdge?.id, selectedEdge]);

  const linkedChapters = useMemo(() => {
    if (!node) return [];
    const ids = snapshot.links.filter((l) => l.nodeId === node.id).map((l) => l.chapterId);
    const list = structure.chapters.filter((c) => ids.includes(c.id));
    return list.map((c) => ({
      ...c,
      stageName: structure.stages.find((s) => s.id === c.stageId)?.name ?? null,
    }));
  }, [snapshot.links, structure, node]);

  const characters = useMemo(() => snapshot.nodes.filter((n) => n.type === 'character'), [snapshot.nodes]);

  const linkedForeshadow = useMemo(() => {
    if (!node) return null;
    return foreshadows.find((f) => f.id === node.data?.foreshadowId) ?? null;
  }, [foreshadows, node]);

  const persist = async (patch: {
    title?: string;
    description?: string;
    data?: Record<string, unknown>;
    type?: NodeType;
  }) => {
    if (!node) return;
    setSaving(true);
    try {
      const updated = await api.updateNode(node.id, patch);
      onSnapshotChange({
        ...snapshot,
        nodes: snapshot.nodes.map((n) => (n.id === updated.id ? updated : n)),
      });
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存节点失败');
    } finally {
      setSaving(false);
    }
  };

  const scheduleSave = (next: { title?: string; description?: string; data?: Record<string, unknown> }) => {
    setDirty(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(next);
    }, 700);
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const flush = async () => {
    if (!node) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    await persist({ title, description, data });
  };

  const linkChapter = async (chapterId: string) => {
    if (!node) return;
    try {
      await api.createLink(projectId, node.id, chapterId);
      onSnapshotChange({
        ...snapshot,
        links: [...snapshot.links, { nodeId: node.id, chapterId, createdAt: new Date().toISOString() }],
      });
      toast.success('已关联章节');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '关联章节失败');
    }
  };

  const unlinkChapter = async (chapterId: string) => {
    if (!node) return;
    try {
      await api.deleteLink(projectId, node.id, chapterId);
      onSnapshotChange({
        ...snapshot,
        links: snapshot.links.filter((l) => !(l.nodeId === node.id && l.chapterId === chapterId)),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消关联失败');
    }
  };

  const updateEdge = async (patch: { relation?: EdgeRelation; label?: string; description?: string }) => {
    if (!selectedEdge) return;
    try {
      const updated = await api.updateEdge(selectedEdge.id, patch);
      onSnapshotChange({
        ...snapshot,
        edges: snapshot.edges.map((e) => (e.id === updated.id ? updated : e)),
      });
      toast.success('连线已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新连线失败');
    }
  };

  const deleteEdge = async () => {
    if (!selectedEdge) return;
    try {
      await api.deleteEdge(selectedEdge.id);
      onSnapshotChange({ ...snapshot, edges: snapshot.edges.filter((e) => e.id !== selectedEdge.id) });
      onSelectEdge(null);
      toast.success('连线已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除连线失败');
    }
  };

  const duplicate = async () => {
    if (!node) return;
    try {
      const copy = await api.duplicateNode(node.id);
      onSnapshotChange({ ...snapshot, nodes: [...snapshot.nodes, copy] });
      onSelectNode(copy.id);
      toast.success('节点已复制');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制节点失败');
    }
  };

  const filteredChapters = useMemo(() => {
    const q = chapterQuery.trim().toLowerCase();
    const linked = new Set(linkedChapters.map((c) => c.id));
    return structure.chapters
      .filter((c) => !linked.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [structure.chapters, chapterQuery, linkedChapters]);

  const focusChapter = useMemo(() => {
    if (!focusChapterId) return null;
    return structure.chapters.find((c) => c.id === focusChapterId) ?? null;
  }, [focusChapterId, structure.chapters]);

  if (selectedEdge) {
    return (
      <aside className="outline-details">
        <div className="outline-details-head">
          <span className="badge" style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
            连线
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>编辑关系</span>
          <button className="icon-btn" onClick={() => onSelectEdge(null)} title="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="outline-details-body">
          <div className="detail-section">
            <div className="detail-section-title">关系类型</div>
            <select
              className="select"
              value={selectedEdge.relation}
              onChange={(e) => void updateEdge({ relation: e.target.value as EdgeRelation })}
            >
              {Object.entries(EDGE_RELATION_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label} —— {meta.description}
                </option>
              ))}
            </select>
            <div className="field-hint" style={{ marginTop: 6 }}>
              不同的关系类型会以不同颜色和虚实线展示，避免剧情关系混为一谈。
            </div>
          </div>
          <div className="detail-section">
            <div className="detail-section-title">关系说明</div>
            <input
              className="input"
              value={edgeLabel}
              placeholder="例如：导致、之后、同时发生"
              maxLength={120}
              onChange={(e) => setEdgeLabel(e.target.value)}
              onBlur={() => edgeLabel !== selectedEdge.label && void updateEdge({ label: edgeLabel })}
            />
            <textarea
              className="textarea"
              style={{ marginTop: 8, minHeight: 70 }}
              value={edgeDesc}
              placeholder="更详细的关系说明…"
              onChange={(e) => setEdgeDesc(e.target.value)}
              onBlur={() => edgeDesc !== selectedEdge.description && void updateEdge({ description: edgeDesc })}
            />
          </div>
          <div className="detail-section">
            <div className="detail-section-title">连接</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              {snapshot.nodes.find((n) => n.id === selectedEdge.sourceId)?.title ?? '（已删除）'}
              <span style={{ color: 'var(--text-tertiary)' }}> → </span>
              {snapshot.nodes.find((n) => n.id === selectedEdge.targetId)?.title ?? '（已删除）'}
            </div>
          </div>
          <button className="btn btn-soft-danger" style={{ width: '100%' }} onClick={() => void deleteEdge()}>
            <Trash2 size={14} /> 删除连线
          </button>
        </div>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="outline-details">
        <div className="outline-details-head">
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>节点详情</span>
        </div>
        <div className="outline-details-body">
          <div className="empty-state" style={{ padding: '36px 12px' }}>
            <div className="icon-wrap">
              <Link2 size={20} />
            </div>
            <h3>未选择节点</h3>
            <p style={{ fontSize: 12 }}>
              在画布上点击一个节点查看和编辑详情。拖动左侧节点类型到画布可创建新节点，拖动节点右侧圆点到另一个节点可创建连线。
            </p>
          </div>
          {relatedEdgeCountHint(snapshot, focusChapter)}
        </div>
      </aside>
    );
  }

  const meta = NODE_TYPE_META[node.type];
  const fields = FIELD_BY_TYPE[node.type] ?? FIELD_BY_TYPE.note;

  return (
    <aside className="outline-details">
      <div className="outline-details-head">
        <span className="node-type-tag" style={{ background: meta.bg, color: meta.color }}>
          {meta.short}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flex: 1 }}>
          {saving ? '保存中…' : dirty ? '未保存' : '已保存'}
        </span>
        <button className="icon-btn" onClick={() => void duplicate()} title="复制节点">
          <Copy size={15} />
        </button>
        <button className="icon-btn" onClick={() => onDeleteNode(node)} title="删除节点">
          <Trash2 size={15} />
        </button>
      </div>
      <div className="outline-details-body">
        {focusChapter ? (
          <div className="info-note" style={{ marginBottom: 14, fontSize: 11.5 }}>
            联动中：正在编辑章节「{focusChapter.name}」，该章节与当前节点关联。
          </div>
        ) : null}

        <div className="field">
          <label className="field-label">节点名称</label>
          <input
            className="input"
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSave({ title: e.target.value, description, data });
            }}
            onBlur={() => void flush()}
          />
        </div>

        <div className="field">
          <label className="field-label">节点类型</label>
          <select
            className="select"
            value={type}
            onChange={(e) => {
              const next = e.target.value as NodeType;
              setType(next);
              void persist({ type: next });
            }}
          >
            {Object.entries(NODE_TYPE_META).map(([key, m]) => (
              <option key={key} value={key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label">剧情描述</label>
          <textarea
            className="textarea"
            style={{ minHeight: 90 }}
            value={description}
            placeholder="这一节点在故事中发生了什么…"
            onChange={(e) => {
              setDescription(e.target.value);
              scheduleSave({ title, description: e.target.value, data });
            }}
            onBlur={() => void flush()}
          />
        </div>

        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label className="field-label">{f.label}</label>
            {f.multiline ? (
              <textarea
                className="textarea"
                style={{ minHeight: 62 }}
                value={String(data[f.key] ?? '')}
                placeholder={f.placeholder}
                onChange={(e) => {
                  const next = { ...data, [f.key]: e.target.value };
                  setData(next);
                  scheduleSave({ title, description, data: next });
                }}
                onBlur={() => void flush()}
              />
            ) : (
              <input
                className="input"
                value={String(data[f.key] ?? '')}
                placeholder={f.placeholder}
                onChange={(e) => {
                  const next = { ...data, [f.key]: e.target.value };
                  setData(next);
                  scheduleSave({ title, description, data: next });
                }}
                onBlur={() => void flush()}
              />
            )}
          </div>
        ))}

        {node.type === 'character' ? (
          <div className="field">
            <label className="field-label">关联人物节点</label>
            <div className="chip-list">
              {characters
                .filter((c) => c.id !== node.id)
                .map((c) => (
                  <span key={c.id} className="chip">
                    {c.title}
                  </span>
                ))}
              {characters.length <= 1 ? <span className="field-hint">暂无其他人物节点</span> : null}
            </div>
          </div>
        ) : null}

        {node.type === 'foreshadow' && linkedForeshadow ? (
          <div className="detail-section">
            <div className="detail-section-title">
              <span>关联伏笔</span>
              <span
                className="badge"
                style={{
                  background: FORESHADOW_STATUS_META[linkedForeshadow.status].bg,
                  color: FORESHADOW_STATUS_META[linkedForeshadow.status].color,
                }}
              >
                {FORESHADOW_STATUS_META[linkedForeshadow.status].label}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              {linkedForeshadow.description || '（无描述）'}
            </div>
          </div>
        ) : null}

        <div className="detail-section">
          <div className="detail-section-title">
            <span>关联章节 · {linkedChapters.length}</span>
            <button className="icon-btn" title="添加关联章节" onClick={() => setChapterPickerOpen((v) => !v)}>
              <Plus size={14} />
            </button>
          </div>
          {chapterPickerOpen ? (
            <div style={{ marginBottom: 8 }}>
              <div className="search-box" style={{ width: '100%' }}>
                <Search size={13} />
                <input
                  className="input input-sm"
                  placeholder="搜索章节…"
                  value={chapterQuery}
                  onChange={(e) => setChapterQuery(e.target.value)}
                />
              </div>
              <div
                style={{
                  maxHeight: 180,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  marginTop: 5,
                  padding: 3,
                }}
              >
                {filteredChapters.length === 0 ? (
                  <div style={{ padding: 8, fontSize: 11.5, color: 'var(--text-tertiary)' }}>没有可添加的章节</div>
                ) : (
                  filteredChapters.map((c) => (
                    <div
                      key={c.id}
                      className="linked-chapter-row"
                      onClick={() => {
                        void linkChapter(c.id);
                        setChapterPickerOpen(false);
                        setChapterQuery('');
                      }}
                    >
                      <BookOpenIcon />
                      <span className="n">{c.name}</span>
                      <Plus size={12} style={{ color: 'var(--accent)' }} />
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
          {linkedChapters.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
              尚未关联章节。点击右上角「+」添加，一个节点可关联多个章节。
            </div>
          ) : (
            linkedChapters.map((c) => (
              <div key={c.id} className="linked-chapter-row">
                <BookOpenIcon />
                <span className="n" title={`${c.stageName ?? ''} ${c.name}`}>
                  {c.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{c.wordCount}字</span>
                <button className="icon-btn" title="打开联动编辑" onClick={() => onOpenChapter?.(c.id, node.id)}>
                  <Link2 size={12} />
                </button>
                <button className="icon-btn" title="取消关联" onClick={() => void unlinkChapter(c.id)}>
                  <Unlink size={12} />
                </button>
              </div>
            ))
          )}
          {onEnterLinkMode && linkedChapters.length > 0 ? (
            <button
              className="btn btn-sm"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => onEnterLinkMode(node.id)}
            >
              <Link2 size={13} /> 进入大纲-正文联动工作区
            </button>
          ) : null}
        </div>

        <div className="detail-section">
          <div className="detail-section-title">
            <span>节点连线 · {relatedEdges.length}</span>
          </div>
          {relatedEdges.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
              尚未连线。拖动节点边缘圆点到另一个节点即可创建连线。
            </div>
          ) : (
            relatedEdges.map((e) => {
              const otherId = e.sourceId === node.id ? e.targetId : e.sourceId;
              const other = snapshot.nodes.find((n) => n.id === otherId);
              const metaE = EDGE_RELATION_META[e.relation];
              return (
                <div
                  key={e.id}
                  className="linked-chapter-row"
                  onClick={() => onSelectEdge(e.id)}
                  title="点击编辑连线"
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      background: metaE.color,
                      flex: '0 0 7px',
                    }}
                  />
                  <span style={{ fontSize: 10.5, color: metaE.color, fontWeight: 600, flex: '0 0 auto' }}>
                    {e.sourceId === node.id ? '→' : '←'} {metaE.label}
                  </span>
                  <span className="n">{other?.title ?? '（已删除）'}</span>
                </div>
              );
            })
          )}
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={() => void flush()}
          disabled={saving || !dirty}
        >
          <Save size={14} /> {saving ? '保存中…' : dirty ? '保存修改' : '已保存'}
        </button>
      </div>
    </aside>
  );
}

function BookOpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: '0 0 auto' }}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function relatedEdgeCountHint(snapshot: OutlineSnapshot, focusChapter: ProjectStructure['chapters'][number] | null) {
  if (!focusChapter) return null;
  const nodeIds = snapshot.links.filter((l) => l.chapterId === focusChapter.id).map((l) => l.nodeId);
  return (
    <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
      当前章节「{focusChapter.name}」关联 {nodeIds.length} 个节点。
    </div>
  );
}
