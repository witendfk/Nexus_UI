import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

/**
 * S2.7.2.2 产物根入口类型消费：最小 TS 消费只 import 三包公开根入口，
 * 以消费方 node_modules 链接解析到当前 dist 的 ESM 与 .d.ts 编译。
 * tsconfig 不继承仓库根 base（其 paths 把 core/react 别名到 src，会掩盖
 * dist 类型问题）；moduleResolution 与当前消费方一致（NodeNext 迁移归 S5）。
 * 反例证明 harness 真的在查类型：对文档签名的故意错用必须编译失败。
 */

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const workDir = join(exampleDir, '.dist-consumer-check');

const CONSUMER_SOURCE = `import {
  A2UIRuntime,
  CatalogRegistry,
  CATALOG_CONTRACT_VERSION,
  createCatalogPromptContract,
  getCatalogContractHashInput,
  parseSurfaceCommit,
  standardCatalogComponentDeclarations,
} from '@nexus-ui/core';
import type { CatalogDefinition, InputDraftSnapshot, NexusSurfaceCommit } from '@nexus-ui/core';
import { A2UIProvider, ReactRenderer, standardRenderMap, useA2UI } from '@nexus-ui/react';
import {
  AgentAdapter,
  createAgentOnboardingContract,
  createAgentRouter,
  createCatalogContractHash,
  InMemoryAgentRunManager,
  NEXUS_RUN_ID_HEADER,
  sendAgentRun,
  verifyExternalAgentIntegration,
} from '@nexus-ui/server';

const catalog: CatalogDefinition = {
  catalogId: 'https://example.com/consumer/v1',
  components: standardCatalogComponentDeclarations(),
  actions: [{ name: 'submit', sources: ['Button'] }],
};
const registry = new CatalogRegistry([catalog]);
const hash: string = createCatalogContractHash(catalog);
const hashInput: string = getCatalogContractHashInput(catalog);
const prompt: string = createCatalogPromptContract(catalog);
const version: number = CATALOG_CONTRACT_VERSION;
const header: string = NEXUS_RUN_ID_HEADER;
const commit: NexusSurfaceCommit | null = parseSurfaceCommit(JSON.parse('{}') as unknown);
const drafts: InputDraftSnapshot | null = null;

// 关键签名在类型层核对：四参数 setInputValue、boolean 确认、三参数 sendAgentRun。
const write: (componentId: string, surfaceId: string, property: string, value: unknown) => boolean =
  A2UIRuntime.prototype.setInputValue;
const confirm: (snapshot: InputDraftSnapshot) => boolean = A2UIRuntime.prototype.confirmInputDrafts;
const extract: (surfaceId: string) => InputDraftSnapshot = A2UIRuntime.prototype.extractLatestInputDrafts;
const send: typeof sendAgentRun = sendAgentRun;
const router: ReturnType<typeof createAgentRouter> | null = null;
const adapter: AgentAdapter | null = null;
const manager: InMemoryAgentRunManager = new InMemoryAgentRunManager();
const provider: typeof A2UIProvider = A2UIProvider;
const renderer: typeof ReactRenderer = ReactRenderer;
const renderMap: typeof standardRenderMap = standardRenderMap;
const hook: typeof useA2UI = useA2UI;
const onboarding: ReturnType<typeof createAgentOnboardingContract> | null = null;
const verify: typeof verifyExternalAgentIntegration = verifyExternalAgentIntegration;

export { registry, hash, hashInput, prompt, version, header, commit, drafts, write, confirm, extract, send, router, adapter, manager, provider, renderer, renderMap, hook, onboarding, verify };
`;

const BROKEN_SOURCE = `${CONSUMER_SOURCE}
const broken = A2UIRuntime.prototype.setInputValue('only', 'three', 'args');
export { broken };
`;

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'ES2020',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    jsx: 'react-jsx',
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    isolatedModules: true,
  },
  files: ['consumer.ts'],
};

function compile(source: string): { status: number; output: string } {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, 'consumer.ts'), source, 'utf8');
  writeFileSync(join(workDir, 'tsconfig.json'), JSON.stringify(TSCONFIG), 'utf8');
  const tsc = join(exampleDir, 'node_modules', '.bin', 'tsc');
  const result = spawnSync(tsc, ['-p', join(workDir, 'tsconfig.json')], {
    cwd: exampleDir,
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, output: result.stdout + result.stderr };
}

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('S2.7.2.2 三包当前 dist 根入口的最小 TS 消费', () => {
  it('只 import 公开根入口的最小消费经当前 dist 声明编译通过', () => {
    const { status, output } = compile(CONSUMER_SOURCE);
    assert.equal(status, 0, `最小消费必须经 dist 类型编译通过：${output}`);
  });

  it('对公开签名的故意错用编译失败（harness 真在查类型）', () => {
    const { status, output } = compile(BROKEN_SOURCE);
    assert.notEqual(status, 0, '三参数调用 setInputValue 必须编译失败');
    assert.match(output, /Expected 4 arguments, but got 3/);
  });
});
