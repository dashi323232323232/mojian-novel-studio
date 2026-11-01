# 大师小说工作台

> 简洁、现代、本地优先的 Windows 长篇小说创作工作台。
> 项目管理 · 阶段章节 · 图形化大纲 · 大纲正文联动 · 伏笔追踪 · 有声小说 · 本地 Agent API

**软件版本**：1.3.0 ｜ **API 版本**：v1 ｜ **平台**：Windows 10/11 x64

---

## 一、快速开始

### 方式 A：直接使用打包版（推荐）

1. 双击桌面快捷方式 **「大师小说工作台」**，或运行：
   ```
   dist-packaged\DashiNovelStudio-win32-x64\大师小说工作台.exe
   ```
2. 首次启动会自动创建本地数据库，无需安装任何额外运行时。

> 若桌面快捷方式丢失，可重新创建：
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1
> ```

### 方式 B：从源码运行（开发）

环境要求：Node.js ≥ 22.12（推荐 24.x）、Windows 10/11。

```bash
npm install          # 安装依赖（Electron 二进制较大）
npm run build        # 构建主进程 + 渲染层
npm start            # 启动桌面应用
```

开发模式（热更新）：

```bash
npm run dev          # 同时启动 Vite 与 Electron
```

重新打包：

```bash
npm run package      # 输出到 dist-packaged/DashiNovelStudio-win32-x64
```

> 若 Electron 二进制下载失败，可设置镜像：
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> npm install
> ```

---

## 二、功能总览

| 模块 | 能力 |
| --- | --- |
| 项目管理 | 创建 / 重命名 / 删除（二次确认）/ 展开折叠 / 数据隔离 / 持久化 |
| 内容页 | 阶段与章节分层、新建（右上角 ＋ 菜单，**只填名称即可创建**）、简介、重命名、改阶段、排序、折叠、删除（阶段可选移动或删除章节） |
| 简介同步 | 章节简介 / 阶段简介与大纲中绑定的「具体章节 / 故事阶段」节点**双向同步**，任一入口修改另一处立即跟随 |
| 勾选导出 | 全选阶段、全选章节、单选章节，导出为 TXT（含阶段标题、简介与正文）；也可通过 HTTP API 导出 |
| 章节编辑器 | CodeMirror 6 长文本编辑、中文输入法、撤销重做、自动保存（1.2s 防抖）、手动保存、离开保护、**仅保留当前版本 + 上一版本**并可一键回滚 |
| 图形化大纲 | React Flow 节点画布：**6 种节点类型（含「具体章节」）**、拖动 / 缩放 / 平移、连线（8 种关系，含「包含」）、节点复制删除、右侧详情、画布视口持久化 |
| 一键生成结构 | 「从内容生成结构」按内容页的阶段/章节自动生成阶段节点 → 章节节点及先后连线，重复执行不会重复创建 |
| 节点备注 | 每个节点独立备注，**不限字数**，可查看、改写、一键清空 |
| 大纲 ↔ 正文联动 | 节点与章节多对多关联、悬停查看关联章节、点击进入联动工作区、**可连续拖动分隔条**、比例按项目持久化 |
| 伏笔追踪 | 独立数据对象：名称/描述/埋设章节/预计回收章节或阶段/关联人物/关联大纲节点/状态/备注/多章节关联 |
| 音频制作 | 选择章节与声音、真实试听、真实生成（Windows SAPI 本地语音 / OpenAI 兼容在线语音）、进度、播放、导出、失败明确提示 |
| Agent 接入 | 真实本地 HTTP API、Bearer 鉴权、OpenAPI 3.1、完整 Markdown 文档一键复制、连接测试、令牌管理、高危开关、请求审计日志 |
| 可靠性 | SQLite WAL + 事务、原子写入、自动备份（10 分钟/保留 20 份）、手动备份与恢复、全库统计 |
| 数据位置 | **可自定义数据存储目录**，支持整体迁移（数据库 + 音频 + 备份）并自动重启，或仅切换已有目录，可一键恢复默认 |

---

## 三、项目目录结构

```
.
├── electron/                       # 主进程（Node 侧）
│   ├── main/
│   │   ├── index.ts                # 应用入口：窗口、媒体协议、生命周期
│   │   ├── core.ts                 # AppCore：所有能力的统一入口
│   │   ├── ipc.ts                  # IPC 白名单（渲染层与主进程通信）
│   │   ├── errors.ts               # 统一错误类型与错误码
│   │   ├── events.ts               # 数据变更事件总线
│   │   ├── util.ts                 # ID、时间、并发队列等工具
│   │   ├── db/database.ts          # SQLite 初始化、迁移、事务、备份
│   │   ├── services/
│   │   │   ├── projects.ts         # 项目、结构树、搜索
│   │   │   ├── structure.ts        # 阶段、章节、正文、双版本回溯
│   │   │   ├── outline.ts          # 大纲节点、连线、节点-章节关联
│   │   │   ├── foreshadow.ts       # 伏笔对象
│   │   │   ├── audio.ts            # 音频任务队列与状态机
│   │   │   ├── settings.ts         # 应用/项目设置、API 日志
│   │   │   └── backup.ts           # 备份与恢复
│   │   ├── adapters/tts.ts         # 语音适配器（SAPI / OpenAI 兼容）
│   │   └── api/
│   │       ├── server.ts           # HTTP 服务、鉴权、跨站防护、日志
│   │       ├── router.ts           # 全部 REST 路由
│   │       ├── openapi.ts          # OpenAPI 3.1 定义（与路由同源维护）
│   │       ├── agentGuide.ts       # 完整 Agent 接入文档生成器
│   │       └── discovery.ts        # 动态端口服务发现文件
│   └── preload/index.ts            # contextBridge 安全暴露
├── src/                            # 渲染层（React 19）
│   ├── App.tsx                     # 路由与项目数据加载
│   ├── components/
│   │   ├── Sidebar.tsx             # 左侧项目导航
│   │   ├── Modal.tsx               # 弹窗 / 确认框
│   │   ├── ui.tsx                  # Toast、菜单、空状态
│   │   ├── editor/                 # CodeMirror 编辑器 + 章节编辑核心
│   │   ├── outline/                # 画布、节点卡片、详情、悬停浮层
│   │   └── ForeshadowPanel.tsx     # 伏笔追踪
│   ├── pages/                      # 内容、编辑、大纲、联动、音频、Agent、设置、欢迎
│   ├── lib/                        # IPC 桥接、API 封装、Toast、离开保护
│   └── styles/global.css           # 设计系统与响应式样式
├── shared/                         # 主进程与渲染层共享的类型与常量
├── docs/
│   ├── openapi.json                # 机器可读 OpenAPI 3.1（39 个路径）
│   └── AGENT_GUIDE.md              # 完整 Agent 接入文档
├── scripts/                        # 构建、打包、快捷方式、OpenAPI 生成、版本提交
├── tests/
│   ├── unit/                       # 数据层与语音适配器测试
│   ├── api/                        # HTTP API 集成测试
│   └── e2e/                        # Playwright 桌面端到端测试
├── assets/icon.ico                 # 应用图标
└── dist-packaged/                  # 打包产物（Windows 可执行目录）
```

### 大纲节点的语义（重要）

很多 AI 只会用「故事阶段」和「具体章节」，导致大纲只剩骨架、缺少情节。正确的用法是三层结构：

| 类型 | 时间尺度 | 例子 | 作用 |
| --- | --- | --- | --- |
| `stage` 故事阶段 | 几个月 ~ 几年（长期） | 「我的高中三年」 | 大时间段，是"盒子" |
| `event` 剧情事件 | 几小时 ~ 几天（短） | 「和同桌打了一架」 | 盒子里的一件具体小事 |
| `chapter` 具体章节 | 一个叙事单元 | 「第三章 梁子结下了」 | 真正写正文的地方 |
| `foreshadow` 伏笔 | 跨多个事件/章节 | 「军旗第 1 章埋下、第 12 章回收」 | 隔很久才回收的线索 |

推荐结构：

```
故事阶段（高中三年）
  │ contains 包含
  ├── 剧情事件（和同桌打了一架）
  │       └── 关联章节 → 第三章
  ├── 剧情事件（第一次月考失利）
  │       └── 关联章节 → 第五章、第六章   ← 一个事件可写多章
  └── 剧情事件（运动会接力赛）
          └── 关联章节 → 第七章
```

- 事件用 `contains` 连到阶段（不要用 `sequence`）；
- 一个事件可以关联多个章节，不要复制多个事件节点；
- 跨很多章才回收的线索用伏笔，不要用事件表达。

完整的字段说明、判断清单、6 步调用示例见：

- [docs/OUTLINE_GUIDE.md](docs/OUTLINE_GUIDE.md) —— **独立的大纲使用说明**，推荐单独复制给只关心大纲搭建的 AI；
- [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) 的「3.5 大纲节点」章节 —— 完整接口文档中的对应部分。

软件「Agent 接入」页也提供 **「复制大纲使用说明」** 按钮，一键复制全文（含真实令牌与当前服务地址）。

---

## 四、数据保存位置

默认用户数据目录（Electron `userData`），**可在「设置与备份 → 数据存储位置」中更改**：

```
%APPDATA%\大师小说工作台\
├── dashi.db              # SQLite 主数据库（WAL 模式）
├── dashi.db-wal / -shm   # WAL 日志
├── api-endpoint.json     # 本地 API 服务发现文件（不含令牌）
├── audio\<projectId>\    # 生成的音频文件
└── backups\              # 自动 / 手动备份（保留最近 20 份）
```

可通过「设置与备份 → 打开数据目录」直接定位。

**更改数据存储位置**：

1. 打开「设置与备份 → 数据存储位置」；
2. 点击「选择新位置并迁移数据」，选择目标目录 → 自动复制数据库、音频与备份，校验成功后写入引导文件并重启；
3. 或点击「仅切换到已有目录」，不复制数据，适合目录中已有旧数据；
4. 点击「恢复默认位置」可回到 `%APPDATA%\大师小说工作台`。

引导文件：`%APPDATA%\大师小说工作台\data-location.json`（记录自定义数据目录，删除即恢复默认）。目标目录不能已存在 `dashi.db`，避免误覆盖。

**数据结构要点**：

- 项目、阶段、章节、正文、版本、大纲、连线、关联、伏笔、音频任务均为独立表；
- 章节正文单独存放于 `chapter_contents`，列表查询不加载正文；
- 章节使用稳定内部 ID（`chp_...`），重命名不影响任何关联；
- 所有写操作在事务中执行，异常退出由 SQLite 回滚；
- 每次保存正文会把上一版归档到 `chapter_versions` 并清理更早版本 —— **只保留当前版本 + 上一个版本**。

**环境变量**（调试/便携模式）：

| 变量 | 说明 |
| --- | --- |
| `DASHI_DATA_DIR` | 覆盖数据目录（测试或多实例） |
| `DASHI_PORTABLE=1` | 使用 exe 同级 `data/` 作为数据目录 |
| `DASHI_DEV=1` / `DASHI_DEV_URL` | 开发模式加载 Vite 地址 |

---

## 五、Agent 接入（本地 API）

### 5.1 获取文档

打开软件左侧底部 **「Agent 接入」**：

- 点击 **「复制完整 Agent 接入文档」** 将完整 Markdown 文档（含真实令牌、服务地址、数据结构、全部接口、调用示例、错误码、安全说明）复制到剪贴板，直接粘贴给外部 AI Agent。
- 「查看完整文档」可预览；「查看 API 定义」查看 OpenAPI 3.1 JSON；「连接测试」验证服务可用性。
- 文档同时以文件形式提供：[docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md)、[docs/openapi.json](docs/openapi.json)。

### 5.2 连接方式

- 服务只监听 `127.0.0.1`，默认端口 `45871`（被占用时自动顺延）。
- **不要写死端口**：从服务发现文件读取当前地址：
  ```
  %APPDATA%\大师小说工作台\api-endpoint.json
  ```
  其中 `baseUrl` 字段即当前服务地址。
- 鉴权：请求头 `Authorization: Bearer <token>`，令牌在「Agent 接入」页面查看或重新生成。
- 健康检查、版本、OpenAPI、Agent 文档四个端点无需令牌。

### 5.3 快速示例

```bash
BASE=$(node -p "require(process.env.APPDATA + '/大师小说工作台/api-endpoint.json').baseUrl")
TOKEN="<从 Agent 接入页复制的令牌>"

# 健康检查（无需令牌）
curl -s "$BASE/api/v1/health"

# 创建项目
curl -s -X POST "$BASE/api/v1/projects" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"普法战争","genre":"历史小说"}'

# 创建章节
curl -s -X POST "$BASE/api/v1/projects/<projectId>/chapters" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"第一章 宣战","stageId":"<stageId>"}'

# 写入正文
curl -s -X PUT "$BASE/api/v1/chapters/<chapterId>/content" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"一八七〇年七月，巴黎的夏天闷热得反常。"}'

# 创建大纲节点
curl -s -X POST "$BASE/api/v1/projects/<projectId>/outline/nodes" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"event","title":"色当战役","x":320,"y":180}'

# 建立节点与章节关联
curl -s -X POST "$BASE/api/v1/projects/<projectId>/links" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nodeId":"<nodeId>","chapterId":"<chapterId>"}'
```

### 5.4 安全策略

- 默认只允许本机访问，拒绝跨站浏览器请求（Origin / Sec-Fetch-Site 校验）。
- 所有写接口需要 Bearer 令牌；令牌保存在本机数据库，不写入服务发现文件。
- **高危操作默认关闭**：删除项目/阶段/章节、删除节点/伏笔/音频等接口默认返回 `403 FORBIDDEN`，需在「Agent 接入 → 安全与高危操作」中由用户主动开启；开启后仍需请求体 `confirm: true`，删除项目建议附带 `confirmName`。
- 删除阶段必须指定 `chapterAction`（`move` 或 `delete`），不会静默丢弃章节。
- 所有请求记录审计日志（最多 500 条），可在 Agent 接入页查看。

### 5.5 错误处理

| HTTP | 错误码 | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 参数校验失败 |
| 401 | `UNAUTHORIZED` | 缺少或错误的令牌 |
| 403 | `FORBIDDEN` | 跨站请求 / 高危操作未开启 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 版本冲突（乐观锁）或需要确认 |
| 409 | `STAGE_NOT_EMPTY` | 阶段内章节无处可移 |
| 502 | `PROVIDER_ERROR` | 语音服务调用失败 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

错误响应统一为：

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "章节名称不能为空", "details": {} } }
```

---

## 六、音频服务配置

### 6.1 Windows 本地语音（默认，离线免费）

- 使用系统 SAPI。若「音频制作」提示未检测到声音，请到
  **Windows 设置 → 时间和语言 → 语音 → 管理语音** 安装中文语音包。
- 本机已验证可用声音：`Microsoft Huihui Desktop`（zh-CN）、`Microsoft Yaoyao`（zh-CN）等。
- 在「音频制作 → 服务设置」可调整默认语速。

### 6.2 OpenAI 兼容在线语音（可选）

在「音频制作 → 服务设置」填写：

| 配置项 | 说明 |
| --- | --- |
| API 密钥 | 仅保存在本机数据库，不进入文档与日志 |
| 服务地址 | 需兼容 `POST /audio/speech`，可指向自建网关 |
| 模型 | 例如 `gpt-4o-mini-tts` |
| 默认音色 | 例如 `alloy` |

> 使用在线服务会产生费用并受服务商条款约束。生成失败时软件显示具体错误，**不会伪造成功结果**。

---

## 七、开发与测试

```bash
npm run build          # 类型检查 + 构建
npm test               # 数据层 + API + 语音适配器（46 项）
npm run test:e2e       # Playwright 桌面端到端（需先 build）
npm run openapi        # 重新生成 docs/openapi.json 与 docs/AGENT_GUIDE.md
npm run package        # 打包 Windows 应用
```

### 已执行的验证

| 测试集 | 结果 |
| --- | --- |
| 单元 / 数据层（`tests/unit/core.test.ts`） | 21 / 21 通过 |
| 简介同步（`tests/unit/summary-sync.test.ts`） | 9 / 9 通过 |
| 新增接口（`tests/api/features-v2.test.ts`） | 8 / 8 通过 |
| 新功能桌面端（`tests/e2e/features-v2.mjs`） | 22 / 22 通过 |
| 导出与结构生成接口（`tests/api/export-generate.test.ts`） | 7 / 7 通过 |
| 结构生成桌面端（`tests/e2e/generate-structure.mjs`） | 5 / 5 通过 |
| 大纲说明文档（`tests/api/outline-guide.test.ts`） | 8 / 8 通过 |
| 大纲说明界面（`tests/e2e/outline-guide.mjs`） | 7 / 7 通过 |
| 切换章节滚动重置（`tests/e2e/scroll-reset.mjs`） | 7 / 7 通过 |
| 数据目录迁移（`tests/e2e/data-move.mjs`） | 5 / 5 通过 |
| 打包版新功能（`tests/e2e/packed-v2.mjs`） | 7 / 7 通过 |
| 语音适配器（`tests/unit/tts.test.ts`） | 3 / 3 通过（真实合成 WAV） |
| HTTP API（`tests/api/api.test.ts`） | 22 / 22 通过 |
| 桌面冒烟（`tests/e2e/smoke.mjs`） | 15 / 15 通过 |
| 关窗保护（`tests/e2e/close-guard.mjs`） | 3 / 3 通过 |
| 联动工作区（`tests/e2e/link-and-guard.mjs`） | 11 / 11 通过 |
| 高级场景（`tests/e2e/advanced.mjs`） | 20 / 20 通过 |
| 综合验收（`tests/e2e/final.mjs`） | 9 / 9 通过 |
| 打包版验收（`tests/e2e/packed.mjs`） | 9 / 9 通过 |

详细结果见 [TEST_REPORT.md](TEST_REPORT.md)。

---

## 八、版本管理约定

本项目遵循「**本地只保留两个版本，GitHub 保留全部版本**」：

- 本地 Git 仅保留当前版本 + 上一个版本两个提交；
- 每次提交会把该版本快照推送到 GitHub 的 `release/<版本号>` 分支与同名标签，永久保留；
- 使用 `bash scripts/version-commit.sh "提交说明" "v1.0.0-N"` 提交，脚本会自动完成归档、压缩本地历史与推送。

GitHub 私有仓库：<https://github.com/ubyubn/mojian-novel-studio>

---

## 九、已知限制

- 音频批量生成尚未提供（已预留任务队列与 API 设计，单章生成完整可用）。
- 在线语音仅实现 OpenAI 兼容 `/audio/speech` 协议，其他供应商需新增适配器（`electron/main/adapters/tts.ts` 已按接口抽象）。
- 编辑器暂不提供 Markdown 预览与富文本排版，专注纯文本长篇写作。
- 未实现多窗口同时编辑同一章节的实时协同（通过 `baseRevision` 乐观锁避免静默覆盖）。

---

## 十、技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron 45 |
| 渲染层 | React 19 + TypeScript + Vite 7 + Zustand |
| 正文编辑器 | CodeMirror 6 |
| 大纲画布 | React Flow（@xyflow/react 12） |
| 数据存储 | SQLite（Node 内置 `node:sqlite`，WAL + 事务） |
| 本地 API | Node `http` 模块，手写路由 + Bearer 鉴权 + OpenAPI 3.1 |
| 语音 | Windows SAPI（PowerShell） / OpenAI 兼容 HTTP |
| 测试 | node:test + tsx、Playwright（Electron） |
| 打包 | @electron/packager + asar |
