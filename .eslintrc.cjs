/**
 * 仓库级 ESLint 配置（ESLint 8 + eslintrc 风格）。
 *
 * 质量底线之一：源码禁止任何 console.*，仅在显式标注的 dev-only 目录放行。
 * 见 设计文档与实施计划 §0.5。
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier', // eslint-config-prettier：关闭与 Prettier 冲突的格式规则
  ],
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  rules: {
    // 源码禁止调试输出（仅允许 dev-only 工具，见下方 overrides）
    'no-console': 'error',
    // 协议数据天然是 Record<string, unknown>，放开 any 以减少噪音
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
  },
  overrides: [
    // 调试专用工具目录：允许 console
    {
      files: ['**/dev-only/**', '**/scripts/**', '**/tools/**'],
      rules: { 'no-console': 'off' },
    },
    // 测试代码：允许 console（断言/排障），但禁止进入 src
    {
      files: ['**/tests/**', '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
      rules: { 'no-console': 'off' },
    },
    // CJS 配置文件自身
    {
      files: ['*.cjs', '*.js'],
      parserOptions: { sourceType: 'commonjs' },
    },
  ],
  ignorePatterns: [
    'specification/',
    'dist/',
    'build/',
    'coverage/',
    'node_modules/',
    '**/*.d.ts',
    '.eslintrc.cjs',
  ],
};
