import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import type { AgentRun, NexusRunDiagnostic } from '../../src/agent/adapter';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { sendAgentRun } from '../../src/api/send-messages';
import { createTestRegistry, TEST_CATALOG_ID } from '../../tests/helpers/test-catalog';

const registry = createTestRegistry(),
  catalog = registry.require(TEST_CATALOG_ID);
const hash = createCatalogContractHash(catalog);

describe('S3.3 自定义 run 提交事实', () => {
  for (const fault of ['retain', 'transition', 'dispose'] as const) {
    it(`${fault} 故障不覆盖实际提交，SSE done 与状态一致`, async () => {
      const store = new InMemorySurfaceActionStateStore();
      const diagnostics: NexusRunDiagnostic[] = [];
      class Manager extends InMemoryAgentRunManager {
        override recordCommit(...args: Parameters<InMemoryAgentRunManager['recordCommit']>) {
          if (fault === 'retain') throw new Error('retention unavailable');
          super.recordCommit(...args);
        }
        override transition(...args: Parameters<InMemoryAgentRunManager['transition']>) {
          if (fault === 'transition' && args[1] === 'succeeded')
            throw new Error('transition unavailable');
          super.transition(...args);
        }
      }
      const manager = new Manager();
      const surfaceId = `custom-${fault}`,
        runId = `run-${fault}`;
      let disposeCalls = 0,
        errorCalls = 0;
      const run: AgentRun = {
        runId,
        sequence: {
          kind: 'generate',
          surfaceId,
          catalogId: TEST_CATALOG_ID,
          registry,
          supportedActions: ['submit', 'call'],
        },
        source: [
          { version: 'v0.9', createSurface: { surfaceId, catalogId: TEST_CATALOG_ID } },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [{ id: 'root', component: 'Text', text: 'OK' }],
            },
          },
        ],
        async commit(messages) {
          const result = await store.commitGeneration(surfaceId, TEST_CATALOG_ID, messages, {
            catalog,
            catalogHash: hash,
            contractVersion: 2,
          });
          assert.equal(result.outcome, 'committed');
          if (result.outcome !== 'committed') throw new Error('write expected');
          return {
            sessionVersion: 1,
            runId,
            surfaceId,
            catalogId: TEST_CATALOG_ID,
            contractVersion: 2,
            catalogHash: hash,
            surfaceRevision: result.snapshot.version,
          };
        },
        onError() {
          errorCalls++;
        },
        dispose() {
          disposeCalls++;
          if (fault === 'dispose') throw new Error('dispose unavailable');
        },
      };
      const res = new PassThrough();
      let output = '';
      res.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });
      const ended = new Promise<void>((resolve) => res.once('end', resolve));
      const result = await sendAgentRun({ res, set() {} } as unknown as Koa.Context, run, {
        manager,
        streamDelayMs: 0,
        onRunDiagnostic: (d) => diagnostics.push(d),
      });
      await ended;
      assert.equal((await store.get(surfaceId))?.version, 1);
      assert.equal(result.ok, true);
      assert.match(output, /event: done/);
      assert.doesNotMatch(output, /event: error/);
      assert.equal(errorCalls, 0, '提交后的 SDK 扩展故障不能调用宿主失败回调');
      assert.equal(disposeCalls, 1);
      assert.equal(manager.get(runId)?.state, fault === 'transition' ? 'running' : 'succeeded');
      assert.equal(manager.get(runId)?.commit?.surfaceRevision, fault === 'retain' ? undefined : 1);
      const stage =
        fault === 'retain'
          ? 'record-commit'
          : fault === 'transition'
            ? 'record-transition'
            : 'run-dispose';
      assert.ok(diagnostics.some((d) => d.stage === stage));
    });
  }

  for (const fault of ['throw-after-write', 'invalid-confirmation'] as const) {
    it(`${fault} 加 failed-transition 异常：真实流报告 unknown 并保留写入`, async () => {
      const store = new InMemorySurfaceActionStateStore();
      const diagnostics: NexusRunDiagnostic[] = [];
      class Manager extends InMemoryAgentRunManager {
        override transition(...args: Parameters<InMemoryAgentRunManager['transition']>) {
          if (args[1] === 'failed') throw new Error('terminal write unavailable');
          super.transition(...args);
        }
      }
      const manager = new Manager();
      const surfaceId = `custom-${fault}`,
        runId = `run-${fault}`;
      const res = new PassThrough();
      let output = '';
      res.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });
      const ended = new Promise<void>((resolve) => res.once('end', resolve));
      const result = await sendAgentRun(
        { res, set() {} } as unknown as Koa.Context,
        {
          runId,
          sequence: {
            kind: 'generate',
            surfaceId,
            catalogId: TEST_CATALOG_ID,
            registry,
            supportedActions: ['submit', 'call'],
          },
          source: [
            { version: 'v0.9', createSurface: { surfaceId, catalogId: TEST_CATALOG_ID } },
            {
              version: 'v0.9',
              updateComponents: {
                surfaceId,
                components: [{ id: 'root', component: 'Text', text: 'OK' }],
              },
            },
          ],
          async commit(messages) {
            await store.commitGeneration(surfaceId, TEST_CATALOG_ID, messages, {
              catalog,
              catalogHash: hash,
              contractVersion: 2,
            });
            if (fault === 'throw-after-write') throw new Error('write response lost');
            return {
              sessionVersion: 1,
              runId,
              surfaceId: 'wrong-surface',
              catalogId: TEST_CATALOG_ID,
              contractVersion: 2,
              catalogHash: hash,
              surfaceRevision: 1,
            };
          },
        },
        { manager, streamDelayMs: 0, onRunDiagnostic: (d) => diagnostics.push(d) },
      );
      await ended;
      assert.equal(result.ok, false);
      assert.equal((await store.get(surfaceId))?.version, 1);
      assert.match(output, /"commitState":"unknown"/);
      assert.match(output, /"runCode":"RUN_COMMIT_UNKNOWN"/);
      assert.doesNotMatch(output, /event: done/);
      assert.equal(manager.get(runId)?.commit, undefined);
      assert.ok(diagnostics.some((d) => d.stage === 'record-transition'));
    });
  }
});
