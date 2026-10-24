import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import {
  CatalogRegistry,
  createSessionStreamCheck,
  parseSessionEvent,
  type CatalogDefinition,
  type NexusSessionEvent,
} from '@nexus-ui/core';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { sendAgentRun } from '../../src/api/send-messages';
import type { AgentAction } from '../../src/agent/adapter';

interface Oracle {
  id: string;
  request: {
    kind: string;
    generate?: { catalogId: string; message: string };
    action?: {
      message: { action: Omit<AgentAction, 'actionId'> };
      nexus: {
        sessionVersion: number;
        actionId: string;
        surfaceRevision: number;
        catalogHash: string;
        inputs: AgentAction['inputs'];
      };
    };
  };
  setup?: { surface: { messages: unknown[] } };
  source: { messages: unknown[] };
  expected: {
    events: {
      event: string;
      count?: number;
      surfaceRevision?: number | null;
      code?: string;
      commitState?: string;
    }[];
    terminal: string;
    commitState: string;
    sourceFactoryCalls: number;
    handlerCalls: number;
    handlerParamScore?: number;
    surfaceRevisionAfter: number | 'unknown';
  };
}
const root = new URL('../../../../fixtures/session-v1/', import.meta.url);
const catalog: CatalogDefinition = JSON.parse(
  readFileSync(new URL('catalog.json', root), 'utf8'),
).catalog;
const hash = createCatalogContractHash(catalog);

describe('Session v1 shared fixture execution (direct/SSE)', () => {
  for (const name of [
    'accept-generation',
    'accept-action-with-inputs',
    'reject-admission-stale-revision',
    'unknown-store-commit-throw',
  ]) {
    for (const transport of ['direct', 'sse'] as const) {
      it(`${name}: ${transport}`, async () => {
        const oracle: Oracle = JSON.parse(readFileSync(new URL(`${name}.json`, root), 'utf8'));
        const store = new InMemorySurfaceActionStateStore();
        const initial = (oracle.setup?.surface.messages ?? oracle.source.messages) as {
          createSurface?: { surfaceId: string };
        }[];
        const surfaceId = initial[0].createSurface!.surfaceId;
        let factoryCalls = 0,
          handlerCalls = 0;
        let params: Record<string, unknown> | undefined;
        const r = createAgentRuntime({
          registry: new CatalogRegistry([catalog]),
          createSurfaceId: () => surfaceId,
          editablePaths: () => ['/score', '/note'],
          createGenerationSource: () => {
            factoryCalls++;
            return initial;
          },
          actionHandlers: new Map(
            catalog.actions.map((entry) => [
              `${catalog.catalogId}:${entry.name}`,
              (action: AgentAction) => {
                handlerCalls++;
                params = structuredClone(action.context);
                return oracle.source.messages;
              },
            ]),
          ),
          actionStateStore: {
            get: (id) => store.get(id),
            removeSnapshot: (id) => store.removeSnapshot(id),
            commitGeneration: (...args) => store.commitGeneration(...args),
            commitAction: async (...args) => {
              const result = await store.commitAction(...args);
              if (name === 'unknown-store-commit-throw')
                throw new Error('confirmation lost after write');
              return result;
            },
          },
        });
        if (oracle.setup) {
          const setup = await r.generate({ catalogId: catalog.catalogId });
          assert.ok(setup.accepted);
          assert.equal((await setup.run.result).terminal, 'succeeded');
          if (name === 'reject-admission-stale-revision') {
            const rebuild = await r.generate({ catalogId: catalog.catalogId });
            assert.ok(rebuild.accepted);
            assert.equal((await rebuild.run.result).terminal, 'succeeded');
          }
          factoryCalls = 0;
        }
        const request = oracle.request.action;
        const q = request
          ? await r.action({ ...request.message.action, ...request.nexus, catalogHash: hash })
          : await r.generate(oracle.request.generate!);
        assert.ok(q.accepted);
        const events: NexusSessionEvent[] = [];
        const accept = (name: string, data: unknown) => {
          const parsed = parseSessionEvent(name, JSON.parse(JSON.stringify(data)));
          assert.ok(parsed.ok, `${oracle.id}: ${name} must parse`);
          events.push(parsed.event);
        };
        if (transport === 'direct') {
          for await (const event of q.run.events()) {
            accept(
              event.type,
              event.type === 'message'
                ? event.message
                : event.type === 'done'
                  ? event.commit
                  : event,
            );
          }
        } else {
          const res = new PassThrough();
          let output = '';
          res.on('data', (chunk) => {
            output += chunk.toString('utf8');
          });
          const ended = new Promise<void>((resolve) => res.once('end', resolve));
          await sendAgentRun({ res, set() {} } as unknown as Koa.Context, q.run, {
            streamDelayMs: 0,
          });
          await ended;
          for (const block of output.split('\n\n').filter(Boolean)) {
            const eventName = block.match(/^event: (.*)$/m)![1];
            accept(eventName, JSON.parse(block.match(/^data: (.*)$/m)![1]));
          }
        }
        assert.deepEqual(
          events.map((e) => e.type),
          oracle.expected.events.flatMap((e) =>
            Array.from({ length: e.count ?? 1 }, () => e.event),
          ),
        );
        const check = createSessionStreamCheck();
        let offset = 0;
        for (const expected of oracle.expected.events) {
          for (let i = 0; i < (expected.count ?? 1); i++) {
            const event = events[offset++];
            assert.equal(check.push(event), null);
            if (event.type === 'start')
              assert.equal(event.surfaceRevision ?? null, expected.surfaceRevision);
            if (event.type === 'error') {
              assert.equal(event.code, expected.code);
              assert.equal(event.commitState, expected.commitState);
              assert.equal(event.actionId, request?.nexus.actionId);
            }
            if (event.type === 'done') {
              assert.equal(event.commit.surfaceRevision, expected.surfaceRevision);
              assert.deepEqual(event.commit, r.queryRun(surfaceId, q.run.runId)?.commit);
            }
          }
        }
        assert.equal(check.end(), null);
        const outcome = await q.run.result;
        assert.equal(outcome.terminal, oracle.expected.terminal);
        assert.equal(outcome.commitState, oracle.expected.commitState);
        assert.equal(factoryCalls, oracle.expected.sourceFactoryCalls);
        assert.equal(handlerCalls, oracle.expected.handlerCalls);
        if (oracle.expected.handlerParamScore !== undefined)
          assert.equal(params?.score, oracle.expected.handlerParamScore);
        if (typeof oracle.expected.surfaceRevisionAfter === 'number')
          assert.equal((await store.get(surfaceId))?.version, oracle.expected.surfaceRevisionAfter);
        else {
          assert.equal((await store.get(surfaceId))?.version, 2, 'fault injected after real write');
          assert.equal(
            r.queryRun(surfaceId, q.run.runId)?.commit,
            undefined,
            'unknown cannot fabricate retained confirmation',
          );
        }
      });
    }
  }
});
