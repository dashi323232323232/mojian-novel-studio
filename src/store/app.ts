import { create } from 'zustand';
import type { Project } from '@shared/types';
import { api } from '../lib/api';

export type ViewKind = 'welcome' | 'content' | 'editor' | 'outline' | 'link' | 'audio' | 'foreshadow' | 'agent' | 'settings';

export interface NavState {
  view: ViewKind;
  projectId: string | null;
  chapterId: string | null;
  /** 联动工作区当前聚焦的大纲节点 */
  nodeId: string | null;
}

interface AppStore {
  projects: Project[];
  loadingProjects: boolean;
  projectsError: string | null;
  expanded: Record<string, boolean>;
  active: NavState;
  structureVersion: number;

  loadProjects: () => Promise<void>;
  setProjects: (projects: Project[]) => void;
  toggleExpanded: (projectId: string) => void;
  setExpanded: (projectId: string, value: boolean) => void;
  navigate: (next: Partial<NavState> & { view: ViewKind }) => void;
  bumpStructure: () => void;
}

const STORAGE_KEY = 'mojian.ui.nav.v1';

function loadExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    /* ignore */
  }
  return {};
}

function saveExpanded(expanded: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
  } catch {
    /* ignore */
  }
}

export const useAppStore = create<AppStore>((set, get) => ({
  projects: [],
  loadingProjects: true,
  projectsError: null,
  expanded: loadExpanded(),
  active: { view: 'welcome', projectId: null, chapterId: null, nodeId: null },
  structureVersion: 0,

  loadProjects: async () => {
    set({ loadingProjects: true, projectsError: null });
    try {
      const projects = await api.listProjects();
      set({ projects, loadingProjects: false });
      const activeProjectId = get().active.projectId;
      if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
        set({ active: { view: 'welcome', projectId: null, chapterId: null, nodeId: null } });
      }
    } catch (err) {
      set({
        loadingProjects: false,
        projectsError: err instanceof Error ? err.message : '加载项目失败',
      });
    }
  },
  setProjects: (projects) => set({ projects }),
  toggleExpanded: (projectId) => {
    const expanded = { ...get().expanded, [projectId]: !get().expanded[projectId] };
    saveExpanded(expanded);
    set({ expanded });
  },
  setExpanded: (projectId, value) => {
    const expanded = { ...get().expanded, [projectId]: value };
    saveExpanded(expanded);
    set({ expanded });
  },
  navigate: (next) => {
    const active = { ...get().active, ...next };
    set({ active });
    if (active.projectId) {
      const expanded = { ...get().expanded, [active.projectId]: true };
      saveExpanded(expanded);
      set({ expanded });
    }
  },
  bumpStructure: () => set({ structureVersion: get().structureVersion + 1 }),
}));
