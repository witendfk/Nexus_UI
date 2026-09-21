import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Nexus UI Playground —— Vite 配置。
 * dev server 默认代理 /api 到本地 Koa 服务（server/nexus-playground-server）。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
