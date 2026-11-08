/**
 * 大师小说工作台 —— 跨进程共享的数据类型。
 * 主进程（SQLite 数据层 / HTTP API）、预加载脚本与渲染层都依赖这里的定义。
 */

export const NODE_TYPES = ['stage', 'event', 'chapter', 'character', 'foreshadow', 'note'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_RELATIONS = [
  'contains',
  'sequence',
  'causal',
  'parallel',
  'setup',
  'payoff',
  'relation',
  'custom',
] as const;
export type EdgeRelation = (typeof EDGE_RELATIONS)[number];

export const FORESHADOW_STATUSES = [
  'planned',
  'planted',
  'developing',
  'resolved',
  'abandoned',
] as const;
export type ForeshadowStatus = (typeof FORESHADOW_STATUSES)[number];

export const AUDIO_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
] as const;
export type AudioJobStatus = (typeof AUDIO_JOB_STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  description: string;
  genre: string;
  coverColor: string;
  chapterCount: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface Stage {
  id: string;
  projectId: string;
  name: string;
  /** 阶段简介：与大纲中绑定的故事阶段节点互通 */
  summary: string;
  sortOrder: number;
  chapterCount: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  projectId: string;
  stageId: string | null;
  name: string;
  /** 章节简介：与大纲中绑定的具体章节节点互通 */
  summary: string;
  sortOrder: number;
  wordCount: number;
  contentUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterContent {
  chapterId: string;
  content: string;
  revision: number;
  wordCount: number;
  updatedAt: string;
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  revision: number;
  content: string;
  wordCount: number;
  savedAt: string;
  source: string;
}

export interface ChapterVersionSummary {
  id: string;
  chapterId: string;
  revision: number;
  wordCount: number;
  savedAt: string;
  source: string;
}

export interface ChapterVersionsPayload {
  current: {
    revision: number;
    wordCount: number;
    updatedAt: string;
  };
  previous: ChapterVersionSummary | null;
}

export interface ProjectStructure {
  project: Project;
  stages: Stage[];
  chapters: Chapter[];
}

export interface OutlineNodeData {
  /** 人物：身份 / 年龄 / 外貌 / 性格 */
  role?: string;
  age?: string;
  appearance?: string;
  personality?: string;
  /** 事件：时间 / 地点 */
  time?: string;
  location?: string;
  /** 伏笔节点关联的伏笔对象 */
  foreshadowId?: string;
  /** 故事阶段节点：绑定的真实阶段 */
  stageId?: string;
  /** 具体章节节点：绑定的真实章节 */
  chapterId?: string;
  /** 故事阶段节点：阶段目标 */
  goal?: string;
  /** 通用备注（兼容旧数据，新数据写入 outline_nodes.notes 列） */
  notes?: string;
  /** 预留扩展字段 */
  [key: string]: unknown;
}

export interface OutlineNode {
  id: string;
  projectId: string;
  type: NodeType;
  title: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
  data: OutlineNodeData;
  /** 节点备注：不限字数，可在大纲详情中直接查看、改写或清空 */
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutlineEdge {
  id: string;
  projectId: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  label: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodeChapterLink {
  nodeId: string;
  chapterId: string;
  createdAt: string;
}

export interface OutlineSnapshot {
  nodes: OutlineNode[];
  edges: OutlineEdge[];
  links: NodeChapterLink[];
}

export interface ForeshadowChapterRef {
  chapterId: string;
  role: 'planted' | 'related' | 'resolved';
}

export interface Foreshadow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: ForeshadowStatus;
  plantedChapterId: string | null;
  plannedResolveChapterId: string | null;
  plannedResolveStageId: string | null;
  nodeId: string | null;
  characterNodeIds: string[];
  chapterIds: string[];
  chapterRefs: ForeshadowChapterRef[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Voice {
  id: string;
  name: string;
  locale: string;
  gender?: string;
  provider: string;
  description?: string;
}

export interface AudioProviderConfigPublic {
  provider: 'none' | 'sapi' | 'openai';
  openaiBaseUrl: string;
  openaiModel: string;
  openaiVoice: string;
  openaiApiKeySet: boolean;
  sapiRate: number;
}

export interface AudioJob {
  id: string;
  projectId: string;
  chapterId: string | null;
  chapterName: string;
  status: AudioJobStatus;
  progress: number;
  message: string;
  provider: string;
  voiceId: string;
  voiceName: string;
  rate: number;
  volume: number;
  format: string;
  fileName: string | null;
  filePath: string | null;
  durationMs: number | null;
  charCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AppInfo {
  appVersion: string;
  apiVersion: string;
  name: string;
  platform: string;
  dataDir: string;
  dbPath: string;
  electron: string;
  node: string;
  chrome: string;
}

export interface ApiServerStatus {
  running: boolean;
  host: string;
  port: number;
  baseUrl: string;
  apiVersion: string;
  appVersion: string;
  authRequired: boolean;
  tokenMasked: string;
  endpointFilePath: string;
  startedAt: string | null;
  requestCount: number;
  lastRequestAt: string | null;
  error: string | null;
}

export interface ApiRequestLogEntry {
  id: number;
  ts: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  actor: string;
  ip: string;
  summary: string;
}

export interface ApiTestResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  message: string;
  baseUrl: string;
  version?: string;
}

export interface EditorSettings {
  fontSize: number;
  lineHeight: number;
  fontFamily: 'serif' | 'sans';
  showWordCount: boolean;
  autoSave: boolean;
}

/**
 * 关闭主窗口时的行为：
 * - 'tray'：收缩到系统托盘，后台继续运行（默认）
 * - 'quit'：直接退出软件
 */
export type CloseAction = 'tray' | 'quit';

/** 实时朗读（边读边播，不落地音频文件）的偏好设置。 */
export interface ReadingSettings {
  /** 朗读引擎：web=系统实时语音；sapi=本地语音任务（生成文件后播放） */
  engine: 'web' | 'sapi';
  /** 语音服务：web 引擎对应浏览器语音，sapi/openai 对应本地/在线语音任务 */
  provider: 'sapi' | 'openai';
  /** 声音标识：web 引擎为语音名称，其他为音色 id */
  voiceId: string;
  /** 朗读语速倍率 0.5 ~ 2 */
  rate: number;
  /** 音调 0.5 ~ 1.6（仅 web 引擎） */
  pitch: number;
  /** 音量 0 ~ 100 */
  volume: number;
  /** 当前朗读的章节 */
  chapterId: string | null;
  /** 是否自动接着读下一章 */
  autoNext: boolean;
}

/** 单章朗读进度：以字符偏移量保存，换引擎、换语速都能继续读。 */
export interface ReadingProgress {
  chapterId: string;
  charIndex: number;
  charTotal: number;
  /** 进度百分比（0~1），便于列表直接展示 */
  percent: number;
  updatedAt: string;
}

export interface UiSettings {
  lastProjectId: string | null;
  editor: EditorSettings;
  audio: AudioProviderConfigPublic;
  /** 关闭主窗口时的行为，默认收缩到系统托盘 */
  closeAction: CloseAction;
  /** 是否记住上次朗读位置，默认开启 */
  rememberReading: boolean;
  reading: ReadingSettings;
  /** 项目导出时默认保存的文件夹；null 表示每次弹系统保存对话框 */
  exportFolder: string | null;
}

export interface ProjectUiSettings {
  outlineViewport: { x: number; y: number; zoom: number } | null;
  linkSplitRatio: number;
  lastChapterId: string | null;
  /** 各章节的朗读进度（按 chapterId 索引） */
  readingProgress: Record<string, ReadingProgress>;
}

export interface BackupInfo {
  fileName: string;
  filePath: string;
  size: number;
  createdAt: string;
  auto: boolean;
}

export interface AppSettingsSnapshot {
  ui: UiSettings;
  audio: AudioProviderConfigPublic;
}

/** 实时朗读引擎自检结果：用于音频页显示可用的系统声音。 */
export interface ReadingEngineInfo {
  /** 当前运行环境是否支持实时朗读 */
  supported: boolean;
  /** 是否检测到中文语音 */
  hasChinese: boolean;
  voices: Array<{ id: string; name: string; locale: string; local: boolean }>;
  message?: string;
}

export interface MutationResult<T = unknown> {
  ok: true;
  data: T;
  savedAt: string;
}

export interface ChapterSaveResult {
  chapterId: string;
  revision: number;
  wordCount: number;
  savedAt: string;
  unchanged: boolean;
  versionId: string | null;
}

export interface DeleteStageOptions {
  chapterAction?: 'move' | 'delete';
  targetStageId?: string | null;
  confirm?: boolean;
}

export interface DeleteProjectOptions {
  confirm: boolean;
  confirmName?: string;
}

export interface OutlineNodeInput {
  type: NodeType;
  title: string;
  description?: string;
  notes?: string;
  stageId?: string | null;
  chapterId?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string | null;
  data?: OutlineNodeData;
}

export type OutlineNodePatch = Partial<Omit<OutlineNodeInput, 'type'>> & {
  type?: NodeType;
};

export interface StageInput {
  name: string;
  summary?: string;
}

export interface ChapterInput {
  name: string;
  summary?: string;
  stageId?: string | null;
  content?: string;
}

export interface OutlineEdgeInput {
  sourceId: string;
  targetId: string;
  relation?: EdgeRelation;
  label?: string;
  description?: string;
}

export type OutlineEdgePatch = Partial<Omit<OutlineEdgeInput, 'sourceId' | 'targetId'>> & {
  sourceId?: string;
  targetId?: string;
};

export interface ForeshadowInput {
  name: string;
  description?: string;
  status?: ForeshadowStatus;
  plantedChapterId?: string | null;
  plannedResolveChapterId?: string | null;
  plannedResolveStageId?: string | null;
  nodeId?: string | null;
  characterNodeIds?: string[];
  chapterIds?: string[];
  chapterRefs?: ForeshadowChapterRef[];
  notes?: string;
}

export type ForeshadowPatch = Partial<ForeshadowInput>;

export interface CreateAudioJobInput {
  chapterId: string;
  voiceId: string;
  provider?: 'sapi' | 'openai';
  rate?: number;
  volume?: number;
}

export interface AudioJobWithFile extends AudioJob {
  exists: boolean;
  size: number | null;
  mediaUrl: string | null;
}

export interface NovelErrorShape {
  code: string;
  message: string;
  details?: unknown;
  status?: number;
}

/** 多实例：每个实例拥有独立的 userData、数据库与设置。 */
export interface InstanceSummary {
  id: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string | null;
}

export type ProjectWithStats = Project;

export interface SearchHit {
  projectId: string;
  chapterId: string;
  chapterName: string;
  stageName: string | null;
  snippet: string;
}
