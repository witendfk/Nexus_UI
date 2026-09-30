import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'tarballs/**', 'var/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // [架构边界墙] OrderOps 是 Nexus 运行时的消费方：只准 import 公开入口，
    // 不准碰内部路径（src/、dist/ 深路径）。这条墙在双仓时期由仓库边界保证，
    // 同居期由 lint 保证——将来拆分回独立仓时它就是拆分的接口契约。
    files: ['packages/**/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nexus-ui/*/*', '@nexus-ui/*/src/*', '*/dist/*'],
              message: '只允许 import @nexus-ui/core / @nexus-ui/react / @nexus-ui/server 的公开入口（包根），禁止深路径。',
            },
          ],
        },
      ],
    },
  },
);
