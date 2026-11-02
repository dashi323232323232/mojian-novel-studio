import { useEffect, useMemo, useState } from 'react';
import {
  Lightbulb,
  Plus,
  Trash2,
  Search,
  Save,
  Link2,
  BookOpen,
  Flag,
  ExternalLink,
  X,
} from 'lucide-react';
import type {
  Foreshadow,
  ForeshadowInput,
  ForeshadowStatus,
  OutlineSnapshot,
  ProjectStructure,
} from '@shared/types';
import { FORESHADOW_STATUS_META, NODE_TYPE_META } from '@shared/constants';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { ConfirmDialog } from './Modal';

interface Props {
  projectId: string;
  structure: ProjectStructure;
  snapshot: OutlineSnapshot;
  foreshadows: Foreshadow[];
  reload: () => Promise<void>;
  onJumpToNode: (nodeId: string) => void;
  onJumpToChapter: (chapterId: string, nodeId: string | null) => void;
}

const EMPTY: ForeshadowInput = {
  name: '',
  description: '',
  status: 'planned',
  plantedChapterId: null,
  plannedResolveChapterId: null,
  plannedResolveStageId: null,
  nodeId: null,
  characterNodeIds: [],
  chapterIds: [],
  notes: '',
};

export function ForeshadowPanel({
  projectId,
  structure,
  snapshot,
  foreshadows,
  reload,
  onJumpToNode,
  onJumpToChapter,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(foreshadows[0]?.id ?? null);
  const [draft, setDraft] = useState<ForeshadowInput>(EMPTY);
  const [filter, setFilter] = useState<ForeshadowStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState<Foreshadow | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = foreshadows.find((f) => f.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected && foreshadows.length) {
      setSelectedId(foreshadows[0].id);
    }
  }, [foreshadows, selected]);

  useEffect(() => {
    if (!selected) {
      setDraft(EMPTY);
      setDirty(false);
      return;
    }
    setDraft({
      name: selected.name,
      description: selected.description,
      status: selected.status,
      plantedChapterId: selected.plantedChapterId,
      plannedResolveChapterId: selected.plannedResolveChapterId,
      plannedResolveStageId: selected.plannedResolveStageId,
      nodeId: selected.nodeId,
      characterNodeIds: selected.characterNodeIds,
      chapterIds: selected.chapterIds,
      notes: selected.notes,
    });
    setDirty(false);
  }, [selected?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return foreshadows.filter((f) => {
      if (filter !== 'all' && f.status !== filter) return false;
      if (q && !f.name.toLowerCase().includes(q) && !f.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [foreshadows, filter, query]);

  const update = <K extends keyof ForeshadowInput>(key: K, value: ForeshadowInput[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error('伏笔名称不能为空');
      return;
    }
    setSaving(true);
    try {
      if (selected) {
        await api.updateForeshadow(selected.id, draft);
        toast.success('伏笔已保存');
      } else {
        const created = await api.createForeshadow(projectId, draft);
        setSelectedId(created.id);
        toast.success('伏笔已创建');
        setCreating(false);
      }
      await reload();
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存伏笔失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await api.deleteForeshadow(deleting.id);
      await reload();
      setSelectedId(null);
      setDeleting(null);
      toast.success('伏笔已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const attachOutline = async () => {
    if (!selected) return;
    try {
      const { nodeId } = await api.attachForeshadowOutline(selected.id);
      await reload();
      toast.success('已同步为大纲节点');
      onJumpToNode(nodeId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败');
    }
  };

  const characterNodes = snapshot.nodes.filter((n) => n.type === 'character');
  const linkedNode = selected?.nodeId ? snapshot.nodes.find((n) => n.id === selected.nodeId) : null;

  return (
    <div className="foreshadow-page">
      <div className="foreshadow-list">
        <div className="foreshadow-list-head">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="search-box" style={{ flex: 1, width: 'auto' }}>
              <Search size={13} />
              <input
                className="input input-sm"
                placeholder="搜索伏笔…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                setSelectedId(null);
                setDraft({ ...EMPTY });
                setCreating(true);
                setDirty(false);
              }}
              title="新建伏笔"
            >
              <Plus size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              className={`btn btn-sm${filter === 'all' ? ' btn-primary' : ''}`}
              style={{ height: 24, padding: '0 8px', fontSize: 11 }}
              onClick={() => setFilter('all')}
            >
              全部 {foreshadows.length}
            </button>
            {Object.entries(FORESHADOW_STATUS_META).map(([key, meta]) => (
              <button
                key={key}
                className={`btn btn-sm${filter === key ? ' btn-primary' : ''}`}
                style={{ height: 24, padding: '0 8px', fontSize: 11 }}
                onClick={() => setFilter(key as ForeshadowStatus)}
              >
                {meta.label} {foreshadows.filter((f) => f.status === key).length}
              </button>
            ))}
          </div>
        </div>
        <div className="foreshadow-items">
          {filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 16px' }}>
              <div className="icon-wrap">
                <Lightbulb size={20} />
              </div>
              <h3>还没有伏笔</h3>
              <p style={{ fontSize: 12 }}>点击右上角「+」记录第一条伏笔，跟踪埋设与回收。</p>
            </div>
          ) : (
            filtered.map((f) => {
              const meta = FORESHADOW_STATUS_META[f.status];
              return (
                <div
                  key={f.id}
                  className={`foreshadow-card${f.id === selectedId ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedId(f.id);
                    setCreating(false);
                  }}
                >
                  <div className="name">
                    <span className="badge" style={{ background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  </div>
                  <div className="desc">{f.description || '（无描述）'}</div>
                  <div className="meta">
                    <span>{f.chapterIds.length} 个章节</span>
                    {f.nodeId ? <span>已关联大纲</span> : null}
                    <span>{new Date(f.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="foreshadow-detail">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 650 }}>
            {selected ? selected.name : creating ? '新建伏笔' : '伏笔详情'}
          </h2>
          {selected ? (
            <span
              className="badge"
              style={{
                background: FORESHADOW_STATUS_META[selected.status].bg,
                color: FORESHADOW_STATUS_META[selected.status].color,
              }}
            >
              {FORESHADOW_STATUS_META[selected.status].label}
            </span>
          ) : null}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {selected ? (
              <>
                <button className="btn btn-sm" onClick={() => void attachOutline()}>
                  <Link2 size={13} /> 同步到大纲
                </button>
                <button className="btn btn-sm btn-soft-danger" onClick={() => setDeleting(selected)}>
                  <Trash2 size={13} /> 删除
                </button>
              </>
            ) : null}
            <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving || (!dirty && !creating)}>
              {saving ? <span className="spinner" /> : <Save size={13} />}
              保存
            </button>
          </div>
        </div>

        {!selected && !creating ? (
          <div className="empty-state" style={{ padding: '60px 20px' }}>
            <div className="icon-wrap">
              <Lightbulb size={22} />
            </div>
            <h3>伏笔是长篇小说的骨架</h3>
            <p>
              在左侧选择一条伏笔查看详情，或点击「+」新建。伏笔会记录埋设章节、预计回收章节、关联人物与大纲节点。
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setDraft({ ...EMPTY });
                setCreating(true);
              }}
            >
              <Plus size={14} /> 新建伏笔
            </button>
          </div>
        ) : (
          <>
            <div className="detail-grid">
              <div className="field full">
                <label className="field-label">名称</label>
                <input
                  className="input"
                  value={draft.name}
                  placeholder="例如：染血的军旗"
                  onChange={(e) => update('name', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">状态</label>
                <select
                  className="select"
                  value={draft.status}
                  onChange={(e) => update('status', e.target.value as ForeshadowStatus)}
                >
                  {Object.entries(FORESHADOW_STATUS_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">埋设章节</label>
                <select
                  className="select"
                  value={draft.plantedChapterId ?? ''}
                  onChange={(e) => update('plantedChapterId', e.target.value || null)}
                >
                  <option value="">未指定</option>
                  {structure.chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">预计回收章节</label>
                <select
                  className="select"
                  value={draft.plannedResolveChapterId ?? ''}
                  onChange={(e) => update('plannedResolveChapterId', e.target.value || null)}
                >
                  <option value="">未指定</option>
                  {structure.chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">预计回收阶段</label>
                <select
                  className="select"
                  value={draft.plannedResolveStageId ?? ''}
                  onChange={(e) => update('plannedResolveStageId', e.target.value || null)}
                >
                  <option value="">未指定</option>
                  {structure.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field full">
                <label className="field-label">描述</label>
                <textarea
                  className="textarea"
                  rows={3}
                  value={draft.description ?? ''}
                  placeholder="这条伏笔是什么？读者需要记住什么？"
                  onChange={(e) => update('description', e.target.value)}
                />
              </div>
              <div className="field full">
                <label className="field-label">关联大纲节点</label>
                <select
                  className="select"
                  value={draft.nodeId ?? ''}
                  onChange={(e) => update('nodeId', e.target.value || null)}
                >
                  <option value="">未关联</option>
                  {snapshot.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      [{NODE_TYPE_META[n.type].short}] {n.title}
                    </option>
                  ))}
                </select>
                {linkedNode ? (
                  <button
                    className="btn btn-sm"
                    style={{ alignSelf: 'flex-start', marginTop: 6 }}
                    onClick={() => onJumpToNode(linkedNode.id)}
                  >
                    <ExternalLink size={12} /> 在画布中查看
                  </button>
                ) : null}
              </div>
              <div className="field full">
                <label className="field-label">关联人物（大纲人物节点）</label>
                <div className="chip-list">
                  {characterNodes.length === 0 ? (
                    <span className="field-hint">还没有人物节点，可在大纲中创建。</span>
                  ) : (
                    characterNodes.map((n) => {
                      const active = (draft.characterNodeIds ?? []).includes(n.id);
                      return (
                        <button
                          key={n.id}
                          className="chip"
                          style={
                            active
                              ? { borderColor: 'var(--accent-border)', background: 'var(--accent-soft)', color: 'var(--accent)' }
                              : undefined
                          }
                          onClick={() => {
                            const cur = draft.characterNodeIds ?? [];
                            update(
                              'characterNodeIds',
                              active ? cur.filter((id) => id !== n.id) : [...cur, n.id],
                            );
                          }}
                        >
                          {active ? <X size={10} /> : <Plus size={10} />}
                          {n.title}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="field full">
                <label className="field-label">关联章节（可多选）</label>
                <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 7, padding: 5 }}>
                  {structure.chapters.length === 0 ? (
                    <div style={{ padding: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>项目还没有章节</div>
                  ) : (
                    structure.chapters.map((c) => {
                      const checked = (draft.chapterIds ?? []).includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className="checkbox-row"
                          style={{ padding: '4px 6px', borderRadius: 5, cursor: 'pointer', fontSize: 12.5 }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const cur = draft.chapterIds ?? [];
                              update('chapterIds', checked ? cur.filter((id) => id !== c.id) : [...cur, c.id]);
                            }}
                          />
                          <span>{c.name}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                            {c.wordCount} 字
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="field full">
                <label className="field-label">备注</label>
                <textarea
                  className="textarea"
                  rows={3}
                  value={draft.notes ?? ''}
                  placeholder="写作提醒、回收方式等…"
                  onChange={(e) => update('notes', e.target.value)}
                />
              </div>
            </div>

            {selected && selected.chapterIds.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <div className="detail-section-title">快速跳转</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.chapterIds.map((id) => {
                    const c = structure.chapters.find((x) => x.id === id);
                    if (!c) return null;
                    return (
                      <button
                        key={id}
                        className="btn btn-sm"
                        onClick={() => onJumpToChapter(id, selected.nodeId)}
                      >
                        <BookOpen size={12} /> {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除伏笔"
        confirmText="删除伏笔"
        busy={saving}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
        message={
          <>
            即将删除伏笔「<b>{deleting?.name}</b>」。该操作不可恢复，关联的大纲节点不会自动删除。
          </>
        }
      />
    </div>
  );
}
