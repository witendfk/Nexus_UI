import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentRun } from '../../src/agent/adapter';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import type { NexusRunDiagnostic } from '../../src/agent/run-diagnostic';
import { startCustomRunTask } from '../../src/runtime/agent-runtime';
import { TEST_CATALOG_ID, createTestRegistry } from '../../tests/helpers/test-catalog';

describe('S3.5 自定义 run 初始化失败清理', () => {
  for (const brokenDispose of [false, true]) {
    it(`未提供 manager 且 dispose ${brokenDispose ? '抛错' : '成功'}：清理不覆盖装配错误`, () => {
      let disposed = 0;
      const diagnostics: NexusRunDiagnostic[] = [];
      const run: AgentRun = {
        runId: 'custom-missing-manager',
        sequence: {
          kind: 'generate',
          surfaceId: 'custom-surface',
          catalogId: TEST_CATALOG_ID,
          registry: createTestRegistry(),
          supportedActions: ['submit', 'call'],
        },
        source: [],
        commit: async () => {
          throw new Error('must not commit');
        },
        dispose: () => {
          disposed++;
          if (brokenDispose) throw new Error('host dispose failed');
        },
      };
      assert.throws(
        () =>
          startCustomRunTask(run, {
            onRunDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
          }),
        /自定义 AgentRun 需要显式传入 manager/,
      );
      assert.equal(disposed, 1);
      assert.equal(diagnostics.length, brokenDispose ? 1 : 0);
    });
  }

  for (const failure of ['reserve', 'prepare'] as const) {
    for (const brokenDispose of [false, true]) {
      it(`${failure} 失败且 dispose ${brokenDispose ? '抛错' : '成功'}：清理一次并保留原错误`, () => {
        const original = new Error(`${failure} failed`);
        const cleanupError = new Error('host dispose failed');
        let disposed = 0;
        let sourceCalls = 0;
        const diagnostics: NexusRunDiagnostic[] = [];
        const manager = new InMemoryAgentRunManager();
        const registry = createTestRegistry();
        if (failure === 'reserve')
          manager.create = () => {
            throw original;
          };
        else {
          const requireCatalog = registry.require.bind(registry);
          let reads = 0;
          registry.require = (catalogId) => {
            if (++reads === 2) throw original;
            return requireCatalog(catalogId);
          };
        }
        const run: AgentRun = {
          runId: 'custom-initialization-failure',
          sequence: {
            kind: 'generate',
            surfaceId: 'custom-surface',
            catalogId: TEST_CATALOG_ID,
            registry,
            supportedActions: ['submit', 'call'],
          },
          get source() {
            sourceCalls++;
            return [];
          },
          commit: async () => {
            throw new Error('must not commit');
          },
          dispose: () => {
            disposed++;
            if (brokenDispose) throw cleanupError;
          },
        };
        assert.throws(
          () =>
            startCustomRunTask(run, {
              manager,
              onRunDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
            }),
          (error) => error === original,
        );
        assert.equal(disposed, 1, '宿主清理不能被记录终态或清理自身的异常跳过/重复');
        assert.equal(sourceCalls, 0, '初始化失败不触碰宿主 source');
        if (failure === 'prepare') assert.equal(manager.get(run.runId)?.state, 'failed');
        else assert.equal(manager.get(run.runId), undefined);
        assert.equal(diagnostics.length, brokenDispose ? 1 : 0);
        if (brokenDispose) {
          assert.equal(diagnostics[0].stage, 'run-dispose');
          assert.match(diagnostics[0].message, /host dispose failed/);
        }
      });
    }
  }
});
