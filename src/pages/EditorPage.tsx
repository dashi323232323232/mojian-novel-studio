import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ProjectStructure } from '@shared/types';
import { useAppStore } from '../store/app';
import { confirmLeave } from '../lib/leaveGuard';
import { ChapterEditor } from '../components/editor/ChapterEditor';

export function EditorPage({ structure }: { structure: ProjectStructure }) {
  const active = useAppStore((s) => s.active);
  const navigate = useAppStore((s) => s.navigate);
  const chapter = structure.chapters.find((c) => c.id === active.chapterId);
  const [settings, setSettings] = useState(() => {
    try {
      const cached = localStorage.getItem('mojian.editor.settings');
      if (cached) return JSON.parse(cached) as { fontSize: number; lineHeight: number; fontFamily: 'serif' | 'sans'; autoSave: boolean; showWordCount: boolean };
    } catch {
      /* ignore */
    }
    return { fontSize: 18, lineHeight: 1.9, fontFamily: 'serif' as const, autoSave: true, showWordCount: true };
  });

  if (!chapter) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="page-title">章节不存在</div>
        </div>
        <div style={{ padding: 30 }}>
          <button
            className="btn"
            onClick={async () => {
              if (await confirmLeave()) navigate({ view: 'content', chapterId: null });
            }}
          >
            <ArrowLeft size={15} /> 返回内容
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ background: 'var(--bg-elevated)' }}>
      <ChapterEditor
        chapter={chapter}
        structure={structure}
        settings={settings}
        onSwitchChapter={(id) => {
          navigate({ view: 'editor', chapterId: id });
        }}
        headerRight={
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (await confirmLeave()) navigate({ view: 'content', chapterId: null });
            }}
          >
            退出
          </button>
        }
      />
    </div>
  );
}
