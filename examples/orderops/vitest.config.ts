import { defineConfig } from 'vitest/config';

// 单测统一放各包 test/ 目录（镜像 src 结构）；构建（tsconfig.build.json）只含 src，不会打包测试代码。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
  },
});
