import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Nexus UI Playground 测试配置。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
});
