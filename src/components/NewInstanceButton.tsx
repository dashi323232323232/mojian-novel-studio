import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, X, ShieldCheck, AlertTriangle, Layers } from 'lucide-react';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

interface InstanceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string | null;
}

/**
 * 「新建实例」按钮：位于右上角窗口控制按钮的左侧。
 * 首次点击会要求输入密码（默认 Qy60811，可在弹窗内修改），
 * 校验通过后以独立 userData 启动一个新的应用实例。
 */
export function NewInstanceButton() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [isDefaultPwd, setIsDefaultPwd] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const result = await api.instances();
      setInstances(result.instances);
    } catch {
      /* 列表读取失败不阻塞创建 */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setName('');
    setError('');
    void loadList();
    void api
      .isDefaultInstancePassword()
      .then((r) => setIsDefaultPwd(r.isDefault))
      .catch(() => undefined);
  }, [open, loadList]);

  const submit = async () => {
    if (!password) {
      setError('请输入密码');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.createInstance({ password, name: name.trim() || undefined });
      toast.success(`已启动新实例「${result.instance.name}」`);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建实例失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="icon-btn instance-btn"
        onClick={() => setOpen(true)}
        title="新建实例（同时打开第二个窗口，数据相互独立）"
        aria-label="新建实例"
      >
        <Copy size={14} />
      </button>

      <Modal
        open={open}
        title="新建实例"
        subtitle="新实例拥有独立的数据目录、章节与设置，可与当前实例同时运行。"
        width="md"
        onClose={busy ? () => undefined : () => setOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? <span className="spinner" /> : <Plus size={14} />}
              创建并启动
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label">
            访问密码 <span style={{ color: 'var(--danger)' }}>*</span>
          </label>
          <input
            className="input"
            type="password"
            autoFocus
            placeholder="请输入密码"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          {error ? (
            <div className="field-hint" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          ) : (
            <div className="field-hint">密码只在本机校验，以加盐哈希保存，不会上传到任何服务器。</div>
          )}
        </div>

        <div className="field">
          <label className="field-label">实例名称（可选）</label>
          <input
            className="input"
            placeholder="例如：第二部小说"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {isDefaultPwd ? (
          <div className="warn-note">
            <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
            当前仍在使用默认密码，建议尽快修改。
          </div>
        ) : null}

        {instances.length ? (
          <div className="detail-section" style={{ marginTop: 4 }}>
            <div className="detail-section-title">
              <Layers size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
              已有实例（{instances.length}）
            </div>
            <div className="instance-list">
              {instances.map((item) => (
                <div className="instance-row" key={item.id}>
                  <span className="instance-dot" />
                  <span className="instance-name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="instance-time">
                    {new Date(item.lastOpenedAt ?? item.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="info-note" style={{ marginBottom: 0 }}>
          <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
          每个实例都有独立的数据库与音频目录，互不干扰；关闭其中任意一个不会影响其它实例。
        </div>
      </Modal>
    </>
  );
}
