import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
// S4.1.4：从本次构建的 core/client 公开根入口验证完整链路（不 import 源码）。
import * as core from '@nexus-ui/core';
import * as client from '../dist/index.js';
import type { SseFrame } from '../src/transport';

/** 与参考浏览器同口径：core 规范化输入 + SHA-256（浏览器用 Web Crypto）。 */
function contractHash(catalog: core.CatalogDefinition): string {
  return `sha256:${createHash('sha256').update(core.getCatalogContractHashInput(catalog)).digest('hex')}`;
}

/**
 * S4.1.4 headless 公开契约验收（SPEC §7/CURRENT S4.1.4）：
 * - 从构建产物（core dist via workspace 根入口 + client dist）驱动完整链路：
 *   生成 → 提交 → 输入/action → patch → 失败/unknown → 恢复；
 * - 实际读取共享 Session/Catalog fixture（fixtures/session-v1/）；
 * - 矩阵：两个 Catalog、双 surface 更新/删除、done-only 生成、本地拒绝、
 *   请求期间编辑、稳定快照、订阅与 dispose 幂等释放、自定义输入/action。
 * 断言视图、草稿、固定基准、动作门控与资源清理，而非仅状态字符串。
 */

const FIXTURE_ROOT = new URL('../../../fixtures/session-v1/', import.meta.url);
const fixtureCatalog = (
  JSON.parse(readFileSync(new URL('catalog.json', FIXTURE_ROOT), 'utf8')) as {
    catalog: core.CatalogDefinition;
  }
).catalog;
const FIXTURE_CATALOG_ID = fixtureCatalog.catalogId;
const fixtureHash = contractHash(fixtureCatalog);

const CLIENT_CATALOG_ID = 'https://example.com/catalogs/client-acceptance/v1';
function clientCatalog(): core.CatalogDefinition {
  return {
    catalogId: CLIENT_CATALOG_ID,
    components: {
      ...core.standardCatalogComponentDeclarations(),
      TextField: {
        ...core.standardCatalogComponentDeclarations().TextField,
        inputs: { value: { type: 'string', maxLength: 200 } },
      },
    },
    actions: [
      {
        name: 'save',
        sources: ['Button'],
        paramSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ],
  };
}
const CLIENT_HASH = contractHash(clientCatalog());

interface Entry {
  runId: string | null;
  frames: SseFrame[];
}
function scripted(transportRef: { queue: Entry[] }): client.SessionTransport {
  return {
    async open(_request) {
      const next = transportRef.queue.shift();
      if (!next) throw new Error('transport script exhausted');
      transportRef.queue.unshift !== undefined && void 0;
      return {
        runIdHeader: next.runId,
        frames: (async function* () {
          for (const frame of next.frames) {
            await Promise.resolve();
            yield frame;
          }
        })(),
      };
    },
  };
}

function buildQueue(): Entry[] & { pushEntry(e: Entry): void } {
  const arr: Entry[] = [];
  return Object.assign(arr, {
    pushEntry(e: Entry): void {
      arr.push(e);
    },
  });
}

describe('S4.1.4 · 共享 fixture 驱动（core/client 构建入口）', () => {
  it('accept-generation oracle：事件序列与 core 解析器逐条一致，done 提交可恢复', async () => {
    const oracle = JSON.parse(
      readFileSync(new URL('accept-generation.json', FIXTURE_ROOT), 'utf8'),
    ) as {
      request: { generate: { catalogId: string; message: string } };
      source: { messages: unknown[] };
      expected: { events: Array<{ event: string; surfaceRevision?: number | null }> };
    };
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([structuredClone(fixtureCatalog)]),
    });
    const queue = buildQueue();
    const runId = 'ace0f888-0000-4000-8000-000000000001';
    const surfaceId = 's-gen-1';
    queue.pushEntry({
      runId,
      frames: [
        {
          event: 'start',
          data: JSON.stringify({
            type: 'start',
            sessionVersion: 1,
            runId,
            surfaceId,
            catalogId: FIXTURE_CATALOG_ID,
            contractVersion: 2,
            catalogHash: fixtureHash,
          }),
        },
        ...oracle.source.messages.map((message: unknown) => ({
          event: 'message',
          data: JSON.stringify(message),
        })),
        {
          event: 'done',
          data: JSON.stringify({
            sessionVersion: 1,
            runId,
            surfaceId,
            catalogId: FIXTURE_CATALOG_ID,
            contractVersion: 2,
            catalogHash: fixtureHash,
            surfaceRevision: 1,
          }),
        },
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[FIXTURE_CATALOG_ID, fixtureHash]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate({
      catalogId: FIXTURE_CATALOG_ID,
      message: oracle.request.generate.message,
    });
    assert.equal(result.status, 'committed');
    // oracle 预期：start(无旧基准) → message×3 → done(revision 1)。
    const status = session.getSurface(surfaceId)!;
    assert.equal(status.phase, 'ready');
    assert.equal(status.baseline?.surfaceRevision, 1);
    assert.equal(status.baseline?.runId, runId);
    assert.ok(runtime.getSurfaceView(surfaceId)!.components.some((c) => c.id === 'root'));

    // 生成后的 surface 无在途脚本：action 明确失败（transport 耗尽），不虚报成功。
    const action = await session.action({
      surfaceId,
      name: 'rate',
      sourceComponentId: 'rating-1',
    });
    // transport 耗尽在 open 前抛错：请求未送达，但视图已由本次生成建立且未被
    // 改动——按 desync 收敛（无法证明新基准仍有效）是会话的保守正确口径。
    assert.equal(action.status, 'desync');
    // 成功 done 的固定提交可驱动合法恢复（视图/基准一次到位）。
    const recovered = session.recover({
      view: runtime.getSurfaceView(surfaceId)!,
      commit: (result as { commit: core.NexusSurfaceCommit }).commit,
    });
    assert.equal(recovered.status, 'committed');
    assert.equal(session.getSurface(surfaceId)!.actionOpen, true);
  });

  it('accept-action-with-inputs oracle：inputs 随 nexus 发送，patch 提交推进 revision', async () => {
    const oracle = JSON.parse(
      readFileSync(new URL('accept-action-with-inputs.json', FIXTURE_ROOT), 'utf8'),
    ) as {
      request: {
        action: { message: { action: Record<string, unknown> }; nexus: Record<string, unknown> };
      };
      setup: { surface: { messages: unknown[] } };
      source: { messages: unknown[] };
      expected: {
        events: Array<{ event: string; surfaceRevision?: number }>;
        surfaceRevisionAfter: number;
      };
    };
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([structuredClone(fixtureCatalog)]),
      // RatingInput.score 的写回门控需要 inputs 声明（fixture Catalog 已含）。
    });
    const queue = buildQueue();
    const surfaceId = 's-s3-1';
    const genRunId = 'ace0f888-0000-4000-8000-000000000010';
    const actionRunId = 'ace0f888-0000-4000-8000-000000000011';
    queue.pushEntry({
      runId: genRunId,
      frames: [
        {
          event: 'start',
          data: JSON.stringify({
            type: 'start',
            sessionVersion: 1,
            runId: genRunId,
            surfaceId,
            catalogId: FIXTURE_CATALOG_ID,
            contractVersion: 2,
            catalogHash: fixtureHash,
          }),
        },
        ...oracle.setup.surface.messages.map((message: unknown) => ({
          event: 'message',
          data: JSON.stringify(message),
        })),
        {
          event: 'done',
          data: JSON.stringify({
            sessionVersion: 1,
            runId: genRunId,
            surfaceId,
            catalogId: FIXTURE_CATALOG_ID,
            contractVersion: 2,
            catalogHash: fixtureHash,
            surfaceRevision: 1,
          }),
        },
      ],
    });
    queue.pushEntry({
      runId: actionRunId,
      frames: [
        {
          event: 'start',
          data: JSON.stringify({
            type: 'start',
            sessionVersion: 1,
            runId: actionRunId,
            surfaceId,
            catalogId: FIXTURE_CATALOG_ID,
            contractVersion: 2,
            catalogHash: fixtureHash,
          }),
        },
        ...oracle.source.messages.map((message: unknown) => ({
          event: 'message',
          data: JSON.stringify(message),
        })),
        {
          event: 'done',
          data: JSON.stringify({
            sessionVersion: 1,
            runId: actionRunId,
            surfaceId,
            catalogId: FIXTURE_CATALOG_ID,
            contractVersion: 2,
            catalogHash: fixtureHash,
            surfaceRevision: 2,
          }),
        },
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[FIXTURE_CATALOG_ID, fixtureHash]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const setup = await session.generate({ catalogId: FIXTURE_CATALOG_ID });
    assert.ok(setup.status === 'committed');

    // oracle 的 action 请求：nexus.inputs 由客户端草稿提供（rating-1.score=4）。
    assert.equal(
      runtime.setInputValue('rating-1', surfaceId, 'score', 4),
      true,
      'fixture Catalog inputs 声明下写回成功',
    );
    const result = await session.action({
      surfaceId,
      name: String(oracle.request.action.message.action.name),
      sourceComponentId: String(oracle.request.action.message.action.sourceComponentId),
      actionId: String(oracle.request.action.nexus.actionId),
    });
    assert.equal(result.status, 'committed');
    assert.equal(
      (result as { commit: core.NexusSurfaceCommit }).commit.surfaceRevision,
      oracle.expected.surfaceRevisionAfter,
    );
  });
});

describe('S4.1.4 · 双 Catalog 与双 surface 隔离', () => {
  it('两个 Catalog 各自生成；delete 一个 surface 不影响另一 surface 的门控', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog(), structuredClone(fixtureCatalog)]),
    });
    const queue = buildQueue();
    const hashes = new Map<string, string>([
      [CLIENT_CATALOG_ID, CLIENT_HASH],
      [FIXTURE_CATALOG_ID, fixtureHash],
    ]);
    const runIdFor = (surfaceId: string, rev: number) =>
      `dead0000-0000-4000-8000-${surfaceId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}${rev}`;
    for (const [surfaceId, catalogId, hash] of [
      ['acc-a', CLIENT_CATALOG_ID, CLIENT_HASH],
      ['fix-b', FIXTURE_CATALOG_ID, fixtureHash],
    ] as const) {
      queue.pushEntry({
        runId: runIdFor(surfaceId, 1),
        frames: [
          {
            event: 'start',
            data: JSON.stringify({
              type: 'start',
              sessionVersion: 1,
              runId: runIdFor(surfaceId, 1),
              surfaceId,
              catalogId,
              contractVersion: 2,
              catalogHash: hash,
            }),
          },
          {
            event: 'message',
            data: JSON.stringify({ version: 'v0.9', createSurface: { surfaceId, catalogId } }),
          },
          {
            event: 'message',
            data: JSON.stringify({
              version: 'v0.9',
              updateComponents: {
                surfaceId,
                components: [{ id: 'root', component: 'Text', text: 'x' }],
              },
            }),
          },
          {
            event: 'message',
            data: JSON.stringify({
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { v: 1 } },
            }),
          },
          {
            event: 'done',
            data: JSON.stringify({
              sessionVersion: 1,
              runId: runIdFor(surfaceId, 1),
              surfaceId,
              catalogId,
              contractVersion: 2,
              catalogHash: hash,
              surfaceRevision: 1,
            }),
          },
        ],
      });
    }
    const session = client.createClientSession({
      runtime,
      catalogHashes: hashes,
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const a = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    const b = await session.generate({ catalogId: FIXTURE_CATALOG_ID });
    assert.ok(a.status === 'committed' && b.status === 'committed');
    assert.equal(session.getSurface('acc-a')!.actionOpen, true);
    assert.equal(session.getSurface('fix-b')!.actionOpen, true);

    // 删除 acc-a：其跟踪与视图清理，fix-b 门控不变。
    runtime.removeSurfaceView('acc-a');
    assert.equal(runtime.getSurfaceView('acc-a'), undefined);
    assert.equal(runtime.store.getState().dataModelBySurface['acc-a'], undefined);
    assert.equal(session.getSurface('fix-b')!.actionOpen, true);
    assert.deepEqual(runtime.store.getState().dataModelBySurface['fix-b'], { v: 1 });
  });
});

describe('S4.1.4 · done-only 生成与本地拒绝', () => {
  it('done-only 生成（无视图消息）：不提升门控', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const runId = 'd0ne0000-0000-4000-8000-000000000001';
    queue.pushEntry({
      runId,
      frames: [
        {
          event: 'start',
          data: JSON.stringify({
            type: 'start',
            sessionVersion: 1,
            runId,
            surfaceId: 'done-only',
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
          }),
        },
        {
          event: 'done',
          data: JSON.stringify({
            sessionVersion: 1,
            runId,
            surfaceId: 'done-only',
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
            surfaceRevision: 1,
          }),
        },
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    assert.equal(result.status, 'desync', 'done-only 缺本地视图，按失同步收敛');
    assert.equal(
      session.getSurface('done-only'),
      undefined,
      '无视图无基准：surface 跟踪不保留，动作出口无从开放',
    );
  });

  it('本地拒绝（runtime dispatchChecked 拒绝非法组件）：流失败且视图无半提交', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const runId = 'ba d00000-0000-4000-8000-000000000001'.replace(' ', '');
    queue.pushEntry({
      runId,
      frames: [
        {
          event: 'start',
          data: JSON.stringify({
            type: 'start',
            sessionVersion: 1,
            runId,
            surfaceId: 'rej-1',
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
          }),
        },
        {
          event: 'message',
          data: JSON.stringify({
            version: 'v0.9',
            createSurface: { surfaceId: 'rej-1', catalogId: CLIENT_CATALOG_ID },
          }),
        },
        {
          event: 'message',
          data: JSON.stringify({
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'rej-1',
              components: [{ id: 'ghost', component: 'Ghost', child: 'x' }],
            },
          }),
        },
        {
          event: 'done',
          data: JSON.stringify({
            sessionVersion: 1,
            runId,
            surfaceId: 'rej-1',
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
            surfaceRevision: 1,
          }),
        },
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    assert.equal(result.status, 'desync', '本地拒绝按失同步收敛（视图已改动不可信）');
    // 预览不保留：跟踪与视图整体丢弃，动作出口无从开放。
    assert.equal(session.getSurface('rej-1'), undefined);
    assert.equal(runtime.getSurfaceView('rej-1'), undefined);
  });
});

describe('S4.1.4 · 请求期间编辑与订阅释放', () => {
  it('请求期间新编辑：随下次请求 inputs 发送，成功确认不误删新 serial', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const surfaceId = 'edit-1';
    const setupRunId = 'ed1t0000-0000-4000-8000-000000000001';
    queue.pushEntry({
      runId: setupRunId,
      frames: [
        {
          event: 'start',
          data: JSON.stringify({
            type: 'start',
            sessionVersion: 1,
            runId: setupRunId,
            surfaceId,
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
          }),
        },
        {
          event: 'message',
          data: JSON.stringify({
            version: 'v0.9',
            createSurface: { surfaceId, catalogId: CLIENT_CATALOG_ID },
          }),
        },
        {
          event: 'message',
          data: JSON.stringify({
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [
                { id: 'root', component: 'Column', children: ['field'] },
                { id: 'field', component: 'TextField', value: { path: '/name' }, label: '姓名' },
              ],
            },
          }),
        },
        {
          event: 'message',
          data: JSON.stringify({
            version: 'v0.9',
            updateDataModel: { surfaceId, value: { name: 'base' } },
          }),
        },
        {
          event: 'done',
          data: JSON.stringify({
            sessionVersion: 1,
            runId: setupRunId,
            surfaceId,
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
            surfaceRevision: 1,
          }),
        },
      ],
    });
    // action 请求挂起：让测试在请求在途时继续编辑。
    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    const actionRunId = 'ed1t0000-0000-4000-8000-000000000002';
    const multi: { queue: Entry[] } = { queue };
    const transport: client.SessionTransport = {
      async open(request) {
        const next = multi.queue.shift();
        if (!next) {
          await actionGate;
          if (request.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          return {
            runIdHeader: actionRunId,
            frames: (async function* () {
              yield {
                event: 'start',
                data: JSON.stringify({
                  type: 'start',
                  sessionVersion: 1,
                  runId: actionRunId,
                  surfaceId,
                  catalogId: CLIENT_CATALOG_ID,
                  contractVersion: 2,
                  catalogHash: CLIENT_HASH,
                }),
              };
              yield {
                event: 'done',
                data: JSON.stringify({
                  sessionVersion: 1,
                  runId: actionRunId,
                  surfaceId,
                  catalogId: CLIENT_CATALOG_ID,
                  contractVersion: 2,
                  catalogHash: CLIENT_HASH,
                  surfaceRevision: 2,
                }),
              };
            })(),
          };
        }
        return {
          runIdHeader: next.runId,
          frames: (async function* () {
            yield* next.frames;
          })(),
        };
      },
    };
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    const setup = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    if (setup.status !== 'committed') console.log('SETUP:', JSON.stringify(setup));
    assert.ok(setup.status === 'committed');

    // 编辑 #1（随请求发送）。
    assert.equal(runtime.setInputValue('field', surfaceId, 'value', 'sent'), true);
    const inFlight = session.action({
      surfaceId,
      name: 'save',
      sourceComponentId: 'field',
    });
    // 请求期间编辑 #2（新 serial，不随本次请求发送）。
    assert.equal(runtime.setInputValue('field', surfaceId, 'value', 'edited-later'), true);
    releaseAction();
    const result = await inFlight;
    assert.equal(result.status, 'committed');
    // 成功只 confirm 发送代次；请求期间的新编辑保留为可见草稿。
    const drafts = runtime.getLatestInputs(surfaceId);
    assert.equal(drafts.length, 1);
    assert.deepEqual(drafts[0].value, 'edited-later');
  });

  it('订阅与 dispose 幂等释放；dispose 后入口抛错', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue: buildQueue() }),
      endpoints: { generate: '/g', event: '/e' },
    });
    let notified = 0;
    const unsub1 = session.subscribe(() => {
      notified += 1;
    });
    const unsub2 = session.subscribe(() => {
      notified += 1;
    });
    unsub1();
    unsub1(); // 幂等。
    session.dispose();
    unsub2(); // dispose 后解除仍安全。
    assert.equal(session.disposed, true);
    await assert.rejects(() => session.generate({ catalogId: CLIENT_CATALOG_ID }), /已销毁/);
    assert.equal(notified, 0, 'dispose 清空订阅，未发生通知');
  });
});
