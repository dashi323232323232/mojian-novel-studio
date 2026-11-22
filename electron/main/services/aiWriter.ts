import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { AiChatMessage, AiDeployInput, AiDeployStatus } from '@shared/types';

/**
 * 本地模型部署：把 llama-server 拉起为子进程，暴露 OpenAI 兼容接口给「AI 写作」用。
 */
let proc: ChildProcess | null = null;
let logBuf = '';
let state: AiDeployStatus = {
  running: false,
  port: 8080,
  modelPath: null,
  pid: null,
  startedAt: null,
  binary: null,
};

function pushLog(s: string) {
  logBuf = (logBuf + s).slice(-8000);
}

export function findServerBinary(): string | null {
  const candidates: string[] = [];
  if (process.env.AI_LLAMA_SERVER) candidates.push(process.env.AI_LLAMA_SERVER);
  const res = process.resourcesPath || '';
  if (res) {
    candidates.push(path.join(res, 'llama', 'llama-server.exe'));
    candidates.push(path.join(res, 'llamacpp', 'llama-server.exe'));
  }
  candidates.push(path.join(process.cwd(), 'out', 'llamacpp-cuda', 'llama-server.exe'));
  candidates.push(path.join(process.cwd(), 'out', 'llamacpp', 'llama-server.exe'));
  candidates.push('E:\\小说编辑器\\out\\llamacpp-cuda\\llama-server.exe');
  candidates.push('E:\\小说编辑器\\out\\llamacpp\\llama-server.exe');
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function aiStatus(): AiDeployStatus {
  if (proc && (proc.exitCode !== null || proc.killed)) {
    proc = null;
    state = { ...state, running: false, pid: null };
  }
  return { ...state, log: logBuf.slice(-4000) };
}

function healthUrl(port: number) {
  return 'http://127.0.0.1:' + port + '/health';
}

async function waitHealthy(port: number, timeoutMs = 120000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(healthUrl(port), { method: 'GET' });
      if (r.ok) return true;
    } catch {
      /* not ready */
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  return false;
}

export async function aiDeploy(input: AiDeployInput): Promise<AiDeployStatus> {
  const binary = input.binary || findServerBinary();
  if (!binary) throw new Error('没找到 llama-server.exe：请解压 llama.cpp 到 out/llamacpp-cuda/');
  const modelPath = input.modelPath;
  if (!modelPath || !fs.existsSync(modelPath)) throw new Error('模型文件不存在：' + (modelPath || '(未选择)'));
  if (proc) aiStop();
  const port = input.port || 8080;
  const ctxSize = input.ctxSize || 8192;
  const ngl = input.gpuLayers === undefined ? 99 : input.gpuLayers;
  const threads = Math.max(4, Math.min(16, os.cpus().length - 2));
  const args = ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port),
    '-c', String(ctxSize), '-ngl', String(ngl), '-fa', '--jinja', '-t', String(threads)];
  pushLog('[deploy] ' + binary + ' ' + args.join(' ') + '\n');
  proc = spawn(binary, args, { cwd: path.dirname(binary), windowsHide: true });
  proc.stdout?.on('data', (d) => pushLog(String(d)));
  proc.stderr?.on('data', (d) => pushLog(String(d)));
  proc.on('exit', (code) => {
    pushLog('\n[exit] code=' + String(code) + '\n');
    proc = null;
    state = { ...state, running: false, pid: null };
  });
  state = { running: true, port, modelPath, pid: proc.pid ?? null, startedAt: Date.now(), binary };
  const ok = await waitHealthy(port);
  if (!ok) {
    aiStop();
    throw new Error('llama-server 启动超时，检查日志（显存不足或模型路径不对）');
  }
  pushLog('\n[deploy] 就绪，端口 ' + port + '\n');
  return aiStatus();
}

export function aiStop(): AiDeployStatus {
  if (proc) {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    proc = null;
  }
  state = { ...state, running: false, pid: null };
  return aiStatus();
}

export async function aiChat(
  messages: AiChatMessage[],
  opts?: { maxTokens?: number; temperature?: number; topP?: number },
): Promise<{ content: string; tokens: number }> {
  if (!proc || !state.port) throw new Error('模型还没部署，先点「部署到本地」');
  const body = {
    model: 'local',
    messages,
    max_tokens: opts?.maxTokens ?? 4000,
    temperature: opts?.temperature ?? 0.85,
    top_p: opts?.topP ?? 0.9,
    stream: false,
  };
  const r = await fetch('http://127.0.0.1:' + state.port + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('模型返回错误 ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = (await r.json()) as any;
  return {
    content: j?.choices?.[0]?.message?.content ?? '',
    tokens: j?.usage?.completion_tokens ?? 0,
  };
}

// ---------- 上下文文件（每个项目一份，落在硬盘） ----------

function rootDir(): string {
  const dir = path.join(app.getPath('userData'), 'ai-writer');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function aiContextPath(projectId: string): string {
  return path.join(rootDir(), projectId, '上下文.md');
}

const TEMPLATE_HEAD = '# 《';
const TEMPLATE_BODY = [
  '',
  '> 这是模型的长期记忆。每次写作前自动读取，写完后自动更新。',
  '',
  '## 一、核心设定',
  '- 题材：',
  '- 世界/时代：',
  '- 主角：姓名 / 身份 / 目标 / 金手指',
  '- 核心矛盾：',
  '- 剧情主线终点：',
  '',
  '## 二、人物卡',
  '',
  '### 主角',
  '- 姓名：',
  '- 性格特点：三个词 + 一句解释',
  '- 说话风格：',
  '- 底线 / 雷点：',
  '- 当前实力 / 处境：',
  '',
  '## 三、未回收伏笔',
  '',
  '| 编号 | 埋设章节 | 内容 | 计划回收 |',
  '|---|---|---|---|',
  '',
  '## 四、章节摘要',
  '',
  '## 五、时间线与当前进度',
  '- 当前章节：0',
  '- 故事内时间：',
  '- 当前所在地：',
  '- 上一章结尾的状态：',
  '',
  '## 六、文风约束',
  '- 人称视角：第三人称限知',
  '- 段落节奏：短句为主，对话推动情节',
  '- 禁止：现代网络用语、翻译腔、总结式收尾',
  '- 每章字数：3000 字左右',
  '',
].join('\n');

export function aiReadContext(projectId: string, projectName?: string): { path: string; text: string; exists: boolean } {
  const p = aiContextPath(projectId);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tpl = TEMPLATE_HEAD + (projectName || projectId) + '》故事上下文\n' + TEMPLATE_BODY;
    fs.writeFileSync(p, tpl, 'utf8');
    return { path: p, text: tpl, exists: false };
  }
  return { path: p, text: fs.readFileSync(p, 'utf8'), exists: true };
}

export function aiWriteContext(projectId: string, text: string): { path: string } {
  const p = aiContextPath(projectId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
  return { path: p };
}

export function aiSaveDraft(projectId: string, name: string, text: string): { path: string } {
  const dir = path.join(rootDir(), projectId, '正文');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name.replace(/[\\/:*?"<>|]/g, '_') + '.txt');
  fs.writeFileSync(p, text, 'utf8');
  return { path: p };
}
