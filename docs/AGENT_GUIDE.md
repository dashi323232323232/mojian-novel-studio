# 大师小说工作台 · Agent 接入文档

> 版本：软件 1.2.0 · API v1
> 生成时间：2026/10/27 02:55:18
> 当前数据库项目数：0

本文档是给外部 AI Agent / 自动化脚本的**完整操作手册**。所有接口均已在软件中真实实现，文档与实现保持同步。请按「服务发现 → 鉴权 → 调用 → 校验」的顺序使用。

---

## 1. 服务地址与发现机制

- 服务地址（本次运行）：`http://127.0.0.1:45871`
- 服务只监听 `127.0.0.1`（本机回环地址），局域网与公网无法访问。
- **不要写死端口**：软件端口若被占用会自动顺延，且每次启动可能不同。请始终从服务发现文件读取当前地址：

```text
%APPDATA%\大师小说工作台\api-endpoint.json
```

文件内容示例：

```json
{
  "app": "大师小说工作台",
  "appVersion": "1.2.0",
  "apiVersion": "v1",
  "baseUrl": "http://127.0.0.1:45871",
  "host": "127.0.0.1",
  "port": 45871,
  "auth": { "type": "bearer", "header": "Authorization: Bearer <token>" },
  "docs": "http://127.0.0.1:45871/api/v1/agent-guide",
  "openapi": "http://127.0.0.1:45871/api/v1/openapi.json",
  "pid": 12548,
  "updatedAt": "2026-10-26T18:55:18.359Z"
}
```

> 说明：发现文件中**不包含令牌**，避免任何本地程序读取文件后获得写权限。令牌只在用户主动复制时提供。

其他连接方式：

- 健康检查：`GET http://127.0.0.1:45871/api/v1/health`（无需令牌）
- 版本：`GET http://127.0.0.1:45871/api/v1/version`（无需令牌）
- OpenAPI 3.1 定义：`GET http://127.0.0.1:45871/api/v1/openapi.json`（无需令牌，可导入 Postman / Apifox / 代码生成器）
- Agent 文档（本文件）：`GET http://127.0.0.1:45871/api/v1/agent-guide`

---

## 2. 身份验证

- 方式：HTTP Bearer Token
- 请求头：`Authorization: Bearer <从软件 Agent 接入页复制>`
- 令牌：本次复制的文档已包含真实令牌，请妥善保管，不要提交到公开仓库。
- 除 `/health`、`/version`、`/openapi.json`、`/agent-guide` 外，所有接口都必须携带令牌。
- 令牌错误或缺失返回 `401 UNAUTHORIZED`。
- 跨站来源（浏览器 Origin 非本机、Sec-Fetch-Site: cross-site）返回 `403 FORBIDDEN`。
- 可通过请求头 `X-Dashi-Actor: 你的Agent名称` 标记调用方，日志会记录该名称，便于用户审计。

---

## 3. 数据结构

### 3.1 项目 Project

```json
{
  "id": "prj_2k9z8x4q1m",
  "name": "普法战争",
  "description": "以 1870 年普法战争为背景的长篇小说",
  "genre": "历史小说",
  "coverColor": "#5b6cff",
  "chapterCount": 12,
  "wordCount": 83452,
  "createdAt": "2026-10-27T00:00:00.000Z",
  "updatedAt": "2026-10-27T00:10:00.000Z",
  "lastOpenedAt": "2026-10-27T00:10:00.000Z"
}
```

- `id` 由服务端生成，稳定不变；不要用项目名称作为标识。

### 3.2 阶段 Stage

```json
{ "id": "stg_...", "projectId": "prj_...", "name": "第一阶段：战云密布", "summary": "战云密布，局势一触即发。", "sortOrder": 0, "chapterCount": 3, "wordCount": 12000 }
```

- `summary` 是阶段简介，与大纲中绑定的故事阶段节点（`type=stage`）**双向同步**。

### 3.3 章节 Chapter

```json
{
  "id": "chp_...",
  "projectId": "prj_...",
  "stageId": "stg_...",
  "name": "第一章 宣战",
  "summary": "巴黎的夏天，宣战的消息传遍街头。",
  "sortOrder": 0,
  "wordCount": 3200,
  "contentUpdatedAt": "2026-10-27T00:10:00.000Z"
}
```

- 章节 ID 由服务端生成，与名称无关；重命名不会改变 ID。
- `summary` 是章节简介，与大纲中绑定的具体章节节点（`type=chapter`）**双向同步**。创建时只需 `name`，简介可留空。
- `sortOrder` 为全项目顺序，越小越靠前。

### 3.4 章节正文与版本

```json
{
  "chapterId": "chp_...",
  "content": "一八七〇年七月，巴黎的夏天闷热得反常。",
  "revision": 7,
  "wordCount": 3200,
  "updatedAt": "2026-10-27T00:12:00.000Z"
}
```

章节正文采用「当前版本 + 上一个版本」的保留策略：每次保存会把上一版归档为可回溯版本，更早的版本自动清理。

- 保存返回 `revision` 新版本号；把该值作为下一次保存的 `baseRevision` 可实现乐观并发控制。
- 版本不一致返回 `409 CONFLICT`，此时应重新 `GET /content` 后再决定合并或覆盖。

### 3.5 大纲节点 OutlineNode

```json
{
  "id": "nod_...",
  "projectId": "prj_...",
  "type": "event",
  "title": "色当战役",
  "description": "法军主力被围，拿破仑三世投降。",
  "x": 320,
  "y": 180,
  "width": 230,
  "height": 116,
  "color": null,
  "data": { "time": "1870-09-01", "location": "色当", "notes": "与第二章呼应" }
}
```

节点另有 `notes` 字段（备注，不限字数，可 `PATCH notes=""` 清空，或调用 `POST /api/v1/outline/nodes/{nodeId}/clear-notes`）。

节点类型 `type`：

| 值 | 含义 | data 常用字段 |
| --- | --- | --- |
| `stage` | 故事阶段（可绑定真实阶段） | `stageId`、`goal` |
| `event` | 剧情事件 | `time`、`location` |
| `chapter` | 具体章节（可绑定真实章节） | `chapterId` |
| `character` | 人物 | `role`、`age`、`appearance`、`personality` |
| `foreshadow` | 伏笔 | `foreshadowId` |
| `note` | 备注 / 普通文本 | `notes` |

### 3.6 连线 OutlineEdge

```json
{
  "id": "edg_...",
  "sourceId": "nod_a",
  "targetId": "nod_b",
  "relation": "causal",
  "label": "导致",
  "description": "色当战败直接导致第二帝国崩溃。"
}
```

连线类型 `relation`：`sequence`（先后）、`causal`（因果）、`parallel`（并行）、`setup`（伏笔埋设）、`payoff`（伏笔回收）、`relation`（人物关系）、`custom`（自定义）。

### 3.7 导出 Export

```json
{
  "filePath": "C:UsersmeAppDataRoaming大师小说工作台exports普法战争-节选.txt",
  "fileName": "普法战争-节选.txt",
  "chapterCount": 2,
  "wordCount": 6400,
  "bytes": 19200
}
```

导出文件写入数据目录的 `exports/` 子目录，内容包含阶段标题、阶段简介、章节名、章节简介与正文。

### 3.8 关联 NodeChapterLink

```json
{ "nodeId": "nod_...", "chapterId": "chp_...", "createdAt": "2026-10-27T00:00:00.000Z" }
```

多对多：一个节点可关联多个章节，一个章节也可关联多个节点。

### 3.9 伏笔 Foreshadow

```json
{
  "id": "fsd_...",
  "projectId": "prj_...",
  "name": "染血的军旗",
  "description": "第一章出现的军旗，将在最后决战中再次出现。",
  "status": "planted",
  "plantedChapterId": "chp_1",
  "plannedResolveChapterId": "chp_12",
  "plannedResolveStageId": null,
  "nodeId": "nod_...",
  "characterNodeIds": ["nod_character"],
  "chapterIds": ["chp_1", "chp_12"],
  "chapterRefs": [
    { "chapterId": "chp_1", "role": "planted" },
    { "chapterId": "chp_12", "role": "related" }
  ],
  "notes": "需要在第十章补一个特写。"
}
```

状态 `status`：`planned`（计划中）、`planted`（已埋设）、`developing`（正在推进）、`resolved`（已回收）、`abandoned`（已废弃）。

### 3.10 音频任务 AudioJob

```json
{
  "id": "aud_...",
  "projectId": "prj_...",
  "chapterId": "chp_...",
  "chapterName": "第一章 宣战",
  "status": "queued",
  "progress": 0,
  "provider": "sapi",
  "voiceId": "Microsoft Huihui Desktop",
  "voiceName": "Microsoft Huihui Desktop",
  "rate": 0,
  "volume": 100,
  "format": "wav",
  "fileName": null,
  "filePath": null,
  "durationMs": null,
  "charCount": 3200,
  "error": null
}
```

状态流转：`queued`（等待中）→ `running`（生成中）→ `succeeded`（成功）/ `failed`（失败）；可 `canceled`（已取消）。成功后有 `filePath`、`mediaUrl`、`durationMs`、`size`。

---

## 4. 接口清单（全部真实可用）


### 系统

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | 健康检查 |  |
| GET | `/api/v1/version` | 获取软件与接口版本 |  |
| GET | `/api/v1/openapi.json` | 获取 OpenAPI 3.1 定义 |  |
| GET | `/api/v1/agent-guide` | 获取完整 Agent 接入文档（Markdown） |  |
| GET | `/api/v1/stats` | 获取全库统计 |  |
| GET | `/api/v1/search` | 搜索章节名称与正文 |  |

### 项目

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/projects` | 查询项目列表 |  |
| POST | `/api/v1/projects` | 创建项目 |  |
| GET | `/api/v1/projects/{projectId}` | 查询项目详情 |  |
| PATCH | `/api/v1/projects/{projectId}` | 重命名或修改项目 |  |
| DELETE | `/api/v1/projects/{projectId}` | 删除项目（高危） | 是 |
| GET | `/api/v1/projects/{projectId}/structure` | 查询项目的阶段与章节树 |  |
| POST | `/api/v1/projects/{projectId}/export/chapters` | 导出所选章节为 TXT 文件 |  |

### 阶段

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/projects/{projectId}/stages` | 查询阶段列表 |  |
| POST | `/api/v1/projects/{projectId}/stages` | 创建阶段 |  |
| PATCH | `/api/v1/stages/{stageId}` | 重命名阶段 |  |
| DELETE | `/api/v1/stages/{stageId}` | 删除阶段（高危） | 是 |
| POST | `/api/v1/projects/{projectId}/stages/reorder` | 调整阶段顺序 |  |

### 章节

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/projects/{projectId}/chapters` | 查询章节列表 |  |
| POST | `/api/v1/projects/{projectId}/chapters` | 创建章节 |  |
| GET | `/api/v1/chapters/{chapterId}` | 查询章节详情 |  |
| PATCH | `/api/v1/chapters/{chapterId}` | 重命名章节或修改所属阶段 |  |
| DELETE | `/api/v1/chapters/{chapterId}` | 删除章节（高危） | 是 |
| POST | `/api/v1/chapters/{chapterId}/move` | 移动章节到指定阶段与位置 |  |
| POST | `/api/v1/projects/{projectId}/chapters/reorder` | 整体调整章节顺序 |  |

### 正文

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/chapters/{chapterId}/content` | 读取章节正文 |  |
| PUT | `/api/v1/chapters/{chapterId}/content` | 保存章节正文 |  |
| GET | `/api/v1/chapters/{chapterId}/versions` | 查询当前版本与上一个版本 |  |
| GET | `/api/v1/chapters/{chapterId}/versions/{versionId}` | 读取上一个版本正文 |  |
| POST | `/api/v1/chapters/{chapterId}/versions/{versionId}/restore` | 回滚到上一个版本 |  |

### 大纲

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/projects/{projectId}/outline` | 获取完整大纲快照 |  |
| GET | `/api/v1/projects/{projectId}/outline/nodes` | 查询大纲节点 |  |
| POST | `/api/v1/projects/{projectId}/outline/nodes` | 创建大纲节点 |  |
| GET | `/api/v1/outline/nodes/{nodeId}` | 查询单个节点 |  |
| PATCH | `/api/v1/outline/nodes/{nodeId}` | 修改节点 |  |
| DELETE | `/api/v1/outline/nodes/{nodeId}` | 删除节点（需确认） | 是 |
| POST | `/api/v1/outline/nodes/{nodeId}/clear-notes` | 清空节点备注 |  |
| POST | `/api/v1/projects/{projectId}/outline/reconcile-bindings` | 按名称自动绑定阶段/章节节点 |  |
| POST | `/api/v1/outline/nodes/{nodeId}/duplicate` | 复制节点 |  |
| POST | `/api/v1/projects/{projectId}/outline/nodes/positions` | 批量保存节点位置 |  |
| GET | `/api/v1/projects/{projectId}/outline/edges` | 查询连线 |  |
| POST | `/api/v1/projects/{projectId}/outline/edges` | 创建连线 |  |
| PATCH | `/api/v1/outline/edges/{edgeId}` | 修改连线 |  |
| DELETE | `/api/v1/outline/edges/{edgeId}` | 删除连线 |  |
| POST | `/api/v1/projects/{projectId}/outline/generate` | 按章节结构自动生成大纲节点与连线 |  |

### 关联

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/projects/{projectId}/links` | 查询章节与节点关联 |  |
| POST | `/api/v1/projects/{projectId}/links` | 创建章节与节点关联 |  |
| DELETE | `/api/v1/projects/{projectId}/links` | 删除章节与节点关联 |  |
| GET | `/api/v1/outline/nodes/{nodeId}/chapters` | 查询节点关联的章节 |  |
| GET | `/api/v1/chapters/{chapterId}/nodes` | 查询章节关联的大纲节点 |  |

### 伏笔

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/projects/{projectId}/foreshadows` | 查询伏笔 |  |
| POST | `/api/v1/projects/{projectId}/foreshadows` | 创建伏笔 |  |
| GET | `/api/v1/foreshadows/{foreshadowId}` | 查询伏笔详情 |  |
| PATCH | `/api/v1/foreshadows/{foreshadowId}` | 修改伏笔 |  |
| DELETE | `/api/v1/foreshadows/{foreshadowId}` | 删除伏笔（需确认） | 是 |
| POST | `/api/v1/foreshadows/{foreshadowId}/attach-outline` | 把伏笔同步为大纲节点 |  |

### 音频

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/audio/voices` | 查询可用声音 |  |
| GET | `/api/v1/projects/{projectId}/audio/jobs` | 查询音频任务 |  |
| POST | `/api/v1/projects/{projectId}/audio/jobs` | 创建音频生成任务 |  |
| POST | `/api/v1/projects/{projectId}/audio/preview` | 试听声音样本 |  |
| GET | `/api/v1/audio/jobs/{jobId}` | 查询音频任务状态与结果 |  |
| POST | `/api/v1/audio/jobs/{jobId}/cancel` | 取消音频任务 |  |
| DELETE | `/api/v1/audio/jobs/{jobId}` | 删除音频任务及文件（需确认） | 是 |

### 设置

| 方法 | 路径 | 说明 | 高危 |
| --- | --- | --- | --- |
| GET | `/api/v1/settings` | 读取界面与 API 设置（不含密钥） |  |
| PATCH | `/api/v1/settings` | 更新界面设置 |  |

> 完整参数类型、必填规则与示例见 OpenAPI 定义：`GET http://127.0.0.1:45871/api/v1/openapi.json`。高危接口标有 `x-dashi-destructive: true`。

---

## 5. 完整调用示例：从零创建一本小说

以下命令可直接复制执行（Windows PowerShell / bash 均可，按需替换变量）。

### 步骤 0：读取服务地址（不要写死端口）

```bash
# 用户数据目录中的服务发现文件（Windows 默认路径如下）
cat "$APPDATA/大师小说工作台/api-endpoint.json"
```

```bash
BASE="http://127.0.0.1:45871"
TOKEN="<从软件 Agent 接入页复制>"
AUTH="Authorization: Bearer $TOKEN"
```

### 步骤 1：创建项目

```bash
curl -s -X POST "$BASE/api/v1/projects" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -H "X-Dashi-Actor: MyNovelAgent" \
  -d '{"name":"普法战争","description":"1870 年的故事","genre":"历史小说"}'
```

返回：

```json
{ "project": { "id": "prj_2k9z8x4q1m", "name": "普法战争", "chapterCount": 0, "wordCount": 0 } }
```

```bash
PROJECT="prj_2k9z8x4q1m"   # 取返回的 project.id
```

### 步骤 2：查询阶段（新项目会自动创建一个「第一阶段」）

```bash
curl -s "$BASE/api/v1/projects/$PROJECT/stages" -H "$AUTH"
```

若需要新的阶段：

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/stages" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"第二阶段：围城"}'
```

### 步骤 3：创建章节

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/chapters" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"第一章 宣战","stageId":"stg_xxx","content":""}'
```

```bash
CHAPTER="chp_xxx"   # 取返回的 chapter.id
```

### 步骤 4：写入正文

```bash
curl -s -X PUT "$BASE/api/v1/chapters/$CHAPTER/content" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"content":"一八七〇年七月，巴黎的夏天闷热得反常。\n\n皇宫里，欧仁妮皇后正在读一份来自柏林的电报。"}'
```

返回 `{"save":{"revision":1,"wordCount":38,"unchanged":false,...}}`。请记录 `revision`。

### 步骤 5：读取正文并校验

```bash
curl -s "$BASE/api/v1/chapters/$CHAPTER/content" -H "$AUTH"
```

校验方法：返回的 `content.content` 应与你写入的完全一致，`revision` 等于保存返回值。

### 步骤 6：创建大纲节点

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/nodes" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"event","title":"色当战役","description":"法军主力被围，拿破仑三世投降。","x":320,"y":180,"data":{"time":"1870-09-01","location":"色当"}}'
```

```bash
NODE="nod_xxx"
```

### 步骤 7：建立节点与章节的关联（多对多）

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/links" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"nodeId":"'"$NODE"'","chapterId":"'"$CHAPTER"'"}'
```

再次创建同一关联不会报错（幂等）。查询：

```bash
curl -s "$BASE/api/v1/outline/nodes/$NODE/chapters" -H "$AUTH"
curl -s "$BASE/api/v1/chapters/$CHAPTER/nodes" -H "$AUTH"
```

### 步骤 8：创建连线

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/edges" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"sourceId":"'"$NODE"'","targetId":"'"$NODE2"'","relation":"causal","label":"导致","description":"色当战败导致第二帝国崩溃。"}'
```

### 步骤 9：创建伏笔

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/foreshadows" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"染血的军旗","status":"planted","plantedChapterId":"'"$CHAPTER"'","chapterIds":["'"$CHAPTER"'"],"nodeId":"'"$NODE"'","notes":"决战时回收"}'
```

### 步骤 10：导出所选章节为 TXT

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/export/chapters"   -H "$AUTH" -H "Content-Type: application/json"   -d '{"chapterIds":["'"$CHAPTER"'"],"includeStageHeaders":true,"fileName":"节选.txt"}'
```

### 步骤 11：按章节结构自动生成大纲

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/generate" -H "$AUTH"
# => {"createdStageNodes":2,"createdChapterNodes":5,"createdEdges":5}
```

### 步骤 12：完整检查

```bash
curl -s "$BASE/api/v1/projects/$PROJECT/structure" -H "$AUTH"
curl -s "$BASE/api/v1/projects/$PROJECT/outline" -H "$AUTH"
curl -s "$BASE/api/v1/projects/$PROJECT/foreshadows" -H "$AUTH"
```

---

## 6. 简介同步与备注

- 章节 `summary` 与大纲 `type=chapter` 节点（`data.chapterId` 绑定）的 `description` **双向同步**；阶段 `summary` 与 `type=stage` 节点同理。
- 任一入口修改，另一处立即生效；无需额外调用同步接口。
- 节点 `notes` 为不限字数备注，可用 `PATCH` 写入，或 `POST /api/v1/outline/nodes/{nodeId}/clear-notes` 一键清空。
- 删除大纲节点**不会**删除真实章节或正文，仅移除画布节点与连线。

## 7. 音频任务示例

### 6.1 查询声音（先确认服务已配置）

```bash
curl -s "$BASE/api/v1/audio/voices" -H "$AUTH"
```

返回 `providers[].configured` 为 `false` 时表示未配置，此时创建任务会返回 `400 PROVIDER_NOT_CONFIGURED`，**不会伪造成功**。请在软件「音频制作 → 服务设置」中配置，或安装 Windows 语音包。

### 6.2 创建任务

```bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/audio/jobs" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"chapterId":"'"$CHAPTER"'","voiceId":"Microsoft Huihui Desktop","provider":"sapi","rate":0,"volume":100}'
```

### 6.3 轮询状态

```bash
JOB="aud_xxx"
curl -s "$BASE/api/v1/audio/jobs/$JOB" -H "$AUTH"
```

建议每 1–2 秒轮询一次，直到 `status` 为 `succeeded` / `failed` / `canceled`。成功时 `filePath` 是本机音频绝对路径，`mediaUrl` 可在应用内播放。

---

## 8. 错误码与处理

| HTTP | 错误码 | 含义 | 处理建议 |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 参数校验失败 | 读取 `error.message` 与 `error.details` |
| 401 | `UNAUTHORIZED` | 未授权：缺少或错误的访问令牌 | 读取 `error.message` 与 `error.details` |
| 403 | `FORBIDDEN` | 禁止访问：请求来源不被允许 | 读取 `error.message` 与 `error.details` |
| 404 | `NOT_FOUND` | 资源不存在 | 读取 `error.message` 与 `error.details` |
| 409 | `CONFLICT` | 数据冲突（例如版本号不一致） | 读取 `error.message` 与 `error.details` |
| 409 | `CONFIRMATION_REQUIRED` | 需要显式确认的危险操作 | 读取 `error.message` 与 `error.details` |
| 409 | `STAGE_NOT_EMPTY` | 阶段内仍有章节，需要指定处理方式 | 读取 `error.message` 与 `error.details` |
| 400 | `PROJECT_NOT_EMPTY` | 项目删除需要确认 | 读取 `error.message` 与 `error.details` |
| 400 | `RATE_LIMITED` | 请求过于频繁 | 读取 `error.message` 与 `error.details` |
| 400 | `PROVIDER_NOT_CONFIGURED` | 音频服务未配置 | 读取 `error.message` 与 `error.details` |
| 502 | `PROVIDER_ERROR` | 音频服务调用失败 | 读取 `error.message` 与 `error.details` |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 | 读取 `error.message` 与 `error.details` |
| 501 | `UNSUPPORTED` | 该能力暂不支持 | 读取 `error.message` 与 `error.details` |

错误响应结构：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "章节名称不能为空",
    "details": { "field": "name" }
  }
}
```

处理原则：

1. 先看 HTTP 状态码，再看 `error.code`。
2. `401` 重新获取令牌；`403` 检查是否跨站或高危开关；`409` 重新读取最新数据后重试；`400` 修正参数。
3. 不要盲目重试 `4xx`；`5xx` 可指数退避重试 1–2 次。
4. 所有失败都会返回结构化 JSON，不会返回伪装的成功结果。

---

## 9. 如何检查操作是否成功

- 所有成功响应为 HTTP 200，并包含实际操作结果（新对象、保存结果或删除标记）。
- 写操作建议采用「写入 → 读取校验」：
  - 创建章节后 `GET /api/v1/chapters/{id}`；
  - 保存正文后 `GET /api/v1/chapters/{id}/content`，比较 `content` 与 `revision`；
  - 创建节点后 `GET /api/v1/outline/nodes/{id}`；
  - 创建关联后 `GET /api/v1/outline/nodes/{id}/chapters`。
- 批量操作后可用 `GET /api/v1/projects/{projectId}/structure` 与 `GET /api/v1/projects/{projectId}/outline` 全量核对。

---

## 10. 数据安全与危险操作

### 9.1 默认安全策略

- 服务只监听 `127.0.0.1`，不绑定 `0.0.0.0`。
- 所有写接口需要 Bearer 令牌；令牌保存在本机数据库中，不写入服务发现文件。
- 拒绝跨站浏览器请求（Origin / Sec-Fetch-Site 校验）。
- 请求体上限 40MB，正文单次上限 32MB。
- 所有删除项目、阶段、章节、节点、伏笔、音频任务等接口默认被禁用，返回 `403 FORBIDDEN`，除非用户在「Agent 接入」页面主动开启「允许 API 执行高危操作」。
- 高危接口仍需 `confirm: true`；删除项目建议同时传 `confirmName` 等于项目名称。
- 删除阶段必须明确 `chapterAction`（move / delete），不会静默丢弃章节。

### 9.2 Agent 操作建议

- 不要删除项目或批量删除章节，除非用户明确要求。
- 覆盖正文前先读取当前内容，必要时备份到本地文件。
- 优先使用 `baseRevision` 防止覆盖用户在软件内的编辑。
- 所有修改都记录在 API 请求日志中，用户可在「Agent 接入」页面查看。
- 不要尝试修改数据库文件本身；请通过 API 操作，保证一致性与审计。

---

## 11. 数据位置与备份

- 数据库：`%APPDATA%\大师小说工作台\dashi.db`（SQLite，WAL 模式，事务写入）
- 音频文件：`%APPDATA%\大师小说工作台\audio\<projectId>\`
- 备份：`%APPDATA%\大师小说工作台\backups\`（自动备份 + 手动备份，保留最近 20 份）
- 服务发现：`%APPDATA%\大师小说工作台\api-endpoint.json`

章节正文与项目结构分表存储，单个项目上千章、数千节点仍可正常工作。所有写操作均为事务，异常退出不会破坏数据。

---

## 12. 快速自检清单

- [ ] `GET /api/v1/health` 返回 `ok: true`
- [ ] 携带令牌访问 `GET /api/v1/projects` 返回 `projects`
- [ ] 创建项目后能在软件左侧看到
- [ ] 创建章节并写入正文后，软件打开该章节能看到内容
- [ ] 创建大纲节点与关联后，软件大纲页能看到节点与章节列表
- [ ] 删除类接口在未开启高危开关时返回 403
- [ ] 修改章节简介后，绑定该章的大纲节点 description 同步变化
- [ ] 节点备注可写入超长文本，并可用 clear-notes 清空
- [ ] 导出接口返回存在的 txt 文件路径

> 如果任何接口返回 404，请访问 `GET http://127.0.0.1:45871/api/v1/openapi.json` 核对路径；文档与实现不一致时以 OpenAPI 为准，并请向用户反馈。
