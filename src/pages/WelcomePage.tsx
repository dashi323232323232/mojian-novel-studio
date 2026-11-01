import { BookOpen, LayoutList, AudioLines, Bot, ArrowRight, Plus, Sparkles } from 'lucide-react';
import { useAppStore } from '../store/app';

export function WelcomePage() {
  const projects = useAppStore((s) => s.projects);
  const navigate = useAppStore((s) => s.navigate);

  const recent = [...projects].slice(0, 4);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 15,
              background: 'linear-gradient(145deg,#333d5c,#1d2438)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-serif)',
              fontSize: 26,
              fontWeight: 700,
              marginBottom: 18,
              boxShadow: '0 10px 30px rgba(30,38,60,0.18)',
            }}
          >
            墨
          </div>
          <h1>大师小说工作台</h1>
          <p>
            从项目、阶段、章节到图形化大纲、伏笔追踪与有声小说，
            <br />
            一个安静、可靠的长篇创作空间。数据全部保存在本机。
          </p>
          <div className="welcome-actions">
            <button
              className="btn btn-primary btn-lg"
              onClick={() => {
                const btn = document.querySelector<HTMLButtonElement>('.sidebar .btn-primary');
                btn?.click();
              }}
            >
              <Plus size={16} /> 创建新项目
            </button>
            <button className="btn btn-lg" onClick={() => navigate({ view: 'agent' })}>
              <Bot size={16} /> Agent 接入
            </button>
          </div>
        </div>

        <div className="feature-grid">
          <div className="feature-card">
            <h3>
              <BookOpen size={14} style={{ color: 'var(--accent)' }} /> 长篇写作
            </h3>
            <p>阶段与章节分层管理，稳定 ID、自动保存、仅保留最新与上一版本，随时回溯。</p>
          </div>
          <div className="feature-card">
            <h3>
              <LayoutList size={14} style={{ color: '#0f8a6a' }} /> 图形大纲
            </h3>
            <p>节点式剧情画布，支持拖动、缩放、平移、连线与章节多对多关联。</p>
          </div>
          <div className="feature-card">
            <h3>
              <AudioLines size={14} style={{ color: '#b25e09' }} /> 有声小说
            </h3>
            <p>直接使用章节正文，本地 SAPI 或在线语音生成，可播放与导出。</p>
          </div>
        </div>

        {recent.length ? (
          <div className="recent-projects">
            <h3>最近项目</h3>
            {recent.map((p) => (
              <div
                key={p.id}
                className="recent-row"
                onClick={() => navigate({ view: 'content', projectId: p.id, chapterId: null, nodeId: null })}
              >
                <span className="project-dot" style={{ background: p.coverColor, width: 9, height: 9 }} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                  {p.chapterCount} 章 · {p.wordCount} 字
                </span>
                <ArrowRight size={14} style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="recent-projects">
            <h3>开始</h3>
            <div className="recent-row" style={{ cursor: 'default' }}>
              <Sparkles size={14} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                左侧点击「创建项目」开始你的第一部长篇小说，或从 Agent 接入页让 AI 协助搭建。
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
