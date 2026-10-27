import { APP_VERSION, API_VERSION, ERROR_CODES, RETENTION_NOTE } from '@shared/constants';
import { listOperations } from './openapi';
import type { AppCore } from '../core';
import fs from 'node:fs';

export interface AgentGuideOptions {
  core: AppCore;
  baseUrl: string;
  /** 用户点击复制时传入真实令牌；公开端点不返回令牌。 */
  token?: string;
  endpointFilePath?: string;
  dataDir?: string;
}

function opsTable(): string {
  const rows = listOperations();
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const tag = row.tags[0] ?? '其他';
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push(row);
  }
  const out: string[] = [];
  for (const [tag, list] of groups) {
    out.push(`\n### ${tag}\n`);
    out.push('| 方法 | 路径 | 说明 | 高危 |');
    out.push('| --- | --- | --- | --- |');
    for (const r of list) {
      out.push(`| ${r.method} | \`${r.path}\` | ${r.summary} | ${r.destructive ? '是' : ''} |`);
    }
  }
  return out.join('\n');
}

export function buildAgentGuide(options: AgentGuideOptions): string {
  const { baseUrl, token } = options;
  const tokenDisplay = token ? token : '<访问令牌：请在软件「Agent 接入」页面点击“复制完整 Agent 接入文档”自动填入>';
  const endpointPath =
    options.endpointFilePath ??
    (options.core ? `${options.core.dataDir}${require('node:path').sep}api-endpoint.json` : '<用户数据目录>/api-endpoint.json');
  const dataDir = options.dataDir ?? options.core?.dataDir ?? '<用户数据目录>';

  let projectCount = 0;
  try {
    projectCount = options.core.projects.list().length;
  } catch {
    projectCount = 0;
  }

  return `# 大师小说工作台 · Agent 接入文档

> 版本：软件 ${APP_VERSION} · API ${API_VERSION}
> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}
> 当前数据库项目数：${projectCount}

本文档是给外部 AI Agent / 自动化脚本的**完整操作手册**。所有接口均已在软件中真实实现，文档与实现保持同步。请按「服务发现 → 鉴权 → 调用 → 校验」的顺序使用。

---

## 1. 服务地址与发现机制

- 服务地址（本次运行）：\`${baseUrl}\`
- 服务只监听 \`127.0.0.1\`（本机回环地址），局域网与公网无法访问。
- **不要写死端口**：软件端口若被占用会自动顺延，且每次启动可能不同。请始终从服务发现文件读取当前地址：

\`\`\`text
${endpointPath}
\`\`\`

文件内容示例：

\`\`\`json
{
  "app": "大师小说工作台",
  "appVersion": "${APP_VERSION}",
  "apiVersion": "${API_VERSION}",
  "baseUrl": "${baseUrl}",
  "host": "127.0.0.1",
  "port": ${new URL(baseUrl).port || 45871},
  "auth": { "type": "bearer", "header": "Authorization: Bearer <token>" },
  "docs": "${baseUrl}/api/v1/agent-guide",
  "openapi": "${baseUrl}/api/v1/openapi.json",
  "pid": ${process.pid},
  "updatedAt": "${new Date().toISOString()}"
}
\`\`\`

> 说明：发现文件中**不包含令牌**，避免任何本地程序读取文件后获得写权限。令牌只在用户主动复制时提供。

其他连接方式：

- 健康检查：\`GET ${baseUrl}/api/v1/health\`（无需令牌）
- 版本：\`GET ${baseUrl}/api/v1/version\`（无需令牌）
- OpenAPI 3.1 定义：\`GET ${baseUrl}/api/v1/openapi.json\`（无需令牌，可导入 Postman / Apifox / 代码生成器）
- Agent 文档（本文件）：\`GET ${baseUrl}/api/v1/agent-guide\`

---

## 2. 身份验证

- 方式：HTTP Bearer Token
- 请求头：\`Authorization: Bearer ${tokenDisplay}\`
- 令牌：${token ? '本次复制的文档已包含真实令牌，请妥善保管，不要提交到公开仓库。' : '请让用户在软件「Agent 接入」页面复制完整文档，令牌会填入此处；也可点击“重新生成令牌”。'}
- 除 \`/health\`、\`/version\`、\`/openapi.json\`、\`/agent-guide\` 外，所有接口都必须携带令牌。
- 令牌错误或缺失返回 \`401 UNAUTHORIZED\`。
- 跨站来源（浏览器 Origin 非本机、Sec-Fetch-Site: cross-site）返回 \`403 FORBIDDEN\`。
- 可通过请求头 \`X-Dashi-Actor: 你的Agent名称\` 标记调用方，日志会记录该名称，便于用户审计。

---

## 3. 数据结构

### 3.1 项目 Project

\`\`\`json
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
\`\`\`

- \`id\` 由服务端生成，稳定不变；不要用项目名称作为标识。

### 3.2 阶段 Stage

\`\`\`json
{ "id": "stg_...", "projectId": "prj_...", "name": "第一阶段：战云密布", "summary": "战云密布，局势一触即发。", "sortOrder": 0, "chapterCount": 3, "wordCount": 12000 }
\`\`\`

- \`summary\` 是阶段简介，与大纲中绑定的故事阶段节点（\`type=stage\`）**双向同步**。

### 3.3 章节 Chapter

\`\`\`json
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
\`\`\`

- 章节 ID 由服务端生成，与名称无关；重命名不会改变 ID。
- \`summary\` 是章节简介，与大纲中绑定的具体章节节点（\`type=chapter\`）**双向同步**。创建时只需 \`name\`，简介可留空。
- \`sortOrder\` 为全项目顺序，越小越靠前。

### 3.4 章节正文与版本

\`\`\`json
{
  "chapterId": "chp_...",
  "content": "一八七〇年七月，巴黎的夏天闷热得反常。",
  "revision": 7,
  "wordCount": 3200,
  "updatedAt": "2026-10-27T00:12:00.000Z"
}
\`\`\`

${RETENTION_NOTE}

- 保存返回 \`revision\` 新版本号；把该值作为下一次保存的 \`baseRevision\` 可实现乐观并发控制。
- 版本不一致返回 \`409 CONFLICT\`，此时应重新 \`GET /content\` 后再决定合并或覆盖。

### 3.5 大纲节点 OutlineNode

\`\`\`json
{
  "id": "nod_...",
  "projectId": "prj_...",
  "type": "event",
  "title": "和同桌打了一架",
  "description": "因为一支钢笔吵起来，动手后被班主任叫去办公室，从此结下梁子。",
  "x": 320,
  "y": 180,
  "width": 230,
  "height": 116,
  "color": null,
  "notes": "打架这段要写出少年意气，不要写成暴力。",
  "data": { "time": "高一上学期 10 月", "location": "教室后排" }
}
\`\`\`

节点另有 \`notes\` 字段（备注，不限字数，可 \`PATCH notes=""\` 清空，或调用 \`POST /api/v1/outline/nodes/{nodeId}/clear-notes\`）。

#### 节点类型 \`type\` 一览

| 值 | 中文 | 一句话作用 | \`data\` 常用字段 |
| --- | --- | --- | --- |
| \`stage\` | 故事阶段 | **长期时间段**（可绑定真实阶段） | \`stageId\`、\`goal\` |
| \`event\` | 剧情事件 | **阶段内发生的具体小事** | \`time\`、\`location\` |
| \`chapter\` | 具体章节 | **真正写正文的章节**（可绑定真实章节） | \`chapterId\` |
| \`character\` | 人物 | 人物档案 | \`role\`、\`age\`、\`appearance\`、\`personality\` |
| \`foreshadow\` | 伏笔 | 跨多个事件/章节的线索 | \`foreshadowId\` |
| \`note\` | 备注 | 自由文本、资料、待办 | \`notes\` |

---

#### ⭐ 重点：\`event\`（剧情事件）到底怎么用

**这是最容易被误用的类型。请务必读完本节。**

##### 一句话定义

> **剧情事件 = 故事阶段这个长期时间段里，发生的某一件具体的小事。**

它**不是**章节，**不是**阶段，也**不是**伏笔。它是"情节的颗粒"，用来把一段漫长的生活拆成一个个可以讲的瞬间。

##### 三类节点的时间尺度对比（关键）

| 类型 | 时间尺度 | 举例 | 一句话 |
| --- | --- | --- | --- |
| \`stage\` 故事阶段 | **几个月 ~ 几年**（长期） | 「我的高中三年」「普法战争时期」 | 一个大盒子 |
| \`event\` 剧情事件 | **几小时 ~ 几天**（短） | 「和同桌打了一架」「色当战役爆发」 | 盒子里的一件小事 |
| \`chapter\` 具体章节 | **一个叙事单元**（可长可短） | 「第三章 梁子结下了」 | 把小事写成正文的地方 |

##### 正确的层级关系（请按这个结构搭）

\`\`\`
故事阶段：我的高中三年                (stage 节点)
   │  contains 包含
   ├── 剧情事件：和同桌打了一架        (event 节点)
   │       │  describes / 关联章节
   │       └── 具体章节：第三章 梁子结下了   (chapter 节点)
   │
   ├── 剧情事件：第一次月考失利        (event 节点)
   │       └── 具体章节：第五章 排名单   (chapter 节点)
   │
   └── 剧情事件：运动会接力赛          (event 节点)
           └── 具体章节：第七章 最后一棒 (chapter 节点)
\`\`\`

##### 一个事件可以对应多个章节（很重要）

你提到"一个事件时间比较长，可能要用多个章节来写"。这是**完全支持**的：

\`\`\`
剧情事件：备战高考的一年
   ├── 具体章节：第九章 题海
   ├── 具体章节：第十章 模考
   └── 具体章节：第十一章 考前夜
\`\`\`

做法：把**同一个 \`event\` 节点**分别与多个 \`chapter\` 节点建立连线（或直接调用关联接口把事件节点关联到多个真实章节）。**不要**为了这件事把事件复制成三份。

##### 什么时候该建 \`event\` 节点？（判断清单）

只要满足下面任意一条，就应该建一个 \`event\` 节点：

- [ ] 这件事可以单独讲成一个"小故事"，有起因、经过、结果；
- [ ] 这件事发生在某个**故事阶段之内**，是那个阶段里的一段插曲；
- [ ] 这件事推动了人物关系或主线（比如"结下梁子"）；
- [ ] 这件事需要 1 个或多个章节来展开描写；
- [ ] 你想在画布上看清"这个阶段里到底发生了哪些事"。

反例（**不要**建 \`event\`）：

- ❌ "第一章" —— 这是章节，用 \`chapter\`；
- ❌ "我的高中三年" —— 这是长期阶段，用 \`stage\`；
- ❌ "军旗会在结局出现" —— 这是伏笔，用 \`foreshadow\`；
- ❌ "主角性格内向" —— 这是人物设定，用 \`character\` 或写进 \`notes\`；
- ❌ "第三章要写打架" —— 这是写作任务，用 \`note\` 或写进章节简介。

##### 事件节点该填什么

| 字段 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- |
| \`type\` | ✅ | 固定 \`"event"\` | \`"event"\` |
| \`title\` | ✅ | **一句话说清发生了什么**，动宾结构最好 | \`"和同桌打了一架"\` |
| \`description\` | 建议 | 起因 → 经过 → 结果，2~4 句 | \`"因为一支钢笔吵起来……"\` |
| \`data.time\` | 建议 | 在阶段内的相对时间 | \`"高一上学期 10 月"\` |
| \`data.location\` | 可选 | 地点 | \`"教室后排"\` |
| \`notes\` | 可选 | 写作提醒、素材，**不限字数** | \`"要写出少年意气"\` |
| \`x\` / \`y\` | 建议 | 画布坐标，见下方布局建议 | \`320 / 180\` |

> \`title\` 不要写成章节号。事件名要能让人一眼看出"发生了什么"，例如
> ✅「和同桌打了一架」 ❌「打架事件1」

##### 事件节点的画布布局建议

为了让画布一眼看懂，建议按列摆放（画布 x 向右为正）：

| 列 | 节点类型 | 建议 \`x\` |
| --- | --- | --- |
| 第 1 列 | \`stage\` 故事阶段 | \`80\` |
| 第 2 列 | \`event\` 剧情事件 | \`420\` |
| 第 3 列 | \`chapter\` 具体章节 | \`760\` |

同一列内按时间先后从上往下排，\`y\` 每次 +160 左右。这样打开大纲就能看到"阶段 → 事件 → 章节"的清晰流向。

##### 创建剧情事件的完整示例

**第 1 步：确认项目与阶段 ID**

\`\`\`bash
curl -s "$BASE/api/v1/projects/$PROJECT/structure" -H "$AUTH"
# 从返回的 stages[] 里取 stageId，例如 stg_abc
\`\`\`

**第 2 步：创建剧情事件节点**

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/nodes" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "type": "event",
    "title": "和同桌打了一架",
    "description": "因为一支钢笔吵起来，动手后被班主任叫去办公室，从此结下梁子。",
    "x": 420,
    "y": 180,
    "data": { "time": "高一上学期 10 月", "location": "教室后排" },
    "notes": "要写出少年意气，不要写成暴力。"
  }'
\`\`\`

返回：

\`\`\`json
{
  "node": {
    "id": "nod_event_001",
    "type": "event",
    "title": "和同桌打了一架",
    "description": "因为一支钢笔吵起来……",
    "notes": "要写出少年意气，不要写成暴力。",
    "x": 420, "y": 180, "width": 230, "height": 116,
    "data": { "time": "高一上学期 10 月", "location": "教室后排" }
  }
}
\`\`\`

**第 3 步：把事件挂到阶段下面（包含关系）**

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/edges" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"sourceId":"'"$STAGE_NODE"'","targetId":"'"$EVENT_NODE"'","relation":"contains","label":"包含"}'
\`\`\`

> \`sourceId\` 是阶段节点、\`targetId\` 是事件节点，方向是「阶段 → 事件」。
> \`relation\` 必须用 \`contains\`，不要用 \`sequence\`（\`sequence\` 表示"先发生 A 再发生 B"，不是包含关系）。

**第 4 步：把事件连到要写的章节**

\`\`\`bash
# 4a. 如果章节节点已经在画布上：建 describes 连线
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/edges" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"sourceId":"'"$EVENT_NODE"'","targetId":"'"$CHAPTER_NODE"'","relation":"sequence","label":"写入"}'

# 4b. 或者直接把事件节点关联到真实章节（推荐，会在悬停列表里出现）
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/links" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"nodeId":"'"$EVENT_NODE"'","chapterId":"'"$CHAPTER"'"}'
\`\`\`

**第 5 步：一个事件写多章**

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/links" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"nodeId":"'"$EVENT_NODE"'","chapterId":"'"$CHAPTER_2"'"}'
\`\`\`

**第 6 步：校验**

\`\`\`bash
curl -s "$BASE/api/v1/outline/nodes/$EVENT_NODE" -H "$AUTH"
curl -s "$BASE/api/v1/outline/nodes/$EVENT_NODE/chapters" -H "$AUTH"
\`\`\`

---

#### 其他类型的语义（配合理解）

- **\`stage\` 故事阶段**：长期时间段，例如"我的高中三年""普法战争时期"。**不要**把单个小故事建成阶段。
- **\`chapter\` 具体章节**：真正写正文的地方，必须绑定真实章节（\`data.chapterId\`）才能与正文/简介同步。
- **\`foreshadow\` 伏笔**：**跨越多个事件、多个章节的线索**。例如"军旗"在第 1 章埋下、第 12 章回收，中间隔了很多事件——这种情况才用伏笔，不要用事件表达。
- **\`character\` 人物**：人物档案与人物关系。
- **\`note\` 备注**：资料、灵感、待办，不参与剧情连线。

##### 伏笔 vs 剧情事件：怎么区分

| 判断 | 用 \`event\` | 用 \`foreshadow\` |
| --- | --- | --- |
| 事情在一段时间内发生并结束 | ✅ | |
| 一个线索埋下后，隔了很多事件/章节才回收 | | ✅ |
| 需要记录"埋设章节"和"预计回收章节" | | ✅ |
| 需要跟踪状态（计划中/已埋设/正在推进/已回收） | | ✅ |

##### 推荐的整体搭建顺序

1. 先在**内容页**建好阶段与章节（只要名称即可）；
2. 到大纲点「从内容生成结构」，自动得到 \`stage\` + \`chapter\` 节点和连线；
3. 在两者之间**补 \`event\` 节点**，用 \`contains\` 连到阶段，用关联接口连到章节；
4. 需要跨章线索时，再建 \`foreshadow\` 并关联相关章节。

---

### 3.6 连线 OutlineEdge

\`\`\`json
{
  "id": "edg_...",
  "sourceId": "nod_stage",
  "targetId": "nod_event",
  "relation": "contains",
  "label": "包含",
  "description": "高中三年这个阶段里，发生了这次打架。"
}
\`\`\`

连线类型 \`relation\`：

| 值 | 中文 | 什么时候用 | 方向 |
| --- | --- | --- | --- |
| \`contains\` | **包含** | 阶段包含事件 / 阶段包含章节 | 阶段 → 被包含者 |
| \`sequence\` | 先后顺序 | A 之后发生 B（事件之间的时间顺序） | 先 → 后 |
| \`causal\` | 因果推动 | A 导致 B | 因 → 果 |
| \`parallel\` | 并行发展 | A 与 B 同时发生 | 任意 |
| \`setup\` | 伏笔埋设 | A 为 B 埋下伏笔 | 埋设 → 回收 |
| \`payoff\` | 伏笔回收 | A 回收 B 的伏笔 | 回收 ← 埋设 |
| \`relation\` | 人物关系 | 人物之间的关联 | 任意 |
| \`custom\` | 自定义 | 其他关系，用 \`label\` 说明 | 任意 |

> 同一条连线可以额外填 \`label\`（显示在线上）与 \`description\`（详细说明）。
> 相同两端 + 相同 \`relation\` 不会重复创建。

---

### 3.7 导出 Export

\`\`\`json
{
  "filePath": "C:\Users\me\AppData\Roaming\大师小说工作台\exports\普法战争-节选.txt",
  "fileName": "普法战争-节选.txt",
  "chapterCount": 2,
  "wordCount": 6400,
  "bytes": 19200
}
\`\`\`

导出文件写入数据目录的 \`exports/\` 子目录，内容包含阶段标题、阶段简介、章节名、章节简介与正文。

### 3.8 关联 NodeChapterLink

\`\`\`json
{ "nodeId": "nod_...", "chapterId": "chp_...", "createdAt": "2026-10-27T00:00:00.000Z" }
\`\`\`

多对多：一个节点可关联多个章节，一个章节也可关联多个节点。

### 3.9 伏笔 Foreshadow

\`\`\`json
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
\`\`\`

状态 \`status\`：\`planned\`（计划中）、\`planted\`（已埋设）、\`developing\`（正在推进）、\`resolved\`（已回收）、\`abandoned\`（已废弃）。

### 3.10 音频任务 AudioJob

\`\`\`json
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
\`\`\`

状态流转：\`queued\`（等待中）→ \`running\`（生成中）→ \`succeeded\`（成功）/ \`failed\`（失败）；可 \`canceled\`（已取消）。成功后有 \`filePath\`、\`mediaUrl\`、\`durationMs\`、\`size\`。

---

## 4. 接口清单（全部真实可用）

${opsTable()}

> 完整参数类型、必填规则与示例见 OpenAPI 定义：\`GET ${baseUrl}/api/v1/openapi.json\`。高危接口标有 \`x-dashi-destructive: true\`。

---

## 5. 完整调用示例：从零创建一本小说

以下命令可直接复制执行（Windows PowerShell / bash 均可，按需替换变量）。

### 步骤 0：读取服务地址（不要写死端口）

\`\`\`bash
# 用户数据目录中的服务发现文件（Windows 默认路径如下）
cat "$APPDATA/大师小说工作台/api-endpoint.json"
\`\`\`

\`\`\`bash
BASE="${baseUrl}"
TOKEN="${token ?? '<从软件 Agent 接入页复制的令牌>'}"
AUTH="Authorization: Bearer $TOKEN"
\`\`\`

### 步骤 1：创建项目

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -H "X-Dashi-Actor: MyNovelAgent" \\
  -d '{"name":"普法战争","description":"1870 年的故事","genre":"历史小说"}'
\`\`\`

返回：

\`\`\`json
{ "project": { "id": "prj_2k9z8x4q1m", "name": "普法战争", "chapterCount": 0, "wordCount": 0 } }
\`\`\`

\`\`\`bash
PROJECT="prj_2k9z8x4q1m"   # 取返回的 project.id
\`\`\`

### 步骤 2：查询阶段（新项目会自动创建一个「第一阶段」）

\`\`\`bash
curl -s "$BASE/api/v1/projects/$PROJECT/stages" -H "$AUTH"
\`\`\`

若需要新的阶段：

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/stages" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -d '{"name":"第二阶段：围城"}'
\`\`\`

### 步骤 3：创建章节

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/chapters" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -d '{"name":"第一章 宣战","stageId":"stg_xxx","content":""}'
\`\`\`

\`\`\`bash
CHAPTER="chp_xxx"   # 取返回的 chapter.id
\`\`\`

### 步骤 4：写入正文

\`\`\`bash
curl -s -X PUT "$BASE/api/v1/chapters/$CHAPTER/content" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -d '{"content":"一八七〇年七月，巴黎的夏天闷热得反常。\\n\\n皇宫里，欧仁妮皇后正在读一份来自柏林的电报。"}'
\`\`\`

返回 \`{"save":{"revision":1,"wordCount":38,"unchanged":false,...}}\`。请记录 \`revision\`。

### 步骤 5：读取正文并校验

\`\`\`bash
curl -s "$BASE/api/v1/chapters/$CHAPTER/content" -H "$AUTH"
\`\`\`

校验方法：返回的 \`content.content\` 应与你写入的完全一致，\`revision\` 等于保存返回值。

### 步骤 6：创建大纲节点

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/nodes" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -d '{"type":"event","title":"色当战役","description":"法军主力被围，拿破仑三世投降。","x":320,"y":180,"data":{"time":"1870-09-01","location":"色当"}}'
\`\`\`

\`\`\`bash
NODE="nod_xxx"
\`\`\`

### 步骤 7：建立节点与章节的关联（多对多）

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/links" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -d '{"nodeId":"'"$NODE"'","chapterId":"'"$CHAPTER"'"}'
\`\`\`

再次创建同一关联不会报错（幂等）。查询：

\`\`\`bash
curl -s "$BASE/api/v1/outline/nodes/$NODE/chapters" -H "$AUTH"
curl -s "$BASE/api/v1/chapters/$CHAPTER/nodes" -H "$AUTH"
\`\`\`

### 步骤 8：创建连线

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/edges" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -d '{"sourceId":"'"$NODE"'","targetId":"'"$NODE2"'","relation":"causal","label":"导致","description":"色当战败导致第二帝国崩溃。"}'
\`\`\`

### 步骤 9：创建伏笔

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/foreshadows" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -d '{"name":"染血的军旗","status":"planted","plantedChapterId":"'"$CHAPTER"'","chapterIds":["'"$CHAPTER"'"],"nodeId":"'"$NODE"'","notes":"决战时回收"}'
\`\`\`

### 步骤 10：导出所选章节为 TXT

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/export/chapters"   -H "$AUTH" -H "Content-Type: application/json"   -d '{"chapterIds":["'"$CHAPTER"'"],"includeStageHeaders":true,"fileName":"节选.txt"}'
\`\`\`

### 步骤 11：按章节结构自动生成大纲

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/generate" -H "$AUTH"
# => {"createdStageNodes":2,"createdChapterNodes":5,"createdEdges":5}
\`\`\`

### 步骤 12：完整检查

\`\`\`bash
curl -s "$BASE/api/v1/projects/$PROJECT/structure" -H "$AUTH"
curl -s "$BASE/api/v1/projects/$PROJECT/outline" -H "$AUTH"
curl -s "$BASE/api/v1/projects/$PROJECT/foreshadows" -H "$AUTH"
\`\`\`

---

## 6. 简介同步与备注

- 章节 \`summary\` 与大纲 \`type=chapter\` 节点（\`data.chapterId\` 绑定）的 \`description\` **双向同步**；阶段 \`summary\` 与 \`type=stage\` 节点同理。
- 任一入口修改，另一处立即生效；无需额外调用同步接口。
- 节点 \`notes\` 为不限字数备注，可用 \`PATCH\` 写入，或 \`POST /api/v1/outline/nodes/{nodeId}/clear-notes\` 一键清空。
- 删除大纲节点**不会**删除真实章节或正文，仅移除画布节点与连线。

## 7. 音频任务示例

### 6.1 查询声音（先确认服务已配置）

\`\`\`bash
curl -s "$BASE/api/v1/audio/voices" -H "$AUTH"
\`\`\`

返回 \`providers[].configured\` 为 \`false\` 时表示未配置，此时创建任务会返回 \`400 PROVIDER_NOT_CONFIGURED\`，**不会伪造成功**。请在软件「音频制作 → 服务设置」中配置，或安装 Windows 语音包。

### 6.2 创建任务

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/audio/jobs" \\
  -H "$AUTH" -H "Content-Type: application/json" \\
  -d '{"chapterId":"'"$CHAPTER"'","voiceId":"Microsoft Huihui Desktop","provider":"sapi","rate":0,"volume":100}'
\`\`\`

### 6.3 轮询状态

\`\`\`bash
JOB="aud_xxx"
curl -s "$BASE/api/v1/audio/jobs/$JOB" -H "$AUTH"
\`\`\`

建议每 1–2 秒轮询一次，直到 \`status\` 为 \`succeeded\` / \`failed\` / \`canceled\`。成功时 \`filePath\` 是本机音频绝对路径，\`mediaUrl\` 可在应用内播放。

---

## 8. 错误码与处理

| HTTP | 错误码 | 含义 | 处理建议 |
| --- | --- | --- | --- |
${Object.entries(ERROR_CODES)
  .map(([code, label]) => {
    const status =
      code === 'UNAUTHORIZED'
        ? 401
        : code === 'FORBIDDEN'
          ? 403
          : code === 'NOT_FOUND'
            ? 404
            : code === 'CONFLICT' || code === 'CONFIRMATION_REQUIRED' || code === 'STAGE_NOT_EMPTY'
              ? 409
              : code === 'PROVIDER_ERROR'
                ? 502
                : code === 'INTERNAL_ERROR'
                  ? 500
                  : code === 'UNSUPPORTED'
                    ? 501
                    : 400;
    return `| ${status} | \`${code}\` | ${label} | 读取 \`error.message\` 与 \`error.details\` |`;
  })
  .join('\n')}

错误响应结构：

\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "章节名称不能为空",
    "details": { "field": "name" }
  }
}
\`\`\`

处理原则：

1. 先看 HTTP 状态码，再看 \`error.code\`。
2. \`401\` 重新获取令牌；\`403\` 检查是否跨站或高危开关；\`409\` 重新读取最新数据后重试；\`400\` 修正参数。
3. 不要盲目重试 \`4xx\`；\`5xx\` 可指数退避重试 1–2 次。
4. 所有失败都会返回结构化 JSON，不会返回伪装的成功结果。

---

## 9. 如何检查操作是否成功

- 所有成功响应为 HTTP 200，并包含实际操作结果（新对象、保存结果或删除标记）。
- 写操作建议采用「写入 → 读取校验」：
  - 创建章节后 \`GET /api/v1/chapters/{id}\`；
  - 保存正文后 \`GET /api/v1/chapters/{id}/content\`，比较 \`content\` 与 \`revision\`；
  - 创建节点后 \`GET /api/v1/outline/nodes/{id}\`；
  - 创建关联后 \`GET /api/v1/outline/nodes/{id}/chapters\`。
- 批量操作后可用 \`GET /api/v1/projects/{projectId}/structure\` 与 \`GET /api/v1/projects/{projectId}/outline\` 全量核对。

---

## 10. 数据安全与危险操作

### 9.1 默认安全策略

- 服务只监听 \`127.0.0.1\`，不绑定 \`0.0.0.0\`。
- 所有写接口需要 Bearer 令牌；令牌保存在本机数据库中，不写入服务发现文件。
- 拒绝跨站浏览器请求（Origin / Sec-Fetch-Site 校验）。
- 请求体上限 40MB，正文单次上限 32MB。
- 所有删除项目、阶段、章节、节点、伏笔、音频任务等接口默认被禁用，返回 \`403 FORBIDDEN\`，除非用户在「Agent 接入」页面主动开启「允许 API 执行高危操作」。
- 高危接口仍需 \`confirm: true\`；删除项目建议同时传 \`confirmName\` 等于项目名称。
- 删除阶段必须明确 \`chapterAction\`（move / delete），不会静默丢弃章节。

### 9.2 Agent 操作建议

- 不要删除项目或批量删除章节，除非用户明确要求。
- 覆盖正文前先读取当前内容，必要时备份到本地文件。
- 优先使用 \`baseRevision\` 防止覆盖用户在软件内的编辑。
- 所有修改都记录在 API 请求日志中，用户可在「Agent 接入」页面查看。
- 不要尝试修改数据库文件本身；请通过 API 操作，保证一致性与审计。

---

## 11. 数据位置与备份

- 数据库：\`${dataDir}\\dashi.db\`（SQLite，WAL 模式，事务写入）
- 音频文件：\`${dataDir}\\audio\\<projectId>\\\`
- 备份：\`${dataDir}\\backups\\\`（自动备份 + 手动备份，保留最近 20 份）
- 服务发现：\`${endpointPath}\`

章节正文与项目结构分表存储，单个项目上千章、数千节点仍可正常工作。所有写操作均为事务，异常退出不会破坏数据。

---

## 12. 快速自检清单

- [ ] \`GET /api/v1/health\` 返回 \`ok: true\`
- [ ] 携带令牌访问 \`GET /api/v1/projects\` 返回 \`projects\`
- [ ] 创建项目后能在软件左侧看到
- [ ] 创建章节并写入正文后，软件打开该章节能看到内容
- [ ] 创建大纲节点与关联后，软件大纲页能看到节点与章节列表
- [ ] 删除类接口在未开启高危开关时返回 403
- [ ] 修改章节简介后，绑定该章的大纲节点 description 同步变化
- [ ] 节点备注可写入超长文本，并可用 clear-notes 清空
- [ ] 导出接口返回存在的 txt 文件路径

> 如果任何接口返回 404，请访问 \`GET ${baseUrl}/api/v1/openapi.json\` 核对路径；文档与实现不一致时以 OpenAPI 为准，并请向用户反馈。
`;
}

export function writeGuideFile(path: string, content: string): void {
  fs.writeFileSync(path, content, 'utf8');
}
