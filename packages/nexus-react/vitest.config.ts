import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * @nexus-ui/react 测试配置 —— jsdom 环境，支持 TSX 组件测试。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
