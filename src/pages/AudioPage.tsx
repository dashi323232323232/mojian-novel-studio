import { useCallback, useEffect, useState } from 'react';
import { AudioLines, Headphones, Settings2, FileAudio, Info } from 'lucide-react';
import type {
  AudioProviderConfigPublic,
  ProjectStructure,
  ReadingProgress,
  ReadingSettings,
  UiSettings,
} from '@shared/types';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { Modal } from '../components/Modal';
import { ReaderView } from '../components/audio/ReaderView';
import { OfflineAudioPanel } from '../components/audio/OfflineAudioPanel';

interface Props {
  projectId: string;
  structure: ProjectStructure;
}

type Tab = 'reader' | 'offline';

/**
 * 音频制作：默认「实时朗读」——点开就能听，边读边播，不落地文件。
 * 需要导出 MP3/WAV 时切到「离线音频」，用任务队列生成。
 */
export function AudioPage({ projectId, structure }: Props) {
  const [tab, setTab] = useState<Tab>('reader');
  const [settings, setSettings] = useState<UiSettings | null>(null);
  const [readingProgress, setReadingProgress] = useState<Record<string, ReadingProgress>>({});
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<AudioProviderConfigPublic | null>(null);

  const load = useCallback(async () => {
    try {
      const [ui, ps, cfg] = await Promise.all([
        api.settings(),
        api.projectSettings(projectId),
        api.audioConfig(),
      ]);
      setSettings(ui);
      setReadingProgress(ps.readingProgress ?? {});
      setConfig(cfg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取朗读设置失败');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchReading = useCallback(
    async (patch: Partial<ReadingSettings>) => {
      // 先乐观更新，保证拖动语速/换声音立刻生效
      setSettings((prev) => (prev ? { ...prev, reading: { ...prev.reading, ...patch } } : prev));
      try {
        const next = await api.updateSettings({ reading: patch as ReadingSettings });
        setSettings(next);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '保存朗读设置失败');
      }
    },
    [],
  );

  const onProgressSaved = useCallback((progress: ReadingProgress) => {
    setReadingProgress((prev) => ({ ...prev, [progress.chapterId]: progress }));
  }, []);

  const saveConfig = async (patch: Partial<AudioProviderConfigPublic> & { openaiApiKey?: string | null }) => {
    try {
      const next = await api.setAudioConfig(patch);
      setConfig(next);
      toast.success('音频服务设置已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存设置失败');
    }
  };

  const reading = settings?.reading;

  return (
    <div className="page audio-page audio-page-v2">
      <div className="page-header">
        <div className="page-title">
          <AudioLines size={19} style={{ color: 'var(--accent)' }} />
          音频制作
          <span className="sub">
            {tab === 'reader' ? '实时朗读 · 边读边播，不需要生成文件' : '离线音频 · 生成 MP3 / WAV 后可导出'}
          </span>
        </div>
        <div className="page-actions">
          <div className="seg-tabs">
            <button className={`seg-tab${tab === 'reader' ? ' active' : ''}`} onClick={() => setTab('reader')}>
              <Headphones size={14} /> 实时朗读
            </button>
            <button className={`seg-tab${tab === 'offline' ? ' active' : ''}`} onClick={() => setTab('offline')}>
              <FileAudio size={14} /> 离线音频
            </button>
          </div>
          <button className="btn btn-sm" onClick={() => setConfigOpen(true)}>
            <Settings2 size={13} /> 服务设置
          </button>
        </div>
      </div>

      {!settings || !reading ? (
        <div className="audio-loading">正在准备朗读环境…</div>
      ) : tab === 'reader' ? (
        <ReaderView
          projectId={projectId}
          structure={structure}
          settings={reading}
          rememberReading={settings.rememberReading}
          progressMap={readingProgress}
          onSettingsChange={(patch) => void patchReading(patch)}
          onProgressSaved={onProgressSaved}
          onOpenConfig={() => setConfigOpen(true)}
        />
      ) : (
        <div className="audio-offline-wrap">
          <div className="info-note" style={{ marginBottom: 14 }}>
            <Info size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
            离线音频会把整章合成为文件，耗时与占用磁盘；只想听书时请用「实时朗读」。
          </div>
          <OfflineAudioPanel
            projectId={projectId}
            structure={structure}
            provider={reading.provider}
            readerVoiceId={reading.voiceId}
            onProviderChange={(provider) => void patchReading({ provider })}
            onOpenConfig={() => setConfigOpen(true)}
          />
        </div>
      )}

      <AudioConfigModal
        open={configOpen}
        config={config}
        onClose={() => setConfigOpen(false)}
        onSave={(patch) => void saveConfig(patch)}
      />
    </div>
  );
}

function AudioConfigModal({
  open,
  config,
  onClose,
  onSave,
}: {
  open: boolean;
  config: AudioProviderConfigPublic | null;
  onClose: () => void;
  onSave: (patch: Partial<AudioProviderConfigPublic> & { openaiApiKey?: string | null }) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(config?.openaiBaseUrl ?? '');
  const [model, setModel] = useState(config?.openaiModel ?? '');
  const [voice, setVoice] = useState(config?.openaiVoice ?? 'alloy');
  const [apiKey, setApiKey] = useState('');
  const [sapiRate, setSapiRate] = useState(config?.sapiRate ?? 0);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.openaiBaseUrl);
      setModel(config.openaiModel);
      setVoice(config.openaiVoice);
      setSapiRate(config.sapiRate);
    }
  }, [config]);

  return (
    <Modal
      open={open}
      title="音频服务设置"
      subtitle="实时朗读使用系统自带语音；离线音频可用本地语音或在线语音服务。"
      width="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave({
                openaiBaseUrl: baseUrl,
                openaiModel: model,
                openaiVoice: voice,
                sapiRate,
                ...(apiKey ? { openaiApiKey: apiKey } : {}),
              });
              setApiKey('');
              onClose();
            }}
          >
            保存设置
          </button>
        </>
      }
    >
      <div className="detail-section">
        <div className="detail-section-title">实时朗读（系统语音）</div>
        <div className="field-hint" style={{ marginBottom: 8 }}>
          朗读声音直接来自 Windows 系统语音，离线、免费、即点即读。可在下方的「离线音频」中设置默认语速。
        </div>
      </div>
      <div className="detail-section">
        <div className="detail-section-title">Windows 本地语音（SAPI）</div>
        <div className="field-hint" style={{ marginBottom: 8 }}>
          离线音频使用系统已安装的语音包，离线、免费。若没有中文声音，请到 Windows 设置中安装「中文（简体）语音」。
        </div>
        <div className="field">
          <label className="field-label">默认语速（-10 ~ 10）</label>
          <input
            className="input"
            type="number"
            min={-10}
            max={10}
            value={sapiRate}
            onChange={(e) => setSapiRate(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="detail-section">
        <div className="detail-section-title">OpenAI 兼容在线语音</div>
        <div className="field">
          <label className="field-label">API 密钥 {config?.openaiApiKeySet ? '（已配置，留空保持不变）' : ''}</label>
          <input
            className="input"
            type="password"
            placeholder={config?.openaiApiKeySet ? '••••••••（已保存）' : 'sk-...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="field-hint">密钥仅保存在本机数据库，不会写入 API 文档或日志。</div>
        </div>
        <div className="field">
          <label className="field-label">服务地址</label>
          <input
            className="input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
          <div className="field-hint">需兼容 POST /audio/speech 接口，可指向自建网关。</div>
        </div>
        <div className="field">
          <label className="field-label">模型</label>
          <input
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini-tts"
          />
        </div>
        <div className="field">
          <label className="field-label">默认音色</label>
          <input
            className="input"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            placeholder="alloy"
          />
        </div>
      </div>
      <div className="warn-note">
        使用在线语音会产生相应费用，并受服务商条款约束。生成失败时软件会显示具体错误，不会伪造成功。
      </div>
    </Modal>
  );
}
