import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Foreshadow,
  OutlineSnapshot,
  Project,
  ProjectStructure,
} from '@shared/types';
import { useAppStore } from './store/app';
import { api } from './lib/api';
import { toast } from './lib/toast';
import { confirmLeave } from './lib/leaveGuard';
import { Sidebar } from './components/Sidebar';
import { ToastHost } from './components/ui';
import { WelcomePage } from './pages/WelcomePage';
import { ContentPage } from './pages/ContentPage';
import { EditorPage } from './pages/EditorPage';
import { OutlinePage } from './pages/OutlinePage';
import { AudioPage } from './pages/AudioPage';
import { AgentPage } from './pages/AgentPage';
import { SettingsPage } from './pages/SettingsPage';
import { Spinner } from './components/ui';

export default function App() {
  const active = useAppStore((s) => s.active);
  const projects = useAppStore((s) => s.projects);
  const loadProjects = useAppStore((s) => s.loadProjects);
  const navigate = useAppStore((s) => s.navigate);

  const [structure, setStructure] = useState<ProjectStructure | null>(null);
  const [snapshot, setSnapshot] = useState<OutlineSnapshot | null>(null);
  const [foreshadows, setForeshadows] = useState<Foreshadow[]>([]);
  const [loadingProject, setLoadingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<{ nodeId: string; chapterId: string } | null>(null);
  const activeProjectId = active.projectId;

  // 初始化项目列表
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // 加载项目数据（结构 + 大纲 + 伏笔）
  const loadProjectData = useCallback(async (projectId: string) => {
    setLoadingProject(true);
    setProjectError(null);
    try {
      const [structureData, snapshotData, fs] = await Promise.all([
        api.projectStructure(projectId),
        api.outlineSnapshot(projectId),
        api.listForeshadows(projectId),
      ]);
      setStructure(structureData);
      setSnapshot(snapshotData);
      setForeshadows(fs);
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : '加载项目失败');
    } finally {
      setLoadingProject(false);
    }
  }, []);

  useEffect(() => {
    if (!activeProjectId) {
      setStructure(null);
      setSnapshot(null);
      setForeshadows([]);
      return;
    }
    // 切换项目时立即清空旧项目数据，避免短暂显示到另一个项目
    setStructure(null);
    setSnapshot(null);
    setForeshadows([]);
    setProjectError(null);
    setLinkState(null);
    void loadProjectData(activeProjectId);
  }, [activeProjectId, loadProjectData]);

  // 监听主进程数据变更：Agent 或其它窗口修改后同步刷新
  useEffect(() => {
    const off = window.dashi?.events?.onDataChanged((raw) => {
      const event = raw as { scope?: string; projectId?: string; source?: string };
      if (!event?.projectId || event.projectId !== activeProjectId) {
        if (event?.scope === 'projects') void loadProjects();
        return;
      }
      if (event.scope === 'projects') {
        void loadProjects();
        return;
      }
      void refreshProjectQuietly(event.projectId);
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, loadProjects]);

  const refreshProjectQuietly = useCallback(
    async (projectId: string) => {
      try {
        const [structureData, snapshotData, fs] = await Promise.all([
          api.projectStructure(projectId),
          api.outlineSnapshot(projectId),
          api.listForeshadows(projectId),
        ]);
        setStructure(structureData);
        setSnapshot(snapshotData);
        setForeshadows(fs);
      } catch {
        /* 静默刷新失败不打扰用户 */
      }
    },
    [],
  );

  const reloadStructure = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const structureData = await api.projectStructure(activeProjectId);
      setStructure(structureData);
      void loadProjects();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '刷新章节结构失败');
    }
  }, [activeProjectId, loadProjects]);

  const reloadForeshadows = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      setForeshadows(await api.listForeshadows(activeProjectId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '刷新伏笔失败');
    }
  }, [activeProjectId]);

  const reloadSnapshot = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      setSnapshot(await api.outlineSnapshot(activeProjectId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '刷新大纲失败');
    }
  }, [activeProjectId]);

  // 导航保护：有未保存内容时先询问
  const safeNavigate = useCallback(
    async (next: Parameters<typeof navigate>[0]) => {
      const ok = await confirmLeave();
      if (!ok) return;
      if (next.view !== 'link') setLinkState(null);
      navigate(next);
    },
    [navigate],
  );

  // 主进程请求关闭窗口
  useEffect(() => {
    const off = window.dashi?.app?.onRequestClose(async () => {
      const ok = await confirmLeave();
      if (ok) {
        window.dashi.app.setDirty(false);
        window.dashi.app.closeConfirmed();
      }
    });
    return () => off?.();
  }, []);

  // 菜单动作
  useEffect(() => {
    const off = window.dashi?.app?.onMenuAction((action) => {
      if (action === 'new-project') {
        document.querySelector<HTMLButtonElement>('.sidebar .btn-primary')?.click();
      } else if (action === 'save-chapter') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      } else if (action === 'open-agent') {
        void safeNavigate({ view: 'agent' });
      }
    });
    return () => off?.();
  }, [safeNavigate]);

  const project: Project | undefined = projects.find((p) => p.id === activeProjectId);

  const enterLink = useCallback(
    async (nodeId: string, chapterId: string) => {
      const ok = await confirmLeave();
      if (!ok) return;
      setLinkState({ nodeId, chapterId });
      navigate({ view: 'link', projectId: activeProjectId, chapterId, nodeId });
    },
    [navigate, activeProjectId],
  );

  const openChapter = useCallback(
    async (chapterId: string) => {
      const ok = await confirmLeave();
      if (!ok) return;
      navigate({ view: 'editor', chapterId });
    },
    [navigate],
  );

  let content: React.ReactNode;
  if (active.view === 'agent') {
    content = <AgentPage />;
  } else if (active.view === 'settings') {
    content = <SettingsPage />;
  } else if (!activeProjectId) {
    content = <WelcomePage />;
  } else if (loadingProject && !structure) {
    content = (
      <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-tertiary)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Spinner large /> 正在加载项目…
        </div>
      </div>
    );
  } else if (projectError) {
    content = (
      <div className="page">
        <div className="empty-state" style={{ padding: 60 }}>
          <h3>项目加载失败</h3>
          <p>{projectError}</p>
          <button className="btn" onClick={() => void loadProjectData(activeProjectId)}>
            重试
          </button>
        </div>
      </div>
    );
  } else if (!structure || !snapshot || !project) {
    content = <WelcomePage />;
  } else if (active.view === 'editor') {
    content = <EditorPage structure={structure} />;
  } else if (active.view === 'outline' || active.view === 'link') {
    content = (
      <OutlinePage
        projectId={project.id}
        structure={structure}
        snapshot={snapshot}
        setSnapshot={setSnapshot}
        foreshadows={foreshadows}
        reloadForeshadows={reloadForeshadows}
        reloadSnapshot={reloadSnapshot}
        enterLink={(nodeId, chapterId) => void enterLink(nodeId, chapterId)}
        linkState={active.view === 'link' ? linkState ?? { nodeId: active.nodeId ?? '', chapterId: active.chapterId ?? '' } : null}
        exitLink={() => {
          setLinkState(null);
          navigate({ view: 'outline', nodeId: null });
        }}
        onChapterUpdated={() => void reloadStructure()}
      />
    );
  } else if (active.view === 'audio') {
    content = <AudioPage projectId={project.id} structure={structure} />;
  } else {
    content = (
      <ContentPage
        project={project}
        structure={structure}
        reload={reloadStructure}
        onOpenChapter={(chapterId) => void openChapter(chapterId)}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">{content}</main>
      <ToastHost />
    </div>
  );
}
