import React from 'react';
import ReactDOM from 'react-dom/client';
import { MiniReaderPage } from './pages/MiniReaderPage';
import './styles/global.css';
import './styles/mini-reader.css';

/**
 * 朗读迷你弹窗入口：由独立的 BrowserWindow 加载 /mini.html#/mini-reader?projectId=xxx&chapterId=yyy
 * 与主窗口完全独立，只负责「小窗口里换书/换章/换音色/调语速/拖进度」。
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MiniReaderPage />
  </React.StrictMode>,
);
