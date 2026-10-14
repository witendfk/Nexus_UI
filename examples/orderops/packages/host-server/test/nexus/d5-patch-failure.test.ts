import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentAdapter } from '@nexus-ui/server';
import type { AgentAction } from '@nexus-ui/server';
import { CatalogRegistry, validateNexusProfileMessage, validateProtocolMessage } from '@nexus-ui/core';
import { ORDEROPS_CATALOG, ORDEROPS_CATALOG_ID } from '../../src/nexus/catalog';
import { createTicketForSurface, resolveCreateTicketContext } from '../../src/actions/create-ticket';
import { getActionAttemptByActionId, insertSurfaceBinding } from '../../src/cases/repository';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import { detectStalledCases } from '../../src/cases/detect';
import { seedFixtures } from '../../src/fixtures/seed';

/**
 * T4.4 样本⑦（docs/DESIGN.md D5 的锁定反例）：领域事务在 handler 内同步完成后，
 * patch 流被 guard 拒绝——事务不得回滚，以 `action_attempts` 记录恢复（即
 * GET /api/actions/:actionId 的数据源）。故障在测试装配内注入（patch 含
 * Catalog 未声明组件），生产代码不存在该状态。
 */

const NOW = new Date('2026-09-30T12:00:00.000Z');
const SEEDED_CASE_ID = 'case-order-stalled-001-evt-stalled-002';
const registry = new CatalogRegistry([ORDEROPS_CATALOG]);

const dbs: SqliteDb[] = [];

function seededDbWithBinding(): SqliteDb {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-d5-patch-fail-'));
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  seedFixtures(db, NOW);
  detectStalledCases(db, { now: NOW, thresholdHours: 48 });
  insertSurfaceBinding(db, {
    surfaceId: '',
    caseId: SEEDED_CASE_ID,
    caseVersion: 1,
    catalogHash: 'sha256:test',
    createdAt: NOW.toISOString(),
  });
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

/** 与编译器输出同形的合法生成流（host guard 可过）。 */
async function* validSurfaceSource(surfaceId: string): AsyncGenerator<unknown, void, void> {
  yield { version: 'v0.9', createSurface: { surfaceId, catalogId: ORDEROPS_CATALOG.catalogId } };
  yield {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'root',
          component: 'Column',
          children: ['case-title', 'note', 'submit-ticket-label', 'submit-ticket'],
        },
        { id: 'case-title', component: 'Text', text: { path: '/title' }, variant: 'h3' },
        {
          id: 'note',
          component: 'TextField',
          label: { path: '/noteLabel' },
          value: { path: '/draft/note' },
          variant: 'longText',
        },
        { id: 'submit-ticket-label', component: 'Text', text: { path: '/submitButtonLabel' } },
        {
          id: 'submit-ticket',
          component: 'Button',
          child: 'submit-ticket-label',
          action: {
            event: {
              name: 'createTicket',
              context: { note: { path: '/draft/note' } },
            },
          },
        },
      ],
    },
  };
  yield {
    version: 'v0.9',
    updateDataModel: {
      surfaceId,
      value: { title: '分析', noteLabel: '备注', submitButtonLabel: '确认建单', draft: { note: '' } },
    },
  };
}

/** 故障注入：建单后的 patch 含 Catalog 未声明组件（guard 必拒）。 */
async function* illegalPatchSource(surfaceId: string): AsyncGenerator<unknown, void, void> {
  yield {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [{ id: 'evil', component: 'NotInCatalog', rows: [] }],
    },
  };
}

describe('T4.4 样本⑦：事务成功但 patch 失败（D5）', () => {
  it('事务不回滚，操作记录可查询，patch 消息逐条 guard 报错', async () => {
    const db = seededDbWithBinding();
    const adapter = new AgentAdapter({
      registry,
      createGenerationSource: (request) => validSurfaceSource(request.surfaceId),
      resolveActionContext: resolveCreateTicketContext,
    });
    adapter.registerActionHandler(ORDEROPS_CATALOG_ID, 'createTicket', (action) => {
      const outcome = createTicketForSurface(db, {
        surfaceId: action.surfaceId,
        note: String(action.context.note ?? ''),
        requestId: action.actionId,
      });
      if (!outcome.ok) throw new Error(outcome.message);
      return illegalPatchSource(action.surfaceId);
    });

    // 1) 生成并提交快照（in-process 装配，等价宿主 sendAgentRun 的 commit 路径）
    const plan = await adapter.prepareGeneration({
      message: 'case-x',
      catalogId: ORDEROPS_CATALOG.catalogId,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const generationMessages: unknown[] = [];
    for await (const message of plan.run.source) generationMessages.push(message);
    await plan.run.commit(generationMessages);
    const surfaceId = plan.run.sequence.surfaceId;
    db.prepare('UPDATE surface_bindings SET surface_id = ? WHERE case_id = ?').run(
      surfaceId,
      SEEDED_CASE_ID,
    );

    // 2) action：prepareAction 返回时事务已同步提交，patch 尚未被消费
    const action: AgentAction = {
      name: 'createTicket',
      surfaceId,
      sourceComponentId: 'submit-ticket',
      timestamp: new Date().toISOString(),
      actionId: 'd5-1',
      context: { note: 'D5 备注' },
    };
    const actionPlan = await adapter.prepareAction(action);
    expect(actionPlan.ok).toBe(true);
    if (!actionPlan.ok) return;

    expect(db.prepare('SELECT note FROM tickets').all()).toHaveLength(1);
    const c = db.prepare('SELECT status, version FROM anomaly_cases WHERE id = ?').get(SEEDED_CASE_ID) as {
      status: string;
      version: number;
    };
    expect(c).toEqual({ status: 'ticket_created', version: 2 });

    // 3) patch 流被 guard 拒绝（未声明组件在 Catalog 层报错）
    const patchMessages: unknown[] = [];
    for await (const message of actionPlan.run.source) patchMessages.push(message);
    expect(patchMessages).toHaveLength(1);
    const patch = patchMessages[0] as { updateComponents: { components: Array<Record<string, unknown>> } };
    const protocol = validateProtocolMessage(patch);
    expect(protocol.ok).toBe(true);
    if (!protocol.ok) return;
    expect(validateNexusProfileMessage(protocol.message)).toBeNull();
    const diagnostics = registry
      .getComponentDiagnostics(
        ORDEROPS_CATALOG.catalogId,
        patch.updateComponents.components[0] as never,
      )
      .map((entry) => entry.message);
    expect(diagnostics.some((text) => text.includes('NotInCatalog'))).toBe(true);

    // 4) 查询恢复：attempt 仍为 succeeded 且指向工单（patch 失败只影响界面回流）
    expect(getActionAttemptByActionId(db, 'd5-1')).toMatchObject({
      actionId: 'd5-1',
      status: 'succeeded',
      resultId: (db.prepare('SELECT id FROM tickets').get() as { id: string }).id,
    });
  });
});
