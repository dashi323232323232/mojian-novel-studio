/**
 * 大纲使用说明（独立文档）。
 * 与 Agent 接入文档分开提供，方便单独复制给只关心"大纲怎么搭"的 AI。
 * 内容随代码维护，保证与实现一致（节点类型、连线类型、接口路径）。
 */
export interface OutlineGuideOptions {
  baseUrl: string;
  token?: string;
}

export function buildOutlineGuide(options: OutlineGuideOptions): string {
  const base = options.baseUrl;
  const tokenLine = options.token
    ? `Authorization: Bearer ${options.token}`
    : 'Authorization: Bearer <从软件 Agent 接入页复制的令牌>';

  return `# 大纲使用说明（给 AI Agent 的完整指南）

> 本文说明「故事阶段 / 剧情事件 / 具体章节 / 伏笔」四类节点的区别与正确用法。
> 适用软件：大师小说工作台 1.3.x，API 版本 v1。
> 服务地址：${base}
> 完整接口与鉴权见同目录 \`AGENT_GUIDE.md\`。

---

## 一、先记住这句话

> **故事阶段是一个长期时间段，剧情事件是这段时间里发生的某件具体小事，具体章节是把这件小事写成正文的地方，伏笔是隔了很多事件/章节才回收的线索。**

---

## 二、四类节点的区别

| 类型 | 时间尺度 | 例子 | 作用 | 不要用来表达 |
| --- | --- | --- | --- | --- |
| \`stage\` 故事阶段 | **几个月 ~ 几年** | 「我的高中三年」「普法战争时期」 | 一个大盒子，装下这段时间里的所有事 | 单件小事 |
| \`event\` 剧情事件 | **几小时 ~ 几天** | 「和同桌打了一架」「色当战役爆发」 | 盒子里的一件具体小事 | 章节号、长期阶段、跨章线索 |
| \`chapter\` 具体章节 | **一个叙事单元** | 「第三章 梁子结下了」 | 真正写正文的地方 | 阶段、事件 |
| \`foreshadow\` 伏笔 | **跨多个事件/章节** | 「军旗第 1 章埋下，第 12 章回收」 | 隔很久才回收的线索 | 一次性发生完的事 |

### 常见错误

| ❌ 错误做法 | ✅ 正确做法 |
| --- | --- |
| 把所有内容都建成「故事阶段」 | 阶段只放长期时间段；具体小事用「剧情事件」 |
| 把「和同桌打了一架」建成阶段 | 它是事件，挂在「高中三年」阶段下面 |
| 把「第一章」建成剧情事件 | 章节用 \`chapter\` 类型，绑定真实章节 |
| 一个事件写了 3 章，就复制 3 个事件节点 | 只建 1 个事件节点，关联 3 个章节 |
| 用 \`sequence\` 连「阶段 → 事件」 | 包含关系用 \`contains\` |
| 把跨 10 章的线索写成事件 | 用 \`foreshadow\` 伏笔，记录埋设/回收章节 |

---

## 三、正确的结构（照着搭）

\`\`\`
故事阶段：我的高中三年                      (stage)
   │  contains（包含）
   ├── 剧情事件：和同桌打了一架              (event)
   │       │  关联章节
   │       └── 具体章节：第三章 梁子结下了    (chapter)
   │
   ├── 剧情事件：第一次月考失利              (event)
   │       │  关联章节（一个事件写多章）
   │       ├── 具体章节：第五章 排名单        (chapter)
   │       └── 具体章节：第六章 家长会        (chapter)
   │
   └── 剧情事件：运动会接力赛                (event)
           └── 具体章节：第七章 最后一棒      (chapter)

伏笔：染血的军旗                            (foreshadow)
   ├── 埋设章节：第一章
   └── 回收章节：第十二章
   （中间跨过多个事件与章节，所以用伏笔）
\`\`\`

---

## 四、剧情事件（event）详细用法

### 4.1 什么时候该建事件节点

满足任意一条就应该建：

- 这件事可以单独讲成一个「小故事」，有起因、经过、结果；
- 它发生在某个故事阶段**之内**，是那个阶段里的一段插曲；
- 它推动了人物关系或主线（比如「结下梁子」）；
- 它需要用 1 个或多个章节来展开描写；
- 你想在画布上看清「这个阶段里到底发生了哪些事」。

### 4.2 事件节点的字段

| 字段 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- |
| \`type\` | ✅ | 固定 \`"event"\` | \`"event"\` |
| \`title\` | ✅ | 一句话说清发生了什么，动宾结构最好 | \`"和同桌打了一架"\` |
| \`description\` | 建议 | 起因 → 经过 → 结果，2~4 句 | \`"因为一支钢笔吵起来……"\` |
| \`data.time\` | 建议 | 在阶段内的相对时间 | \`"高一上学期 10 月"\` |
| \`data.location\` | 可选 | 地点 | \`"教室后排"\` |
| \`notes\` | 可选 | 写作提醒、素材，**不限字数** | \`"要写出少年意气"\` |
| \`x\` / \`y\` | 建议 | 画布坐标 | \`420 / 180\` |

> \`title\` 不要写章节号。要让人一眼看出「发生了什么」：
> ✅「和同桌打了一架」 ❌「打架事件1」

### 4.3 画布布局建议

| 列 | 节点类型 | 建议 \`x\` |
| --- | --- | --- |
| 第 1 列 | \`stage\` 故事阶段 | \`80\` |
| 第 2 列 | \`event\` 剧情事件 | \`420\` |
| 第 3 列 | \`chapter\` 具体章节 | \`760\` |

同一列按时间先后从上往下排，\`y\` 每次 +160 左右。

---

## 五、完整调用示例（可直接复制）

前置：已取得 \`$BASE\`（服务地址）、\`$AUTH\`（\`${tokenLine}\`）、\`$PROJECT\`（项目 ID）。

### 第 1 步：查阶段，拿到 stageId

\`\`\`bash
curl -s "$BASE/api/v1/projects/$PROJECT/structure" -H "$AUTH"
\`\`\`

从返回的 \`stages[]\` 里取 \`id\`，记为 \`$STAGE\`。

### 第 2 步：创建剧情事件

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

返回 \`{"node":{"id":"nod_event_001", ...}}\`，记为 \`$EVENT\`。

### 第 3 步：把事件挂到阶段下（包含关系）

先找到该阶段的画布节点：

\`\`\`bash
curl -s "$BASE/api/v1/projects/$PROJECT/outline/nodes?type=stage" -H "$AUTH"
\`\`\`

然后建 \`contains\` 连线（方向：阶段 → 事件）：

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/outline/edges" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"sourceId":"'"$STAGE_NODE"'","targetId":"'"$EVENT"'","relation":"contains","label":"包含"}'
\`\`\`

> ⚠️ 必须用 \`contains\`，不要用 \`sequence\`。
> \`sequence\` 表示「先发生 A，再发生 B」，是时间先后，不是包含。

### 第 4 步：把事件关联到要写的章节

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/links" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"nodeId":"'"$EVENT"'","chapterId":"'"$CHAPTER"'"}'
\`\`\`

### 第 5 步：一个事件写多章（重复调用即可）

\`\`\`bash
curl -s -X POST "$BASE/api/v1/projects/$PROJECT/links" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"nodeId":"'"$EVENT"'","chapterId":"'"$CHAPTER_2"'"}'
\`\`\`

### 第 6 步：校验

\`\`\`bash
curl -s "$BASE/api/v1/outline/nodes/$EVENT" -H "$AUTH"
curl -s "$BASE/api/v1/outline/nodes/$EVENT/chapters" -H "$AUTH"
\`\`\`

\`chapters\` 里应能看到关联的所有章节。

---

## 六、连线类型对照表

| \`relation\` | 中文 | 什么时候用 | 方向 |
| --- | --- | --- | --- |
| \`contains\` | **包含** | 阶段包含事件 / 阶段包含章节 | 阶段 → 被包含者 |
| \`sequence\` | 先后顺序 | 事件之间的时间先后 | 先 → 后 |
| \`causal\` | 因果推动 | A 导致 B | 因 → 果 |
| \`parallel\` | 并行发展 | A 与 B 同时发生 | 任意 |
| \`setup\` | 伏笔埋设 | A 为 B 埋下伏笔 | 埋设 → 回收 |
| \`payoff\` | 伏笔回收 | A 回收 B 的伏笔 | 回收 ← 埋设 |
| \`relation\` | 人物关系 | 人物之间 | 任意 |
| \`custom\` | 自定义 | 其他关系，用 \`label\` 说明 | 任意 |

---

## 七、推荐的整体搭建顺序

1. 在**内容页**建好阶段与章节（只要名称即可）；
2. 到大纲点「从内容生成结构」，自动得到阶段节点 + 章节节点 + 连线；
3. 在阶段与章节之间**补剧情事件节点**，用 \`contains\` 连到阶段、用 \`links\` 关联章节；
4. 需要跨章线索时，再建伏笔并关联相关章节；
5. 最后检查：\`GET /api/v1/projects/{id}/outline\` 应能看到完整的「阶段 → 事件 → 章节」结构。

---

## 八、自检清单

搭完大纲后，用下面几条自查：

- [ ] 每个 \`stage\` 节点的 \`title\` 是不是一个「时间段」而不是一件事？
- [ ] 每个 \`event\` 节点是不是能独立讲成一个小故事？
- [ ] 事件是否都用 \`contains\` 连到了阶段（而不是 \`sequence\`）？
- [ ] 每个事件是否至少关联了一个章节？
- [ ] 需要多章描写的事件，是否只建了 1 个事件节点、关联了多个章节？
- [ ] 跨很多章才回收的线索，是否用了 \`foreshadow\` 而不是 \`event\`？
- [ ] 画布上是否形成「阶段（左）→ 事件（中）→ 章节（右）」的流向？

全部为「是」，说明大纲结构正确。
`;
}
