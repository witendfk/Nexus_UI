import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';
import { createCatalogPromptContract, getCatalogContractHashInput } from '@nexus-ui/core';
import { createHash } from 'node:crypto';
import { DemoApp } from '../src/browser/app';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../src/contract';
import {
  SCORECARD_ACTION,
  SCORECARD_CATALOG_ID,
  scorecardHostCatalog,
} from '../src/shared/scorecard-contract';
import { standaloneHostCatalog } from '../src/shared/catalog-contract';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const surfaceId = 'surface-browser-regression';

/** 与 server 同源的规范化：Web Crypto/Node 摘要值一致（S2.6.3.1）。 */
function contractHashOf(
  catalog: typeof standaloneHostCatalog | typeof scorecardHostCatalog,
): string {
  return `sha256:${createHash('sha256')
    .update(getCatalogContractHashInput(catalog))
    .digest('hex')}`;
}

function contractPayload(catalog: typeof standaloneHostCatalog | typeof scorecardHostCatalog) {
  return {
    serverApiVersion: 1,
    kind: 'catalog-contract',
    contractVersion: 2,
    contractHash: contractHashOf(catalog),
    catalog,
    promptContract: createCatalogPromptContract(catalog),
  };
}

const approvalContract = contractPayload(standaloneHostCatalog);
const scorecardContract = contractPayload(scorecardHostCatalog);

const approvalContractUrl = `https://host.invalid/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(
  DEMO_AGENT_CATALOG_ID,
)}`;

const onboardingChecks = [
  'generation-lifecycle',
  'catalog-stability',
  'generation-root',
  'action-same-surface',
  'action-root-stability',
  'policy-rejection',
] as const;

const onboardingRequirements = [
  'generation starts with createSurface and ends with done',
  'catalogId remains stable across the stream',
  'a component with id root is rendered',
  'action response uses the same surfaceId and does not create or delete it',
  'root remains available for same-surface patching',
  'host policy rejection returns POLICY_REJECTED',
] as const;

const onboardingContract = {
  serverApiVersion: 1,
  contractVersion: 1,
  kind: 'agent-onboarding-contract',
  protocol: {
    name: 'A2UI',
    version: 'v0.9',
    wireFormat: 'JSONL',
    surfaceModel: 'flat components + dataModel + stable component ids',
  },
  catalogContract: {
    ...approvalContract,
  },
  rpc: {
    endpoint: {
      method: 'POST',
      disclosed: true,
      url: 'https://agent.invalid/a2ui',
    },
  },
  errors: {
    transport: 'SSE error event',
    boundaryCodes: [
      'PROTOCOL_INVALID',
      'LIFECYCLE_INVALID',
      'CATALOG_UNSUPPORTED',
      'FEATURE_UNSUPPORTED',
      'POLICY_REJECTED',
    ],
  },
  verification: {
    required: true,
    type: 'external-agent',
    checks: onboardingChecks.map((id, index) => ({
      id,
      requirement: onboardingRequirements[index],
    })),
    command:
      'pnpm --filter @nexus-ui/standalone-host-demo verify -- --endpoint https://agent.invalid/a2ui',
  },
};

const publishedCatalogs = {
  serverApiVersion: 1,
  kind: 'published-catalog-list',
  catalogs: [
    {
      catalogId: DEMO_AGENT_CATALOG_ID,
      contractVersion: 2,
      contractHash: approvalContract.contractHash,
      components: ['ApprovalSummary', 'Text', 'Button'],
      actions: [DEMO_AGENT_ACTION],
      catalogContractUrl: approvalContractUrl,
      agentOnboardingUrl: 'https://host.invalid/api/a2ui/agent-onboarding?catalogId=approval',
    },
    {
      catalogId: SCORECARD_CATALOG_ID,
      contractVersion: 2,
      contractHash: scorecardContract.contractHash,
      components: ['FeedbackSummary', 'ScoreDial', 'PinnedToggle', 'SubmitCard', 'Text', 'Column'],
      actions: [SCORECARD_ACTION],
      catalogContractUrl: `https://host.invalid/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(
        SCORECARD_CATALOG_ID,
      )}`,
      agentOnboardingUrl: 'https://host.invalid/api/a2ui/agent-onboarding?catalogId=scorecard',
    },
  ],
};

const generationMessages = [
  {
    version: 'v0.9',
    createSurface: { surfaceId, catalogId: DEMO_AGENT_CATALOG_ID },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'root',
          component: 'ApprovalSummary',
          title: { path: '/title' },
          amount: { path: '/amount' },
          children: ['approve'],
        },
        {
          id: 'approve',
          component: 'Button',
          child: 'approveLabel',
          action: {
            event: {
              name: DEMO_AGENT_ACTION,
              context: {
                approvalId: { path: '/approvalId' },
                amount: { path: '/amount' },
              },
            },
          },
        },
        { id: 'approveLabel', component: 'Text', text: 'Approve' },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId,
      value: {
        title: 'Marketing campaign approval',
        amount: 'USD 12,000',
        approvalId: 'approval-browser-001',
      },
    },
  },
];

const actionMessages = [
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'root',
          component: 'ApprovalSummary',
          title: { path: '/title' },
          amount: { path: '/amount' },
          children: ['approve'],
        },
        { id: 'approve', component: 'Button', child: 'approveLabel', disabled: true },
        { id: 'approveLabel', component: 'Text', text: 'Approved locally' },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId,
      value: {
        title: 'Approved locally: approval-browser-001',
        amount: 'USD 12,000',
      },
    },
  },
];

function sessionStart(runId: string, surfaceId: string, catalogId: string, revision = 1): string {
  return `event: start\ndata: ${JSON.stringify({
    sessionVersion: 1,
    runId,
    surfaceId,
    catalogId,
    contractVersion: 2,
    catalogHash: contractHashOf(
      catalogId === SCORECARD_CATALOG_ID ? scorecardHostCatalog : standaloneHostCatalog,
    ),
    ...(revision > 1 ? { surfaceRevision: revision - 1 } : {}),
  })}\n\n`;
}

function toSseResponse(
  messages: unknown[],
  catalogId: string,
  options: {
    runIdHeader?: string | null;
    doneRunId?: string;
    catalogHash?: string;
    revision?: number;
  } = {},
): Response {
  const runId = options.doneRunId ?? surfaceId;
  const encoder = new TextEncoder();
  const output = messages
    .map((message, index) => {
      const id = `${surfaceId}:${index}`;
      return `event: message\nid: ${id}\ndata: ${JSON.stringify(message)}\n\n`;
    })
    .join('');
  const doneCommit = {
    sessionVersion: 1,
    runId,
    surfaceId,
    catalogId,
    contractVersion: 2,
    catalogHash:
      options.catalogHash ??
      contractHashOf(
        catalogId === SCORECARD_CATALOG_ID ? scorecardHostCatalog : standaloneHostCatalog,
      ),
    surfaceRevision: options.revision ?? 1,
  };
  const headers: Record<string, string> = { 'Content-Type': 'text/event-stream' };
  if (options.runIdHeader !== null) {
    headers['X-Nexus-Run-Id'] = options.runIdHeader ?? runId;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `${sessionStart(runId, surfaceId, catalogId, options.revision)}${output}event: done\nid: ${surfaceId}:done\ndata: ${JSON.stringify(doneCommit)}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

function toScorecardSse(messages: unknown[], surface: string, revision = 1): Response {
  const runId = `${surface}:run-${revision}`;
  const encoder = new TextEncoder();
  const output = messages
    .map((message, index) => {
      const id = `${surface}:${index}`;
      return `event: message\nid: ${id}\ndata: ${JSON.stringify(message)}\n\n`;
    })
    .join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `${sessionStart(runId, surface, SCORECARD_CATALOG_ID, revision)}${output}event: done\nid: ${surface}:done\ndata: ${JSON.stringify(
            {
              sessionVersion: 1,
              runId,
              surfaceId: surface,
              catalogId: SCORECARD_CATALOG_ID,
              contractVersion: 2,
              catalogHash: scorecardContract.contractHash,
              surfaceRevision: revision,
            },
          )}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'X-Nexus-Run-Id': runId },
  });
}

const scorecardGeneration = [
  {
    version: 'v0.9',
    createSurface: { surfaceId: 'surface-scorecard-browser', catalogId: SCORECARD_CATALOG_ID },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'surface-scorecard-browser',
      components: [
        {
          id: 'root',
          component: 'Column',
          children: ['summary', 'scoreDial', 'pinnedToggle', 'submitCard'],
        },
        {
          id: 'summary',
          component: 'FeedbackSummary',
          title: { path: '/title' },
          note: { path: '/note' },
        },
        { id: 'scoreDial', component: 'ScoreDial', score: { path: '/score' } },
        { id: 'pinnedToggle', component: 'PinnedToggle', pinned: { path: '/pinned' } },
        {
          id: 'submitCard',
          component: 'SubmitCard',
          children: ['submitCardLabel'],
          action: {
            event: {
              name: SCORECARD_ACTION,
              context: { score: { path: '/score' }, pinned: { path: '/pinned' } },
            },
          },
        },
        { id: 'submitCardLabel', component: 'Text', text: '记录反馈' },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'surface-scorecard-browser',
      value: {
        title: '会话反馈',
        note: '给本次会话打分并选择是否置顶',
        score: 50,
        pinned: false,
      },
    },
  },
];

function hostFetchMock(
  overrides: {
    generate?: (catalogId: string) => Response;
    event?: () => Response;
  } = {},
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return Promise.resolve(
        new Response(JSON.stringify({ actionMode: 'local' }), { status: 200 }),
      );
    }
    if (url.endsWith('/api/a2ui/published-catalogs')) {
      return Promise.resolve(new Response(JSON.stringify(publishedCatalogs), { status: 200 }));
    }
    if (url === approvalContractUrl) {
      return Promise.resolve(new Response(JSON.stringify(approvalContract), { status: 200 }));
    }
    if (url.includes(`catalogId=${encodeURIComponent(SCORECARD_CATALOG_ID)}`)) {
      return Promise.resolve(new Response(JSON.stringify(scorecardContract), { status: 200 }));
    }
    if (url.includes('agent-onboarding')) {
      return Promise.resolve(new Response(JSON.stringify(onboardingContract), { status: 200 }));
    }
    if (url.endsWith('/api/a2ui/generate')) {
      const body = JSON.parse(String(init?.body)) as { catalogId: string };
      if (overrides.generate) return Promise.resolve(overrides.generate(body.catalogId));
      return Promise.resolve(
        body.catalogId === SCORECARD_CATALOG_ID
          ? toScorecardSse(scorecardGeneration, 'surface-scorecard-browser')
          : toSseResponse(generationMessages, DEMO_AGENT_CATALOG_ID),
      );
    }
    if (url.endsWith('/api/a2ui/event')) {
      if (overrides.event) return Promise.resolve(overrides.event());
      return Promise.resolve(
        toSseResponse(actionMessages, DEMO_AGENT_CATALOG_ID, {
          revision: 2,
          doneRunId: 'approval-action-run',
        }),
      );
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

describe('standalone host browser app', () => {
  it('keeps the runtime stable when a local action rerenders the host and patches the same surface', async () => {
    const fetchMock = hostFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { container } = render(createElement(DemoApp));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '生成审批面' })).to.exist;
    });
    await waitFor(() => {
      expect(screen.getByText('action: local handler')).to.exist;
    });

    fireEvent.click(screen.getByRole('button', { name: '查看 Catalog Contract' }));
    const contractPanel = screen.getByLabelText('Catalog Contract');
    await waitFor(() => {
      const text = contractPanel.querySelector('pre.contract-text')?.textContent ?? '';
      expect(text).to.contain('# Nexus UI Agent Output Contract');
      expect(text).to.contain(`Catalog ID: ${DEMO_AGENT_CATALOG_ID}`);
    });

    fireEvent.click(screen.getByRole('button', { name: '生成审批面' }));
    await waitFor(() => {
      expect(screen.getByText('Marketing campaign approval')).to.exist;
      expect(screen.getByText('USD 12,000')).to.exist;
      expect(screen.getByRole('button', { name: 'Approve' })).to.exist;
    });

    const surfaceBefore = screen.getByText('Marketing campaign approval').closest('section');
    expect(surfaceBefore).to.exist;

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText('Approved locally: approval-browser-001')).to.exist;
      expect(screen.getByRole('button', { name: 'Approved locally' })).to.exist;
    });

    expect(container.querySelector('p.status')?.textContent).to.equal(
      `action: ${DEMO_AGENT_ACTION} · surface: ${surfaceId}`,
    );

    const approvedButton = screen.getByRole('button', {
      name: 'Approved locally',
    }) as HTMLButtonElement;
    expect(approvedButton.disabled).to.equal(true);

    const surfaceAfter = screen
      .getByText('Approved locally: approval-browser-001')
      .closest('section');
    expect(surfaceAfter).to.equal(surfaceBefore);

    const actionCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/a2ui/event'),
    );
    expect(actionCall).toBeDefined();
    const actionBody = JSON.parse(String(actionCall?.[1]?.body)) as {
      message: { action?: { name?: string; surfaceId?: string; actionId?: string } };
      nexus: { actionId: string; surfaceRevision: number };
    };
    expect(actionBody.message.action?.name).to.equal(DEMO_AGENT_ACTION);
    expect(actionBody.message.action?.surfaceId).to.equal(surfaceId);
    expect(actionBody.nexus.actionId).to.equal(actionBody.message.action?.actionId);
    expect(actionBody.nexus.surfaceRevision).to.equal(1);

    fireEvent.click(screen.getByRole('button', { name: '查看 Agent Onboarding' }));
    await waitFor(() => {
      expect(screen.getByText('A2UI v0.9 · JSONL')).to.exist;
      expect(screen.getByText(DEMO_AGENT_CATALOG_ID)).to.exist;
      expect(screen.getByText('ApprovalSummary, Text, Button')).to.exist;
      expect(screen.getByText(DEMO_AGENT_ACTION)).to.exist;
      expect(screen.getByText('https://agent.invalid/a2ui')).to.exist;
      for (const id of onboardingChecks) {
        expect(screen.getByText(id)).to.exist;
      }
    });
    expect(screen.getByText('host policy rejection returns POLICY_REJECTED')).to.exist;
  });

  it('scorecard 场景：非 value 输入与非 Button 触发器上报，成功提交确认草稿（连续第二次不再重发）', async () => {
    let eventCalls = 0;
    const fetchMock = hostFetchMock({
      generate: (catalogId) =>
        catalogId === SCORECARD_CATALOG_ID
          ? toScorecardSse(scorecardGeneration, 'surface-scorecard-browser')
          : toSseResponse(generationMessages, DEMO_AGENT_CATALOG_ID),
      event: () => {
        eventCalls += 1;
        return toScorecardSse(
          [
            {
              version: 'v0.9',
              updateDataModel: {
                surfaceId: 'surface-scorecard-browser',
                path: '/note',
                value: `已记录（第 ${eventCalls} 次）`,
              },
            },
          ],
          'surface-scorecard-browser',
          eventCalls + 1,
        );
      },
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(createElement(DemoApp));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '生成反馈卡' })).to.exist;
    });

    fireEvent.click(screen.getByRole('button', { name: '生成反馈卡' }));
    await waitFor(() => {
      expect(screen.getByText('会话反馈')).to.exist;
    });

    const summaryBefore = screen.getByText('会话反馈').closest('section');
    expect(summaryBefore).to.exist;

    fireEvent.change(screen.getByLabelText('评分（0-100 整数）'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '置顶本次反馈' }));
    fireEvent.click(screen.getByRole('button', { name: '记录反馈' }));

    await waitFor(() => {
      expect(screen.getByText('已记录（第 1 次）')).to.exist;
    });

    // 同一 runtime：action 前后摘要 DOM 节点不重建。
    const summaryAfter = screen.getByText('已记录（第 1 次）').closest('section');
    expect(summaryAfter).to.equal(summaryBefore);

    const eventBodies = () =>
      fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith('/api/a2ui/event'))
        .map(([, init]) => JSON.parse(String(init?.body)));
    const firstBody = eventBodies()[0] as {
      message: { action: { name: string; sourceComponentId: string } };
      nexus: { inputs: { componentId: string; property: string; value: unknown }[] };
    };
    expect(firstBody.message.action.name).to.equal(SCORECARD_ACTION);
    expect(firstBody.message.action.sourceComponentId).to.equal('submitCard');
    expect(firstBody.nexus.inputs).to.deep.equal([
      { componentId: 'scoreDial', property: 'score', value: 42 },
      { componentId: 'pinnedToggle', property: 'pinned', value: true },
    ]);

    // 第二次提交：已确认草稿不重发，inputs 为空。
    fireEvent.click(screen.getByRole('button', { name: '记录反馈' }));
    await waitFor(() => {
      expect(screen.getByText('已记录（第 2 次）')).to.exist;
    });
    const secondBody = eventBodies()[1] as { nexus: { inputs: unknown[] } };
    expect(secondBody.nexus.inputs).to.deep.equal([]);
  });

  it('缺运行标识头时生成被拒、不形成基准', async () => {
    const fetchMock = hostFetchMock({
      generate: () =>
        toSseResponse(generationMessages, DEMO_AGENT_CATALOG_ID, { runIdHeader: null }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(createElement(DemoApp));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '生成审批面' })).to.exist;
    });

    fireEvent.click(screen.getByRole('button', { name: '生成审批面' }));
    await waitFor(() => {
      expect(screen.getByText(/响应缺少运行标识头/)).to.exist;
    });
    // 生成被拒：流消息可渐进渲染，但不产生任何基准——没有 action 请求发出。
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/a2ui/event')).length,
    ).to.equal(0);
  });

  it('done 运行标识与响应头不一致同样拒绝', async () => {
    const fetchMock = hostFetchMock({
      generate: () =>
        toSseResponse(generationMessages, DEMO_AGENT_CATALOG_ID, {
          runIdHeader: surfaceId,
          doneRunId: 'other-run',
        }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(createElement(DemoApp));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '生成审批面' })).to.exist;
    });
    fireEvent.click(screen.getByRole('button', { name: '生成审批面' }));
    await waitFor(() => {
      expect(screen.getByText(/start.runId 与响应头不一致/)).to.exist;
    });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/a2ui/event')).length,
    ).to.equal(0);
  });

  it('done 的 catalogHash 与已加载契约不一致拒绝', async () => {
    const fetchMock = hostFetchMock({
      generate: () =>
        toSseResponse(generationMessages, DEMO_AGENT_CATALOG_ID, {
          catalogHash: `sha256:${'0'.repeat(64)}`,
        }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(createElement(DemoApp));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '生成审批面' })).to.exist;
    });
    fireEvent.click(screen.getByRole('button', { name: '生成审批面' }));
    await waitFor(() => {
      expect(screen.getByText(/done catalogHash 与 start 不一致/)).to.exist;
    });
  });
});

it('在途重复 action 被忽略，原运行正常完成并释放 busy', async () => {
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const fetchMock = hostFetchMock({
    event: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            control = c;
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'X-Nexus-Run-Id': 'surface-scorecard-browser:run-2',
          },
        },
      ),
  });
  vi.stubGlobal('fetch', fetchMock);
  const { container } = render(createElement(DemoApp));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成反馈卡' })).to.exist);
  fireEvent.click(screen.getByRole('button', { name: '生成反馈卡' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '生成反馈卡' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '记录反馈' }));
  await waitFor(() =>
    expect(container.querySelector('span.status')?.textContent).toBe('streaming'),
  );
  fireEvent.click(screen.getByRole('button', { name: '记录反馈' }));
  const final = await toScorecardSse([], 'surface-scorecard-browser', 2).text();
  control.enqueue(new TextEncoder().encode(final));
  control.close();
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '生成反馈卡' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(container.querySelector('span.status')?.textContent).toBe('done');
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/event'))).toHaveLength(1);
});

it('scorecard 请求期间的新编辑在成功确认后恢复可见，下次只提交新草稿', async () => {
  let release!: (response: Response) => void;
  let first!: Response;
  const fetchMock = hostFetchMock();
  const original = fetchMock.getMockImplementation()!;
  let count = 0;
  fetchMock.mockImplementation((input, init) => {
    if (String(input).endsWith('/api/a2ui/event')) {
      const response = toScorecardSse(
        [
          {
            version: 'v0.9',
            updateDataModel: {
              surfaceId: 'surface-scorecard-browser',
              value: { title: '会话反馈', note: 'done', score: 60, pinned: false },
            },
          },
        ],
        'surface-scorecard-browser',
        ++count + 1,
      );
      if (count === 1) {
        first = response;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(response);
    }
    return original(input, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(createElement(DemoApp));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成反馈卡' })).to.exist);
  fireEvent.click(screen.getByRole('button', { name: '生成反馈卡' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '生成反馈卡' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText('评分（0-100 整数）'), { target: { value: '42' } });
  fireEvent.click(screen.getByRole('button', { name: '记录反馈' }));
  fireEvent.change(screen.getByLabelText('评分（0-100 整数）'), { target: { value: '73' } });
  release(first);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '生成反馈卡' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect((screen.getByLabelText('评分（0-100 整数）') as HTMLInputElement).value).toBe('73');
  fireEvent.click(screen.getByRole('button', { name: '记录反馈' }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/event'))).toHaveLength(2),
  );
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/event'));
  expect(JSON.parse(String(calls[1]![1]?.body)).nexus.inputs).toEqual([
    { componentId: 'scoreDial', property: 'score', value: 73 },
  ]);
});

it('standalone 第二次生成只有 done，旧 surface 不取得新基准', async () => {
  let count = 0;
  const fetchMock = hostFetchMock({
    generate: () =>
      ++count === 1
        ? toScorecardSse(scorecardGeneration, 'surface-scorecard-browser')
        : toScorecardSse([], 'surface-scorecard-browser', 2),
  });
  vi.stubGlobal('fetch', fetchMock);
  const { container } = render(createElement(DemoApp));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成反馈卡' })).to.exist);
  fireEvent.click(screen.getByRole('button', { name: '生成反馈卡' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '生成反馈卡' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '生成反馈卡' }));
  await waitFor(() =>
    expect(container.querySelector('span.status')?.textContent).toContain('error:'),
  );
  expect(screen.queryByRole('button', { name: '记录反馈' })).toBeNull();
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/event'))).toHaveLength(0);
});

for (const phase of ['generate', 'action'] as const) {
  it(`standalone ${phase} 挂起期间卸载，reader 被取消并且不会消费晚到消息`, async () => {
    let control!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          control = c;
        },
        cancel,
      }),
      { headers: { 'Content-Type': 'text/event-stream', 'X-Nexus-Run-Id': 'late-run' } },
    );
    const fetchMock = hostFetchMock();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) =>
      String(input).endsWith(`/api/a2ui/${phase === 'action' ? 'event' : 'generate'}`)
        ? Promise.resolve(response)
        : original(input, init),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(createElement(DemoApp));
    await waitFor(() => expect(screen.getByRole('button', { name: '生成反馈卡' })).to.exist);
    fireEvent.click(screen.getByRole('button', { name: '生成反馈卡' }));
    if (phase === 'action') {
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: '生成反馈卡' }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole('button', { name: '记录反馈' }));
    }
    await waitFor(() => expect(response.body!.locked).toBe(true));
    unmount();
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(() => control.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'))).toThrow();
    expect(response.body!.locked).toBe(false);
  });
}

it('standalone 取消后另一次生成完成，晚到 fetch 不替换新视图或重新启用旧运行', async () => {
  const fetchMock = hostFetchMock();
  const original = fetchMock.getMockImplementation()!;
  let release!: (response: Response) => void;
  let old!: Response;
  let count = 0;
  fetchMock.mockImplementation(async (input, init) => {
    const response = await original(input, init);
    if (String(input).endsWith('/generate') && ++count === 1) {
      old = response;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  render(createElement(DemoApp));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成审批面' })).to.exist);
  fireEvent.click(screen.getByRole('button', { name: '生成审批面' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '生成反馈卡' }));
  await waitFor(() => expect(screen.getByText('会话反馈')).to.exist);
  await act(async () => release(old));
  await waitFor(() => expect(old.body!.locked).toBe(false));
  expect(screen.queryByText('Marketing campaign approval')).toBeNull();
  expect(screen.getByText('会话反馈')).to.exist;
  fireEvent.click(screen.getByRole('button', { name: '记录反馈' }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/event'))).toHaveLength(1),
  );
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/event'))!;
  expect(JSON.parse(String(call[1]?.body)).message.action.surfaceId).toBe(
    'surface-scorecard-browser',
  );
});

it('自定义 action 在流中预览、运行中和 unknown 后均显示禁用且 click/key 无请求出口', async () => {
  let generationControl!: ReadableStreamDefaultController<Uint8Array>;
  let generationTail = '';
  let actionControl!: ReadableStreamDefaultController<Uint8Array>;
  const fetchMock = hostFetchMock();
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    const response = await original(input, init);
    if (String(input).endsWith('/generate')) {
      const text = await response.text();
      const split = text.lastIndexOf('event: done');
      generationTail = text.slice(split);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            generationControl = c;
            c.enqueue(new TextEncoder().encode(text.slice(0, split)));
          },
        }),
        { headers: response.headers },
      );
    }
    if (String(input).endsWith('/event')) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            actionControl = c;
          },
        }),
        {
          headers: { 'Content-Type': 'text/event-stream', 'X-Nexus-Run-Id': 'uncertain-action' },
        },
      );
    }
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  const { container } = render(createElement(DemoApp));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成反馈卡' })).to.exist);
  fireEvent.click(screen.getByRole('button', { name: '生成反馈卡' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '记录反馈' })).to.exist);
  const previewAction = screen.getByRole('button', { name: '记录反馈' });
  expect(previewAction.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(previewAction);
  fireEvent.keyDown(previewAction, { key: 'Enter' });
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/event'))).toHaveLength(0);
  await act(async () => {
    generationControl.enqueue(new TextEncoder().encode(generationTail));
    generationControl.close();
  });
  const action = screen.getByRole('button', { name: '记录反馈' });
  expect(action.getAttribute('aria-disabled')).toBe('false');
  // 键盘路径真正能发起合法 action，避免“永远禁用”的假阳性。
  fireEvent.keyDown(action, { key: 'Enter' });
  await waitFor(() => expect(actionControl).toBeDefined());
  expect(action.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(action);
  fireEvent.keyDown(action, { key: ' ' });
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/event'))).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('评分（0-100 整数）'), { target: { value: '73' } });
  await act(async () => {
    actionControl.enqueue(
      new TextEncoder().encode(
        sessionStart('uncertain-action', 'surface-scorecard-browser', SCORECARD_CATALOG_ID, 2) +
          `event: message\ndata: ${JSON.stringify({ version: 'v0.9', updateDataModel: { surfaceId: 'surface-scorecard-browser', path: '/score', value: 10 } })}\n\n` +
          `event: error\ndata: ${JSON.stringify({ sessionVersion: 1, runId: 'uncertain-action', surfaceId: 'surface-scorecard-browser', code: 'RUN_FAILED', commitState: 'unknown', message: 'unknown outcome' })}\n\n`,
      ),
    );
    actionControl.close();
  });
  expect(container.querySelector('span.status')?.textContent).toContain('unknown outcome');
  expect((screen.getByLabelText('评分（0-100 整数）') as HTMLInputElement).value).toBe('73');
  expect(action.getAttribute('aria-disabled')).toBe('true');
  expect(action.tabIndex).toBe(-1);
  fireEvent.click(action);
  fireEvent.keyDown(action, { key: 'Enter' });
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/event'))).toHaveLength(1);
});
