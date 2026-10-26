# 测试报告

**软件**：大师小说工作台 1.0.0（API v1）
**测试时间**：2026-10-27
**测试环境**：Windows 11 x64 · Node.js 24.20 · Electron 45.0.0 · Chromium 142
**数据目录**：临时隔离目录（每个测试集独立，互不污染）

---

## 一、测试总览

| 编号 | 测试集 | 类型 | 用例数 | 通过 | 失败 |
| --- | --- | --- | --- | --- | --- |
| 1 | `tests/unit/core.test.ts` | 数据层单元测试 | 21 | 21 | 0 |
| 2 | `tests/unit/tts.test.ts` | 语音适配器（真实合成） | 3 | 3 | 0 |
| 3 | `tests/api/api.test.ts` | HTTP API 集成测试 | 22 | 22 | 0 |
| 4 | `tests/e2e/smoke.mjs` | 桌面端冒烟 | 15 | 15 | 0 |
| 5 | `tests/e2e/link-and-guard.mjs` | 联动工作区与离开保护 | 11 | 11 | 0 |
| 6 | `tests/e2e/advanced.mjs` | 长文本 / 重启 / 画布 / 音频 | 20 | 20 | 0 |
| 7 | `tests/e2e/final.mjs` | 综合验收（隔离、连线、伏笔、备份、窄窗） | 9 | 9 | 0 |
| 8 | `tests/e2e/packed.mjs` | 打包版验收 | 9 | 9 | 0 |
| 9 | `tests/e2e/close-guard.mjs` | 关窗未保存保护 | 3 | 3 | 0 |
| **合计** | | | **113** | **113** | **0** |

---

## 二、验收标准逐项核对

| # | 验收场景 | 结果 | 验证方式 |
| --- | --- | --- | --- |
| 1 | 创建两个项目，重启后仍可读取 | ✅ | `advanced.mjs` 重启测试 + `final.mjs` 双项目隔离 |
| 2 | 多阶段多章节，改名与顺序保存正确 | ✅ | `core.test.ts` 排序/移动 + `final.mjs` 移动阶段 |
| 3 | 编辑正文、保存退出、重新进入仍在 | ✅ | `smoke.mjs`、`advanced.mjs`（11212 字符重启后存在） |
| 4 | 空白章节可直接写作 | ✅ | `smoke.mjs` 新建即进入编辑器并输入 |
| 5 | 切换章节/退出不静默丢失 | ✅ | `advanced.mjs` 未保存保护；编辑器守卫 + 自动保存 |
| 6 | 大纲创建/编辑/拖动/连线/缩放/平移 | ✅ | `advanced.mjs`（拖动、缩放、平移）+ `final.mjs`（连线） |
| 7 | 重开后节点位置与关联仍在 | ✅ | `advanced.mjs` 刷新后 `translate(312,384)` 一致 |
| 8 | 节点关联多章节、章节关联多节点 | ✅ | `api.test.ts` + `link-and-guard.mjs`（关联 2 章） |
| 9 | 悬停节点查看章节并进入编辑 | ✅ | `link-and-guard.mjs`（浮层不消失、点击进入） |
| 10 | 分隔条连续拖动，比例重开恢复 | ✅ | `link-and-guard.mjs` 拖到 0.33 后刷新仍为 0.33 |
| 11 | 右侧正文编辑、保存、切换章节 | ✅ | `link-and-guard.mjs`（自动保存 + 切换章节） |
| 12 | 音频选章选声、未配置提示、配置后真实生成 | ✅ | `tts.test.ts` 真实 WAV + `advanced.mjs` 真实生成 128.9MB WAV |
| 13 | Agent 页面展示真实文档并复制成功 | ✅ | `advanced.mjs` 复制 16,300 字符成功 |
| 14 | 外部程序按文档创建项目/章节/正文/节点/关联 | ✅ | `api.test.ts` 完整创作流程 |
| 15 | 无效参数、未授权、危险操作正确处理 | ✅ | `api.test.ts`（401/403/409/400 全覆盖） |
| 16 | 重要操作有明确状态 | ✅ | 保存状态、任务状态、Toast、加载态 |
| 17 | 无「只有外观没有功能」的关键按钮 | ✅ | 全部按钮均走真实 IPC/API，E2E 覆盖 |
| 18 | 关窗时未保存正文不丢失 | ✅ | `close-guard.mjs`：关闭自动保存后关窗，守卫自动保存，重启正文完整 |

---

## 三、关键测试细节

### 3.1 双版本保留策略（核心需求）

```
保存第 1 版 → revision=1，无上一版本
保存第 2 版 → revision=2，上一版本=第1版
保存第 3~8 版 → revision=8，上一版本=第7版，数据库仅 1 条历史记录 ✅
相同内容重复保存 → unchanged=true，不产生新版本 ✅
baseRevision 不一致 → 409 CONFLICT ✅
回滚上一版本 → 内容恢复，回滚前内容成为新的上一版本 ✅
```

### 3.2 长文本性能

- 一次性插入 12,000 字（含中文标点）：**14~16 ms**
- 编辑器保持流畅，自动保存 1.2s 防抖，保存耗时 < 1s
- 重启后 11,212 字符完整保留

### 3.3 音频真实生成

- 使用系统 `Microsoft Huihui Desktop`（zh-CN）合成
- 9,811 字章节 → WAV 51:05 / 128.9 MB，时长解析正确
- 播放器、导出、在文件夹中显示均可用
- 未配置在线服务时返回 `PROVIDER_NOT_CONFIGURED`，不伪造成功

### 3.4 安全测试

| 场景 | 期望 | 实际 |
| --- | --- | --- |
| 无令牌访问 `/api/v1/projects` | 401 | ✅ |
| 错误令牌 | 401 | ✅ |
| 跨站 Origin | 403 | ✅ |
| 高危接口未开启 | 403 | ✅ |
| 高危开启但无 confirm | 409 | ✅ |
| 删除项目 confirmName 不匹配 | 409 | ✅ |
| 不存在接口 | 404 结构化 JSON | ✅ |

### 3.5 打包版验证

- 可执行文件：`dist-packaged/DashiNovelStudio-win32-x64/大师小说工作台.exe`（238 MB）
- 桌面快捷方式：`C:\Users\qy130\OneDrive\Desktop\大师小说工作台.lnk`
- 打包版独立数据目录启动、创建项目、自动保存、大纲、音频检测、API 连接测试全部通过

---

## 四、复现测试

```bash
# 全部单元 + API 测试（46 项）
npm test

# 桌面端到端（需先 npm run build）
npm run test:e2e

# 单独运行某个 E2E
env -u ELECTRON_RUN_AS_NODE node tests/e2e/smoke.mjs
env -u ELECTRON_RUN_AS_NODE node tests/e2e/link-and-guard.mjs
env -u ELECTRON_RUN_AS_NODE node tests/e2e/advanced.mjs
env -u ELECTRON_RUN_AS_NODE node tests/e2e/final.mjs
env -u ELECTRON_RUN_AS_NODE node tests/e2e/packed.mjs
```

> Windows 下若环境中存在 `ELECTRON_RUN_AS_NODE=1`，需在运行 E2E 前清除（脚本内已自动处理）。

---

## 五、截图

| 文件 | 内容 |
| --- | --- |
| `tests/e2e/shots/01-welcome.png` | 欢迎页 |
| `tests/e2e/shots/02-content-empty.png` | 空项目内容页 |
| `tests/e2e/shots/03-editor.png` | 章节编辑器 |
| `tests/e2e/shots/04-content-list.png` | 阶段与章节列表 |
| `tests/e2e/shots/05-outline.png` | 图形化大纲 |
| `tests/e2e/shots/06-audio.png` | 音频制作 |
| `tests/e2e/shots/07-agent.png` | Agent 接入 |
| `tests/e2e/shots/08-hover.png` | 节点悬停关联章节 |
| `tests/e2e/shots/09-link.png` | 大纲-正文联动 |
| `tests/e2e/shots/10-longtext.png` | 长文本编辑 |
| `tests/e2e/shots/13-audio-done.png` | 音频生成完成 |
| `tests/e2e/shots/14-edge-select.png` | 连线关系编辑 |
| `tests/e2e/shots/15-foreshadow.png` | 伏笔追踪 |
| `tests/e2e/shots/16-settings.png` | 设置与备份 |
| `tests/e2e/shots/17-narrow.png` | 窄窗口响应式 |
| `tests/e2e/shots/18-packed-editor.png` | 打包版运行 |
