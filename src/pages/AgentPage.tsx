import { useEffect, useState } from 'react';
import {
  Bot,
  Copy,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  EyeOff,
  ShieldAlert,
  Activity,
  FileJson,
  KeyRound,
  Download,
  Plug,
  ExternalLink,
  Server,
  Terminal,
  BookOpen,
} from 'lucide-react';
import type { ApiServerStatus, ApiTestResult } from '@shared/types';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { Modal } from '../components/Modal';

export function AgentPage() {
  const [status, setStatus] = useState<ApiServerStatus | null>(null);
  const [token, setToken] = useState<string>('');
  const [showToken, setShowToken] = useState(false);
  const [apiSettings, setApiSettings] = useState<{ allowDestructive: boolean; enabled: boolean } | null>(null);
  const [guide, setGuide] = useState('');
  const [logs, setLogs] = useState<
    Array<{ id: number; ts: string; method: string; path: string; status: number; durationMs: number; actor: string; summary: string }>
  >([]);
  const [test, setTest] = useState<ApiTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [openapiOpen, setOpenapiOpen] = useState(false);
  const [openapi, setOpenapi] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [s, t, settings, g, l] = await Promise.all([
        api.apiStatus(),
        api.apiToken(),
        api.apiSettings(),
        api.guide(),
        api.apiLogs(),
      ]);
      setStatus(s);
      setToken(t.token);
      setApiSettings(settings);
      setGuide(g);
      setLogs(l as typeof logs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取 Agent 状态失败');
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void api.apiLogs().then((l) => setLogs(l as typeof logs)).catch(() => undefined);
      void api.apiStatus().then(setStatus).catch(() => undefined);
    }, 6000);
    return () => window.clearInterval(timer);
  }, []);

  const copyGuide = async () => {
    setCopying(true);
    try {
      const result = await api.copyGuide();
      toast.success(`完整 Agent 接入文档已复制到剪贴板（${result.length.toLocaleString()} 字符）`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败');
    } finally {
      setCopying(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await api.copyText(text);
      toast.success(`${label}已复制`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败');
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const result = await api.apiTest();
      setTest(result);
      if (result.ok) toast.success('连接测试成功');
      else toast.error(`连接测试失败：${result.message}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const result = await api.regenerateToken();
      setToken(result.token);
      setShowToken(true);
      await refresh();
      toast.success('访问令牌已重新生成，旧令牌立即失效');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成令牌失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleDestructive = async () => {
    if (!apiSettings) return;
    setBusy(true);
    try {
      const next = await api.updateApiSettings({ allowDestructive: !apiSettings.allowDestructive });
      setApiSettings(next);
      toast.success(next.allowDestructive ? '已允许 API 执行高危操作' : '已禁止 API 执行高危操作');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setBusy(false);
    }
  };

  const loadOpenapi = async () => {
    try {
      const spec = await api.openapi();
      setOpenapi(JSON.stringify(spec, null, 2));
      setOpenapiOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取 OpenAPI 失败');
    }
  };

  const statusColor = status?.running ? 'var(--success)' : 'var(--danger)';

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">
          <Bot size={19} style={{ color: 'var(--accent)' }} />
          Agent 接入
          <span className="sub">让外部 AI Agent 通过本地 API 操作整个工作台</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={() => void refresh()}>
            <RefreshCw size={13} /> 刷新
          </button>
          <button className="btn btn-sm" onClick={() => setGuideOpen(true)}>
            <BookOpen size={13} /> 查看完整文档
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void copyGuide()} disabled={copying}>
            {copying ? <span className="spinner" /> : <Copy size={13} />}
            复制完整 Agent 接入文档
          </button>
        </div>
      </div>

      <div className="agent-page">
        <div className="agent-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <Server size={14} /> 服务状态
                </div>
                <span className="status-line">
                  <span className="dot-status" style={{ background: statusColor }} />
                  {status?.running ? '运行中' : '未运行'}
                </span>
              </div>
              <div className="card-body">
                <div className="kv-row">
                  <span className="k">服务地址</span>
                  <span className="v" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {status?.baseUrl ?? '—'}
                    <button
                      className="icon-btn"
                      style={{ marginLeft: 6 }}
                      onClick={() => status && void copyText(status.baseUrl, '服务地址')}
                      title="复制地址"
                    >
                      <Copy size={12} />
                    </button>
                  </span>
                </div>
                <div className="kv-row">
                  <span className="k">软件版本</span>
                  <span className="v">{status?.appVersion ?? '—'}</span>
                </div>
                <div className="kv-row">
                  <span className="k">API 版本</span>
                  <span className="v">{status?.apiVersion ?? '—'}</span>
                </div>
                <div className="kv-row">
                  <span className="k">鉴权方式</span>
                  <span className="v">Bearer Token（仅本机 127.0.0.1）</span>
                </div>
                <div className="kv-row">
                  <span className="k">累计请求</span>
                  <span className="v">{status?.requestCount ?? 0} 次</span>
                </div>
                <div className="kv-row">
                  <span className="k">服务发现文件</span>
                  <span className="v" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {status?.endpointFilePath ?? '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" onClick={() => void runTest()} disabled={testing}>
                    {testing ? <span className="spinner" /> : <Plug size={13} />} 连接测试
                  </button>
                  <button className="btn btn-sm" onClick={() => void loadOpenapi()}>
                    <FileJson size={13} /> 查看 API 定义
                  </button>
                  <button className="btn btn-sm" onClick={() => setGuideOpen(true)}>
                    <Terminal size={13} /> 文档预览
                  </button>
                </div>
                {test ? (
                  <div
                    className="info-note"
                    style={{
                      marginTop: 12,
                      marginBottom: 0,
                      background: test.ok ? 'var(--success-soft)' : 'var(--danger-soft)',
                      borderColor: test.ok ? '#bfe5d7' : '#f3d5d1',
                      color: test.ok ? 'var(--success)' : 'var(--danger)',
                    }}
                  >
                    {test.ok ? <CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> : <XCircle size={13} style={{ verticalAlign: -2 }} />}{' '}
                    {test.message}（HTTP {test.status}，{test.latencyMs} ms）
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <KeyRound size={14} /> 访问令牌
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{status?.tokenMasked}</span>
              </div>
              <div className="card-body">
                <div className="token-box">
                  <span className="val">{showToken ? token : status?.tokenMasked ?? '—'}</span>
                  <button className="icon-btn" onClick={() => setShowToken((v) => !v)} title={showToken ? '隐藏' : '显示'}>
                    {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button className="icon-btn" onClick={() => void copyText(token, '访问令牌')} title="复制令牌">
                    <Copy size={13} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-sm" onClick={() => void regenerate()} disabled={busy}>
                    <RefreshCw size={12} /> 重新生成令牌
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => void copyText(`Authorization: Bearer ${token}`, '鉴权请求头')}
                  >
                    <Copy size={12} /> 复制请求头
                  </button>
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  令牌只保存在本机。重新生成后旧令牌立即失效；请勿把令牌提交到公开仓库。
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <ShieldAlert size={14} /> 安全与高危操作
                </div>
              </div>
              <div className="card-body">
                <label className="checkbox-row">
                  <input type="checkbox" checked={apiSettings?.allowDestructive ?? false} onChange={() => void toggleDestructive()} disabled={busy} />
                  <span>
                    <b>允许 API 执行高危操作</b>
                    <div className="field-hint">
                      开启后，删除项目/章节/阶段、删除节点/伏笔/音频等接口才可用，且仍需请求体 confirm=true。
                      默认关闭，防止 Agent 误删数据。
                    </div>
                  </span>
                </label>
                <div className="warn-note" style={{ marginTop: 12, marginBottom: 0 }}>
                  API 仅监听 127.0.0.1，拒绝跨站浏览器请求；所有写操作记录在下方日志中，便于审计。
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <Activity size={14} /> 最近请求日志
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>最多保留 500 条</span>
              </div>
              <div className="card-body" style={{ padding: '4px 8px 8px', maxHeight: 300, overflow: 'auto' }}>
                {logs.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    还没有外部请求。按文档调用一次接口后，这里会显示调用记录。
                  </div>
                ) : (
                  <table className="api-log-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>方法</th>
                        <th>路径</th>
                        <th>状态</th>
                        <th>耗时</th>
                        <th>来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id}>
                          <td className="mono">{new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false })}</td>
                          <td className="mono">{l.method}</td>
                          <td className="mono" title={l.path} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {l.path}
                          </td>
                          <td>
                            <span
                              style={{
                                color: l.status < 300 ? 'var(--success)' : l.status < 500 ? 'var(--warning)' : 'var(--danger)',
                                fontWeight: 600,
                              }}
                            >
                              {l.status}
                            </span>
                          </td>
                          <td className="mono">{l.durationMs}ms</td>
                          <td>{l.actor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <Terminal size={14} /> 快速开始
                </div>
                <button className="btn btn-sm" onClick={() => void copyText(guide, '完整接入文档')}>
                  <Copy size={12} /> 复制文档
                </button>
              </div>
              <div className="card-body">
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.75, marginBottom: 10 }}>
                  把完整文档复制给 AI Agent，它会自动读取服务地址、鉴权方式、数据结构与调用示例。
                </div>
                <div className="code-block" style={{ fontSize: 11 }}>
{`# 1. 读取服务地址（端口可能变化，勿写死）
type "$env:APPDATA\\大师小说工作台\\api-endpoint.json"

# 2. 健康检查（无需令牌）
curl ${status?.baseUrl ?? 'http://127.0.0.1:45871'}/api/v1/health

# 3. 查询项目（需要令牌）
curl ${status?.baseUrl ?? 'http://127.0.0.1:45871'}/api/v1/projects \\
  -H "Authorization: Bearer <token>"`}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" onClick={() => void copyGuide()} disabled={copying}>
                    <Copy size={12} /> 复制完整 Agent 接入文档
                  </button>
                  <button className="btn btn-sm" onClick={() => setGuideOpen(true)}>
                    <Eye size={12} /> 查看
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      try {
                        const result = await api.exportText('dashi-agent-guide.md', guide);
                        if (!result.canceled) toast.success('Agent 文档已导出');
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : '导出失败');
                      }
                    }}
                  >
                    <Download size={12} /> 导出为文件
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <FileJson size={14} /> 接口概览
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>OpenAPI 3.1</span>
              </div>
              <div className="card-body">
                <div className="stat-grid">
                  <div className="stat">
                    <div className="k">API 版本</div>
                    <div className="v">{status?.apiVersion ?? 'v1'}</div>
                  </div>
                  <div className="stat">
                    <div className="k">接口数量</div>
                    <div className="v">50+</div>
                  </div>
                  <div className="stat">
                    <div className="k">监听地址</div>
                    <div className="v mono">127.0.0.1</div>
                  </div>
                  <div className="stat">
                    <div className="k">鉴权</div>
                    <div className="v">Bearer</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" onClick={() => void loadOpenapi()}>
                    <FileJson size={12} /> 查看 API 定义（JSON）
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      try {
                        const spec = await api.openapi();
                        const result = await api.exportText('dashi-openapi.json', JSON.stringify(spec, null, 2));
                        if (!result.canceled) toast.success('OpenAPI 文件已导出');
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : '导出失败');
                      }
                    }}
                  >
                    <Download size={12} /> 导出 openapi.json
                  </button>
                </div>
                <div className="field-hint" style={{ marginTop: 10 }}>
                  可导入 Postman / Apifox / Swagger UI 或用于代码生成。文档与实现由同一份路由定义生成，保持一致。
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <ShieldAlert size={14} /> 安全说明
                </div>
              </div>
              <div className="card-body" style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <div>· 仅绑定 127.0.0.1，局域网与公网无法访问。</div>
                <div>· 令牌保存在本地数据库，不写入服务发现文件。</div>
                <div>· 拒绝跨站请求（Origin / Sec-Fetch-Site 校验）。</div>
                <div>· 危险操作默认关闭，需用户显式开启并 confirm=true。</div>
                <div>· 所有写操作有审计日志，删除操作可先创建备份。</div>
                <div style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => void api.openDataDir()}
                  >
                    <ExternalLink size={12} /> 打开数据目录
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={guideOpen}
        title="完整 Agent 接入文档"
        subtitle="下方为实际提供给 Agent 的完整文档内容，包含服务发现、鉴权、数据结构、全部接口与调用示例。"
        width="xl"
        onClose={() => setGuideOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setGuideOpen(false)}>
              关闭
            </button>
            <button className="btn btn-primary" onClick={() => void copyGuide()}>
              <Copy size={13} /> 复制完整文档
            </button>
          </>
        }
      >
        <div className="doc-preview">{guide || '加载中…'}</div>
      </Modal>

      <Modal
        open={openapiOpen}
        title="OpenAPI 3.1 接口定义"
        subtitle="机器可读的接口定义文件，可保存为 openapi.json 后导入各类 API 工具。"
        width="xl"
        onClose={() => setOpenapiOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setOpenapiOpen(false)}>
              关闭
            </button>
            <button className="btn" onClick={() => void copyText(openapi, 'OpenAPI 定义')}>
              <Copy size={13} /> 复制 JSON
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  const result = await api.exportText('dashi-openapi.json', openapi);
                  if (!result.canceled) toast.success('已导出 openapi.json');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : '导出失败');
                }
              }}
            >
              <Download size={13} /> 导出文件
            </button>
          </>
        }
      >
        <pre className="code-block" style={{ maxHeight: '58vh' }}>{openapi || '加载中…'}</pre>
      </Modal>
    </div>
  );
}
