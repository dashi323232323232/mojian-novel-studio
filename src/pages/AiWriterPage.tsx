import { useCallback, useEffect, useState } from 'react';
import { Cpu, Play, Square, Save, FolderOpen, Wand2, RefreshCw, ScrollText } from 'lucide-react';
import type { ProjectStructure } from '@shared/types';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { errorMessage } from '../lib/bridge';

interface Props {
  projectId: string;
  structure: ProjectStructure;
}

const DEFAULT_MODEL = 'E:\\小说编辑器\\out\\Qwen3-4B-novel-Q6_K.gguf';

function sectionOf(ctx: string, name: string): string {
  const lines = ctx.split(/\r?\n/);
  const out: string[] = [];
  let on = false;
  for (const ln of lines) {
    if (ln.startsWith('## ')) {
      on = ln.includes(name);
      continue;
    }
    if (on) out.push(ln);
  }
  return out.join('\n').trim();
}

function chapterNo(ctx: string): number {
  const m = /当前章节：(\d+)/.exec(ctx);
  return m ? Number(m[1]) : 0;
}

export function AiWriterPage({ projectId, structure }: Props) {
  const [status, setStatus] = useState<any>({ running: false });
  const [deploying, setDeploying] = useState(false);
  const [modelPath, setModelPath] = useState(DEFAULT_MODEL);
  const [port, setPort] = useState(8080);
  const [ctxSize, setCtxSize] = useState(8192);
  const [gpuLayers, setGpuLayers] = useState(99);

  const [ctx, setCtx] = useState('');
  const [ctxPath, setCtxPath] = useState('');
  const [hint, setHint] = useState('');
  const [words, setWords] = useState(3000);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [logOpen, setLogOpen] = useState(false);

  const projectName = structure.project?.name ?? projectId;

  const loadCtx = useCallback(async () => {
    try {
      const r = await api.ai.contextRead(projectId, projectName);
      setCtx(r.text);
      setCtxPath(r.path);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [projectId, projectName]);

  useEffect(() => {
    void loadCtx();
  }, [loadCtx]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.ai.status();
        if (alive) setStatus(s);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const deploy = async () => {
    setDeploying(true);
    try {
      const s = await api.ai.deploy({ modelPath, port, ctxSize, gpuLayers });
      setStatus(s);
      toast.success('模型已部署到本地（端口 ' + port + '）');
    } catch (err) {
      toast.error(errorMessage(err));
      const s = await api.ai.status().catch(() => null);
      if (s) setStatus(s);
    } finally {
      setDeploying(false);
    }
  };

  const stop = async () => {
    try {
      setStatus(await api.ai.stop());
      toast.success('已停止');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const saveCtx = async () => {
    try {
      await api.ai.contextWrite(projectId, ctx);
      toast.success('上下文已保存');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const buildMessages = () => {
    const sys =
      '你是一位正在写长篇网络小说（番茄风格）的作者。必须严格遵守下面的故事上下文，人物性格、称呼、伏笔、时间线都不能自相矛盾。\n\n' +
      '【核心设定】\n' + sectionOf(ctx, '核心设定') +
      '\n\n【人物卡】\n' + sectionOf(ctx, '人物卡') +
      '\n\n【未回收伏笔】\n' + sectionOf(ctx, '未回收伏笔') +
      '\n\n【最近章节摘要】\n' + sectionOf(ctx, '章节摘要').split('### 第').slice(-3).map((b) => '### 第' + b).join('\n') +
      '\n\n【时间线与当前进度】\n' + sectionOf(ctx, '时间线与当前进度') +
      '\n\n【文风约束】\n' + sectionOf(ctx, '文风约束') +
      '\n\n写作要求：只输出正文，不要章节标题、不要任何说明或总结。';
    const user = '请写下一章，约 ' + words + ' 字。' + (hint ? '本章要点：' + hint : '');
    return [
      { role: 'system' as const, content: sys },
      { role: 'user' as const, content: user },
    ];
  };

  const generate = async () => {
    if (!status.running) {
      toast.error('先点「部署到本地」把模型跑起来');
      return;
    }
    setBusy(true);
    setOutput('');
    try {
      const r = await api.ai.chat(buildMessages(), { maxTokens: Math.min(8000, words * 2 + 400), temperature: 0.9 });
      setOutput(r.content.trim());
      toast.success('正文已生成，' + r.tokens + ' tokens');
      void extractAndUpdate(r.content.trim());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const extractAndUpdate = async (text: string) => {
    const n = chapterNo(ctx) + 1;
    try {
      const r = await api.ai.chat(
        [
          { role: 'system', content: '你是小说编辑助手，只输出 JSON。' },
          {
            role: 'user',
            content:
              '下面是第 ' + n + ' 章正文。输出 JSON：{"title":"标题","summary":"一句话概要","events":"关键事件","chars":"出场人物","new_holes":["新伏笔"],"state":"结尾处境","time":"故事内时间","place":"所在地"}\n\n正文：\n' +
              text.slice(0, 6000),
          },
        ],
        { maxTokens: 600, temperature: 0.3 },
      );
      const js = r.content;
      const s0 = js.indexOf('{');
      const s1 = js.lastIndexOf('}');
      const m = s0 >= 0 && s1 > s0 ? JSON.parse(js.slice(s0, s1 + 1)) : null;
      if (!m) return;
      const holes: string[] = m.new_holes || [];
      let next = ctx.trimEnd() + '\n\n### 第' + n + '章 ' + (m.title || '') + '\n- 一句话概要：' + (m.summary || '') +
        '\n- 关键事件：' + (m.events || '') + '\n- 出场人物：' + (m.chars || '') + '\n- 新增伏笔：' + (holes.join('；') || '无') + '\n';
      if (holes.length) {
        const anchor = next.indexOf('## 四、章节摘要');
        const tblEnd = next.lastIndexOf('\n', anchor);
        const rows = holes.map((h, i) => '| F' + n + '-' + (i + 1) + ' | 第' + n + '章 | ' + h + ' | 待定 |').join('\n');
        if (tblEnd > 0) next = next.slice(0, tblEnd + 1) + rows + '\n' + next.slice(tblEnd + 1);
      }
      next = next.replace(/- 当前章节：\d+/, '- 当前章节：' + n);
      if (m.time) next = next.replace(/- 故事内时间：.*/, '- 故事内时间：' + m.time);
      if (m.place) next = next.replace(/- 当前所在地：.*/, '- 当前所在地：' + m.place);
      if (m.state) next = next.replace(/- 上一章结尾的状态：.*/, '- 上一章结尾的状态：' + m.state);
      setCtx(next);
      await api.ai.contextWrite(projectId, next);
      toast.success('上下文已自动更新（第 ' + n + ' 章，新伏笔 ' + holes.length + ' 条）');
    } catch {
      /* 提取失败不影响正文 */
    }
  };

  const saveDraft = async () => {
    if (!output) return;
    try {
      const n = chapterNo(ctx) + 1;
      const r = await api.ai.saveDraft(projectId, '第' + String(n).padStart(3, '0') + '章', output);
      toast.success('已保存：' + r.path);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const chooseModel = async () => {
    try {
      const r = await api.ai.chooseModel();
      if (r?.path) setModelPath(r.path);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const box: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
  const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', height: '100%' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20 }}>AI 写作 · {projectName}</h2>
        <div style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>
          本地模型：部署后完全离线，不联网、不花钱。上下文文件在硬盘上，每章自动更新。
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Cpu size={16} /> 本地模型部署
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {status.running ? '运行中 · 端口 ' + status.port + ' · PID ' + status.pid : '未部署'}
          </div>
        </div>
        <div style={{ ...row, marginTop: 10 }}>
          <input className="input" style={{ flex: 1, minWidth: 320 }} value={modelPath} onChange={(e) => setModelPath(e.target.value)} placeholder="GGUF 模型路径" />
          <button className="btn btn-ghost" onClick={() => void chooseModel()}>选择文件</button>
        </div>
        <div style={{ ...row, marginTop: 8, fontSize: 13 }}>
          <span>端口</span>
          <input className="input input-sm" style={{ width: 80 }} value={port} onChange={(e) => setPort(Number(e.target.value) || 8080)} />
          <span>上下文长度</span>
          <input className="input input-sm" style={{ width: 90 }} value={ctxSize} onChange={(e) => setCtxSize(Number(e.target.value) || 8192)} />
          <span>GPU 层数</span>
          <input className="input input-sm" style={{ width: 70 }} value={gpuLayers} onChange={(e) => setGpuLayers(Number(e.target.value))} />
          <button className="btn btn-primary" disabled={deploying || status.running} onClick={() => void deploy()}>
            <Play size={14} /> {deploying ? '部署中…' : '部署到本地'}
          </button>
          <button className="btn btn-ghost" disabled={!status.running} onClick={() => void stop()}>
            <Square size={14} /> 停止
          </button>
          <button className="btn btn-ghost" onClick={() => setLogOpen((v) => !v)}>
            <ScrollText size={14} /> {logOpen ? '收起日志' : '看日志'}
          </button>
        </div>
        {logOpen ? (
          <pre style={{ marginTop: 10, maxHeight: 180, overflow: 'auto', fontSize: 11, background: 'rgba(0,0,0,0.25)', padding: 8, borderRadius: 6 }}>
            {status.log || '(暂无日志)'}
          </pre>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 0 }}>
        <div className="card" style={{ padding: 14, ...box }}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 600 }}>上下文文件（故事圣经）</div>
            <div style={{ ...row }}>
              <button className="btn btn-ghost" onClick={() => void loadCtx()}><RefreshCw size={14} /> 重新读取</button>
              <button className="btn btn-ghost" onClick={() => void saveCtx()}><Save size={14} /> 保存</button>
            </div>
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, wordBreak: 'break-all' }}>{ctxPath}</div>
          <textarea
            className="input"
            style={{ minHeight: 420, fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.6 }}
            value={ctx}
            onChange={(e) => setCtx(e.target.value)}
          />
        </div>

        <div className="card" style={{ padding: 14, ...box }}>
          <div style={{ fontWeight: 600 }}>写这一章</div>
          <input className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="本章要点，比如：鸣人第一次见自来也，被嫌弃" />
          <div style={{ ...row, fontSize: 13 }}>
            <span>目标字数</span>
            <input className="input input-sm" style={{ width: 90 }} value={words} onChange={(e) => setWords(Number(e.target.value) || 3000)} />
            <button className="btn btn-primary" disabled={busy} onClick={() => void generate()}>
              <Wand2 size={14} /> {busy ? '生成中…' : '生成正文'}
            </button>
            <button className="btn btn-ghost" disabled={!output} onClick={() => void saveDraft()}>
              <Save size={14} /> 保存草稿
            </button>
          </div>
          <textarea
            className="input"
            style={{ minHeight: 420, fontSize: 13, lineHeight: 1.8 }}
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="生成的正文会出现在这里，可以直接改。生成完会自动提取本章摘要和伏笔写回左边的上下文文件。"
          />
        </div>
      </div>
    </div>
  );
}
