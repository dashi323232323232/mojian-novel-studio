import type {
  ApiServerStatus,
  ApiTestResult,
  AppInfo,
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
  SearchHit,
  Stage,
  UiSettings,
  Voice,
} from '@shared/types';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

interface RawApi {
  app: {
    info(): Promise<Result<AppInfo>>;
    stats(): Promise<Result<Record<string, number | string | null>>>;
    openDataDir(): Promise<Result<unknown>>;
    openPath(path: string): Promise<Result<unknown>>;
    showItemInFolder(path: string): Promise<Result<unknown>>;
    setDirty(dirty: boolean): void;
    closeConfirmed(): void;
    cancelClose(): void;
    dataLocation(): Promise<Result<{
      currentDir: string;
      defaultDir: string;
      bootstrapFile: string;
      isCustom: boolean;
      exists: boolean;
      dbSize: number;
      audioCount: number;
      backupCount: number;
    }>>;
    chooseDataDir(mode?: 'move' | 'switch'): Promise<Result<{ canceled: boolean; dir?: string; mode?: string }>>;
    moveDataDir(
      target: string,
      options?: { mode?: 'move' | 'switch'; relaunch?: boolean },
    ): Promise<Result<{ from: string; to: string; copiedBytes: number; copiedFiles: number; message: string; restarting: boolean }>>;
    resetDataDir(): Promise<Result<{ reset: boolean; message: string }>>;
    backups(): Promise<Result<{ backups: BackupInfo[] }>>;
    createBackup(): Promise<Result<BackupInfo>>;
    restoreBackup(fileName: string): Promise<Result<{ restored: boolean; safetyBackup: BackupInfo; message: string }>>;
    deleteBackup(fileName: string): Promise<Result<unknown>>;
    settings(): Promise<Result<UiSettings>>;
    updateSettings(patch: Partial<UiSettings>): Promise<Result<UiSettings>>;
    projectSettings(projectId: string): Promise<Result<ProjectUiSettings>>;
    updateProjectSettings(projectId: string, patch: Partial<ProjectUiSettings>): Promise<Result<ProjectUiSettings>>;
    exportText(options: { defaultName: string; content: string }): Promise<Result<{ canceled: boolean; filePath?: string }>>;
    onMenuAction(cb: (action: string) => void): () => void;
    onRequestClose(cb: () => void): () => void;
  };
  export: {
    chapters(options: {
      projectId: string;
      chapterIds: string[];
      includeStageHeaders?: boolean;
      defaultName?: string;
    }): Promise<Result<{ canceled: boolean; filePath?: string; chapterCount?: number; wordCount?: number }>>;
  };
  projects: {
    list(): Promise<Result<Project[]>>;
    create(input: { name: string; description?: string; genre?: string }): Promise<Result<Project>>;
    update(id: string, patch: Partial<Project>): Promise<Result<Project>>;
    delete(id: string, options: DeleteProjectOptions): Promise<Result<unknown>>;
    open(id: string): Promise<Result<Project>>;
    structure(id: string): Promise<Result<ProjectStructure>>;
    search(query: string, projectId?: string): Promise<Result<SearchHit[]>>;
  };
  stages: {
    create(projectId: string, input: { name: string; summary?: string }): Promise<Result<Stage>>;
    update(stageId: string, patch: { name?: string; summary?: string }): Promise<Result<Stage>>;
    reorder(projectId: string, orderedIds: string[]): Promise<Result<Stage[]>>;
    delete(stageId: string, options: DeleteStageOptions): Promise<Result<unknown>>;
  };
  chapters: {
    create(
      projectId: string,
      input: { name: string; summary?: string; stageId?: string | null },
    ): Promise<Result<Chapter>>;
    update(
      chapterId: string,
      patch: { name?: string; summary?: string; stageId?: string | null },
    ): Promise<Result<Chapter>>;
    move(chapterId: string, input: { stageId?: string | null; beforeChapterId?: string | null }): Promise<Result<Chapter>>;
    reorder(projectId: string, orderedIds: string[]): Promise<Result<Chapter[]>>;
    delete(chapterId: string, options: { confirm: boolean }): Promise<Result<unknown>>;
    content(chapterId: string): Promise<Result<ChapterContent>>;
    saveContent(
      chapterId: string,
      input: { content: string; baseRevision?: number | null; source?: string },
    ): Promise<Result<ChapterSaveResult>>;
    versions(chapterId: string): Promise<Result<ChapterVersionsPayload>>;
    version(chapterId: string, versionId: string): Promise<Result<ChapterVersion>>;
    restore(chapterId: string, versionId: string): Promise<Result<ChapterSaveResult>>;
  };
  outline: {
    snapshot(projectId: string): Promise<Result<OutlineSnapshot>>;
    createNode(projectId: string, input: OutlineNodeInput): Promise<Result<OutlineNode>>;
    updateNode(nodeId: string, patch: OutlineNodePatch): Promise<Result<OutlineNode>>;
    deleteNode(nodeId: string, options: { confirm: boolean }): Promise<Result<unknown>>;
    duplicateNode(nodeId: string): Promise<Result<OutlineNode>>;
    generateStructure(
      projectId: string,
    ): Promise<Result<{ createdStageNodes: number; createdChapterNodes: number; createdEdges: number }>>;
    reconcileBindings(projectId: string): Promise<Result<{ bound: number }>>;
    updatePositions(
      projectId: string,
      positions: Array<{ id: string; x: number; y: number; width?: number; height?: number }>,
    ): Promise<Result<{ updated: number }>>;
    createEdge(projectId: string, input: OutlineEdgeInput): Promise<Result<OutlineEdge>>;
    updateEdge(edgeId: string, patch: OutlineEdgePatch): Promise<Result<OutlineEdge>>;
    deleteEdge(edgeId: string): Promise<Result<unknown>>;
    createLink(projectId: string, nodeId: string, chapterId: string): Promise<Result<NodeChapterLink>>;
    deleteLink(projectId: string, nodeId: string, chapterId: string): Promise<Result<unknown>>;
    nodeChapters(
      nodeId: string,
    ): Promise<
      Result<Array<{ id: string; name: string; stageId: string | null; stageName: string | null; wordCount: number; order: number }>>
    >;
    chapterNodes(chapterId: string): Promise<Result<OutlineNode[]>>;
  };
  foreshadow: {
    list(projectId: string, filter?: { status?: string; chapterId?: string }): Promise<Result<Foreshadow[]>>;
    create(projectId: string, input: ForeshadowInput): Promise<Result<Foreshadow>>;
    update(id: string, patch: ForeshadowPatch): Promise<Result<Foreshadow>>;
    delete(id: string, options: { confirm: boolean }): Promise<Result<unknown>>;
    attachOutline(id: string): Promise<Result<{ nodeId: string }>>;
  };
  audio: {
    voices(provider?: string): Promise<
      Result<Array<{ provider: string; label: string; configured: boolean; voices: Voice[]; error?: string }>>
    >;
    jobs(projectId: string, chapterId?: string): Promise<Result<AudioJobWithFile[]>>;
    createJob(projectId: string, input: CreateAudioJobInput): Promise<Result<AudioJobWithFile>>;
    previewVoice(
      projectId: string,
      input: { voiceId: string; provider?: string; rate?: number; volume?: number; text?: string },
    ): Promise<Result<{ filePath: string; mediaUrl: string; durationMs: number; provider: string; voiceId: string }>>;
    cancelJob(jobId: string): Promise<Result<AudioJobWithFile>>;
    deleteJob(jobId: string): Promise<Result<unknown>>;
    exportJob(jobId: string): Promise<Result<{ canceled: boolean; filePath?: string }>>;
    config(): Promise<Result<AudioProviderConfigPublic>>;
    setConfig(patch: Partial<AudioProviderConfigPublic> & { openaiApiKey?: string | null }): Promise<Result<AudioProviderConfigPublic>>;
  };
  api: {
    status(): Promise<Result<ApiServerStatus>>;
    token(): Promise<Result<{ token: string; masked: string }>>;
    regenerateToken(): Promise<Result<{ token: string; masked: string }>>;
    settings(): Promise<Result<{ allowDestructive: boolean; enabled: boolean }>>;
    updateSettings(patch: { allowDestructive?: boolean; enabled?: boolean }): Promise<Result<{ allowDestructive: boolean; enabled: boolean }>>;
    logs(limit?: number): Promise<Result<unknown[]>>;
    test(): Promise<Result<ApiTestResult>>;
    openapi(): Promise<Result<unknown>>;
    guide(): Promise<Result<string>>;
    copyGuide(): Promise<Result<{ copied: boolean; length: number }>>;
    copyText(text: string): Promise<Result<{ copied: boolean; length: number }>>;
  };
  events: {
    onDataChanged(cb: (event: unknown) => void): () => void;
  };
}

declare global {
  interface Window {
    dashi: RawApi;
  }
}

export class ClientError extends Error {
  code: string;
  details?: unknown;
  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ClientError';
    this.code = error.code;
    this.details = error.details;
  }
}

/** 解包 IPC 结果：失败时抛出 ClientError，便于 UI 统一处理。 */
export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new ClientError(result.error);
  return result.data;
}

export function getApi(): RawApi {
  if (typeof window === 'undefined' || !window.dashi) {
    throw new Error('预加载脚本未就绪，请通过桌面应用启动。');
  }
  return window.dashi;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ClientError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '发生未知错误';
}
