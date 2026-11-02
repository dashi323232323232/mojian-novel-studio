import { getApi, unwrap } from './bridge';
import type {
  AudioJobWithFile,
  AudioProviderConfigPublic,
  BackupInfo,
  Chapter,
  ChapterContent,
  ChapterSaveResult,
  ChapterVersion,
  ChapterVersionsPayload,
  CreateAudioJobInput,
  DeleteProjectOptions,
  DeleteStageOptions,
  Foreshadow,
  ForeshadowInput,
  ForeshadowPatch,
  NodeChapterLink,
  OutlineEdge,
  OutlineEdgeInput,
  OutlineEdgePatch,
  OutlineNode,
  OutlineNodeInput,
  OutlineNodePatch,
  OutlineSnapshot,
  Project,
  ProjectStructure,
  ProjectUiSettings,
  ReadingProgress,
  SearchHit,
  Stage,
  UiSettings,
  Voice,
} from '@shared/types';

export const api = {
  info: () => unwrap(getApi().app.info()),
  stats: () => unwrap(getApi().app.stats()),
  openDataDir: () => unwrap(getApi().app.openDataDir()),
  openPath: (path: string) => unwrap(getApi().app.openPath(path)),
  showItemInFolder: (path: string) => unwrap(getApi().app.showItemInFolder(path)),
  dataLocation: () => unwrap(getApi().app.dataLocation()),
  chooseDataDir: (mode?: 'move' | 'switch') => unwrap(getApi().app.chooseDataDir(mode)),
  moveDataDir: (target: string, options?: { mode?: 'move' | 'switch' }) =>
    unwrap(getApi().app.moveDataDir(target, options)),
  resetDataDir: () => unwrap(getApi().app.resetDataDir()),
  exportChapters: (options: {
    projectId: string;
    chapterIds: string[];
    includeStageHeaders?: boolean;
    defaultName?: string;
  }) => unwrap(getApi().export.chapters(options)),
  backups: () => unwrap(getApi().app.backups()),
  createBackup: () => unwrap(getApi().app.createBackup()),
  restoreBackup: (fileName: string) => unwrap(getApi().app.restoreBackup(fileName)),
  deleteBackup: (fileName: string) => unwrap(getApi().app.deleteBackup(fileName)),
  settings: () => unwrap(getApi().app.settings()),
  updateSettings: (patch: Partial<UiSettings>) => unwrap(getApi().app.updateSettings(patch)),
  projectSettings: (projectId: string) => unwrap(getApi().app.projectSettings(projectId)),
  updateProjectSettings: (projectId: string, patch: Partial<ProjectUiSettings>) =>
    unwrap(getApi().app.updateProjectSettings(projectId, patch)),
  readingProgress: (
    projectId: string,
    progress: { chapterId: string; charIndex: number; charTotal: number; percent: number },
  ): Promise<ReadingProgress> => unwrap(getApi().app.readingProgress(projectId, progress)),
  clearReadingProgress: (projectId: string, chapterId: string) =>
    unwrap(getApi().app.clearReadingProgress(projectId, chapterId)),
  hideToTray: () => unwrap(getApi().app.hideToTray()),
  showWindow: () => unwrap(getApi().app.showWindow()),
  windowState: () => unwrap(getApi().app.windowState()),
  exportText: (defaultName: string, content: string) =>
    unwrap(getApi().app.exportText({ defaultName, content })),

  listProjects: () => unwrap(getApi().projects.list()),
  createProject: (input: { name: string; description?: string; genre?: string }) =>
    unwrap(getApi().projects.create(input)),
  updateProject: (id: string, patch: Partial<Project>) => unwrap(getApi().projects.update(id, patch)),
  deleteProject: (id: string, options: DeleteProjectOptions) => unwrap(getApi().projects.delete(id, options)),
  openProject: (id: string) => unwrap(getApi().projects.open(id)),
  projectStructure: (id: string) => unwrap(getApi().projects.structure(id)),
  search: (query: string, projectId?: string): Promise<SearchHit[]> =>
    unwrap(getApi().projects.search(query, projectId)),

  createStage: (projectId: string, name: string, summary = ''): Promise<Stage> =>
    unwrap(getApi().stages.create(projectId, { name, summary })),
  renameStage: (stageId: string, name: string, summary = ''): Promise<Stage> =>
    unwrap(getApi().stages.update(stageId, { name, summary })),
  reorderStages: (projectId: string, orderedIds: string[]): Promise<Stage[]> =>
    unwrap(getApi().stages.reorder(projectId, orderedIds)),
  deleteStage: (stageId: string, options: DeleteStageOptions) =>
    unwrap(getApi().stages.delete(stageId, options)),

  createChapter: (
    projectId: string,
    input: { name: string; summary?: string; stageId?: string | null },
  ): Promise<Chapter> => unwrap(getApi().chapters.create(projectId, input)),
  updateChapter: (
    chapterId: string,
    patch: { name?: string; summary?: string; stageId?: string | null },
  ): Promise<Chapter> => unwrap(getApi().chapters.update(chapterId, patch)),
  moveChapter: (
    chapterId: string,
    input: { stageId?: string | null; beforeChapterId?: string | null },
  ): Promise<Chapter> => unwrap(getApi().chapters.move(chapterId, input)),
  reorderChapters: (projectId: string, orderedIds: string[]): Promise<Chapter[]> =>
    unwrap(getApi().chapters.reorder(projectId, orderedIds)),
  deleteChapter: (chapterId: string) => unwrap(getApi().chapters.delete(chapterId, { confirm: true })),
  getContent: (chapterId: string): Promise<ChapterContent> => unwrap(getApi().chapters.content(chapterId)),
  saveContent: (
    chapterId: string,
    input: { content: string; baseRevision?: number | null; source?: string },
  ): Promise<ChapterSaveResult> => unwrap(getApi().chapters.saveContent(chapterId, input)),
  versions: (chapterId: string): Promise<ChapterVersionsPayload> => unwrap(getApi().chapters.versions(chapterId)),
  version: (chapterId: string, versionId: string): Promise<ChapterVersion> =>
    unwrap(getApi().chapters.version(chapterId, versionId)),
  restoreVersion: (chapterId: string, versionId: string): Promise<ChapterSaveResult> =>
    unwrap(getApi().chapters.restore(chapterId, versionId)),

  outlineSnapshot: (projectId: string): Promise<OutlineSnapshot> => unwrap(getApi().outline.snapshot(projectId)),
  createNode: (projectId: string, input: OutlineNodeInput): Promise<OutlineNode> =>
    unwrap(getApi().outline.createNode(projectId, input)),
  updateNode: (nodeId: string, patch: OutlineNodePatch): Promise<OutlineNode> =>
    unwrap(getApi().outline.updateNode(nodeId, patch)),
  deleteNode: (nodeId: string) => unwrap(getApi().outline.deleteNode(nodeId, { confirm: true })),
  duplicateNode: (nodeId: string): Promise<OutlineNode> => unwrap(getApi().outline.duplicateNode(nodeId)),
  generateStructure: (projectId: string) => unwrap(getApi().outline.generateStructure(projectId)),
  reconcileBindings: (projectId: string) => unwrap(getApi().outline.reconcileBindings(projectId)),
  updatePositions: (
    projectId: string,
    positions: Array<{ id: string; x: number; y: number; width?: number; height?: number }>,
  ) => unwrap(getApi().outline.updatePositions(projectId, positions)),
  createEdge: (projectId: string, input: OutlineEdgeInput): Promise<OutlineEdge> =>
    unwrap(getApi().outline.createEdge(projectId, input)),
  updateEdge: (edgeId: string, patch: OutlineEdgePatch): Promise<OutlineEdge> =>
    unwrap(getApi().outline.updateEdge(edgeId, patch)),
  deleteEdge: (edgeId: string) => unwrap(getApi().outline.deleteEdge(edgeId)),
  createLink: (projectId: string, nodeId: string, chapterId: string): Promise<NodeChapterLink> =>
    unwrap(getApi().outline.createLink(projectId, nodeId, chapterId)),
  deleteLink: (projectId: string, nodeId: string, chapterId: string) =>
    unwrap(getApi().outline.deleteLink(projectId, nodeId, chapterId)),
  nodeChapters: (nodeId: string) => unwrap(getApi().outline.nodeChapters(nodeId)),
  chapterNodes: (chapterId: string) => unwrap(getApi().outline.chapterNodes(chapterId)),

  listForeshadows: (projectId: string, filter?: { status?: string; chapterId?: string }): Promise<Foreshadow[]> =>
    unwrap(getApi().foreshadow.list(projectId, filter)),
  createForeshadow: (projectId: string, input: ForeshadowInput): Promise<Foreshadow> =>
    unwrap(getApi().foreshadow.create(projectId, input)),
  updateForeshadow: (id: string, patch: ForeshadowPatch): Promise<Foreshadow> =>
    unwrap(getApi().foreshadow.update(id, patch)),
  deleteForeshadow: (id: string) => unwrap(getApi().foreshadow.delete(id, { confirm: true })),
  attachForeshadowOutline: (id: string) => unwrap(getApi().foreshadow.attachOutline(id)),

  voices: (provider?: string): Promise<
    Array<{ provider: string; label: string; configured: boolean; voices: Voice[]; error?: string }>
  > => unwrap(getApi().audio.voices(provider)),
  audioJobs: (projectId: string, chapterId?: string): Promise<AudioJobWithFile[]> =>
    unwrap(getApi().audio.jobs(projectId, chapterId)),
  createAudioJob: (projectId: string, input: CreateAudioJobInput): Promise<AudioJobWithFile> =>
    unwrap(getApi().audio.createJob(projectId, input)),
  previewVoice: (
    projectId: string,
    input: { voiceId: string; provider?: string; rate?: number; volume?: number; text?: string },
  ) => unwrap(getApi().audio.previewVoice(projectId, input)),
  cancelAudioJob: (jobId: string): Promise<AudioJobWithFile> => unwrap(getApi().audio.cancelJob(jobId)),
  deleteAudioJob: (jobId: string) => unwrap(getApi().audio.deleteJob(jobId)),
  exportAudioJob: (jobId: string) => unwrap(getApi().audio.exportJob(jobId)),
  audioConfig: (): Promise<AudioProviderConfigPublic> => unwrap(getApi().audio.config()),
  setAudioConfig: (patch: Partial<AudioProviderConfigPublic> & { openaiApiKey?: string | null }) =>
    unwrap(getApi().audio.setConfig(patch)),

  apiStatus: () => unwrap(getApi().api.status()),
  apiToken: () => unwrap(getApi().api.token()),
  regenerateToken: () => unwrap(getApi().api.regenerateToken()),
  apiSettings: () => unwrap(getApi().api.settings()),
  updateApiSettings: (patch: { allowDestructive?: boolean; enabled?: boolean }) =>
    unwrap(getApi().api.updateSettings(patch)),
  apiLogs: () => unwrap(getApi().api.logs(120)),
  apiTest: () => unwrap(getApi().api.test()),
  openapi: () => unwrap(getApi().api.openapi()),
  guide: () => unwrap(getApi().api.guide()),
  copyGuide: () => unwrap(getApi().api.copyGuide()),
  outlineGuide: () => unwrap(getApi().api.outlineGuide()),
  copyOutlineGuide: () => unwrap(getApi().api.copyOutlineGuide()),
  copyText: (text: string) => unwrap(getApi().api.copyText(text)),
};
