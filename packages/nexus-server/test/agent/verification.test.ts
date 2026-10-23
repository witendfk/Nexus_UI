import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type Koa from 'koa';
import { PassThrough } from 'node:stream';
import { createCatalogPromptContract, type CatalogDefinition } from '@nexus-ui/core';
import {
  AGENT_ONBOARDING_CHECKS,
  createAgentOnboardingContract,
} from '../../src/api/agent-onboarding';
import {
  CATALOG_CONTRACT_VERSION,
  createCatalogContractHash,
} from '../../src/agent/catalog-contract';
import {
  verifyExternalAgentIntegration,
  type ExternalAgentVerificationOptions,
} from '../../src/agent/verification';
import { verifyExternalAgentOnboarding } from '../../src/agent/onboarding-verification';
import { AgentAdapter } from '../../src/agent/adapter';
import {
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
} from '../../src/agent/external-agent';
import { sendAgentRun } from '../../src/api/send-messages';
import { TEST_CATALOG_ID, createTestRegistry } from '../../tests/helpers/test-catalog';

/**
 * S2.5.6 RPC 与 verifier 贯通：
 * - verifier 以本次成功 done 的固定 commit 为 action 基准并关联请求，
 *   不再借 describeSurfaceContract 的最新快照过关；
 * - 可编辑路径与待编辑输入由可信宿主夹具配置，RPC 请求体序列化完整
 *   已准入 action（元数据、服务端重算参数、最新输入）；
 * - 展示型 Catalog（actions: []）的 action 检查按 skipped 处理并给出原因，
 *   报告不虚报通过。
 */

const formCatalog: CatalogDefinition = {
  catalogId: 'https://example.com/catalogs/verify-form/v2',
  components: {
    Column: { schema: { type: 'object', additionalProperties: false, properties: {} } },
    RatingInput: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['score'],
        properties: {
          score: { type: 'integer', minimum: 1, maximum: 5, dynamic: 'required' },
          label: { type: 'string', dynamic: 'allowed' },
        },
      },
      inputs: { score: { type: 'integer', minimum: 1, maximum: 5 } },
      origin: 'host-extension',
    },
    // S2.6.3.4：第二类值类型（布尔、非 value 属性），verifier 两类输入一并验收。
    PinnedToggle: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['pinned'],
        properties: { pinned: { type: 'boolean', dynamic: 'required' } },
      },
      inputs: { pinned: { type: 'boolean' } },
      origin: 'host-extension',
    },
    ConfirmTrigger: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: { label: { type: 'string', dynamic: 'allowed' } },
      },
      action: { required: true },
      origin: 'host-extension',
    },
  },
  actions: [
    {
      name: 'rate',
      sources: ['RatingInput'],
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['score', 'pinned'],
        properties: {
          score: { type: 'integer', minimum: 1, maximum: 5 },
          pinned: { type: 'boolean' },
        },
      },
    },
    { name: 'submit', sources: ['ConfirmTrigger'] },
  ],
};

const displayCatalog: CatalogDefinition = {
  catalogId: 'https://example.com/catalogs/verify-display/v2',
  components: {
    Column: { schema: { type: 'object', additionalProperties: false, properties: {} } },
    MetricCard: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['metric', 'caption'],
        properties: {
          metric: { type: 'string', dynamic: 'allowed' },
          caption: { type: 'string' },
        },
      },
      origin: 'host-extension',
    },
  },
  actions: [],
};

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

interface CapturedRequest {
  url?: string;
  body: unknown;
}

type AgentRoute = (body: Record<string, unknown>, response: ServerResponse) => void;

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function writeNdjson(response: ServerResponse, messages: unknown[]): void {
  response.setHeader('Content-Type', 'application/x-ndjson');
  for (const message of messages) response.write(`${JSON.stringify(message)}\n`);
  response.end();
}

async function startAgentServer(handler: AgentRoute): Promise<{
  endpoint: string;
  requests: CapturedRequest[];
}> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    if (request.method !== 'POST') {
      // 非 POST（onboarding 契约 GET 等）交给外部处理；这里只收集 Agent RPC。
      response.statusCode = 404;
      response.end();
      return;
    }
    void readJsonBody(request).then((body) => {
      requests.push({ url: request.url, body });
      handler(body, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}/agent`, requests };
}

describe('verification RPC 贯通（S2.5.6）', () => {
  it('完整消费超过响应流缓冲阈值的合法生成结果及 done', async () => {
    const count = 12;
    const { endpoint } = await startAgentServer((body, response) => {
      const surfaceId = body.surfaceId as string;
      writeNdjson(response, [
        { version: 'v0.9', createSurface: { surfaceId, catalogId: displayCatalog.catalogId } },
        ...Array.from({ length: count }, (_, index) => ({
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              {
                id: 'root',
                component: 'MetricCard',
                metric: String(index),
                caption: '合法输出😀'.repeat(4000),
              },
            ],
          },
        })),
      ]);
    });
    const report = await verifyExternalAgentIntegration({
      endpoint,
      catalog: displayCatalog,
      verifyPolicyRejection: false,
    });
    assert.equal(report.generationMessages, count + 1);
    assert.equal(report.generationCommit.surfaceId, report.surfaceId);
    assert.deepEqual(report.componentIdsAfterGeneration, ['root']);
    assert.equal(report.actionCommit, null);
  });

  it('action RPC 序列化完整已准入 action，verifier 以本次 done 固定结果为基准', async () => {
    const { endpoint, requests } = await startAgentServer((body, response) => {
      const surfaceId = body.surfaceId as string;
      if (body.kind === 'generate') {
        writeNdjson(response, [
          {
            version: 'v0.9',
            createSurface: { surfaceId, catalogId: formCatalog.catalogId },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [
                { id: 'root', component: 'Column', children: ['rating', 'pin'] },
                {
                  id: 'rating',
                  component: 'RatingInput',
                  score: { path: '/score' },
                  label: 'Rate this task',
                  action: {
                    event: {
                      name: 'rate',
                      context: { score: { path: '/score' }, pinned: { path: '/pinned' } },
                    },
                  },
                },
                { id: 'pin', component: 'PinnedToggle', pinned: { path: '/pinned' } },
              ],
            },
          },
          {
            version: 'v0.9',
            updateDataModel: { surfaceId, value: { score: 3, pinned: false } },
          },
        ]);
        return;
      }
      // action 响应：同 surface patch，root 保持存在。
      writeNdjson(response, [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Column', children: ['rating', 'pin'] },
              {
                id: 'rating',
                component: 'RatingInput',
                score: { path: '/score' },
                label: 'Re-rated',
              },
            ],
          },
        },
      ]);
    });

    // 可信宿主夹具：可编辑路径与待编辑值由夹具显式配置，SDK 不按组件名猜输入。
    const options: ExternalAgentVerificationOptions = {
      endpoint,
      catalog: formCatalog,
      timeoutMs: 2000,
      editablePaths: () => ['/score', '/pinned'],
      actionInputs: (component) =>
        component.action?.event?.name === 'rate'
          ? [
              { componentId: component.id, property: 'score', value: 4 },
              { componentId: 'pin', property: 'pinned', value: true },
            ]
          : [],
    };
    const report = await verifyExternalAgentIntegration(options);

    // verifier 消费本次成功 done 的固定结果并关联请求。
    const expectedHash = createCatalogContractHash(formCatalog);
    assert.deepEqual(
      {
        sessionVersion: report.generationCommit.sessionVersion,
        surfaceId: report.generationCommit.surfaceId,
        catalogId: report.generationCommit.catalogId,
        contractVersion: report.generationCommit.contractVersion,
        catalogHash: report.generationCommit.catalogHash,
        surfaceRevision: report.generationCommit.surfaceRevision,
      },
      {
        sessionVersion: 1,
        surfaceId: report.surfaceId,
        catalogId: formCatalog.catalogId,
        contractVersion: CATALOG_CONTRACT_VERSION,
        catalogHash: expectedHash,
        surfaceRevision: 1,
      },
    );
    assert.equal(typeof report.generationCommit.runId, 'string');
    assert.ok(report.generationCommit.runId.length > 0);
    assert.equal(report.actionCommit?.surfaceRevision, 2);
    assert.notEqual(report.actionCommit?.runId, report.generationCommit.runId);

    // RPC action 请求体序列化完整已准入 action。
    // 共 3 次 RPC：生成、action、policy 拒绝探针的生成（verifyPolicyRejection 默认开）。
    assert.equal(requests.length, 3);
    const actionRequest = requests[1]?.body as Record<string, unknown>;
    assert.equal(actionRequest.kind, 'action');
    const action = actionRequest.action as Record<string, unknown>;
    // 最新输入按夹具值实际序列化。
    assert.deepEqual(action.inputs, [
      { componentId: 'rating', property: 'score', value: 4 },
      { componentId: 'pin', property: 'pinned', value: true },
    ]);
    assert.deepEqual(report.actionContext, { score: 4, pinned: true });
    // 服务端重算参数覆盖客户端 context 值（客户端解析为 3/false，临时模型输入为 4/true）。
    assert.deepEqual(action.context, { score: 4, pinned: true });
    // nexus 元数据与 done 固定结果一致地出现在 RPC 载荷中。
    assert.equal(action.sessionVersion, 1);
    assert.equal(action.surfaceRevision, 1);
    assert.equal(action.catalogHash, expectedHash);
    assert.equal(typeof action.actionId, 'string');
    assert.ok((action.actionId as string).length > 0);
    assert.equal(action.sourceComponentId, 'rating');

    // 检查项与 onboarding 声明一致，且全部真实通过。
    assert.deepEqual(
      report.checks.map((check) => [check.id, check.status]),
      AGENT_ONBOARDING_CHECKS.map((check) => [check.id, 'passed']),
    );
  });

  it('展示型 Catalog（actions 为空）按 skipped 记录 action 检查且不发起 action RPC', async () => {
    const { endpoint, requests } = await startAgentServer((body, response) => {
      const surfaceId = body.surfaceId as string;
      assert.equal(body.kind, 'generate');
      writeNdjson(response, [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: displayCatalog.catalogId },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Column', children: ['metric'] },
              { id: 'metric', component: 'MetricCard', metric: 'CPU', caption: 'utilization' },
            ],
          },
        },
      ]);
    });

    const report = await verifyExternalAgentIntegration({
      endpoint,
      catalog: displayCatalog,
      timeoutMs: 2000,
    });

    const byId = new Map(report.checks.map((check) => [check.id, check]));
    assert.equal(byId.get('generation-lifecycle')?.status, 'passed');
    assert.equal(byId.get('catalog-stability')?.status, 'passed');
    assert.equal(byId.get('generation-root')?.status, 'passed');
    assert.equal(byId.get('policy-rejection')?.status, 'passed');
    // 适用检查按 skipped 记录并给出原因，不虚报通过。
    assert.equal(byId.get('action-same-surface')?.status, 'skipped');
    assert.match(byId.get('action-same-surface')?.detail ?? '', /未声明|no actions|actions/i);
    assert.equal(byId.get('action-root-stability')?.status, 'skipped');
    assert.deepEqual(
      report.checks.map((check) => check.id),
      AGENT_ONBOARDING_CHECKS.map((check) => check.id),
    );
    assert.equal(report.actionName, '');
    assert.equal(report.actionComponentId, '');
    assert.equal(report.actionCommit, null);
    assert.equal(report.actionMessages, 0);
    // 只有生成与 policy 探针 RPC：跳过 action 阶段时远端 action handler 未被调用。
    assert.equal(requests.length, 2);
  });

  it('onboarding 契约、RPC 声明与 verifier 报告检查项一致（无输入 action 提交空 inputs）', async () => {
    const requests: CapturedRequest[] = [];
    const server = createServer((request, response) => {
      if (request.url === '/onboarding') {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify(
            createAgentOnboardingContract({
              catalogContract: {
                serverApiVersion: 1 as const,
                kind: 'catalog-contract' as const,
                contractVersion: CATALOG_CONTRACT_VERSION,
                contractHash: createCatalogContractHash(formCatalog),
                catalog: formCatalog,
                promptContract: createCatalogPromptContract(formCatalog),
              },
              rpcEndpoint: `http://${request.headers.host}/agent`,
            }),
          ),
        );
        return;
      }
      void readJsonBody(request).then((body) => {
        requests.push({ url: request.url, body });
        const surfaceId = body.surfaceId as string;
        if (body.kind === 'generate') {
          writeNdjson(response, [
            {
              version: 'v0.9',
              createSurface: { surfaceId, catalogId: formCatalog.catalogId },
            },
            {
              version: 'v0.9',
              updateComponents: {
                surfaceId,
                components: [
                  { id: 'root', component: 'Column', children: ['confirm'] },
                  {
                    id: 'confirm',
                    component: 'ConfirmTrigger',
                    label: 'Submit task',
                    action: { event: { name: 'submit' } },
                  },
                ],
              },
            },
          ]);
          return;
        }
        writeNdjson(response, [
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [
                { id: 'root', component: 'Column', children: ['confirm'] },
                {
                  id: 'confirm',
                  component: 'ConfirmTrigger',
                  label: 'Submitted',
                  action: { event: { name: 'submit' } },
                },
              ],
            },
          },
        ]);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const contractUrl = `http://127.0.0.1:${address.port}/onboarding`;

    const report = await verifyExternalAgentOnboarding({
      contractUrl,
      message: 'Verify no-input action',
      timeoutMs: 2000,
    });

    assert.equal(report.endpoint, `http://127.0.0.1:${address.port}/agent`);
    assert.equal(report.actionName, 'submit');
    assert.deepEqual(report.actionContext, {});
    // 无输入 action 仍显式序列化空 inputs 数组，RPC 声明与实际载荷一致。
    const actionRequest = requests[1]?.body as Record<string, unknown>;
    const action = actionRequest.action as Record<string, unknown>;
    assert.deepEqual(action.inputs, []);
    assert.deepEqual(action.context, {});
    // 报告检查项与 onboarding 契约声明的检查项一致（id 与顺序）。
    assert.deepEqual(
      report.checks.map((check) => check.id),
      report.contract.verification.checks.map((check) => check.id),
    );
    assert.deepEqual(
      report.checks.map((check) => check.id),
      AGENT_ONBOARDING_CHECKS.map((check) => check.id),
    );
  });

  it('准入拒绝时远端 handler 未调用；远端响应仍过 guard 不授予写路径权限', async () => {
    const registry = createTestRegistry();
    const surfaceId = 'surface-rpc-guard';
    let actionResponses = 0;
    const { endpoint, requests } = await startAgentServer((body, response) => {
      if (body.kind === 'generate') {
        writeNdjson(response, [
          {
            version: 'v0.9',
            createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [
                {
                  id: 'root',
                  component: 'Text',
                  text: 'External generation',
                  variant: 'body',
                  action: { event: { name: 'submit', context: {} } },
                },
              ],
            },
          },
        ]);
        return;
      }
      actionResponses += 1;
      if (actionResponses === 1) {
        // 合法 patch：root 原地替换，保留已声明 action。
        writeNdjson(response, [
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [
                {
                  id: 'root',
                  component: 'Text',
                  text: 'Action done',
                  variant: 'body',
                  action: { event: { name: 'submit', context: {} } },
                },
              ],
            },
          },
        ]);
        return;
      }
      // 越权响应：action 流里试图 createSurface（生命周期越权），guard 必须拒绝。
      writeNdjson(response, [
        {
          version: 'v0.9',
          createSurface: { surfaceId: 'surface-injected', catalogId: TEST_CATALOG_ID },
        },
      ]);
    });

    const adapter = new AgentAdapter({
      registry,
      actionHandlers: new Map(),
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: createExternalAgentGenerationSource({ endpoint, timeoutMs: 2000 }),
    });
    adapter.registerActionHandler(
      TEST_CATALOG_ID,
      'submit',
      createExternalAgentActionHandler({ endpoint, timeoutMs: 2000 }),
    );

    const generation = await adapter.prepareGeneration({
      message: '创建外部任务面',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationResult = await sendAgentRun(createSseContext(), generation.run, {
      streamDelayMs: 0,
    });
    assert.equal(generationResult.ok, true);
    const before = await adapter.describeSurfaceContract(surfaceId);
    assert.equal(before?.surfaceRevision, 1);

    const baseAction = {
      name: 'submit',
      surfaceId,
      sourceComponentId: 'root',
      timestamp: new Date().toISOString(),
      sessionVersion: 1,
      catalogHash: createCatalogContractHash(registry.get(TEST_CATALOG_ID)!),
      context: {},
    };
    const first = await adapter.prepareAction({
      ...baseAction,
      actionId: 'rpc-action-1',
      surfaceRevision: 1,
    });
    assert.ok(first.ok);
    const firstResult = await sendAgentRun(createSseContext(), first.run, { streamDelayMs: 0 });
    assert.equal(firstResult.ok, true);
    const afterFirst = await adapter.describeSurfaceContract(surfaceId);
    assert.equal(afterFirst?.surfaceRevision, 2);
    assert.equal(requests.length, 2);

    // 旧 revision 的下一次 action：准入拒绝，远端 handler 未调用（无第三次 RPC）。
    const stale = await adapter.prepareAction({
      ...baseAction,
      actionId: 'rpc-action-stale',
      surfaceRevision: 1,
    });
    // S3.2 迁移：准入移入调度任务——入队即接受，拒绝改在运行终态断言。
    assert.ok(stale.ok, 'S3.2：入队即接受，准入在调度内执行');
    const staleOutcome = await stale.run.result;
    assert.equal(staleOutcome.terminal, 'failed', '旧 revision 的 action 必须被拒');
    assert.equal(staleOutcome.code, 'RUN_ADMISSION_REJECTED');
    assert.match(staleOutcome.message ?? '', /revision/i);
    assert.equal(requests.length, 2);
    const afterStale = await adapter.describeSurfaceContract(surfaceId);
    assert.equal(afterStale?.surfaceRevision, 2);

    // 远端响应仍过 guard：action 流里的 createSurface 被拒绝，快照 revision 不变。
    const escalated = await adapter.prepareAction({
      ...baseAction,
      actionId: 'rpc-action-escalate',
      surfaceRevision: 2,
    });
    assert.ok(escalated.ok);
    const escalatedResult = await sendAgentRun(createSseContext(), escalated.run, {
      streamDelayMs: 0,
    });
    assert.equal(escalatedResult.ok, false);
    assert.equal(requests.length, 3);
    const afterEscalated = await adapter.describeSurfaceContract(surfaceId);
    assert.equal(afterEscalated?.surfaceRevision, 2);
  });
});

function createSseContext(): Koa.Context & { getOutput(): string } {
  let body: unknown;
  let output = '';
  const context = {
    status: 200,
    set: () => undefined,
    // res 必须是可写流：claimSseResponse 会 pipe 到它（ctx.respond = false）。
    res: new PassThrough(),
    getOutput: () => output,
  };
  Object.defineProperty(context, 'body', {
    set(value: unknown) {
      body = value;
      if (value instanceof PassThrough) {
        value.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
      }
    },
    get(): unknown {
      return body;
    },
  });
  return context as unknown as Koa.Context & { getOutput(): string };
}
