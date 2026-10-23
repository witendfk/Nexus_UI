import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { NEXUS_RUN_ID_HEADER } from '@nexus-ui/server';
import { NEXUS_BASIC_TASK_CATALOG } from '../src/agent/catalog';

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;

const { app } = await import('../src/main');
const server = app.listen(0) as Server;
const { port } = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${port}`;

after(() => {
  server.close();
});

interface PublishedSummary {
  catalogId: string;
  contractVersion: number;
  contractHash: string;
  components: string[];
  actions: string[];
}

function doneCommit(output: string): Record<string, unknown> {
  const frame = output.split('\n\n').find((part) => part.includes('event: done\n'));
  assert(frame, '成功流必须发布自己的 done 固定提交');
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  assert(dataLine, 'done 帧必须携带 data 载荷');
  return JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
}

describe('S2.6.1.1 实际入口发布执行 Catalog', () => {
  it('published-catalogs 列出参考服务实际使用的三个 Catalog', async () => {
    const response = await fetch(`${baseUrl}/api/a2ui/published-catalogs`);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { catalogs: PublishedSummary[] };
    const ids = payload.catalogs.map((catalog) => catalog.catalogId).sort();
    assert.deepEqual(
      ids,
      [
        NEXUS_BASIC_TASK_CATALOG,
        'https://example.com/catalogs/nexus-task/v1',
        'https://example.com/catalogs/nexus-workbench/v1',
      ].sort(),
    );
    for (const catalog of payload.catalogs) {
      assert.equal(catalog.contractVersion, 2);
      assert.match(catalog.contractHash, /^sha256:[0-9a-f]{64}$/);
      assert.ok(catalog.components.length > 0);
      assert.ok(catalog.actions.length > 0);
    }
  });

  it('catalog-contract 与 onboarding 的 hash 和发布列表一致', async () => {
    const list = (await (await fetch(`${baseUrl}/api/a2ui/published-catalogs`)).json()) as {
      catalogs: PublishedSummary[];
    };
    for (const summary of list.catalogs) {
      const query = `catalogId=${encodeURIComponent(summary.catalogId)}`;
      const contract = await fetch(`${baseUrl}/api/a2ui/catalog-contract?${query}`);
      assert.equal(contract.status, 200, summary.catalogId);
      const contractPayload = (await contract.json()) as {
        contractHash: string;
        catalog: { catalogId: string };
        promptContract: string;
      };
      assert.equal(contractPayload.contractHash, summary.contractHash);
      assert.equal(contractPayload.catalog.catalogId, summary.catalogId);
      assert.ok(contractPayload.promptContract.length > 0);

      const onboarding = await fetch(`${baseUrl}/api/a2ui/agent-onboarding?${query}`);
      assert.equal(onboarding.status, 200, summary.catalogId);
      const onboardingPayload = (await onboarding.json()) as {
        catalogContract: { contractHash: string };
      };
      assert.equal(onboardingPayload.catalogContract.contractHash, summary.contractHash);
    }
  });
});

describe('S2.6.1.3 无 key 经实际服务完成表单首闭环', () => {
  it('生成可编辑表单，done 的 Catalog/hash 与发布契约一致', async () => {
    const generated = await (
      await fetch(`${baseUrl}/api/a2ui/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '生成一个订阅表单卡片',
          catalogId: NEXUS_BASIC_TASK_CATALOG,
        }),
      })
    ).text();

    assert.match(generated, /"TextField"/);
    assert.match(generated, /"CheckBox"/);
    const commit = doneCommit(generated);
    const list = (await (await fetch(`${baseUrl}/api/a2ui/published-catalogs`)).json()) as {
      catalogs: PublishedSummary[];
    };
    const published = list.catalogs.find((catalog) => catalog.catalogId === commit.catalogId);
    assert.ok(published, 'done 的 catalogId 必须在发布列表中');
    assert.equal(commit.catalogHash, published.contractHash);
  });

  it('SSE 响应携带运行标识并经 CORS 暴露给跨源客户端', async () => {
    const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogId: NEXUS_BASIC_TASK_CATALOG }),
    });
    await response.text();
    const runId = response.headers.get(NEXUS_RUN_ID_HEADER);
    assert.ok(runId, '生成响应必须携带 X-Nexus-Run-Id');
    const exposed = (response.headers.get('access-control-expose-headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((item) => item.trim());
    assert.ok(
      exposed.includes(NEXUS_RUN_ID_HEADER.toLowerCase()),
      `CORS exposeHeaders 必须暴露 ${NEXUS_RUN_ID_HEADER}，实际: ${exposed.join(', ')}`,
    );
  });

  it('最新输入经 HTTP envelope 到达 submit handler 并 patch 原 surface', async () => {
    const generated = await (
      await fetch(`${baseUrl}/api/a2ui/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '生成一个订阅表单卡片',
          catalogId: NEXUS_BASIC_TASK_CATALOG,
        }),
      })
    ).text();
    const commit = doneCommit(generated);
    const surfaceId = /"surfaceId":"(surface-[^"]+)"/.exec(generated)?.[1];
    assert.ok(surfaceId);

    const response = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          version: 'v0.9',
          action: {
            name: 'submit',
            surfaceId,
            sourceComponentId: 'submitButton',
            timestamp: new Date().toISOString(),
            context: {},
          },
        },
        nexus: {
          sessionVersion: commit.sessionVersion,
          actionId: randomUUID(),
          surfaceRevision: commit.surfaceRevision,
          catalogHash: commit.catalogHash,
          inputs: [
            { componentId: 'name', property: 'value', value: '张三' },
            { componentId: 'subscribed', property: 'value', value: true },
          ],
        },
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, new RegExp(surfaceId));
    assert.match(text, /已提交：name=张三，subscribed=true/);
    assert.match(text, /event: done/);
  });

  it('错误类型的输入经真实入口拒绝，handler 不产生提交结果', async () => {
    const generated = await (
      await fetch(`${baseUrl}/api/a2ui/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '生成一个订阅表单卡片',
          catalogId: NEXUS_BASIC_TASK_CATALOG,
        }),
      })
    ).text();
    const commit = doneCommit(generated);
    const surfaceId = /"surfaceId":"(surface-[^"]+)"/.exec(generated)?.[1];
    assert.ok(surfaceId);

    const response = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          version: 'v0.9',
          action: {
            name: 'submit',
            surfaceId,
            sourceComponentId: 'submitButton',
            timestamp: new Date().toISOString(),
            context: {},
          },
        },
        nexus: {
          sessionVersion: commit.sessionVersion,
          actionId: randomUUID(),
          surfaceRevision: commit.surfaceRevision,
          catalogHash: commit.catalogHash,
          inputs: [{ componentId: 'subscribed', property: 'value', value: 'yes' }],
        },
      }),
    });
    const text = await response.text();

    // S3.2：调度内准入失败经 SSE error 报告（200 + error 帧），handler 零调用。
    assert.equal(response.status, 200);
    assert.match(text, /event: error/);
    assert.match(text, /"runCode":"RUN_ADMISSION_REJECTED"/);
    assert.match(text, /值不符合声明 schema/);
    assert.doesNotMatch(text, /已提交/);
    assert.doesNotMatch(text, /event: done/);
  });
});
