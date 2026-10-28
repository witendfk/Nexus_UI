import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import { sendAgentRun } from '../../src/api/send-messages';
import {
  TEST_CATALOG_ID,
  createTestRegistry,
} from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';

/**
 * S3.6.3/.4 SSE 有界背压（SPEC §6.6）：
 * - write 返回 false 即暂停事件消费：任务停在闸门上，不无限预取（产出计数
 *   冻结可证伪）；
 * - 慢消费超过 hard上限 → AGENT_STREAM_ERROR 断流，运行失败（明确失败，不是
 *   空输出或静默截断）；
 * - 暂停期间取消 → 闸门同步放行，RUN_CANCELLED 及时收敛，不依赖消费推进；
 * - 合法大流超过 HWM 但消费方持续读取 → 完整收到终态。
 */

const registry = createTestRegistry();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('S3.6.3 SSE 有界背压', () => {
  it('消费方暂停读取：任务停在闸门上不无限预取；超时后 AGENT_STREAM_ERROR 断流', async () => {
    const instance = createAgentRuntime({
      access: allowAllAccess,
      registry,
      createSurfaceId: () => 'bp-slow',
      createGenerationSource: (request) =>
        (async function* () {
          yield {
            version: 'v0.9',
            createSurface: { surfaceId: request.surfaceId, catalogId: TEST_CATALOG_ID },
          };
          yield {
            version: 'v0.9',
            updateComponents: {
              surfaceId: request.surfaceId,
              components: [{ id: 'root', component: 'Text', text: 'stream' }],
            },
          };
          // 逐条让出微任务：真实宿主生产有节奏，消费方有机会暂停读取。
          for (let i = 0; i < 60; i++) {
            await new Promise<void>((r) => setImmediate(r));
            yield {
              version: 'v0.9',
              updateDataModel: {
                surfaceId: request.surfaceId,
                value: { fill: 'z'.repeat(1200), i },
              },
            };
          }
        })(),
    });
    const enqueued = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    // 永不 drain 的 sink：write 返回 false 且不会恢复——确定性背压。
    let output = '';
    const res = new Writable({
      write(chunk, _encoding) {
        // 收集但不回调：模拟彻底停转的消费者（永不 drain）。
        output += chunk.toString('utf8');
      },
    });
    const ctx = { res, set: () => undefined } as unknown as Koa.Context;
    let emitted = 0;
    const unsubscribe = enqueued.run.subscribe((event) => {
      if (event.type === 'message') emitted += 1;
    });
    const sent = sendAgentRun(ctx, enqueued.run, {
      sse: { highWaterMarkBytes: 2_000, slowConsumerTimeoutMs: 300 },
    });
    await sleep(60);
    const emittedAtPause = emitted;
    assert.ok(emittedAtPause > 0, '闸门合上前已有事件产出');
    await sleep(150);
    assert.equal(
      emitted,
      emittedAtPause,
      '闸门暂停期间任务不得继续产出事件（不无限预取）',
    );
    unsubscribe();

    // 慢消费超硬上限：明确失败（AGENT_STREAM_ERROR），不是静默截断或空输出。
    // error 帧滞留在永不 drain 的缓冲中不可达，终态以句柄/结果为证。
    const result = await sent;
    assert.equal(result.ok, false);
    const outcome = await enqueued.run.result;
    assert.equal(outcome.terminal, 'failed');
    assert.ok(outcome.terminal === 'failed');
    assert.equal(outcome.code, 'AGENT_STREAM_ERROR');
    assert.equal(outcome.commitState, 'notCommitted');
    assert.doesNotMatch(output, /event: done/);
    res.destroy();
  });

  it('暂停期间取消：闸门同步放行，RUN_CANCELLED 及时收敛，不依赖消费推进', async () => {
    const instance = createAgentRuntime({
      access: allowAllAccess,
      registry,
      createSurfaceId: () => 'bp-cancel',
      createGenerationSource: (request) =>
        (async function* () {
          yield {
            version: 'v0.9',
            createSurface: { surfaceId: request.surfaceId, catalogId: TEST_CATALOG_ID },
          };
          yield {
            version: 'v0.9',
            updateComponents: {
              surfaceId: request.surfaceId,
              components: [{ id: 'root', component: 'Text', text: 'stream' }],
            },
          };
          // 逐条让出微任务：真实宿主生产有节奏，消费方有机会暂停读取。
          for (let i = 0; i < 60; i++) {
            await new Promise<void>((r) => setImmediate(r));
            yield {
              version: 'v0.9',
              updateDataModel: {
                surfaceId: request.surfaceId,
                value: { fill: 'z'.repeat(1200), i },
              },
            };
          }
        })(),
    });
    const enqueued = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    // 永不 drain 的 sink：确定性背压；取消仍必须及时收敛。
    let output = '';
    const res = new Writable({
      write(chunk, _encoding) {
        output += chunk.toString('utf8');
      },
    });
    const ctx = { res, set: () => undefined } as unknown as Koa.Context;
    let emitted = 0;
    const unsubscribe = enqueued.run.subscribe((event) => {
      if (event.type === 'message') emitted += 1;
    });
    const sent = sendAgentRun(ctx, enqueued.run, {
      sse: { highWaterMarkBytes: 2_000, slowConsumerTimeoutMs: 60_000 },
    });
    await sleep(60);
    assert.ok(emitted > 0);
    // 慢消费上限拉到 60s：取消必须经由闸门中断及时收敛，而非等超时。
    enqueued.run.cancel();
    const started = Date.now();
    const outcome = await enqueued.run.result;
    assert.ok(Date.now() - started < 5_000, '取消不依赖消费推进或慢消费超时');
    assert.equal(outcome.terminal, 'canceled');
    const result = await sent;
    assert.equal(result.ok, false);
    assert.equal(outcome.terminal, 'canceled');
    // RUN_CANCELLED 帧滞留在永不 drain 的缓冲中不可达，终态以句柄为证。
    assert.doesNotMatch(output, /event: done/);
    unsubscribe();
    res.destroy();
  });

  it('合法大流超过 HWM：消费方持续读取时完整收到终态', async () => {
    const instance = createAgentRuntime({
      access: allowAllAccess,
      registry,
      createSurfaceId: () => 'bp-big',
      createGenerationSource: (request) => {
        const chunks = Array.from({ length: 12 }, (_, i) => ({
          version: 'v0.9',
          updateDataModel: {
            surfaceId: request.surfaceId,
            value: { fill: 'q'.repeat(150_000), i },
          },
        }));
        return [
          {
            version: 'v0.9',
            createSurface: { surfaceId: request.surfaceId, catalogId: TEST_CATALOG_ID },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: request.surfaceId,
              components: [{ id: 'root', component: 'Text', text: 'big' }],
            },
          },
          ...chunks,
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: request.surfaceId,
              components: [{ id: 'root', component: 'Text', text: 'end' }],
            },
          },
        ];
      },
    });
    const enqueued = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    const res = new PassThrough();
    const ctx = { res, set: () => undefined } as unknown as Koa.Context;
    let output = '';
    res.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const ended = new Promise<void>((resolve) => res.once('end', resolve));
    // 默认 HWM（1 MiB）被 ~1.8MB 合法输出超过；消费方持续读取 → drain 推进。
    const sent = sendAgentRun(ctx, enqueued.run, {});
    const result = await sent;
    await ended;
    assert.equal(result.ok, true, '合法大流不因超过 HWM 失败');
    assert.equal((await enqueued.run.result).terminal, 'succeeded');
    assert.match(output, /event: done/);
    assert.ok(output.length > 1_500_000, '大流完整送达');
  });
});
