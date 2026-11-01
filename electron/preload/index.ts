import { contextBridge, ipcRenderer } from 'electron';

/**
 * 预加载脚本：只暴露经过白名单的 IPC 方法，渲染进程无法直接访问 Node/Electron。
 */
const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    stats: () => ipcRenderer.invoke('app:stats'),
    openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
    openPath: (path: string) => ipcRenderer.invoke('app:openPath', path),
    showItemInFolder: (path: string) => ipcRenderer.invoke('app:showItemInFolder', path),
    setDirty: (dirty: boolean) => ipcRenderer.send('app:setDirty', dirty),
    closeConfirmed: () => ipcRenderer.send('app:closeConfirmed'),
    cancelClose: () => ipcRenderer.send('app:cancelClose'),
    dataLocation: () => ipcRenderer.invoke('app:dataLocation'),
    chooseDataDir: (mode?: 'move' | 'switch') => ipcRenderer.invoke('app:chooseDataDir', mode),
    moveDataDir: (target: string, options?: unknown) => ipcRenderer.invoke('app:moveDataDir', target, options),
    resetDataDir: () => ipcRenderer.invoke('app:resetDataDir'),
    backups: () => ipcRenderer.invoke('app:backups'),
    createBackup: () => ipcRenderer.invoke('app:createBackup'),
    restoreBackup: (fileName: string) => ipcRenderer.invoke('app:restoreBackup', fileName),
    deleteBackup: (fileName: string) => ipcRenderer.invoke('app:deleteBackup', fileName),
    settings: () => ipcRenderer.invoke('app:settings'),
    updateSettings: (patch: unknown) => ipcRenderer.invoke('app:updateSettings', patch),
    projectSettings: (projectId: string) => ipcRenderer.invoke('app:projectSettings', projectId),
    updateProjectSettings: (projectId: string, patch: unknown) =>
      ipcRenderer.invoke('app:updateProjectSettings', projectId, patch),
    readingProgress: (projectId: string, progress: unknown) =>
      ipcRenderer.invoke('app:readingProgress', projectId, progress),
    clearReadingProgress: (projectId: string, chapterId: string) =>
      ipcRenderer.invoke('app:clearReadingProgress', projectId, chapterId),
    hideToTray: () => ipcRenderer.invoke('app:hideToTray'),
    showWindow: () => ipcRenderer.invoke('app:showWindow'),
    windowState: () => ipcRenderer.invoke('app:windowState'),
    exportText: (options: { defaultName: string; content: string }) =>
      ipcRenderer.invoke('app:exportText', options),
    onMenuAction: (cb: (action: string) => void) => {
      const listener = (_: unknown, action: string) => cb(action);
      ipcRenderer.on('app:menuAction', listener);
      return () => ipcRenderer.removeListener('app:menuAction', listener);
    },
    onRequestClose: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on('app:requestClose', listener);
      return () => ipcRenderer.removeListener('app:requestClose', listener);
    },
    onWindowShown: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on('app:windowShown', listener);
      return () => ipcRenderer.removeListener('app:windowShown', listener);
    },
  },
  export: {
    chapters: (options: unknown) => ipcRenderer.invoke('export:chapters', options),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: unknown) => ipcRenderer.invoke('projects:create', input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('projects:update', id, patch),
    delete: (id: string, options: unknown) => ipcRenderer.invoke('projects:delete', id, options),
    open: (id: string) => ipcRenderer.invoke('projects:open', id),
    structure: (id: string) => ipcRenderer.invoke('projects:structure', id),
    search: (query: string, projectId?: string) => ipcRenderer.invoke('projects:search', query, projectId),
  },
  stages: {
    create: (projectId: string, input: unknown) => ipcRenderer.invoke('stages:create', projectId, input),
    update: (stageId: string, patch: unknown) => ipcRenderer.invoke('stages:update', stageId, patch),
    reorder: (projectId: string, orderedIds: string[]) =>
      ipcRenderer.invoke('stages:reorder', projectId, orderedIds),
    delete: (stageId: string, options: unknown) => ipcRenderer.invoke('stages:delete', stageId, options),
  },
  chapters: {
    create: (projectId: string, input: unknown) => ipcRenderer.invoke('chapters:create', projectId, input),
    update: (chapterId: string, patch: unknown) => ipcRenderer.invoke('chapters:update', chapterId, patch),
    move: (chapterId: string, input: unknown) => ipcRenderer.invoke('chapters:move', chapterId, input),
    reorder: (projectId: string, orderedIds: string[]) =>
      ipcRenderer.invoke('chapters:reorder', projectId, orderedIds),
    delete: (chapterId: string, options: unknown) => ipcRenderer.invoke('chapters:delete', chapterId, options),
    content: (chapterId: string) => ipcRenderer.invoke('chapters:content', chapterId),
    saveContent: (chapterId: string, input: unknown) => ipcRenderer.invoke('chapters:saveContent', chapterId, input),
    versions: (chapterId: string) => ipcRenderer.invoke('chapters:versions', chapterId),
    version: (chapterId: string, versionId: string) => ipcRenderer.invoke('chapters:version', chapterId, versionId),
    restore: (chapterId: string, versionId: string) => ipcRenderer.invoke('chapters:restore', chapterId, versionId),
  },
  outline: {
    snapshot: (projectId: string) => ipcRenderer.invoke('outline:snapshot', projectId),
    createNode: (projectId: string, input: unknown) => ipcRenderer.invoke('outline:createNode', projectId, input),
    updateNode: (nodeId: string, patch: unknown) => ipcRenderer.invoke('outline:updateNode', nodeId, patch),
    deleteNode: (nodeId: string, options: unknown) => ipcRenderer.invoke('outline:deleteNode', nodeId, options),
    duplicateNode: (nodeId: string) => ipcRenderer.invoke('outline:duplicateNode', nodeId),
    generateStructure: (projectId: string) => ipcRenderer.invoke('outline:generateStructure', projectId),
    reconcileBindings: (projectId: string) => ipcRenderer.invoke('outline:reconcileBindings', projectId),
    updatePositions: (projectId: string, positions: unknown) =>
      ipcRenderer.invoke('outline:updatePositions', projectId, positions),
    createEdge: (projectId: string, input: unknown) => ipcRenderer.invoke('outline:createEdge', projectId, input),
    updateEdge: (edgeId: string, patch: unknown) => ipcRenderer.invoke('outline:updateEdge', edgeId, patch),
    deleteEdge: (edgeId: string) => ipcRenderer.invoke('outline:deleteEdge', edgeId),
    createLink: (projectId: string, nodeId: string, chapterId: string) =>
      ipcRenderer.invoke('outline:createLink', projectId, nodeId, chapterId),
    deleteLink: (projectId: string, nodeId: string, chapterId: string) =>
      ipcRenderer.invoke('outline:deleteLink', projectId, nodeId, chapterId),
    nodeChapters: (nodeId: string) => ipcRenderer.invoke('outline:nodeChapters', nodeId),
    chapterNodes: (chapterId: string) => ipcRenderer.invoke('outline:chapterNodes', chapterId),
  },
  foreshadow: {
    list: (projectId: string, filter?: unknown) => ipcRenderer.invoke('foreshadow:list', projectId, filter),
    create: (projectId: string, input: unknown) => ipcRenderer.invoke('foreshadow:create', projectId, input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('foreshadow:update', id, patch),
    delete: (id: string, options: unknown) => ipcRenderer.invoke('foreshadow:delete', id, options),
    attachOutline: (id: string) => ipcRenderer.invoke('foreshadow:attachOutline', id),
  },
  audio: {
    voices: (provider?: string) => ipcRenderer.invoke('audio:voices', provider),
    jobs: (projectId: string, chapterId?: string) => ipcRenderer.invoke('audio:jobs', projectId, chapterId),
    createJob: (projectId: string, input: unknown) => ipcRenderer.invoke('audio:createJob', projectId, input),
    previewVoice: (projectId: string, input: unknown) => ipcRenderer.invoke('audio:previewVoice', projectId, input),
    cancelJob: (jobId: string) => ipcRenderer.invoke('audio:cancelJob', jobId),
    deleteJob: (jobId: string) => ipcRenderer.invoke('audio:deleteJob', jobId),
    exportJob: (jobId: string) => ipcRenderer.invoke('audio:exportJob', jobId),
    config: () => ipcRenderer.invoke('audio:config'),
    setConfig: (patch: unknown) => ipcRenderer.invoke('audio:setConfig', patch),
  },
  api: {
    status: () => ipcRenderer.invoke('api:status'),
    token: () => ipcRenderer.invoke('api:token'),
    regenerateToken: () => ipcRenderer.invoke('api:regenerateToken'),
    settings: () => ipcRenderer.invoke('api:settings'),
    updateSettings: (patch: unknown) => ipcRenderer.invoke('api:updateSettings', patch),
    logs: (limit?: number) => ipcRenderer.invoke('api:logs', limit),
    test: () => ipcRenderer.invoke('api:test'),
    openapi: () => ipcRenderer.invoke('api:openapi'),
    guide: () => ipcRenderer.invoke('api:guide'),
    copyGuide: () => ipcRenderer.invoke('api:copyGuide'),
    outlineGuide: () => ipcRenderer.invoke('api:outlineGuide'),
    copyOutlineGuide: () => ipcRenderer.invoke('api:copyOutlineGuide'),
    copyText: (text: string) => ipcRenderer.invoke('api:copyText', text),
  },
  events: {
    onDataChanged: (cb: (event: unknown) => void) => {
      const listener = (_: unknown, event: unknown) => cb(event);
      ipcRenderer.on('data:changed', listener);
      return () => ipcRenderer.removeListener('data:changed', listener);
    },
  },
};

contextBridge.exposeInMainWorld('dashi', api);

export type DashiApi = typeof api;
