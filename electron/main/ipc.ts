import { BrowserWindow, dialog, ipcMain, Menu, shell, clipboard, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { AppCore } from './core';
import type { ApiServer } from './api/server';
import type { EndpointFileService } from './api/discovery';
import { buildAgentGuide } from './api/agentGuide';
import { buildOpenApiSpec } from './api/openapi';
import { errorPayload, NovelError } from './errors';
import type { ProjectUiSettings, UiSettings } from '@shared/types';

export interface IpcDeps {
  core: AppCore;
  api: ApiServer;
  endpoint: EndpointFileService;
  getWindow: () => BrowserWindow | null;
  markDirty: (dirty: boolean) => void;
  requestClose: () => void;
}

function wrap<R>(fn: (...args: any[]) => R | Promise<R>): (...args: any[]) => Promise<{ ok: true; data: R } | { ok: false; error: ReturnType<typeof errorPayload>['error'] }> {
  return async (...args: any[]) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (err) {
      const payload = errorPayload(err);
      return { ok: false, error: payload.error };
    }
  };
}

function parseDataUrl(url: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const data = match[3];
  return { mime, buffer: isBase64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8') };
}

export function registerIpc(deps: IpcDeps): void {
  const { core, api, endpoint } = deps;

  // ---------- 应用 ----------
  ipcMain.handle(
    'app:info',
    wrap(() => ({
      appVersion: app.getVersion(),
      apiVersion: 'v1',
      name: app.getName(),
      platform: process.platform,
      dataDir: core.dataDir,
      dbPath: core.dbPath,
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    })),
  );
  ipcMain.handle('app:stats', wrap(() => core.stats()));
  ipcMain.handle(
    'app:openDataDir',
    wrap(async () => {
      await shell.openPath(core.dataDir);
      return { opened: true, path: core.dataDir };
    }),
  );
  ipcMain.handle(
    'app:openPath',
    wrap(async (_e, target: string) => {
      if (typeof target !== 'string' || !target) throw new NovelError('VALIDATION_ERROR', '路径无效', 400);
      const result = await shell.openPath(target);
      if (result) throw new NovelError('INTERNAL_ERROR', result, 500);
      return { opened: true };
    }),
  );
  ipcMain.handle(
    'app:showItemInFolder',
    wrap((_e, target: string) => {
      if (typeof target !== 'string' || !target) throw new NovelError('VALIDATION_ERROR', '路径无效', 400);
      shell.showItemInFolder(target);
      return { opened: true };
    }),
  );
  ipcMain.on('app:setDirty', (_e, dirty: boolean) => deps.markDirty(Boolean(dirty)));
  ipcMain.on('app:closeConfirmed', () => deps.requestClose());

  ipcMain.handle('app:backups', wrap(() => ({ backups: core.backup.list() })));
  ipcMain.handle('app:createBackup', wrap(() => core.backup.create('manual')));
  ipcMain.handle(
    'app:restoreBackup',
    wrap((_e, fileName: string) => {
      const result = core.backup.restore(fileName);
      return {
        ...result,
        message: '备份已恢复。请重新启动软件以加载恢复后的数据。',
      };
    }),
  );
  ipcMain.handle(
    'app:deleteBackup',
    wrap((_e, fileName: string) => core.backup.delete(fileName)),
  );

  ipcMain.handle('app:settings', wrap(() => core.settings.getUi()));
  ipcMain.handle(
    'app:updateSettings',
    wrap((_e, patch: Partial<UiSettings>) => core.settings.updateUi(patch ?? {})),
  );
  ipcMain.handle('app:projectSettings', wrap((_e, projectId: string) => core.settings.getProjectSettings(projectId)));
  ipcMain.handle(
    'app:updateProjectSettings',
    wrap((_e, projectId: string, patch: Partial<ProjectUiSettings>) =>
      core.settings.updateProjectSettings(projectId, patch ?? {}),
    ),
  );
  ipcMain.handle(
    'app:exportText',
    wrap(async (_e, options: { defaultName: string; content: string }) => {
      const win = deps.getWindow();
      const result = await dialog.showSaveDialog(win ?? undefined!, {
        title: '导出文本',
        defaultPath: options?.defaultName ?? 'novel.txt',
        filters: [
          { name: '纯文本', extensions: ['txt'] },
          { name: 'Markdown', extensions: ['md'] },
        ],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      fs.writeFileSync(result.filePath, options.content, 'utf8');
      return { canceled: false, filePath: result.filePath };
    }),
  );

  // ---------- 项目 ----------
  ipcMain.handle('projects:list', wrap(() => core.projects.list()));
  ipcMain.handle('projects:create', wrap((_e, input: any) => core.projects.create(input)));
  ipcMain.handle(
    'projects:update',
    wrap((_e, id: string, patch: any) => core.projects.update(id, patch)),
  );
  ipcMain.handle(
    'projects:delete',
    wrap((_e, id: string, options: any) => core.projects.delete(id, options)),
  );
  ipcMain.handle('projects:open', wrap((_e, id: string) => core.projects.touch(id)));
  ipcMain.handle('projects:structure', wrap((_e, id: string) => core.projects.structure(id)));
  ipcMain.handle(
    'projects:search',
    wrap((_e, query: string, projectId?: string) => core.projects.search(String(query ?? ''), projectId)),
  );

  // ---------- 阶段 ----------
  ipcMain.handle('stages:create', wrap((_e, projectId: string, input: any) => core.structure.createStage(projectId, input)));
  ipcMain.handle('stages:update', wrap((_e, stageId: string, patch: any) => core.structure.updateStage(stageId, patch)));
  ipcMain.handle(
    'stages:reorder',
    wrap((_e, projectId: string, orderedIds: string[]) => core.structure.reorderStages(projectId, orderedIds)),
  );
  ipcMain.handle(
    'stages:delete',
    wrap((_e, stageId: string, options: any) => core.structure.deleteStage(stageId, options)),
  );

  // ---------- 章节 ----------
  ipcMain.handle(
    'chapters:create',
    wrap((_e, projectId: string, input: any) => core.structure.createChapter(projectId, input)),
  );
  ipcMain.handle(
    'chapters:update',
    wrap((_e, chapterId: string, patch: any) => core.structure.updateChapter(chapterId, patch)),
  );
  ipcMain.handle(
    'chapters:move',
    wrap((_e, chapterId: string, input: any) => core.structure.moveChapter(chapterId, input)),
  );
  ipcMain.handle(
    'chapters:reorder',
    wrap((_e, projectId: string, orderedIds: string[]) => core.structure.reorderChapters(projectId, orderedIds)),
  );
  ipcMain.handle(
    'chapters:delete',
    wrap((_e, chapterId: string, options: any) => core.structure.deleteChapter(chapterId, options)),
  );
  ipcMain.handle('chapters:content', wrap((_e, chapterId: string) => core.structure.getContent(chapterId)));
  ipcMain.handle(
    'chapters:saveContent',
    wrap((_e, chapterId: string, input: any) => {
      const result = core.structure.saveContent(chapterId, input);
      core.backup.maybeAutoBackup();
      return result;
    }),
  );
  ipcMain.handle('chapters:versions', wrap((_e, chapterId: string) => core.structure.listVersions(chapterId)));
  ipcMain.handle(
    'chapters:version',
    wrap((_e, chapterId: string, versionId: string) => core.structure.getVersion(versionId)),
  );
  ipcMain.handle(
    'chapters:restore',
    wrap((_e, chapterId: string, versionId: string) => core.structure.restoreVersion(chapterId, versionId)),
  );

  // ---------- 大纲 ----------
  ipcMain.handle('outline:snapshot', wrap((_e, projectId: string) => core.outline.snapshot(projectId)));
  ipcMain.handle(
    'outline:createNode',
    wrap((_e, projectId: string, input: any) => core.outline.createNode(projectId, input)),
  );
  ipcMain.handle(
    'outline:updateNode',
    wrap((_e, nodeId: string, patch: any) => core.outline.updateNode(nodeId, patch)),
  );
  ipcMain.handle(
    'outline:deleteNode',
    wrap((_e, nodeId: string, options: any) => core.outline.deleteNode(nodeId, options)),
  );
  ipcMain.handle('outline:duplicateNode', wrap((_e, nodeId: string) => core.outline.duplicateNode(nodeId)));
  ipcMain.handle(
    'outline:updatePositions',
    wrap((_e, projectId: string, positions: any) => core.outline.updatePositions(projectId, positions)),
  );
  ipcMain.handle(
    'outline:createEdge',
    wrap((_e, projectId: string, input: any) => core.outline.createEdge(projectId, input)),
  );
  ipcMain.handle(
    'outline:updateEdge',
    wrap((_e, edgeId: string, patch: any) => core.outline.updateEdge(edgeId, patch)),
  );
  ipcMain.handle('outline:deleteEdge', wrap((_e, edgeId: string) => core.outline.deleteEdge(edgeId)));
  ipcMain.handle(
    'outline:createLink',
    wrap((_e, _projectId: string, nodeId: string, chapterId: string) => core.outline.linkChapter(nodeId, chapterId)),
  );
  ipcMain.handle(
    'outline:deleteLink',
    wrap((_e, _projectId: string, nodeId: string, chapterId: string) => core.outline.unlinkChapter(nodeId, chapterId)),
  );
  ipcMain.handle('outline:nodeChapters', wrap((_e, nodeId: string) => core.outline.chaptersForNode(nodeId)));
  ipcMain.handle('outline:chapterNodes', wrap((_e, chapterId: string) => core.outline.nodesForChapter(chapterId)));

  // ---------- 伏笔 ----------
  ipcMain.handle('foreshadow:list', wrap((_e, projectId: string, filter: any) => core.foreshadow.list(projectId, filter)));
  ipcMain.handle(
    'foreshadow:create',
    wrap((_e, projectId: string, input: any) => core.foreshadow.create(projectId, input)),
  );
  ipcMain.handle('foreshadow:update', wrap((_e, id: string, patch: any) => core.foreshadow.update(id, patch)));
  ipcMain.handle('foreshadow:delete', wrap((_e, id: string, options: any) => core.foreshadow.delete(id, options)));
  ipcMain.handle('foreshadow:attachOutline', wrap((_e, id: string) => core.foreshadow.attachToOutline(id)));

  // ---------- 音频 ----------
  ipcMain.handle('audio:voices', wrap((_e, provider?: string) => core.audio.listVoices(provider)));
  ipcMain.handle('audio:jobs', wrap((_e, projectId: string, chapterId?: string) => core.audio.listJobs(projectId, chapterId)));
  ipcMain.handle(
    'audio:createJob',
    wrap((_e, projectId: string, input: any) => core.audio.createJob(projectId, input)),
  );
  ipcMain.handle(
    'audio:previewVoice',
    wrap((_e, projectId: string, input: any) => core.audio.previewVoice(projectId, input)),
  );
  ipcMain.handle('audio:cancelJob', wrap((_e, jobId: string) => core.audio.cancelJob(jobId)));
  ipcMain.handle('audio:deleteJob', wrap((_e, jobId: string) => core.audio.deleteJob(jobId)));
  ipcMain.handle(
    'audio:exportJob',
    wrap(async (_e, jobId: string) => {
      const job = core.audio.getJob(jobId);
      if (!job.filePath) throw new NovelError('NOT_FOUND', '音频尚未生成完成', 404);
      const win = deps.getWindow();
      const result = await dialog.showSaveDialog(win ?? undefined!, {
        title: '导出音频',
        defaultPath: `${job.chapterName || 'chapter'}.${job.format}`,
        filters: [{ name: job.format.toUpperCase(), extensions: [job.format] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      core.audio.exportJob(jobId, result.filePath);
      return { canceled: false, filePath: result.filePath };
    }),
  );
  ipcMain.handle(
    'audio:config',
    wrap(() => {
      const cfg = core.settings.getAudioConfig();
      const { openaiApiKey, ...publicCfg } = cfg as { openaiApiKey?: string } & typeof cfg;
      return publicCfg;
    }),
  );
  ipcMain.handle(
    'audio:setConfig',
    wrap((_e, patch: any) => {
      const cfg = core.settings.setAudioConfig(patch);
      const { openaiApiKey, ...publicCfg } = cfg as { openaiApiKey?: string } & typeof cfg;
      return publicCfg;
    }),
  );

  // ---------- API 管理 ----------
  ipcMain.handle('api:status', wrap(() => api.status));
  ipcMain.handle('api:token', wrap(() => ({ token: api.getToken(), masked: api.status.tokenMasked })));
  ipcMain.handle(
    'api:regenerateToken',
    wrap(() => {
      const token = 'mj_' + require('node:crypto').randomBytes(24).toString('hex');
      core.settings.setApiToken(token);
      api.setToken(token);
      return { token, masked: api.status.tokenMasked };
    }),
  );
  ipcMain.handle('api:settings', wrap(() => core.settings.getApiSettings()));
  ipcMain.handle(
    'api:updateSettings',
    wrap((_e, patch: { allowDestructive?: boolean; enabled?: boolean }) => core.settings.updateApiSettings(patch ?? {})),
  );
  ipcMain.handle('api:logs', wrap((_e, limit?: number) => core.settings.listApiLogs(limit ?? 100)));
  ipcMain.handle(
    'api:test',
    wrap(async () => {
      const started = Date.now();
      try {
        const res = await fetch(`${api.getBaseUrl()}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
        const body = (await res.json()) as { ok?: boolean; appVersion?: string; apiVersion?: string };
        return {
          ok: res.ok && body.ok === true,
          status: res.status,
          latencyMs: Date.now() - started,
          message: res.ok ? '连接正常，本地 API 正在运行。' : `服务返回 HTTP ${res.status}`,
          baseUrl: api.getBaseUrl(),
          version: body.appVersion,
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          latencyMs: Date.now() - started,
          message: `连接失败：${err instanceof Error ? err.message : String(err)}`,
          baseUrl: api.getBaseUrl(),
        };
      }
    }),
  );
  ipcMain.handle('api:openapi', wrap(() => buildOpenApiSpec(api.getBaseUrl())));
  ipcMain.handle(
    'api:guide',
    wrap(() =>
      buildAgentGuide({
        core,
        baseUrl: api.getBaseUrl(),
        token: api.getToken(),
        endpointFilePath: endpoint.filePath,
        dataDir: core.dataDir,
      }),
    ),
  );
  ipcMain.handle(
    'api:copyGuide',
    wrap(() => {
      const guide = buildAgentGuide({
        core,
        baseUrl: api.getBaseUrl(),
        token: api.getToken(),
        endpointFilePath: endpoint.filePath,
        dataDir: core.dataDir,
      });
      clipboard.writeText(guide);
      return { copied: true, length: guide.length };
    }),
  );
  ipcMain.handle(
    'api:copyText',
    wrap((_e, text: string) => {
      if (typeof text !== 'string') throw new NovelError('VALIDATION_ERROR', '复制内容无效', 400);
      clipboard.writeText(text);
      return { copied: true, length: text.length };
    }),
  );

  // ---------- 媒体协议辅助 ----------
  ipcMain.handle(
    'media:readDataUrl',
    wrap((_e, url: string) => {
      const parsed = parseDataUrl(url);
      if (!parsed) throw new NovelError('VALIDATION_ERROR', '不支持的 data URL', 400);
      return { mime: parsed.mime, size: parsed.buffer.length };
    }),
  );
}

export function buildMenu(
  win: BrowserWindow,
  onAction: (action: string) => void,
  dataDir: string,
): void {
  const send = (action: string) => () => {
    if (!win.isDestroyed()) win.webContents.send('app:menuAction', action);
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: send('new-project') },
        { type: 'separator' },
        { label: '保存当前章节', accelerator: 'CmdOrCtrl+S', click: send('save-chapter') },
        { label: '打开数据目录', click: () => void shell.openPath(dataDir) },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'Agent 接入',
          click: send('open-agent'),
        },
        {
          label: '关于大师小说工作台',
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: '关于',
              message: '大师小说工作台',
              detail: `版本 ${app.getVersion()}\n数据目录：${depsPath()}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function depsPath(): string {
  return app.getPath('userData');
}
