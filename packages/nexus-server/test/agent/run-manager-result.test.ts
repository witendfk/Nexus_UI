import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NexusSurfaceCommit } from '@nexus-ui/core';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';

/**
 * S2.5.1/S2.5.2 run-manager 结果留存：adapter 与 HTTP 共用同一记录所有者保存
 * 固定提交结果，不另建平行结果 Map。本文件覆盖记录所有者的留存语义：
 * 读写深拷贝、状态迁移不覆盖固定结果、重复 ID/重复 recordCommit 显式拒绝、
 * 容量优先淘汰终态记录且不淘汰活动记录。发送层接线与拒绝路径的反例见
 * test/api/send-agent-run-retention.test.ts。
 */

const COMMIT: NexusSurfaceCommit = {
  sessionVersion: 1,
  runId: 'run-result-1',
  surfaceId: 's-result',
  catalogId: 'https://example.com/catalogs/result/v1',
  contractVersion: 2,
  catalogHash: `sha256:${'a'.repeat(64)}`,
  surfaceRevision: 3,
};

describe('AgentRunManager 结果接口（S2.5.1）', () => {
  it('recordCommit 将固定提交结果挂到运行记录，get/listBySurface 可读', () => {
    const manager = new InMemoryAgentRunManager();
    manager.create({ id: 'run-result-1', surfaceId: 's-result', kind: 'generate' });
    manager.recordCommit('run-result-1', COMMIT);

    const record = manager.get('run-result-1');
    assert.deepEqual(record?.commit, COMMIT);
    assert.deepEqual(
      manager.listBySurface('s-result').at(-1)?.commit,
      COMMIT,
      '按 surface 列出的记录必须携带同一固定结果',
    );
  });

  it('记录不存在时 recordCommit 显式报错，不隐式建立记录', () => {
    const manager = new InMemoryAgentRunManager();
    assert.throws(() => manager.recordCommit('missing-run', COMMIT), /missing-run/);
    assert.equal(manager.get('missing-run'), undefined);
  });
});

describe('有界固定结果留存语义（S2.5.2）', () => {
  it('recordCommit 写入深拷贝：调用方修改原对象不污染已留存结果', () => {
    const manager = new InMemoryAgentRunManager();
    manager.create({ id: 'run-write-clone', surfaceId: 's-clone', kind: 'generate' });
    const commit: NexusSurfaceCommit = {
      ...COMMIT,
      runId: 'run-write-clone',
      surfaceId: 's-clone',
    };
    manager.recordCommit('run-write-clone', commit);

    (commit as { surfaceRevision: number }).surfaceRevision = 99;
    (commit as { catalogHash: string }).catalogHash = 'sha256:polluted';

    assert.equal(manager.get('run-write-clone')?.commit?.surfaceRevision, 3);
    assert.equal(manager.get('run-write-clone')?.commit?.catalogHash, COMMIT.catalogHash);
  });

  it('读取深拷贝：修改 get/listBySurface 返回的记录不污染存储', () => {
    const manager = new InMemoryAgentRunManager();
    manager.create({ id: 'run-read-clone', surfaceId: 's-clone', kind: 'action' });
    manager.recordCommit('run-read-clone', {
      ...COMMIT,
      runId: 'run-read-clone',
      surfaceId: 's-clone',
    });

    const record = manager.get('run-read-clone');
    (record!.commit as { surfaceRevision: number }).surfaceRevision = 99;
    const listed = manager.listBySurface('s-clone').at(-1);
    (listed!.commit as { surfaceRevision: number }).surfaceRevision = 77;

    assert.equal(manager.get('run-read-clone')?.commit?.surfaceRevision, 3);
    assert.equal(manager.listBySurface('s-clone').at(-1)?.commit?.surfaceRevision, 3);
  });

  it('状态迁移不覆盖已留存的固定结果', () => {
    const manager = new InMemoryAgentRunManager();
    manager.create({ id: 'run-migrate', surfaceId: 's-migrate', kind: 'generate' });
    manager.recordCommit('run-migrate', {
      ...COMMIT,
      runId: 'run-migrate',
      surfaceId: 's-migrate',
    });

    manager.transition('run-migrate', 'succeeded', 'done');
    assert.deepEqual(manager.get('run-migrate')?.commit, {
      ...COMMIT,
      runId: 'run-migrate',
      surfaceId: 's-migrate',
    });

    manager.transition('run-migrate', 'failed', '后续观察失败');
    assert.deepEqual(
      manager.get('run-migrate')?.commit,
      { ...COMMIT, runId: 'run-migrate', surfaceId: 's-migrate' },
      '确认提交后的后续失败不得改写固定结果',
    );
  });

  it('重复 recordCommit 显式拒绝，已留存结果不被改写', () => {
    const manager = new InMemoryAgentRunManager();
    manager.create({ id: 'run-dup-commit', surfaceId: 's-dup', kind: 'generate' });
    manager.recordCommit('run-dup-commit', {
      ...COMMIT,
      runId: 'run-dup-commit',
      surfaceId: 's-dup',
    });

    const second: NexusSurfaceCommit = { ...COMMIT, surfaceRevision: 42 };
    assert.throws(() => manager.recordCommit('run-dup-commit', second), /重复|已留存/);
    assert.equal(manager.get('run-dup-commit')?.commit?.surfaceRevision, 3);
  });

  it('已终态记录不能事后补记提交结果', () => {
    const manager = new InMemoryAgentRunManager();
    manager.create({ id: 'run-terminal', surfaceId: 's-terminal', kind: 'action' });
    manager.transition('run-terminal', 'failed', '流失败');

    assert.throws(
      () =>
        manager.recordCommit('run-terminal', {
          ...COMMIT,
          runId: 'run-terminal',
          surfaceId: 's-terminal',
        }),
      /终态/,
    );
    assert.equal(manager.get('run-terminal')?.commit, undefined, '失败运行不得补发可用基准');
  });

  it('重复 create ID 显式拒绝，原记录保留', () => {
    const manager = new InMemoryAgentRunManager();
    manager.create({ id: 'run-dup-id', surfaceId: 's-first', kind: 'generate' });

    assert.throws(
      () => manager.create({ id: 'run-dup-id', surfaceId: 's-second', kind: 'action' }),
      /重复/,
    );
    assert.equal(manager.get('run-dup-id')?.surfaceId, 's-first');
    assert.equal(manager.get('run-dup-id')?.kind, 'generate');
  });

  it('容量满时优先淘汰终态记录，排队/执行中的记录受保护', () => {
    const manager = new InMemoryAgentRunManager({ maxRecords: 3 });
    manager.create({ id: 'active-old', surfaceId: 's-cap', kind: 'generate' });
    manager.create({ id: 'terminal-old', surfaceId: 's-cap', kind: 'generate' });
    manager.create({ id: 'terminal-new', surfaceId: 's-cap', kind: 'action' });
    manager.transition('terminal-old', 'succeeded');
    manager.transition('terminal-new', 'failed');

    manager.create({ id: 'incoming', surfaceId: 's-cap', kind: 'generate' });

    assert.equal(manager.get('active-old')?.state, 'queued', '排队中的记录不得被容量淘汰');
    assert.equal(manager.get('terminal-old'), undefined, '最旧的终态记录被淘汰');
    assert.ok(manager.get('terminal-new'), '较新的终态记录保留');
    assert.ok(manager.get('incoming'), '新记录成功建立');
  });

  it('全部为活动记录时显式拒绝新建，既有记录原样保留', () => {
    const manager = new InMemoryAgentRunManager({ maxRecords: 2 });
    manager.create({ id: 'active-1', surfaceId: 's-full', kind: 'generate' });
    manager.create({ id: 'active-2', surfaceId: 's-full', kind: 'action' });

    assert.throws(
      () => manager.create({ id: 'active-3', surfaceId: 's-full', kind: 'generate' }),
      /容量/,
    );
    assert.ok(manager.get('active-1'), '被拒新建不影响既有活动记录');
    assert.ok(manager.get('active-2'));
    assert.equal(manager.get('active-3'), undefined);
  });
});

describe('留存入口自身验证提交事实', () => {
  it('拒绝非法结构和其他 run/surface 的结果，不改变记录', () => {
    const manager = new InMemoryAgentRunManager();
    manager.create({ id: COMMIT.runId, surfaceId: COMMIT.surfaceId, kind: 'generate' });
    for (const invalid of [
      {},
      { ...COMMIT, runId: 'other-run' },
      { ...COMMIT, surfaceId: 'other-surface' },
    ]) {
      assert.throws(
        () => manager.recordCommit(COMMIT.runId, invalid as NexusSurfaceCommit),
        /提交|不一致/,
      );
      assert.equal(manager.get(COMMIT.runId)?.commit, undefined);
    }
    manager.recordCommit(COMMIT.runId, COMMIT);
    assert.deepEqual(manager.get(COMMIT.runId)?.commit, COMMIT);
  });
});
