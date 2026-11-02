import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

interface Props {
  value: string;
  onChange: (value: string) => void;
  fontSize: number;
  lineHeight: number;
  fontFamily: 'serif' | 'sans';
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  minHeight?: number;
  onFocus?: () => void;
}

const highlight = HighlightStyle.define([
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.link, textDecoration: 'underline' },
]);

export function CodeMirrorEditor({
  value,
  onChange,
  fontSize,
  lineHeight,
  fontFamily,
  placeholder,
  readOnly = false,
  autoFocus = false,
  minHeight = 520,
  onFocus,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const applyingExternal = useRef(false);
  const themeCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!hostRef.current) return;
    const startState = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        syntaxHighlighting(highlight),
        cmPlaceholder(placeholder ?? '从这里开始写下第一句话…'),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        themeCompartment.current.of(makeTheme(fontSize, lineHeight, fontFamily)),
        EditorView.editable.of(!readOnly),
      ],
    });
    const view = new EditorView({ state: startState, parent: hostRef.current });
    viewRef.current = view;
    if (autoFocus) {
      window.setTimeout(() => view.focus(), 60);
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅初始化一次；外部 value 通过下面的 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部内容变化（切换章节、回滚版本）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    applyingExternal.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    applyingExternal.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(makeTheme(fontSize, lineHeight, fontFamily)),
    });
  }, [fontSize, lineHeight, fontFamily]);

  return (
    <div
      ref={hostRef}
      className="cm-editor-host"
      style={{ minHeight }}
      onFocusCapture={() => onFocus?.()}
    />
  );
}

function makeTheme(fontSize: number, lineHeight: number, family: 'serif' | 'sans') {
  const font = family === 'serif' ? 'var(--font-serif)' : 'var(--font-ui)';
  return EditorView.theme({
    '&': {
      fontSize: `${fontSize}px`,
      lineHeight: String(lineHeight),
      backgroundColor: 'transparent',
      color: '#1f2532',
    },
    '.cm-content': {
      fontFamily: font,
      padding: '0',
      caretColor: '#1c2330',
      minHeight: '480px',
    },
    '.cm-line': {
      padding: '0 2px',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      fontFamily: font,
      overflow: 'visible',
      paddingBottom: '60px',
    },
    '.cm-placeholder': {
      color: '#b3bac6',
      fontStyle: 'normal',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: '#d6dbfb !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: '#cbd1fa !important',
    },
    '.cm-cursor': {
      borderLeftColor: '#39415a',
      borderLeftWidth: '1.5px',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-searchMatch': {
      backgroundColor: '#ffe9a8',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#ffd36e',
    },
    '.cm-panels': {
      backgroundColor: '#f7f8fa',
      color: '#1c2330',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid #e3e6eb',
    },
    '.cm-textfield': {
      border: '1px solid #d3d8e0',
      borderRadius: '5px',
      padding: '3px 6px',
    },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: '#fff',
      border: '1px solid #d3d8e0',
      borderRadius: '5px',
      padding: '3px 8px',
    },
  });
}
