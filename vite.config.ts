import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: '.',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        // 主窗口
        main: path.resolve(__dirname, 'index.html'),
        // 迷你朗读窗口（独立 BrowserWindow 加载）
        mini: path.resolve(__dirname, 'mini.html'),
      },
    },
  },
  server: {
    port: 5199,
    strictPort: true,
  },
});
