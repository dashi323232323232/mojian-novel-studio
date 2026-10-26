import { APP_VERSION, API_VERSION } from '@shared/constants';

/**
 * OpenAPI 3.1 定义 —— 与实际 HTTP 路由一一对应。
 * 该对象既用于 /api/v1/openapi.json，也用于生成 Agent 接入文档中的接口清单。
 */

type Json = Record<string, unknown>;

const projectSchema: Json = {
  type: 'object',
  required: ['id', 'name', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', example: 'prj_2k9z8x4q1m' },
    name: { type: 'string', example: '普法战争' },
    description: { type: 'string', example: '一部以 1870 年普法战争为背景的长篇小说。' },
    genre: { type: 'string', example: '历史小说' },
    coverColor: { type: 'string', example: '#5b6cff' },
    chapterCount: { type: 'integer', example: 12 },
    wordCount: { type: 'integer', example: 83452 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    lastOpenedAt: { type: ['string', 'null'], format: 'date-time' },
  },
};

const stageSchema: Json = {
  type: 'object',
  required: ['id', 'projectId', 'name', 'sortOrder'],
  properties: {
    id: { type: 'string', example: 'stg_2k9z8x4q1m' },
    projectId: { type: 'string' },
    name: { type: 'string', example: '第一阶段：战云密布' },
    summary: { type: 'string', description: '阶段简介，与大纲中绑定的故事阶段节点互通' },
    sortOrder: { type: 'number', example: 0 },
    chapterCount: { type: 'integer', example: 3 },
    wordCount: { type: 'integer', example: 12000 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const chapterSchema: Json = {
  type: 'object',
  required: ['id', 'projectId', 'name', 'sortOrder'],
  properties: {
    id: { type: 'string', example: 'chp_2k9z8x4q1m' },
    projectId: { type: 'string' },
    stageId: { type: ['string', 'null'] },
    name: { type: 'string', example: '第一章 宣战' },
    summary: { type: 'string', description: '章节简介，与大纲中绑定的具体章节节点互通' },
    sortOrder: { type: 'number', example: 0 },
    wordCount: { type: 'integer', example: 3200 },
    contentUpdatedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const chapterContentSchema: Json = {
  type: 'object',
  required: ['chapterId', 'content', 'revision', 'wordCount'],
  properties: {
    chapterId: { type: 'string' },
    content: { type: 'string', example: '一八七〇年七月，巴黎的夏天闷热得反常。' },
    revision: { type: 'integer', example: 7 },
    wordCount: { type: 'integer', example: 3200 },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const saveResultSchema: Json = {
  type: 'object',
  properties: {
    chapterId: { type: 'string' },
    revision: { type: 'integer', example: 8 },
    wordCount: { type: 'integer', example: 3240 },
    savedAt: { type: 'string', format: 'date-time' },
    unchanged: { type: 'boolean', description: '内容与当前版本相同，未产生新版本' },
    versionId: { type: ['string', 'null'], description: '本次保存归档的上一版本 ID' },
  },
};

const outlineNodeSchema: Json = {
  type: 'object',
  required: ['id', 'projectId', 'type', 'title', 'x', 'y'],
  properties: {
    id: { type: 'string', example: 'nod_2k9z8x4q1m' },
    projectId: { type: 'string' },
    type: {
      type: 'string',
      enum: ['stage', 'event', 'chapter', 'character', 'foreshadow', 'note'],
      example: 'event',
    },
    title: { type: 'string', example: '色当战役' },
    description: { type: 'string', example: '法军主力被围，拿破仑三世投降。' },
    x: { type: 'number', example: 320 },
    y: { type: 'number', example: 180 },
    width: { type: 'number', example: 230 },
    height: { type: 'number', example: 116 },
    color: { type: ['string', 'null'] },
    notes: { type: 'string', description: '节点备注，不限字数，可随时清空' },
    data: {
      type: 'object',
      additionalProperties: true,
      description: '扩展字段：stageId/chapterId（绑定真实对象）、role/age/appearance/personality/time/location/goal/foreshadowId 等',
      example: { time: '1870-09-01', location: '色当' },
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const outlineEdgeSchema: Json = {
  type: 'object',
  required: ['id', 'projectId', 'sourceId', 'targetId', 'relation'],
  properties: {
    id: { type: 'string', example: 'edg_2k9z8x4q1m' },
    projectId: { type: 'string' },
    sourceId: { type: 'string' },
    targetId: { type: 'string' },
    relation: {
      type: 'string',
      enum: ['sequence', 'causal', 'parallel', 'setup', 'payoff', 'relation', 'custom'],
      example: 'causal',
    },
    label: { type: 'string', example: '导致' },
    description: { type: 'string', example: '色当战败直接导致第二帝国崩溃。' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const foreshadowSchema: Json = {
  type: 'object',
  required: ['id', 'projectId', 'name', 'status'],
  properties: {
    id: { type: 'string', example: 'fsd_2k9z8x4q1m' },
    projectId: { type: 'string' },
    name: { type: 'string', example: '染血的军旗' },
    description: { type: 'string' },
    status: {
      type: 'string',
      enum: ['planned', 'planted', 'developing', 'resolved', 'abandoned'],
      example: 'planted',
    },
    plantedChapterId: { type: ['string', 'null'] },
    plannedResolveChapterId: { type: ['string', 'null'] },
    plannedResolveStageId: { type: ['string', 'null'] },
    nodeId: { type: ['string', 'null'], description: '关联的大纲节点' },
    characterNodeIds: { type: 'array', items: { type: 'string' } },
    chapterIds: { type: 'array', items: { type: 'string' }, description: '关联章节（可多个）' },
    chapterRefs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          chapterId: { type: 'string' },
          role: { type: 'string', enum: ['planted', 'related', 'resolved'] },
        },
      },
    },
    notes: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const audioJobSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'aud_2k9z8x4q1m' },
    projectId: { type: 'string' },
    chapterId: { type: ['string', 'null'] },
    chapterName: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'canceled'] },
    progress: { type: 'number', example: 0.65 },
    message: { type: 'string', example: '正在合成语音' },
    provider: { type: 'string', example: 'sapi' },
    voiceId: { type: 'string', example: 'Microsoft Huihui Desktop' },
    voiceName: { type: 'string' },
    rate: { type: 'integer', example: 0 },
    volume: { type: 'integer', example: 100 },
    format: { type: 'string', example: 'wav' },
    fileName: { type: ['string', 'null'] },
    filePath: { type: ['string', 'null'], description: '音频在本机的绝对路径' },
    mediaUrl: { type: ['string', 'null'], description: '可在应用内播放的地址' },
    durationMs: { type: ['integer', 'null'], example: 125000 },
    charCount: { type: 'integer', example: 3200 },
    error: { type: ['string', 'null'] },
    exists: { type: 'boolean' },
    size: { type: ['integer', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    startedAt: { type: ['string', 'null'], format: 'date-time' },
    finishedAt: { type: ['string', 'null'], format: 'date-time' },
  },
};

const errorSchema: Json = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'VALIDATION_ERROR',
            'UNAUTHORIZED',
            'FORBIDDEN',
            'NOT_FOUND',
            'CONFLICT',
            'CONFIRMATION_REQUIRED',
            'STAGE_NOT_EMPTY',
            'RATE_LIMITED',
            'PROVIDER_NOT_CONFIGURED',
            'PROVIDER_ERROR',
            'UNSUPPORTED',
            'INTERNAL_ERROR',
          ],
        },
        message: { type: 'string', example: '章节名称不能为空' },
        details: { type: 'object', additionalProperties: true },
      },
    },
  },
};

const param = (name: string, description: string, example?: string): Json => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
  ...(example ? { example } : {}),
});

const jsonBody = (schemaRef: string, example: Json, description = '请求体'): Json => ({
  required: true,
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
      example,
    },
  },
});

const responses = (
  description: string,
  example?: Json,
  extra?: Record<string, Json>,
): Json => ({
  '200': {
    description,
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
        ...(example ? { example } : {}),
      },
    },
  },
  '400': { $ref: '#/components/responses/ValidationError' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '500': { $ref: '#/components/responses/InternalError' },
  ...(extra ?? {}),
});

interface OpDef {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  public?: boolean;
  params?: Json[];
  query?: Json[];
  body?: Json;
  responseDescription: string;
  responseExample?: Json;
  destructive?: boolean;
}

const ops: OpDef[] = [
  {
    method: 'get',
    path: '/api/v1/health',
    operationId: 'getHealth',
    summary: '健康检查',
    description: '无需令牌。返回服务状态、版本与数据库状态，可用于连接测试。',
    tags: ['系统'],
    public: true,
    responseDescription: '服务正常',
    responseExample: {
      ok: true,
      status: 'running',
      app: '大师小说工作台',
      appVersion: APP_VERSION,
      apiVersion: API_VERSION,
      database: 'ok',
    },
  },
  {
    method: 'get',
    path: '/api/v1/version',
    operationId: 'getVersion',
    summary: '获取软件与接口版本',
    description: '无需令牌。返回应用版本、API 版本以及 OpenAPI / Agent 文档地址。',
    tags: ['系统'],
    public: true,
    responseDescription: '版本信息',
    responseExample: {
      appVersion: APP_VERSION,
      apiVersion: API_VERSION,
      name: '大师小说工作台',
      endpoints: { openapi: '/api/v1/openapi.json', agentGuide: '/api/v1/agent-guide' },
    },
  },
  {
    method: 'get',
    path: '/api/v1/openapi.json',
    operationId: 'getOpenApi',
    summary: '获取 OpenAPI 3.1 定义',
    tags: ['系统'],
    public: true,
    responseDescription: 'OpenAPI 文档对象',
  },
  {
    method: 'get',
    path: '/api/v1/agent-guide',
    operationId: 'getAgentGuide',
    summary: '获取完整 Agent 接入文档（Markdown）',
    tags: ['系统'],
    public: true,
    responseDescription: 'Markdown 文档',
  },
  {
    method: 'get',
    path: '/api/v1/stats',
    operationId: 'getStats',
    summary: '获取全库统计',
    tags: ['系统'],
    responseDescription: '项目/章节/节点/伏笔/音频数量与数据库大小',
  },
  {
    method: 'get',
    path: '/api/v1/search',
    operationId: 'search',
    summary: '搜索章节名称与正文',
    tags: ['系统'],
    query: [
      { name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: '关键词', example: '色当' },
      { name: 'projectId', in: 'query', required: false, schema: { type: 'string' }, description: '限定项目' },
    ],
    responseDescription: '搜索结果',
  },

  // 项目
  {
    method: 'get',
    path: '/api/v1/projects',
    operationId: 'listProjects',
    summary: '查询项目列表',
    tags: ['项目'],
    responseDescription: '项目列表',
    responseExample: {
      projects: [
        {
          id: 'prj_2k9z8x4q1m',
          name: '普法战争',
          chapterCount: 12,
          wordCount: 83452,
          createdAt: '2026-10-27T00:00:00.000Z',
          updatedAt: '2026-10-27T00:10:00.000Z',
        },
      ],
    },
  },
  {
    method: 'post',
    path: '/api/v1/projects',
    operationId: 'createProject',
    summary: '创建项目',
    description: '创建项目时自动生成「第一阶段」，可立即创建章节。项目名称必填。',
    tags: ['项目'],
    body: jsonBody(
      '#/components/schemas/CreateProjectInput',
      { name: '普法战争', description: '1870 年的故事', genre: '历史小说' },
      '项目信息',
    ),
    responseDescription: '创建成功',
    responseExample: { project: { id: 'prj_2k9z8x4q1m', name: '普法战争', chapterCount: 0, wordCount: 0 } },
  },
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}',
    operationId: 'getProject',
    summary: '查询项目详情',
    tags: ['项目'],
    params: [param('projectId', '项目 ID', 'prj_2k9z8x4q1m')],
    responseDescription: '项目详情',
  },
  {
    method: 'patch',
    path: '/api/v1/projects/{projectId}',
    operationId: 'updateProject',
    summary: '重命名或修改项目',
    tags: ['项目'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/UpdateProjectInput', { name: '普法战争（修订版）' }),
    responseDescription: '修改后的项目',
  },
  {
    method: 'delete',
    path: '/api/v1/projects/{projectId}',
    operationId: 'deleteProject',
    summary: '删除项目（高危）',
    description:
      '高危操作：需要用户在「Agent 接入」页面开启「允许高危操作」，且请求体必须 confirm=true；建议同时提供 confirmName=项目名称 二次校验。删除会级联移除阶段、章节、正文、大纲、伏笔、音频记录与音频文件，不可恢复。',
    tags: ['项目'],
    destructive: true,
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/DeleteConfirmInput', { confirm: true, confirmName: '普法战争' }),
    responseDescription: '删除结果',
    responseExample: { deleted: true, id: 'prj_2k9z8x4q1m' },
  },
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/structure',
    operationId: 'getProjectStructure',
    summary: '查询项目的阶段与章节树',
    tags: ['项目'],
    params: [param('projectId', '项目 ID')],
    responseDescription: '项目、阶段与章节',
    responseExample: {
      project: { id: 'prj_1', name: '普法战争' },
      stages: [{ id: 'stg_1', name: '第一阶段', sortOrder: 0 }],
      chapters: [{ id: 'chp_1', stageId: 'stg_1', name: '第一章 宣战', sortOrder: 0 }],
    },
  },

  // 阶段
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/stages',
    operationId: 'listStages',
    summary: '查询阶段列表',
    tags: ['阶段'],
    params: [param('projectId', '项目 ID')],
    responseDescription: '阶段列表',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/stages',
    operationId: 'createStage',
    summary: '创建阶段',
    tags: ['阶段'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/CreateStageInput', { name: '第二阶段：围城' }),
    responseDescription: '新阶段',
  },
  {
    method: 'patch',
    path: '/api/v1/stages/{stageId}',
    operationId: 'updateStage',
    summary: '重命名阶段',
    tags: ['阶段'],
    params: [param('stageId', '阶段 ID')],
    body: jsonBody('#/components/schemas/UpdateStageInput', { name: '第一阶段：战云密布' }),
    responseDescription: '修改后的阶段',
  },
  {
    method: 'delete',
    path: '/api/v1/stages/{stageId}',
    operationId: 'deleteStage',
    summary: '删除阶段（高危）',
    description:
      '必须 confirm=true，并明确章节处理方式：chapterAction=move（默认）把章节移动到 targetStageId（不传则移动到项目内其他阶段）；chapterAction=delete 会连同章节一起删除。阶段内仍有章节却没有其他阶段可接收时返回 STAGE_NOT_EMPTY。',
    tags: ['阶段'],
    destructive: true,
    params: [param('stageId', '阶段 ID')],
    body: jsonBody('#/components/schemas/DeleteStageInput', {
      confirm: true,
      chapterAction: 'move',
      targetStageId: 'stg_other',
    }),
    responseDescription: '删除结果',
    responseExample: { deleted: true, id: 'stg_1', movedChapters: 3, deletedChapters: 0 },
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/stages/reorder',
    operationId: 'reorderStages',
    summary: '调整阶段顺序',
    description: 'orderedIds 必须包含项目全部阶段且不重复。',
    tags: ['阶段'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/ReorderInput', { orderedIds: ['stg_2', 'stg_1'] }),
    responseDescription: '排序后的阶段列表',
  },

  // 章节
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/chapters',
    operationId: 'listChapters',
    summary: '查询章节列表',
    tags: ['章节'],
    params: [param('projectId', '项目 ID')],
    query: [{ name: 'stageId', in: 'query', required: false, schema: { type: 'string' }, description: '按阶段过滤' }],
    responseDescription: '章节列表',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/chapters',
    operationId: 'createChapter',
    summary: '创建章节',
    description: '章节 ID 由服务端生成（稳定且不依赖名称）。stageId 省略时归入第一个阶段；content 可直接写入正文。',
    tags: ['章节'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody(
      '#/components/schemas/CreateChapterInput',
      { name: '第一章 宣战', stageId: 'stg_1', content: '一八七〇年七月，巴黎的夏天闷热得反常。' },
      '章节信息',
    ),
    responseDescription: '新章节',
    responseExample: { chapter: { id: 'chp_2k9z8x4q1m', name: '第一章 宣战', stageId: 'stg_1', wordCount: 20 } },
  },
  {
    method: 'get',
    path: '/api/v1/chapters/{chapterId}',
    operationId: 'getChapter',
    summary: '查询章节详情',
    tags: ['章节'],
    params: [param('chapterId', '章节 ID')],
    responseDescription: '章节详情',
  },
  {
    method: 'patch',
    path: '/api/v1/chapters/{chapterId}',
    operationId: 'updateChapter',
    summary: '重命名章节或修改所属阶段',
    tags: ['章节'],
    params: [param('chapterId', '章节 ID')],
    body: jsonBody('#/components/schemas/UpdateChapterInput', { name: '第一章 战争前夜', stageId: 'stg_2' }),
    responseDescription: '修改后的章节',
  },
  {
    method: 'delete',
    path: '/api/v1/chapters/{chapterId}',
    operationId: 'deleteChapter',
    summary: '删除章节（高危）',
    description: '必须 confirm=true，且用户已开启「允许高危操作」。章节正文、版本、关联与音频任务会一并删除。',
    tags: ['章节'],
    destructive: true,
    params: [param('chapterId', '章节 ID')],
    body: jsonBody('#/components/schemas/DeleteConfirmInput', { confirm: true }),
    responseDescription: '删除结果',
  },
  {
    method: 'post',
    path: '/api/v1/chapters/{chapterId}/move',
    operationId: 'moveChapter',
    summary: '移动章节到指定阶段与位置',
    description: 'beforeChapterId 指定插入到某章节之前；position 为全项目顺序索引；都省略时追加到末尾。',
    tags: ['章节'],
    params: [param('chapterId', '章节 ID')],
    body: jsonBody('#/components/schemas/MoveChapterInput', {
      stageId: 'stg_2',
      beforeChapterId: 'chp_other',
    }),
    responseDescription: '移动后的章节',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/chapters/reorder',
    operationId: 'reorderChapters',
    summary: '整体调整章节顺序',
    tags: ['章节'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/ReorderInput', { orderedIds: ['chp_2', 'chp_1', 'chp_3'] }),
    responseDescription: '排序后的章节列表',
  },
  {
    method: 'get',
    path: '/api/v1/chapters/{chapterId}/content',
    operationId: 'getChapterContent',
    summary: '读取章节正文',
    tags: ['正文'],
    params: [param('chapterId', '章节 ID')],
    responseDescription: '正文与版本号',
    responseExample: {
      content: {
        chapterId: 'chp_1',
        content: '一八七〇年七月，巴黎的夏天闷热得反常。',
        revision: 3,
        wordCount: 20,
        updatedAt: '2026-10-27T00:10:00.000Z',
      },
    },
  },
  {
    method: 'put',
    path: '/api/v1/chapters/{chapterId}/content',
    operationId: 'saveChapterContent',
    summary: '保存章节正文',
    description:
      '保存采用事务写入；每次保存会把上一版归档为「上一个版本」，更早版本自动清理（只保留最新 + 上一版）。可传 baseRevision 做乐观并发控制：版本号不一致返回 409 CONFLICT。',
    tags: ['正文'],
    params: [param('chapterId', '章节 ID')],
    body: jsonBody('#/components/schemas/SaveContentInput', {
      content: '一八七〇年七月，巴黎的夏天闷热得反常。',
      baseRevision: 3,
    }),
    responseDescription: '保存结果',
    responseExample: {
      save: {
        chapterId: 'chp_1',
        revision: 4,
        wordCount: 20,
        savedAt: '2026-10-27T00:12:00.000Z',
        unchanged: false,
        versionId: 'ver_2k9z8x4q1m',
      },
    },
  },
  {
    method: 'get',
    path: '/api/v1/chapters/{chapterId}/versions',
    operationId: 'listChapterVersions',
    summary: '查询当前版本与上一个版本',
    tags: ['正文'],
    params: [param('chapterId', '章节 ID')],
    responseDescription: '版本摘要',
    responseExample: {
      current: { revision: 4, wordCount: 20, updatedAt: '2026-10-27T00:12:00.000Z' },
      previous: { id: 'ver_2k9z8x4q1m', revision: 3, wordCount: 18, savedAt: '2026-10-27T00:10:00.000Z', source: 'manual' },
    },
  },
  {
    method: 'get',
    path: '/api/v1/chapters/{chapterId}/versions/{versionId}',
    operationId: 'getChapterVersion',
    summary: '读取上一个版本正文',
    tags: ['正文'],
    params: [param('chapterId', '章节 ID'), param('versionId', '版本 ID')],
    responseDescription: '版本正文',
  },
  {
    method: 'post',
    path: '/api/v1/chapters/{chapterId}/versions/{versionId}/restore',
    operationId: 'restoreChapterVersion',
    summary: '回滚到上一个版本',
    description: '把指定历史版本写回正文；回滚前的内容会成为新的「上一个版本」，可再次回滚。',
    tags: ['正文'],
    params: [param('chapterId', '章节 ID'), param('versionId', '版本 ID')],
    responseDescription: '回滚后的保存结果',
  },

  // 大纲
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/outline',
    operationId: 'getOutline',
    summary: '获取完整大纲快照',
    description: '一次性返回节点、连线与节点-章节关联，适合 Agent 读取全貌。',
    tags: ['大纲'],
    params: [param('projectId', '项目 ID')],
    responseDescription: '大纲快照',
    responseExample: {
      nodes: [{ id: 'nod_1', type: 'event', title: '色当战役', x: 320, y: 180 }],
      edges: [{ id: 'edg_1', sourceId: 'nod_1', targetId: 'nod_2', relation: 'causal' }],
      links: [{ nodeId: 'nod_1', chapterId: 'chp_1', createdAt: '2026-10-27T00:00:00.000Z' }],
    },
  },
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/outline/nodes',
    operationId: 'listOutlineNodes',
    summary: '查询大纲节点',
    tags: ['大纲'],
    params: [param('projectId', '项目 ID')],
    query: [
      {
        name: 'type',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['stage', 'event', 'character', 'foreshadow', 'note'] },
        description: '按类型过滤',
      },
    ],
    responseDescription: '节点列表',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/outline/nodes',
    operationId: 'createOutlineNode',
    summary: '创建大纲节点',
    description: '节点位置、尺寸、类型、内容都会持久化。data 可携带类型专属字段。',
    tags: ['大纲'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody(
      '#/components/schemas/CreateOutlineNodeInput',
      {
        type: 'event',
        title: '色当战役',
        description: '法军主力被围，拿破仑三世投降。',
        x: 320,
        y: 180,
        data: { time: '1870-09-01', location: '色当' },
      },
      '节点信息',
    ),
    responseDescription: '新节点',
    responseExample: { node: { id: 'nod_2k9z8x4q1m', type: 'event', title: '色当战役', x: 320, y: 180 } },
  },
  {
    method: 'get',
    path: '/api/v1/outline/nodes/{nodeId}',
    operationId: 'getOutlineNode',
    summary: '查询单个节点',
    tags: ['大纲'],
    params: [param('nodeId', '节点 ID')],
    responseDescription: '节点详情',
  },
  {
    method: 'patch',
    path: '/api/v1/outline/nodes/{nodeId}',
    operationId: 'updateOutlineNode',
    summary: '修改节点',
    description: '支持修改名称、类型、描述、坐标、尺寸、颜色与扩展 data。',
    tags: ['大纲'],
    params: [param('nodeId', '节点 ID')],
    body: jsonBody('#/components/schemas/UpdateOutlineNodeInput', {
      title: '色当战役与帝国覆灭',
      x: 360,
      y: 200,
      data: { location: '色当', notes: '需要与第二章呼应' },
    }),
    responseDescription: '修改后的节点',
  },
  {
    method: 'delete',
    path: '/api/v1/outline/nodes/{nodeId}',
    operationId: 'deleteOutlineNode',
    summary: '删除节点（需确认）',
    description: '必须 confirm=true；相关连线与章节关联会一并删除。',
    tags: ['大纲'],
    destructive: true,
    params: [param('nodeId', '节点 ID')],
    body: jsonBody('#/components/schemas/DeleteConfirmInput', { confirm: true }),
    responseDescription: '删除结果',
  },
  {
    method: 'post',
    path: '/api/v1/outline/nodes/{nodeId}/clear-notes',
    operationId: 'clearOutlineNodeNotes',
    summary: '清空节点备注',
    description: '一键删除节点备注（等价于 PATCH notes=""）。',
    tags: ['大纲'],
    params: [param('nodeId', '节点 ID')],
    responseDescription: '修改后的节点',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/outline/reconcile-bindings',
    operationId: 'reconcileOutlineBindings',
    summary: '按名称自动绑定阶段/章节节点',
    description: '把未绑定的 stage/chapter 节点按名称匹配到真实阶段或章节，并同步简介。',
    tags: ['大纲'],
    params: [param('projectId', '项目 ID')],
    responseDescription: '绑定数量',
  },
  {
    method: 'post',
    path: '/api/v1/outline/nodes/{nodeId}/duplicate',
    operationId: 'duplicateOutlineNode',
    summary: '复制节点',
    tags: ['大纲'],
    params: [param('nodeId', '节点 ID')],
    responseDescription: '副本节点',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/outline/nodes/positions',
    operationId: 'updateNodePositions',
    summary: '批量保存节点位置',
    description: '拖动结束后批量提交，减少写入次数。只更新属于该项目的节点。',
    tags: ['大纲'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/NodePositionsInput', {
      positions: [{ id: 'nod_1', x: 100, y: 120 }, { id: 'nod_2', x: 420, y: 120 }],
    }),
    responseDescription: '更新数量',
  },
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/outline/edges',
    operationId: 'listOutlineEdges',
    summary: '查询连线',
    tags: ['大纲'],
    params: [param('projectId', '项目 ID')],
    responseDescription: '连线列表',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/outline/edges',
    operationId: 'createOutlineEdge',
    summary: '创建连线',
    description: 'relation 表达明确关系：sequence/causal/parallel/setup/payoff/relation/custom。相同两端 + 相同关系不会重复创建。',
    tags: ['大纲'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/CreateOutlineEdgeInput', {
      sourceId: 'nod_1',
      targetId: 'nod_2',
      relation: 'causal',
      label: '导致',
      description: '色当战败导致第二帝国崩溃。',
    }),
    responseDescription: '新连线',
  },
  {
    method: 'patch',
    path: '/api/v1/outline/edges/{edgeId}',
    operationId: 'updateOutlineEdge',
    summary: '修改连线',
    tags: ['大纲'],
    params: [param('edgeId', '连线 ID')],
    body: jsonBody('#/components/schemas/UpdateOutlineEdgeInput', {
      relation: 'sequence',
      label: '之后',
    }),
    responseDescription: '修改后的连线',
  },
  {
    method: 'delete',
    path: '/api/v1/outline/edges/{edgeId}',
    operationId: 'deleteOutlineEdge',
    summary: '删除连线',
    tags: ['大纲'],
    params: [param('edgeId', '连线 ID')],
    responseDescription: '删除结果',
  },
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/links',
    operationId: 'listNodeChapterLinks',
    summary: '查询章节与节点关联',
    tags: ['关联'],
    params: [param('projectId', '项目 ID')],
    query: [
      { name: 'nodeId', in: 'query', required: false, schema: { type: 'string' }, description: '按节点过滤' },
      { name: 'chapterId', in: 'query', required: false, schema: { type: 'string' }, description: '按章节过滤' },
    ],
    responseDescription: '关联列表',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/links',
    operationId: 'createNodeChapterLink',
    summary: '创建章节与节点关联',
    description: '多对多：同一节点可关联多个章节，同一章节可关联多个节点。',
    tags: ['关联'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/CreateLinkInput', { nodeId: 'nod_1', chapterId: 'chp_1' }),
    responseDescription: '新关联',
  },
  {
    method: 'delete',
    path: '/api/v1/projects/{projectId}/links',
    operationId: 'deleteNodeChapterLink',
    summary: '删除章节与节点关联',
    tags: ['关联'],
    params: [
      param('projectId', '项目 ID'),
      { name: 'nodeId', in: 'query', required: true, schema: { type: 'string' }, description: '节点 ID' },
      { name: 'chapterId', in: 'query', required: true, schema: { type: 'string' }, description: '章节 ID' },
    ],
    responseDescription: '删除结果',
  },
  {
    method: 'get',
    path: '/api/v1/outline/nodes/{nodeId}/chapters',
    operationId: 'getNodeChapters',
    summary: '查询节点关联的章节',
    tags: ['关联'],
    params: [param('nodeId', '节点 ID')],
    responseDescription: '关联章节（含编号、名称、所属阶段、字数）',
  },
  {
    method: 'get',
    path: '/api/v1/chapters/{chapterId}/nodes',
    operationId: 'getChapterNodes',
    summary: '查询章节关联的大纲节点',
    tags: ['关联'],
    params: [param('chapterId', '章节 ID')],
    responseDescription: '关联节点列表',
  },

  // 伏笔
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/foreshadows',
    operationId: 'listForeshadows',
    summary: '查询伏笔',
    tags: ['伏笔'],
    params: [param('projectId', '项目 ID')],
    query: [
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['planned', 'planted', 'developing', 'resolved', 'abandoned'] },
        description: '按状态过滤',
      },
      { name: 'chapterId', in: 'query', required: false, schema: { type: 'string' }, description: '按关联章节过滤' },
    ],
    responseDescription: '伏笔列表',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/foreshadows',
    operationId: 'createForeshadow',
    summary: '创建伏笔',
    description: '伏笔是独立数据对象，支持埋设章节、预计回收章节/阶段、关联人物节点、关联大纲节点、多章节关联。',
    tags: ['伏笔'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/ForeshadowInput', {
      name: '染血的军旗',
      description: '第一章出现的军旗，将在最后决战中再次出现。',
      status: 'planted',
      plantedChapterId: 'chp_1',
      plannedResolveChapterId: 'chp_12',
      chapterIds: ['chp_1', 'chp_12'],
      notes: '需要在第十章补一个特写。',
    }),
    responseDescription: '新伏笔',
  },
  {
    method: 'get',
    path: '/api/v1/foreshadows/{foreshadowId}',
    operationId: 'getForeshadow',
    summary: '查询伏笔详情',
    tags: ['伏笔'],
    params: [param('foreshadowId', '伏笔 ID')],
    responseDescription: '伏笔详情',
  },
  {
    method: 'patch',
    path: '/api/v1/foreshadows/{foreshadowId}',
    operationId: 'updateForeshadow',
    summary: '修改伏笔',
    tags: ['伏笔'],
    params: [param('foreshadowId', '伏笔 ID')],
    body: jsonBody('#/components/schemas/ForeshadowPatch', { status: 'resolved', notes: '已在第十二章回收。' }),
    responseDescription: '修改后的伏笔',
  },
  {
    method: 'delete',
    path: '/api/v1/foreshadows/{foreshadowId}',
    operationId: 'deleteForeshadow',
    summary: '删除伏笔（需确认）',
    tags: ['伏笔'],
    destructive: true,
    params: [param('foreshadowId', '伏笔 ID')],
    body: jsonBody('#/components/schemas/DeleteConfirmInput', { confirm: true }),
    responseDescription: '删除结果',
  },
  {
    method: 'post',
    path: '/api/v1/foreshadows/{foreshadowId}/attach-outline',
    operationId: 'attachForeshadowToOutline',
    summary: '把伏笔同步为大纲节点',
    tags: ['伏笔'],
    params: [param('foreshadowId', '伏笔 ID')],
    responseDescription: '生成的节点 ID',
  },

  // 音频
  {
    method: 'get',
    path: '/api/v1/audio/voices',
    operationId: 'listVoices',
    summary: '查询可用声音',
    description: '返回各语音服务商是否已配置及可用音色。未配置的服务商返回 configured=false。',
    tags: ['音频'],
    query: [
      {
        name: 'provider',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['sapi', 'openai'] },
        description: '只查询指定服务商',
      },
    ],
    responseDescription: '声音列表',
    responseExample: {
      providers: [
        {
          provider: 'sapi',
          label: 'Windows 本地语音（SAPI）',
          configured: true,
          voices: [{ id: 'Microsoft Huihui Desktop', name: 'Microsoft Huihui Desktop', locale: 'zh-CN' }],
        },
      ],
    },
  },
  {
    method: 'get',
    path: '/api/v1/projects/{projectId}/audio/jobs',
    operationId: 'listAudioJobs',
    summary: '查询音频任务',
    tags: ['音频'],
    params: [param('projectId', '项目 ID')],
    query: [{ name: 'chapterId', in: 'query', required: false, schema: { type: 'string' }, description: '按章节过滤' }],
    responseDescription: '任务列表',
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/audio/jobs',
    operationId: 'createAudioJob',
    summary: '创建音频生成任务',
    description:
      '使用章节已保存的正文作为输入，无需重新粘贴。未配置语音服务时返回 400 PROVIDER_NOT_CONFIGURED；正文为空返回 400 VALIDATION_ERROR。任务异步执行，返回后需轮询查询状态。',
    tags: ['音频'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/CreateAudioJobInput', {
      chapterId: 'chp_1',
      voiceId: 'Microsoft Huihui Desktop',
      provider: 'sapi',
      rate: 0,
      volume: 100,
    }),
    responseDescription: '任务已创建（status=queued）',
    responseExample: {
      job: { id: 'aud_2k9z8x4q1m', status: 'queued', progress: 0, chapterId: 'chp_1', provider: 'sapi' },
    },
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/audio/preview',
    operationId: 'previewVoice',
    summary: '试听声音样本',
    description: '使用一句短文本真实合成试听样本，不创建章节任务、不写入任务列表。',
    tags: ['音频'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/PreviewVoiceInput', {
      voiceId: 'Microsoft Huihui Desktop',
      provider: 'sapi',
      rate: 0,
    }),
    responseDescription: '试听音频地址',
    responseExample: {
      preview: {
        mediaUrl: 'novel-media://audio/prj_1/preview-123.wav',
        durationMs: 4200,
        provider: 'sapi',
        voiceId: 'Microsoft Huihui Desktop',
      },
    },
  },
  {
    method: 'get',
    path: '/api/v1/audio/jobs/{jobId}',
    operationId: 'getAudioJob',
    summary: '查询音频任务状态与结果',
    description: 'status：queued/running/succeeded/failed/canceled；成功后返回 filePath、mediaUrl、durationMs、size。',
    tags: ['音频'],
    params: [param('jobId', '任务 ID')],
    responseDescription: '任务详情',
  },
  {
    method: 'post',
    path: '/api/v1/audio/jobs/{jobId}/cancel',
    operationId: 'cancelAudioJob',
    summary: '取消音频任务',
    tags: ['音频'],
    params: [param('jobId', '任务 ID')],
    responseDescription: '取消后的任务',
  },
  {
    method: 'delete',
    path: '/api/v1/audio/jobs/{jobId}',
    operationId: 'deleteAudioJob',
    summary: '删除音频任务及文件（需确认）',
    tags: ['音频'],
    destructive: true,
    params: [param('jobId', '任务 ID')],
    responseDescription: '删除结果',
  },

  // 设置
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/export/chapters',
    operationId: 'exportChapters',
    summary: '导出所选章节为 TXT 文件',
    description:
      '把所选章节按阶段顺序合并导出为纯文本，包含阶段标题、阶段简介、章节名、章节简介与正文。文件写入数据目录的 exports/ 子目录，返回绝对路径。',
    tags: ['项目'],
    params: [param('projectId', '项目 ID')],
    body: jsonBody('#/components/schemas/ExportChaptersInput', {
      chapterIds: ['chp_1', 'chp_2'],
      includeStageHeaders: true,
      fileName: '普法战争-节选.txt',
    }),
    responseDescription: '导出结果',
    responseExample: {
      export: {
        filePath: '%APPDATA%\大师小说工作台\exports\普法战争-节选.txt',
        fileName: '普法战争-节选.txt',
        chapterCount: 2,
        wordCount: 6400,
        bytes: 19200,
      },
    },
  },
  {
    method: 'post',
    path: '/api/v1/projects/{projectId}/outline/generate',
    operationId: 'generateOutlineFromStructure',
    summary: '按章节结构自动生成大纲节点与连线',
    description: '为每个阶段创建「故事阶段」节点、每个章节创建「具体章节」节点，并建立阶段→章节的先后顺序连线。只新增缺失内容，不删除现有节点。',
    tags: ['大纲'],
    params: [param('projectId', '项目 ID')],
    responseDescription: '新增数量',
    responseExample: { createdStageNodes: 2, createdChapterNodes: 5, createdEdges: 5 },
  },
  {
    method: 'get',
    path: '/api/v1/settings',
    operationId: 'getSettings',
    summary: '读取界面与 API 设置（不含密钥）',
    tags: ['设置'],
    responseDescription: '设置快照',
  },
  {
    method: 'patch',
    path: '/api/v1/settings',
    operationId: 'updateSettings',
    summary: '更新界面设置',
    tags: ['设置'],
    body: jsonBody('#/components/schemas/UpdateSettingsInput', {
      lastProjectId: 'prj_1',
      editor: { fontSize: 18, autoSave: true },
    }),
    responseDescription: '更新后的设置',
  },
];

const schemas: Record<string, Json> = {
  Project: projectSchema,
  Stage: stageSchema,
  Chapter: chapterSchema,
  ChapterContent: chapterContentSchema,
  SaveResult: saveResultSchema,
  OutlineNode: outlineNodeSchema,
  OutlineEdge: outlineEdgeSchema,
  Foreshadow: foreshadowSchema,
  AudioJob: audioJobSchema,
  ErrorResponse: errorSchema,
  CreateProjectInput: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 120, example: '普法战争' },
      description: { type: 'string' },
      genre: { type: 'string' },
      coverColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    },
  },
  UpdateProjectInput: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 120 },
      description: { type: 'string' },
      genre: { type: 'string' },
      coverColor: { type: 'string' },
    },
  },
  DeleteConfirmInput: {
    type: 'object',
    required: ['confirm'],
    properties: {
      confirm: { type: 'boolean', enum: [true], description: '必须显式为 true' },
      confirmName: { type: 'string', description: '项目删除时的二次校验：填写项目名称' },
    },
  },
  DeleteStageInput: {
    type: 'object',
    required: ['confirm'],
    properties: {
      confirm: { type: 'boolean', enum: [true] },
      chapterAction: { type: 'string', enum: ['move', 'delete'], default: 'move' },
      targetStageId: { type: ['string', 'null'], description: 'chapterAction=move 时的目标阶段' },
    },
  },
  ReorderInput: {
    type: 'object',
    required: ['orderedIds'],
    properties: {
      orderedIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
  },
  CreateStageInput: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 120, example: '第二阶段' },
      summary: { type: 'string', description: '阶段简介（可选）' },
    },
  },
  UpdateStageInput: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 120 },
      summary: { type: 'string' },
    },
  },
  CreateChapterInput: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 200, example: '第一章 宣战' },
      summary: { type: 'string', description: '章节简介（可选），与大纲具体章节节点互通' },
      stageId: { type: ['string', 'null'] },
      content: { type: 'string', description: '可选：创建时直接写入正文' },
    },
  },
  UpdateChapterInput: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 200 },
      summary: { type: 'string' },
      stageId: { type: ['string', 'null'] },
      sortOrder: { type: 'number' },
    },
  },
  MoveChapterInput: {
    type: 'object',
    properties: {
      stageId: { type: ['string', 'null'] },
      beforeChapterId: { type: ['string', 'null'] },
      position: { type: 'integer', minimum: 0 },
    },
  },
  SaveContentInput: {
    type: 'object',
    required: ['content'],
    properties: {
      content: { type: 'string', maxLength: 33554432, description: 'UTF-8 正文，最大 32MB' },
      baseRevision: { type: ['integer', 'null'], description: '可选：乐观锁版本号' },
    },
  },
  CreateOutlineNodeInput: {
    type: 'object',
    required: ['type', 'title'],
    properties: {
      type: { type: 'string', enum: ['stage', 'event', 'chapter', 'character', 'foreshadow', 'note'] },
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string' },
      notes: { type: 'string', description: '节点备注，不限字数' },
      stageId: { type: ['string', 'null'], description: 'type=stage 时绑定真实阶段' },
      chapterId: { type: ['string', 'null'], description: 'type=chapter 时绑定真实章节' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      color: { type: ['string', 'null'] },
      data: { type: 'object', additionalProperties: true },
    },
  },
  UpdateOutlineNodeInput: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['stage', 'event', 'chapter', 'character', 'foreshadow', 'note'] },
      title: { type: 'string' },
      description: { type: 'string' },
      notes: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      color: { type: ['string', 'null'] },
      data: { type: 'object', additionalProperties: true },
    },
  },
  NodePositionsInput: {
    type: 'object',
    required: ['positions'],
    properties: {
      positions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'x', 'y'],
          properties: {
            id: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
      },
    },
  },
  CreateOutlineEdgeInput: {
    type: 'object',
    required: ['sourceId', 'targetId'],
    properties: {
      sourceId: { type: 'string' },
      targetId: { type: 'string' },
      relation: {
        type: 'string',
        enum: ['sequence', 'causal', 'parallel', 'setup', 'payoff', 'relation', 'custom'],
        default: 'sequence',
      },
      label: { type: 'string', maxLength: 120 },
      description: { type: 'string', maxLength: 2000 },
    },
  },
  UpdateOutlineEdgeInput: {
    type: 'object',
    properties: {
      sourceId: { type: 'string' },
      targetId: { type: 'string' },
      relation: { type: 'string', enum: ['sequence', 'causal', 'parallel', 'setup', 'payoff', 'relation', 'custom'] },
      label: { type: 'string' },
      description: { type: 'string' },
    },
  },
  CreateLinkInput: {
    type: 'object',
    required: ['nodeId', 'chapterId'],
    properties: { nodeId: { type: 'string' }, chapterId: { type: 'string' } },
  },
  ForeshadowInput: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 200 },
      description: { type: 'string' },
      status: { type: 'string', enum: ['planned', 'planted', 'developing', 'resolved', 'abandoned'] },
      plantedChapterId: { type: ['string', 'null'] },
      plannedResolveChapterId: { type: ['string', 'null'] },
      plannedResolveStageId: { type: ['string', 'null'] },
      nodeId: { type: ['string', 'null'] },
      characterNodeIds: { type: 'array', items: { type: 'string' } },
      chapterIds: { type: 'array', items: { type: 'string' } },
      chapterRefs: {
        type: 'array',
        items: {
          type: 'object',
          required: ['chapterId'],
          properties: {
            chapterId: { type: 'string' },
            role: { type: 'string', enum: ['planted', 'related', 'resolved'] },
          },
        },
      },
      notes: { type: 'string' },
    },
  },
  ForeshadowPatch: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['planned', 'planted', 'developing', 'resolved', 'abandoned'] },
      plantedChapterId: { type: ['string', 'null'] },
      plannedResolveChapterId: { type: ['string', 'null'] },
      plannedResolveStageId: { type: ['string', 'null'] },
      nodeId: { type: ['string', 'null'] },
      characterNodeIds: { type: 'array', items: { type: 'string' } },
      chapterIds: { type: 'array', items: { type: 'string' } },
      chapterRefs: { type: 'array', items: { type: 'object', additionalProperties: true } },
      notes: { type: 'string' },
    },
  },
  CreateAudioJobInput: {
    type: 'object',
    required: ['chapterId', 'voiceId'],
    properties: {
      chapterId: { type: 'string' },
      voiceId: { type: 'string' },
      provider: { type: 'string', enum: ['sapi', 'openai'], default: 'sapi' },
      rate: { type: 'integer', minimum: -10, maximum: 10, default: 0 },
      volume: { type: 'integer', minimum: 0, maximum: 100, default: 100 },
    },
  },
  ExportChaptersInput: {
    type: 'object',
    required: ['chapterIds'],
    properties: {
      chapterIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
      includeStageHeaders: { type: 'boolean', default: true },
      fileName: { type: 'string', description: '可选文件名（自动补 .txt）' },
    },
  },
  PreviewVoiceInput: {
    type: 'object',
    required: ['voiceId'],
    properties: {
      voiceId: { type: 'string' },
      provider: { type: 'string', enum: ['sapi', 'openai'], default: 'sapi' },
      rate: { type: 'integer', minimum: -10, maximum: 10 },
      volume: { type: 'integer', minimum: 0, maximum: 100 },
      text: { type: 'string', maxLength: 200, description: '可选试听文本，默认内置一句样本' },
    },
  },
  UpdateSettingsInput: {
    type: 'object',
    properties: {
      lastProjectId: { type: 'string' },
      editor: {
        type: 'object',
        properties: {
          fontSize: { type: 'number' },
          lineHeight: { type: 'number' },
          fontFamily: { type: 'string', enum: ['serif', 'sans'] },
          showWordCount: { type: 'boolean' },
          autoSave: { type: 'boolean' },
        },
      },
    },
  },
};

function buildPaths(): Json {
  const paths: Json = {};
  for (const op of ops) {
    if (!paths[op.path]) paths[op.path] = {};
    const operation: Json = {
      operationId: op.operationId,
      summary: op.summary,
      tags: op.tags,
      ...(op.description ? { description: op.description } : {}),
      ...(op.public ? { security: [] } : {}),
      parameters: [...(op.params ?? []), ...(op.query ?? [])],
      ...(op.body ? { requestBody: op.body } : {}),
      responses: responses(op.responseDescription, op.responseExample),
      ...(op.destructive
        ? { 'x-dashi-destructive': true, 'x-dashi-confirmation': '需要用户开启「允许高危操作」并显式确认' }
        : {}),
    };
    (paths[op.path] as Json)[op.method] = operation;
  }
  return paths;
}

export function buildOpenApiSpec(baseUrl = 'http://127.0.0.1:45871'): Json {
  return {
    openapi: '3.1.0',
    info: {
      title: '大师小说工作台 本地 API',
      version: API_VERSION,
      description: [
        `大师小说工作台 ${APP_VERSION} 的本地 HTTP API。`,
        '默认只监听 127.0.0.1，需要 Bearer 令牌鉴权（健康检查、版本、OpenAPI、Agent 文档除外）。',
        '章节正文采用「当前版本 + 上一个版本」保留策略；删除项目/章节/阶段、删除节点/伏笔/音频等属于高危操作，需要用户在软件内开启许可并显式确认。',
        '服务端口可能因占用而改变，请从用户数据目录的 api-endpoint.json 读取 baseUrl。',
      ].join('\n'),
      contact: { name: '大师小说工作台', url: 'https://localhost/' },
      license: { name: 'MIT' },
    },
    servers: [
      { url: baseUrl, description: '本机 API（端口以 api-endpoint.json 为准）' },
    ],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: '系统', description: '版本、健康检查、OpenAPI 与文档' },
      { name: '项目', description: '项目创建、查询、重命名、删除' },
      { name: '阶段', description: '小说阶段管理' },
      { name: '章节', description: '章节创建、移动、排序、删除' },
      { name: '正文', description: '章节正文读写与双版本回溯' },
      { name: '大纲', description: '大纲节点、连线与画布布局' },
      { name: '关联', description: '大纲节点与章节的多对多关联' },
      { name: '伏笔', description: '伏笔追踪数据对象' },
      { name: '音频', description: '有声小说任务与结果' },
      { name: '设置', description: '界面与 API 设置' },
    ],
    paths: buildPaths(),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: '在「Agent 接入」页面复制访问令牌，请求头 Authorization: Bearer <token>。',
        },
      },
      schemas,
      responses: {
        ValidationError: {
          description: '参数校验失败（400）',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { error: { code: 'VALIDATION_ERROR', message: '章节名称不能为空' } },
            },
          },
        },
        Unauthorized: {
          description: '未授权（401）：缺少或错误的 Bearer 令牌',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { error: { code: 'UNAUTHORIZED', message: '缺少或错误的访问令牌。' } },
            },
          },
        },
        Forbidden: {
          description: '禁止访问（403）：跨站来源或高危操作未开启',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { error: { code: 'FORBIDDEN', message: '高危操作未启用。' } },
            },
          },
        },
        NotFound: {
          description: '资源不存在（404）',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { error: { code: 'NOT_FOUND', message: '章节不存在：chp_xxx' } },
            },
          },
        },
        Conflict: {
          description: '数据冲突（409）：版本号不一致或需要确认',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { error: { code: 'CONFLICT', message: '章节已被其他操作修改，请重新加载后再保存。' } },
            },
          },
        },
        InternalError: {
          description: '服务器内部错误（500）',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { error: { code: 'INTERNAL_ERROR', message: '未知错误' } },
            },
          },
        },
      },
    },
    'x-dashi-api-version': API_VERSION,
    'x-dashi-app-version': APP_VERSION,
    'x-dashi-discovery': '用户数据目录/api-endpoint.json 中的 baseUrl 字段',
  };
}

export interface OperationSummary {
  method: string;
  path: string;
  summary: string;
  tags: string[];
  destructive: boolean;
}

export function listOperations(): OperationSummary[] {
  return ops.map((o) => ({
    method: o.method.toUpperCase(),
    path: o.path,
    summary: o.summary,
    tags: o.tags,
    destructive: Boolean(o.destructive),
  }));
}
