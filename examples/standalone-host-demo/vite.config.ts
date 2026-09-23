import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const hostPort = Number(process.env.NEXUS_DEMO_HOST_PORT ?? 3101);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.NEXUS_DEMO_WEB_PORT ?? 3100),
    proxy: {
      '/api': { target: `http://127.0.0.1:${hostPort}`, changeOrigin: true },
      '/health': { target: `http://127.0.0.1:${hostPort}`, changeOrigin: true },
    },
  },
});
