import type {
  AudioJobStatus,
  EdgeRelation,
  ForeshadowStatus,
  NodeType,
  ReadingSettings,
} from './types';

export const APP_VERSION = '1.4.0';
export const API_VERSION = 'v1';
export const API_PREFIX = '/api/v1';
export const DEFAULT_API_PORT = 45871;
export const APP_DISPLAY_NAME = '大师小说工作台';
export const APP_ID = 'com.dashi.novelstudio';

export const NODE_TYPE_META: Record<
  NodeType,
  { label: string; short: string; color: string; bg: string; border: string; description: string }
> = {
  stage: {
    label: '故事阶段',
    short: '阶段',
    color: '#6d5bd0',
    bg: '#f1eeff',
    border: '#cfc6f7',
    description: '长期时间段，例如「我的高中三年」「普法战争时期」。',
  },
  event: {
    label: '剧情事件',
    short: '事件',
    color: '#2563eb',
    bg: '#eaf2ff',
    border: '#bcd4ff',
    description: '阶段内发生的一件具体小事，例如「和同桌打了一架」。可关联一个或多个章节。',
  },
  chapter: {
    label: '具体章节',
    short: '章节',
    color: '#b02a6b',
    bg: '#fdeef5',
    border: '#f2c4dc',
    description: '绑定内容页中的真实章节，简介与正文互通。',
  },
  character: {
    label: '人物',
    short: '人物',
    color: '#0f8a6a',
    bg: '#e8f8f2',
    border: '#b5e6d7',
    description: '人物档案与人物关系，可关联章节与伏笔。',
  },
  foreshadow: {
    label: '伏笔',
    short: '伏笔',
    color: '#b25e09',
    bg: '#fff4e3',
    border: '#f3d3a5',
    description: '埋设与回收的线索，可在伏笔面板中管理状态。',
  },
  note: {
    label: '备注',
    short: '备注',
    color: '#5b6472',
    bg: '#f3f5f7',
    border: '#d8dde4',
    description: '自由文本、灵感与待办，不参与剧情连线约束。',
  },
};

export const EDGE_RELATION_META: Record<
  EdgeRelation,
  { label: string; description: string; color: string; dashed?: boolean }
> = {
  contains: { label: '包含', description: '长期阶段包含其中的剧情事件 / 章节', color: '#6d5bd0', dashed: true },
  sequence: { label: '先后顺序', description: 'A 之后发生 B', color: '#64748b' },
  causal: { label: '因果推动', description: 'A 导致 B', color: '#2563eb' },
  parallel: { label: '并行发展', description: 'A 与 B 同时发生', color: '#0f8a6a', dashed: true },
  setup: { label: '伏笔埋设', description: 'A 为 B 埋下伏笔', color: '#b25e09', dashed: true },
  payoff: { label: '伏笔回收', description: 'A 回收 B 的伏笔', color: '#c2410c' },
  relation: { label: '人物关系', description: '人物之间的关联', color: '#7c3aed', dashed: true },
  custom: { label: '自定义关系', description: '使用说明描述具体关系', color: '#475569' },
};

export const FORESHADOW_STATUS_META: Record<
  ForeshadowStatus,
  { label: string; color: string; bg: string }
> = {
  planned: { label: '计划中', color: '#475569', bg: '#eef1f5' },
  planted: { label: '已埋设', color: '#1d4ed8', bg: '#e8efff' },
  developing: { label: '正在推进', color: '#b45309', bg: '#fff3e0' },
  resolved: { label: '已回收', color: '#0f766e', bg: '#e6f7f2' },
  abandoned: { label: '已废弃', color: '#9ca3af', bg: '#f3f4f6' },
};

export const AUDIO_STATUS_META: Record<
  AudioJobStatus,
  { label: string; color: string; bg: string }
> = {
  queued: { label: '等待中', color: '#475569', bg: '#eef1f5' },
  running: { label: '生成中', color: '#1d4ed8', bg: '#e8efff' },
  succeeded: { label: '已完成', color: '#0f766e', bg: '#e6f7f2' },
  failed: { label: '失败', color: '#b91c1c', bg: '#fdecec' },
  canceled: { label: '已取消', color: '#6b7280', bg: '#f3f4f6' },
};

export const DEFAULT_EDITOR_SETTINGS = {
  fontSize: 18,
  lineHeight: 1.9,
  fontFamily: 'serif' as const,
  showWordCount: true,
  autoSave: true,
};

/** 实时朗读默认偏好：系统语音、中文、正常语速。 */
export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  engine: 'web',
  provider: 'sapi',
  voiceId: '',
  rate: 1,
  pitch: 1,
  volume: 100,
  chapterId: null,
  autoNext: true,
};

/** 语速可选项（倍率）。拖动进度条或改语速都不会重置当前朗读位置。 */
export const READING_RATE_OPTIONS = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** 关闭行为说明文案，设置页与提示共用。 */
export const CLOSE_ACTION_LABEL: Record<'tray' | 'quit', { label: string; description: string }> = {
  tray: { label: '收缩到系统托盘（默认）', description: '关闭窗口后程序留在托盘，朗读与后台任务继续运行。' },
  quit: { label: '直接退出软件', description: '关闭窗口即结束进程，未保存的修改会先提示保存。' },
};

export const DEFAULT_PROJECT_COLORS = [
  '#5b6cff',
  '#0f8a6a',
  '#b25e09',
  '#a33b6b',
  '#2563eb',
  '#6d5bd0',
  '#c2410c',
  '#0e7490',
];

export const MAX_CONTENT_BYTES = 32 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 200;
export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 200000;
export const MAX_NODES_PER_PROJECT = 20000;
export const MAX_CHAPTERS_PER_PROJECT = 100000;

export const ERROR_CODES: Record<string, string> = {
  VALIDATION_ERROR: '参数校验失败',
  UNAUTHORIZED: '未授权：缺少或错误的访问令牌',
  FORBIDDEN: '禁止访问：请求来源不被允许',
  NOT_FOUND: '资源不存在',
  CONFLICT: '数据冲突（例如版本号不一致）',
  CONFIRMATION_REQUIRED: '需要显式确认的危险操作',
  STAGE_NOT_EMPTY: '阶段内仍有章节，需要指定处理方式',
  PROJECT_NOT_EMPTY: '项目删除需要确认',
  RATE_LIMITED: '请求过于频繁',
  PROVIDER_NOT_CONFIGURED: '音频服务未配置',
  PROVIDER_ERROR: '音频服务调用失败',
  INTERNAL_ERROR: '服务器内部错误',
  UNSUPPORTED: '该能力暂不支持',
};

export const RETENTION_NOTE =
  '章节正文采用「当前版本 + 上一个版本」的保留策略：每次保存会把上一版归档为可回溯版本，更早的版本自动清理。';
