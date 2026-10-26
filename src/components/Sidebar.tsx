import { useEffect, useState } from 'react';
import { Plus, ChevronDown, ChevronRight, MoreHorizontal, LayoutList, PenLine, AudioLines, Pencil, Trash2, Bot, Settings, BookOpen, Sparkles } from 'lucide-react';
import { useAppStore } from '../store/app';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { Modal, ConfirmDialog } from './Modal';
import { confirmLeave } from '../lib/leaveGuard';
import { DropdownMenu } from './ui';

const COLOR_CHOICES = ['#5b6cff', '#0f8a6a', '#b25e09', '#a33b6b', '#2563eb', '#6d5bd0', '#c2410c', '#0e7490'];

export function Sidebar() {
  const projects = useAppStore((s) => s.projects);
  const loading = useAppStore((s) => s.loadingProjects);
  const error = useAppStore((s) => s.projectsError);
  const active = useAppStore((s) => s.active);
  const expanded = useAppStore((s) => s.expanded);
  const toggleExpanded = useAppStore((s) => s.toggleExpanded);
  const navigate = useAppStore((s) => s.navigate);
  const loadProjects = useAppStore((s) => s.loadProjects);

  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string; chapters: number; words: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ version: string } | null>(null);

  useEffect(() => {
    void api.info().then((i) => setInfo({ version: i.appVersion })).catch(() => undefined);
  }, []);

  const createProject = async (name: string, description: string, genre: string) => {
    setBusy(true);
    try {
      const project = await api.createProject({ name, description, genre });
      await loadProjects();
      useAppStore.getState().setExpanded(project.id, true);
      navigate({ view: 'content', projectId: project.id, chapterId: null, nodeId: null });
      setCreateOpen(false);
      toast.success(`项目「${project.name}」已创建`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建项目失败');
    } finally {
      setBusy(false);
    }
  };

  const renameProject = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) {
      toast.error('项目名称不能为空');
      return;
    }
    setBusy(true);
    try {
      await api.updateProject(renaming.id, { name });
      await loadProjects();
      setRenaming(null);
      toast.success('项目名称已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setBusy(false);
    }
  };

  const deleteProject = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteProject(deleting.id, { confirm: true, confirmName: deleting.name });
      await loadProjects();
      if (active.projectId === deleting.id) {
        navigate({ view: 'welcome', projectId: null, chapterId: null, nodeId: null });
      }
      setDeleting(null);
      toast.success('项目已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除项目失败');
    } finally {
      setBusy(false);
    }
  };

  const openProject = async (id: string, view: 'content' | 'outline' | 'audio') => {
    const canLeave = await confirmLeave();
    if (!canLeave) return;
    try {
      await api.openProject(id);
      navigate({ view, projectId: id, chapterId: null, nodeId: null });
      void loadProjects();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开项目失败');
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <div className="brand-mark">墨</div>
          <div>
            <div className="brand-name">墨笺小说工作台</div>
            <div className="brand-sub">Novel Studio</div>
          </div>
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          创建项目
        </button>
      </div>

      <div className="sidebar-section-label">
        <span>我的项目</span>
        <span style={{ fontWeight: 400 }}>{projects.length}</span>
      </div>

      <div className="project-list">
        {loading ? (
          <div style={{ padding: '14px 10px', fontSize: 12.5, color: 'var(--text-tertiary)' }}>正在加载项目…</div>
        ) : error ? (
          <div style={{ padding: '14px 10px', fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>
        ) : projects.length === 0 ? (
          <div style={{ padding: '18px 10px', fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
            还没有项目。点击上方「创建项目」开始你的第一部长篇小说。
          </div>
        ) : (
          projects.map((project) => {
            const isExpanded = expanded[project.id] ?? false;
            const isActive = active.projectId === project.id;
            return (
              <div className="project-item" key={project.id}>
                <div
                  className={`project-row${isActive ? ' active' : ''}`}
                  onClick={() => {
                    if (!isExpanded) toggleExpanded(project.id);
                    void openProject(project.id, 'content');
                  }}
                  title={project.name}
                >
                  <span
                    className="project-caret"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(project.id);
                    }}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <span className="project-dot" style={{ background: project.coverColor }} />
                  <span className="project-name">{project.name}</span>
                  <span className="project-more">
                    <DropdownMenu
                      label="项目操作"
                      align="right"
                      items={[
                        {
                          key: 'rename',
                          label: '重命名项目',
                          icon: <Pencil size={14} />,
                          onClick: () => setRenaming({ id: project.id, name: project.name }),
                        },
                        {
                          key: 'outline',
                          label: '打开大纲',
                          icon: <LayoutList size={14} />,
                          onClick: () => void openProject(project.id, 'outline'),
                        },
                        {
                          key: 'audio',
                          label: '音频制作',
                          icon: <AudioLines size={14} />,
                          onClick: () => void openProject(project.id, 'audio'),
                        },
                        'sep',
                        {
                          key: 'delete',
                          label: '删除项目',
                          icon: <Trash2 size={14} />,
                          danger: true,
                          onClick: () =>
                            setDeleting({
                              id: project.id,
                              name: project.name,
                              chapters: project.chapterCount,
                              words: project.wordCount,
                            }),
                        },
                      ]}
                    >
                      <MoreHorizontal size={15} />
                    </DropdownMenu>
                  </span>
                </div>
                {isExpanded ? (
                  <div className="project-children">
                    <button
                      className={`nav-child${isActive && active.view !== 'outline' && active.view !== 'audio' && active.view !== 'agent' && active.view !== 'foreshadow' ? ' active' : ''}`}
                      onClick={() => void openProject(project.id, 'content')}
                    >
                      <BookOpen size={15} />
                      内容
                      <span className="count">{project.chapterCount}</span>
                    </button>
                    <button
                      className={`nav-child${isActive && (active.view === 'outline' || active.view === 'link') ? ' active' : ''}`}
                      onClick={() => void openProject(project.id, 'outline')}
                    >
                      <LayoutList size={15} />
                      大纲
                    </button>
                    <button
                      className={`nav-child${isActive && active.view === 'audio' ? ' active' : ''}`}
                      onClick={() => void openProject(project.id, 'audio')}
                    >
                      <AudioLines size={15} />
                      音频制作
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="sidebar-bottom">
        <button
          className={`sidebar-bottom-item${active.view === 'agent' ? ' active' : ''}`}
          onClick={async () => {
            if (await confirmLeave()) navigate({ view: 'agent' });
          }}
        >
          <Bot size={16} />
          Agent 接入
        </button>
        <button
          className={`sidebar-bottom-item${active.view === 'settings' ? ' active' : ''}`}
          onClick={async () => {
            if (await confirmLeave()) navigate({ view: 'settings' });
          }}
        >
          <Settings size={16} />
          设置与备份
        </button>
        <div className="sidebar-footer">
          <span>v{info?.version ?? '1.0.0'}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={11} />
            本地优先
          </span>
        </div>
      </div>

      <CreateProjectModal
        open={createOpen}
        busy={busy}
        onClose={() => setCreateOpen(false)}
        onSubmit={createProject}
      />

      <Modal
        open={Boolean(renaming)}
        title="重命名项目"
        onClose={() => setRenaming(null)}
        footer={
          <>
            <button className="btn" onClick={() => setRenaming(null)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void renameProject()} disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              保存
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label">项目名称</label>
          <input
            className="input"
            value={renaming?.name ?? ''}
            maxLength={120}
            onChange={(e) => setRenaming(renaming ? { ...renaming, name: e.target.value } : null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void renameProject();
            }}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除项目"
        confirmText="永久删除"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void deleteProject()}
        message={
          <>
            即将删除项目「<b>{deleting?.name}</b>」，包括 {deleting?.chapters ?? 0} 个章节、
            {deleting?.words ?? 0} 字正文、全部大纲、伏笔与音频记录。
            <br />
            该操作不可撤销，请确认。
          </>
        }
      >
        <div className="danger-note">删除后数据无法恢复。如需保留，请先在「设置与备份」中创建备份。</div>
      </ConfirmDialog>
    </aside>
  );
}

function CreateProjectModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string, genre: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [color, setColor] = useState(COLOR_CHOICES[0]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setGenre('');
      setColor(COLOR_CHOICES[Math.floor(Math.random() * COLOR_CHOICES.length)]);
      setError('');
    }
  }, [open]);

  const submit = () => {
    if (!name.trim()) {
      setError('请填写项目名称');
      return;
    }
    onSubmit(name.trim(), description.trim(), genre.trim());
  };

  return (
    <Modal
      open={open}
      title="创建小说项目"
      subtitle="项目之间数据完全隔离，可随时重命名或删除。"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : <Plus size={15} />}
            创建项目
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">
          项目名称 <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <input
          className="input"
          placeholder="例如：普法战争"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        {error ? <div className="field-hint" style={{ color: 'var(--danger)' }}>{error}</div> : null}
      </div>
      <div className="field">
        <label className="field-label">简介（可选）</label>
        <textarea
          className="textarea"
          rows={3}
          placeholder="一句话概括这个故事…"
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">题材（可选）</label>
        <input
          className="input"
          placeholder="历史 / 科幻 / 悬疑 / 言情…"
          value={genre}
          maxLength={60}
          onChange={(e) => setGenre(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">封面颜色</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {COLOR_CHOICES.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: c,
                border: color === c ? '2px solid #1c2330' : '1px solid rgba(0,0,0,0.08)',
                cursor: 'pointer',
                boxShadow: color === c ? '0 0 0 2px #fff inset' : undefined,
              }}
              aria-label={`选择颜色 ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="info-note" style={{ marginTop: 6 }}>
        创建后会自动生成「第一阶段」，可直接新建章节开始写作。
      </div>
    </Modal>
  );
}
