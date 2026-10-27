import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import type { AgentRuntimeOptions } from '../../src/runtime/agent-runtime';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import type { AgentAction } from '../../src/agent/adapter';
import {
  TEST_CATALOG_ID,
  TEST_CATALOG_ACTIONS,
  createTestRegistry,
} from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';

/**
 * S3.5.2 访问准入钩子（SPEC §6.5/DESIGN D9）：
 * - generate/action 缺省一律拒绝，未配置与拒绝返回不同错误码；
 * - 拒绝发生在入队前：不启动 source/handler、不创建运行记录；
 * - context 只透传给宿主钩子（HTTP 路由传 Koa Context），运行模块不解释；
 * - 准入先于 Catalog/surface 解析：拒绝不泄露注册状态与 surface 存在性。
 */

const registry = createTestRegistry();
const HASH = createCatalogContractHash(registry.require(TEST_CATALOG_ID));

function generationSource(surfaceId: string): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: TEST_CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['confirm'] },
          {
            id: 'confirm',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'submit', context: {} } },
          },
          { id: 'label', component: 'Text', text: '提交' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId, value: { note: 'ok' } } },
  ];
}

function actionRequest(surfaceId: string, surfaceRevision: number, actionId: string): AgentAction {
  return {
    name: TEST_CATALOG_ACTIONS[0],
    surfaceId,
    sourceComponentId: 'confirm',
    timestamp: new Date().toISOString(),
    context: {},
    actionId,
    sessionVersion: 1,
    surfaceRevision,
    catalogHash: HASH,
  };
}

function runtime(options: Partial<AgentRuntimeOptions> = {}) {
  let factoryCalls = 0;
  let handlerCalls = 0;
  const instance = createAgentRuntime({
    access: allowAllAccess,
    registry,
    createSurfaceId: () => 'access-gen-surface',
    createGenerationSource: (request) => {
      factoryCalls += 1;
      return generationSource(request.surfaceId);
    },
    actionHandlers: new Map([
      [`${TEST_CATALOG_ID}:submit`, () => {
        handlerCalls += 1;
        return [];
      }],
    ]),
    ...options,
  });
  return { instance, calls: () => ({ factoryCalls, handlerCalls }) };
}

describe('S3.5.2 生成请求的访问准入（入队前拒绝）', () => {
  it('未配置 access.generate：accepted:false 且错误码区分未配置，无记录、工厂零调用', async () => {
    const { instance, calls } = runtime({ access: undefined });
    const outcome = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(!outcome.accepted);
    assert.equal(outcome.stage, 'request');
    assert.equal(outcome.code, 'GENERATE_ACCESS_NOT_CONFIGURED');
    assert.equal(calls().factoryCalls, 0, '拒绝不得启动生成源工厂');
    assert.equal(instance.listRuns('access-gen-surface').length, 0, '拒绝不创建运行记录');
  });

  it('access.generate 返回 false：GENERATE_ACCESS_DENIED，钩子收到 (request, context)', async () => {
    const seen: Array<{ catalogId: unknown; context: unknown }> = [];
    const marker = { trusted: 'host-context' };
    const { instance, calls } = runtime({
      access: {
        generate: (request, context) => {
          seen.push({ catalogId: request.catalogId, context });
          return false;
        },
      },
    });
    const outcome = await instance.generate(
      { catalogId: TEST_CATALOG_ID, message: 'hi' },
      { context: marker },
    );
    assert.ok(!outcome.accepted);
    assert.equal(outcome.code, 'GENERATE_ACCESS_DENIED');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].catalogId, TEST_CATALOG_ID);
    assert.equal(seen[0].context, marker, 'context 必须是调用方原对象（透传，不复制不解释）');
    assert.equal(calls().factoryCalls, 0);
  });

  it('异步 false 与同步 false 一致；非 true 值（如字符串）一律拒绝', async () => {
    const asyncDenied = runtime({ access: { generate: async () => false } });
    const r1 = await asyncDenied.instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(!r1.accepted);
    assert.equal(r1.code, 'GENERATE_ACCESS_DENIED');

    const truthy = runtime({
      access: { generate: () => 'yes' as unknown as boolean },
    });
    const r2 = await truthy.instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(!r2.accepted);
    assert.equal(r2.code, 'GENERATE_ACCESS_DENIED', '只有显式 true 放行');
  });

  it('准入先于 Catalog 解析：未注册 catalogId 对未授权调用方同样 403 语义', async () => {
    const { instance } = runtime({ access: undefined });
    const outcome = await instance.generate({ catalogId: 'https://example.com/not-registered' });
    assert.ok(!outcome.accepted);
    assert.equal(outcome.code, 'GENERATE_ACCESS_NOT_CONFIGURED', '不得以 catalog 未注册 泄露探测结果');
  });

  it('放行后正常执行：与缺省拒绝形成可证伪对照', async () => {
    const { instance, calls } = runtime();
    const outcome = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(outcome.accepted);
    assert.equal((await outcome.run.result).terminal, 'succeeded');
    assert.equal(calls().factoryCalls, 1);
  });

  it('钩子抛错按装配错误向上传播，不静默改为拒绝', async () => {
    const { instance } = runtime({
      access: {
        generate: () => {
          throw new Error('host policy crashed');
        },
      },
    });
    await assert.rejects(
      () => instance.generate({ catalogId: TEST_CATALOG_ID }),
      /host policy crashed/,
    );
  });

  it('prepare* 兼容外壳同样被准入拦截，plan 携带相同错误码', async () => {
    const { instance } = runtime({ access: undefined });
    const plan = await instance.adapter.prepareGeneration({ catalogId: TEST_CATALOG_ID });
    assert.ok(!plan.ok);
    assert.equal(plan.code, 'GENERATE_ACCESS_NOT_CONFIGURED');
  });
});

describe('S3.5.2 action 请求的访问准入', () => {
  async function prepareSurface(instance: ReturnType<typeof runtime>['instance']) {
    const gen = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(gen.accepted);
    const result = await gen.run.result;
    assert.equal(result.terminal, 'succeeded');
    assert.ok(result.terminal === 'succeeded');
    return result.commit;
  }

  it('未配置 access.action：accepted:false 且不建记录、handler 零调用、surface 快照不变', async () => {
    const { instance, calls } = runtime({ access: generateOnly() });
    const commit = await prepareSurface(instance);
    const revisionBefore = commit.surfaceRevision;
    const outcome = await instance.action(
      actionRequest(commit.surfaceId, revisionBefore, 'access-deny-1'),
    );
    assert.ok(!outcome.accepted);
    assert.equal(outcome.stage, 'request');
    assert.equal(outcome.code, 'ACTION_ACCESS_NOT_CONFIGURED');
    assert.equal(calls().handlerCalls, 0, '拒绝不得调用 handler');
    assert.equal(instance.listRuns(commit.surfaceId).length, 1, '拒绝不创建运行记录');
    const snapshot = await instance.adapter.describeSurfaceContract(commit.surfaceId);
    assert.equal(snapshot?.surfaceRevision, revisionBefore, '快照与 revision 不变');
  });

  it('access.action 返回 false：ACTION_ACCESS_DENIED，钩子收到原始 action 请求', async () => {
    const requests: AgentAction[] = [];
    const { instance } = runtime({
      access: {
        generate: () => true,
        action: (request) => {
          requests.push(request);
          return false;
        },
      },
    });
    const commit = await prepareSurface(instance);
    const outcome = await instance.action(
      actionRequest(commit.surfaceId, commit.surfaceRevision, 'access-deny-2'),
    );
    assert.ok(!outcome.accepted);
    assert.equal(outcome.code, 'ACTION_ACCESS_DENIED');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].actionId, 'access-deny-2');
  });

  it('拒绝发生在快照读取前：不存在的 surface 同样 403 语义，不泄露存在性', async () => {
    const { instance } = runtime({ access: { action: () => false } });
    const outcome = await instance.action(actionRequest('surface-not-exist', 1, 'probe'));
    assert.ok(!outcome.accepted);
    assert.equal(outcome.code, 'ACTION_ACCESS_DENIED', '准入拒绝不区分 surface 是否存在');
  });

  it('入队等待期修改调用方请求不能改写准入结论与克隆（入口隔离保持）', async () => {
    const { instance, calls } = runtime({
      access: {
        generate: () => true,
        action: async () => {
          // 制造 await 间隙：准入异步完成后调用方才修改请求。
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          return true;
        },
      },
    });
    const commit = await prepareSurface(instance);
    const request = actionRequest(commit.surfaceId, commit.surfaceRevision, 'mutate-after-enqueue');
    const pending = instance.action(request);
    request.context = { injected: true } as typeof request.context;
    request.surfaceRevision = 999;
    const outcome = await pending;
    assert.ok(outcome.accepted, '克隆先于 await：调用方后续修改不影响本次请求');
    assert.equal((await outcome.run.result).terminal, 'succeeded');
    assert.equal(calls().handlerCalls, 1);
  });

  it('放行后正常执行（对照）', async () => {
    const { instance, calls } = runtime();
    const commit = await prepareSurface(instance);
    const outcome = await instance.action(
      actionRequest(commit.surfaceId, commit.surfaceRevision, 'access-allow'),
    );
    assert.ok(outcome.accepted);
    assert.equal((await outcome.run.result).terminal, 'succeeded');
    assert.equal(calls().handlerCalls, 1);
  });
});

function generateOnly() {
  return { generate: () => true };
}

/** 查询准入回落来源（S3.5.2 单一来源）：路由未配置 access 时使用 adapter.access.read。 */
describe('S3.5.2 查询准入的 adapter 回落', () => {
  it('adapter 暴露装配的 access 钩子，read 可作为路由缺省准入', () => {
    const read = (surfaceId: string) => surfaceId.startsWith('allow-');
    const { instance } = runtime({ access: { ...allowAllAccess, read } });
    assert.equal(instance.adapter.access?.read, read, 'adapter getter 返回装配的钩子本身');
  });
});
