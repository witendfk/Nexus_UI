import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Koa from 'koa';
import { CatalogRegistry, createCatalogPromptContract } from '@nexus-ui/core';
import type { CatalogActionDeclaration, CatalogDefinition } from '@nexus-ui/core';
import { AgentAdapter } from '../../src/agent/adapter';
import { createAgentRouter } from '../../src/api/routes';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';

/**
 * S2.5.5 发布内容与执行契约一致：
 * - 路由装配时经 core 注册闸门校验并复制 Catalog；初始化后修改调用方对象
 *   不能造成内容/hash/prompt 分裂。
 * - 已发布 Catalog 与执行 registry 核对 ID/契约版本/内容 hash；允许只发布
 *   执行 Catalog 的子集（不强制泄露私有 Catalog）。
 * - 发布结果、prompt、hash 与 onboarding 始终基于同一份已校验副本。
 */

function loadFixtureCatalog(name: string): CatalogDefinition {
  const file = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/catalog-v2', name),
    'utf8',
  );
  const parsed = JSON.parse(file) as { catalog: CatalogDefinition };
  return parsed.catalog;
}

const catalogA = loadFixtureCatalog('catalog-accept-interactive-form.json');
const catalogB = loadFixtureCatalog('catalog-accept-display-only.json');

const adapter = new AgentAdapter({ registry: new CatalogRegistry([]) });

const servers: Server[] = [];

function listen(router: ReturnType<typeof createAgentRouter>): Promise<string> {
  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen(0, '127.0.0.1') as Server;
  servers.push(server);
  return new Promise((resolve) => {
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

after(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface ContractResponse {
  contractVersion: number;
  contractHash: string;
  catalog: CatalogDefinition;
  promptContract: string;
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url);
  return { status: response.status, body: (await response.json()) as unknown };
}

describe('S2.5.5 发布内容与执行契约一致', () => {
  it('初始化后修改调用方对象不影响已发布的 catalog/hash/prompt/onboarding', async () => {
    const published = structuredClone(catalogA);
    const snapshot = structuredClone(published);
    const expectedHash = createCatalogContractHash(snapshot);
    const expectedPrompt = createCatalogPromptContract(snapshot);

    const baseUrl = await listen(
      createAgentRouter({
        adapter: new AgentAdapter({ registry: new CatalogRegistry([published]) }),
        catalogContracts: [published],
      }),
    );

    // 宿主在装配后原地修改自己持有的对象
    const inputs = published.components.TextField.inputs;
    assert.ok(inputs && typeof inputs === 'object' && !Array.isArray(inputs));
    (inputs as Record<string, unknown>).value = { type: 'string', maxLength: 1 };
    (published.actions[0] as { paramSchema?: unknown }).paramSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {},
    };

    const contract = (await getJson(
      `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(snapshot.catalogId)}`,
    )) as { status: number; body: ContractResponse };
    assert.equal(contract.status, 200);
    assert.deepEqual(contract.body.catalog, snapshot);
    assert.equal(contract.body.contractHash, expectedHash);
    assert.equal(contract.body.promptContract, expectedPrompt);

    const discovery = (await getJson(`${baseUrl}/api/a2ui/published-catalogs`)) as {
      status: number;
      body: { catalogs: { contractHash: string; components: string[]; actions: string[] }[] };
    };
    assert.equal(discovery.status, 200);
    assert.equal(discovery.body.catalogs.length, 1);
    assert.equal(discovery.body.catalogs[0].contractHash, expectedHash);
    assert.deepEqual(discovery.body.catalogs[0].components, Object.keys(snapshot.components));
    assert.deepEqual(
      discovery.body.catalogs[0].actions,
      snapshot.actions.map((action) => action.name),
    );

    const onboarding = (await getJson(
      `${baseUrl}/api/a2ui/agent-onboarding?catalogId=${encodeURIComponent(snapshot.catalogId)}`,
    )) as { status: number; body: { catalogContract: ContractResponse } };
    assert.equal(onboarding.status, 200);
    assert.equal(onboarding.body.catalogContract.contractHash, expectedHash);
    assert.deepEqual(onboarding.body.catalogContract.catalog, snapshot);
  });

  it('发布 payload 与 onboarding 内嵌 catalogContract 完全一致', async () => {
    const baseUrl = await listen(
      createAgentRouter({
        adapter: new AgentAdapter({ registry: new CatalogRegistry([structuredClone(catalogA)]) }),
        catalogContracts: [structuredClone(catalogA)],
      }),
    );
    const contract = await getJson(
      `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(catalogA.catalogId)}`,
    );
    const onboarding = await getJson(
      `${baseUrl}/api/a2ui/agent-onboarding?catalogId=${encodeURIComponent(catalogA.catalogId)}`,
    );
    assert.deepEqual(
      (onboarding.body as { catalogContract: unknown }).catalogContract,
      contract.body,
    );
  });

  it('公开 Catalog 与执行 registry 内容不一致时装配失败', () => {
    const drifted = structuredClone(catalogA);
    (drifted.actions as CatalogActionDeclaration[]).push({
      name: 'ghost-action',
      sources: ['Column'],
    });
    assert.throws(
      () =>
        createAgentRouter({
          adapter: new AgentAdapter({ registry: new CatalogRegistry([drifted]) }),
          catalogContracts: [structuredClone(catalogA)],
        }),
      /实际执行契约/,
    );
  });

  it('公开 Catalog 未在执行 registry 注册时装配失败', () => {
    assert.throws(
      () =>
        createAgentRouter({
          adapter,
          catalogContracts: [structuredClone(catalogA)],
        }),
      /实际执行契约/,
    );
  });

  it('允许只发布执行 registry 的子集，未发布 Catalog 返回 404', async () => {
    const baseUrl = await listen(
      createAgentRouter({
        adapter: new AgentAdapter({
          registry: new CatalogRegistry([structuredClone(catalogA), structuredClone(catalogB)]),
        }),
        catalogContracts: [structuredClone(catalogA)],
      }),
    );
    const published = await getJson(
      `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(catalogA.catalogId)}`,
    );
    assert.equal(published.status, 200);

    const hidden = await fetch(
      `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(catalogB.catalogId)}`,
    );
    assert.equal(hidden.status, 404);

    const discovery = (await getJson(`${baseUrl}/api/a2ui/published-catalogs`)) as {
      body: { catalogs: { catalogId: string }[] };
    };
    assert.deepEqual(
      discovery.body.catalogs.map((entry) => entry.catalogId),
      [catalogA.catalogId],
    );
  });

  // 与 core test/catalog/registration.test.ts 的 REJECT_PATTERNS 同一映射（SPEC §4.2）：
  // server 装配复用同一注册闸门，全部非法夹具在装配期拒绝，双端结论一致。
  const rejectFixturePatterns: readonly (readonly [string, RegExp])[] = [
    ['catalog-reject-v1-shape.json', /components 必须是组件声明表/],
    ['catalog-reject-unknown-schema-keyword.json', /不支持的 schema 关键字: format/],
    [
      'catalog-reject-inputs-on-forbidden-binding.json',
      /绑定能力为 forbidden，不支持 \{ path \} 绑定/,
    ],
    [
      'catalog-reject-action-required-without-source.json',
      /action\.required 但不在任何 action 的 sources 中/,
    ],
    ['catalog-reject-unsupported-pattern.json', /pattern 含不受支持的语法，无法求值/],
    ['catalog-reject-unknown-declaration-key.json', /含未知键: sourcez/],
    ['catalog-reject-legacy-fields-binding.json', /含未知键: binding/],
  ];

  it('全部非法 Catalog 夹具在装配期被 core 注册闸门拒绝', () => {
    for (const [name, pattern] of rejectFixturePatterns) {
      assert.throws(
        () => createAgentRouter({ adapter, catalogContracts: [loadFixtureCatalog(name)] }),
        pattern,
        `${name} 应在装配期被拒`,
      );
    }
  });
});

describe('发布契约绑定真实 adapter', () => {
  it('router 拒绝独立的记录所有者，显式相同实例可装配', () => {
    const actual = new AgentAdapter({ registry: new CatalogRegistry([]) });
    assert.throws(
      () =>
        createAgentRouter({
          adapter: actual,
          runManager: new InMemoryAgentRunManager(),
        }),
      /所有者一致/,
    );
    assert.doesNotThrow(() =>
      createAgentRouter({
        adapter: actual,
        runManager: actual.runManager,
      }),
    );
  });

  it('未提供额外装配选项也不能发布实际 adapter 未注册的 Catalog', () => {
    assert.throws(
      () => createAgentRouter({ adapter, catalogContracts: [catalogA] }),
      /执行|adapter/,
    );
  });
  it('发布声明不能冒充实际 adapter 的不同声明', () => {
    const drifted = structuredClone(catalogA);
    (drifted.actions as CatalogActionDeclaration[]).push({
      name: 'another-action',
      sources: ['Column'],
    });
    assert.throws(
      () =>
        createAgentRouter({
          adapter: new AgentAdapter({ registry: new CatalogRegistry([drifted]) }),
          catalogContracts: [catalogA],
        }),
      /执行|adapter/,
    );
  });
  it('装配后修改同一 registry 不改变发布与后续执行的固定声明', async () => {
    const definition = structuredClone(catalogA);
    const registry = new CatalogRegistry([definition]);
    const actual = new AgentAdapter({ registry, createGenerationSource: () => [] });
    const router = createAgentRouter({ adapter: actual, catalogContracts: [definition] });
    const hash = createCatalogContractHash(definition);
    (definition.actions as CatalogActionDeclaration[]).push({
      name: 'extra-action',
      sources: ['Column'],
    });
    const plan = await actual.prepareGeneration({ catalogId: definition.catalogId });
    assert.ok(plan.ok);
    assert.equal(
      createCatalogContractHash(plan.run.sequence.registry.get(definition.catalogId)!),
      hash,
    );
    plan.run.dispose?.();
    assert.ok(router);
  });
});

it('可选 undefined 的执行声明经真实 HTTP 发布后 hash/prompt 仍与内容一致', async () => {
  const catalog: CatalogDefinition = {
    catalogId: 'https://example.com/catalogs/undefined-wire/v1',
    components: { Label: { schema: { type: 'object' }, origin: undefined, inputs: undefined } },
    actions: [],
  };
  const owner = new AgentAdapter({ registry: new CatalogRegistry([catalog]) });
  const base = await listen(createAgentRouter({ adapter: owner, catalogContracts: [catalog] }));
  const { status, body } = await getJson(
    `${base}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(catalog.catalogId)}`,
  );
  assert.equal(status, 200);
  const wire = body as ContractResponse;
  assert.equal(
    Object.prototype.hasOwnProperty.call(wire.catalog.components.Label, 'origin'),
    false,
  );
  assert.equal(wire.contractHash, createCatalogContractHash(wire.catalog));
  assert.equal(
    wire.contractHash,
    createCatalogContractHash(owner.describeCatalog(catalog.catalogId)!),
  );
  assert.equal(wire.promptContract, createCatalogPromptContract(wire.catalog));
});
