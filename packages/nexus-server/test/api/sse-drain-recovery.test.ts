import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import type { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import { sendAgentRun } from '../../src/api/send-messages';
import { TEST_CATALOG_ID, createTestRegistry } from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';

describe('S3.6 review SSE drain ownership', () => {
  it('drain before next candidate resumes a legal stream through the actual destination', async () => {
    let drained!: () => void;
    const drain = new Promise<void>((resolve) => {
      drained = resolve;
    });
    let output = '';
    let drains = 0;
    let blocked = 0;
    const res = new Writable({
      highWaterMark: 100,
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        setTimeout(callback, 3);
      },
    });
    const finished = new Promise<void>((resolve) => res.on('finish', resolve));
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry: createTestRegistry(),
      createSurfaceId: () => 'drain',
      createGenerationSource: (r) =>
        (async function* () {
          yield {
            version: 'v0.9',
            createSurface: { surfaceId: r.surfaceId, catalogId: TEST_CATALOG_ID },
          };
          yield {
            version: 'v0.9',
            updateComponents: {
              surfaceId: r.surfaceId,
              components: [{ id: 'root', component: 'Text', text: 'x'.repeat(5000) }],
            },
          };
          await drain;
          yield {
            version: 'v0.9',
            updateDataModel: { surfaceId: r.surfaceId, value: { ok: true } },
          };
        })(),
    });
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const ctx = { res, set() {} } as unknown as Koa.Context;
    const sent = sendAgentRun(ctx, q.run, {
      sse: { highWaterMarkBytes: 1000, slowConsumerTimeoutMs: 50 },
    });
    const stream = ctx.body as PassThrough;
    const write = stream.write.bind(stream);
    stream.write = ((...args: Parameters<typeof write>) => {
      const ok = write(...args);
      if (!ok) blocked++;
      return ok;
    }) as typeof write;
    stream.on('drain', () => {
      drains++;
      drained();
    });
    const outcome = await q.run.result;
    await sent;
    await finished;
    assert.ok(blocked > 0 && drains > 0, 'must exercise real write(false)/drain');
    assert.equal(outcome.terminal, 'succeeded');
    assert.match(output, /event: done/);
    assert.match(output, /"ok":true/);
  });

  it('blocked final frame has a bounded response lifetime without rewriting commit facts', async () => {
    const res = new Writable({ highWaterMark: 100, write() {} });
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry: createTestRegistry(),
      createSurfaceId: () => 'final',
      createGenerationSource: (r) => [
        { version: 'v0.9', createSurface: { surfaceId: r.surfaceId, catalogId: TEST_CATALOG_ID } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: r.surfaceId,
            components: [{ id: 'root', component: 'Text', text: 'x'.repeat(10000) }],
          },
        },
      ],
    });
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const ctx = { res, set() {} } as unknown as Koa.Context;
    const sent = sendAgentRun(ctx, q.run, {
      sse: { highWaterMarkBytes: 1000, slowConsumerTimeoutMs: 30 },
    });
    try {
      const outcome = await q.run.result;
      await delay(60);
      assert.ok(
        res.destroyed || res.writableFinished,
        'response must finish or close within slow-consumer limit',
      );
      await sent;
      assert.deepEqual(
        await q.run.result,
        outcome,
        'transport failure cannot rewrite commit facts',
      );
    } finally {
      res.destroy();
      (ctx.body as PassThrough).destroy();
    }
  });
});
