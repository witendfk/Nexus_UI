import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';
import { DemoApp } from '../src/browser/app';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../src/contract';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const surfaceId = 'surface-browser-regression';

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
    serverApiVersion: 1,
    kind: 'catalog-contract',
    catalog: {
      catalogId: DEMO_AGENT_CATALOG_ID,
      components: ['ApprovalSummary', 'Button', 'Text'],
      actions: [DEMO_AGENT_ACTION],
    },
    promptContract: 'Published host catalog prompt contract',
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

const catalogContractUrl =
  'https://host.invalid/api/a2ui/catalog-contract?catalogId=demo-from-discovery';
const agentOnboardingUrl =
  'https://host.invalid/api/a2ui/agent-onboarding?catalogId=demo-from-discovery';

const publishedCatalogs = {
  serverApiVersion: 1,
  kind: 'published-catalog-list',
  catalogs: [
    {
      catalogId: DEMO_AGENT_CATALOG_ID,
      components: ['ApprovalSummary', 'Button', 'Text'],
      actions: [DEMO_AGENT_ACTION],
      catalogContractUrl,
      agentOnboardingUrl,
    },
  ],
};

function toSseResponse(messages: unknown[]): Response {
  const encoder = new TextEncoder();
  const output = messages
    .map((message, index) => {
      const id = `${surfaceId}:${index}`;
      return `event: message\nid: ${id}\ndata: ${JSON.stringify(message)}\n\n`;
    })
    .join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`${output}event: done\nid: ${surfaceId}:done\ndata: {}\n\n`),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('standalone host browser app', () => {
  it('keeps the runtime stable when a local action rerenders the host and patches the same surface', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Promise.resolve(
          new Response(JSON.stringify({ actionMode: 'local' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url === '/api/a2ui/published-catalogs') {
        return Promise.resolve(
          new Response(JSON.stringify(publishedCatalogs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.endsWith('/api/a2ui/generate')) {
        return Promise.resolve(toSseResponse(generationMessages));
      }
      if (url.endsWith('/api/a2ui/event')) {
        return Promise.resolve(toSseResponse(actionMessages));
      }
      if (url === catalogContractUrl) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              serverApiVersion: 1,
              kind: 'catalog-contract',
              promptContract: 'Published host catalog prompt contract',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url === agentOnboardingUrl) {
        return Promise.resolve(
          new Response(JSON.stringify(onboardingContract), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { container } = render(createElement(DemoApp));

    await waitFor(() => {
      expect(screen.getByText('action: local handler')).to.exist;
    });
    await waitFor(() => {
      expect(screen.getByText('catalog discovery: done')).to.exist;
    });

    fireEvent.click(screen.getByRole('button', { name: '查看 Catalog Contract' }));
    await waitFor(() => {
      expect(screen.getByText('Published host catalog prompt contract')).to.exist;
    });

    fireEvent.click(screen.getByRole('button', { name: '生成任务面' }));
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

    const actionBody = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body)) as {
      action?: { name?: string; surfaceId?: string };
    };
    expect(actionBody.action?.name).to.equal(DEMO_AGENT_ACTION);
    expect(actionBody.action?.surfaceId).to.equal(surfaceId);

    fireEvent.click(screen.getByRole('button', { name: '查看 Agent Onboarding' }));
    await waitFor(() => {
      expect(screen.getByText('A2UI v0.9 · JSONL')).to.exist;
      expect(screen.getByText(DEMO_AGENT_CATALOG_ID)).to.exist;
      expect(screen.getByText('ApprovalSummary, Button, Text')).to.exist;
      expect(screen.getByText(DEMO_AGENT_ACTION)).to.exist;
      expect(screen.getByText('https://agent.invalid/a2ui')).to.exist;
      expect(
        screen.getByText(
          'PROTOCOL_INVALID, LIFECYCLE_INVALID, CATALOG_UNSUPPORTED, FEATURE_UNSUPPORTED, POLICY_REJECTED',
        ),
      ).to.exist;
      for (const id of onboardingChecks) {
        expect(screen.getByText(id)).to.exist;
      }
      expect(
        screen.getByText(
          'pnpm --filter @nexus-ui/standalone-host-demo verify -- --endpoint https://agent.invalid/a2ui',
        ),
      ).to.exist;
    });
    expect(screen.getByText('host policy rejection returns POLICY_REJECTED')).to.exist;

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/a2ui/published-catalogs');
    expect(fetchMock.mock.calls[2]?.[0]).toBe(catalogContractUrl);
    expect(fetchMock.mock.calls[5]?.[0]).toBe(agentOnboardingUrl);
  });
});
