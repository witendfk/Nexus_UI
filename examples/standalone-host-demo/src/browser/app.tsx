import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import { parseSurfaceCommit } from '@nexus-ui/core';
import type { NexusSurfaceCommit } from '@nexus-ui/core';
import type { ActionEvent, A2UIRuntime } from '@nexus-ui/core';
import type { AgentOnboardingContractPayload, PublishedCatalogsPayload } from '@nexus-ui/server';
import { streamSse } from './sse';
import type { SseEvent } from './sse';
import { createStandaloneHostRegistry, standaloneHostRenderMap } from '../shared/catalog';
import { DEMO_AGENT_CATALOG_ID } from '../contract';

function agentError(data: string): string {
  try {
    const value = JSON.parse(data) as { message?: unknown };
    return value.message === undefined ? 'Agent 输出失败' : String(value.message);
  } catch {
    return 'Agent 输出失败';
  }
}

async function consumeRun(
  runtime: A2UIRuntime,
  options: {
    url: string;
    body: unknown;
    signal?: AbortSignal;
  },
  rejected: { current: boolean },
): Promise<NexusSurfaceCommit> {
  let commit: NexusSurfaceCommit | null = null;
  const touched = new Set<string>();
  rejected.current = false;
  await streamSse({
    ...options,
    onEvent: (event: SseEvent) => {
      if (commit) throw new Error('成功终态之后收到额外事件');
      if (event.event === 'error') throw new Error(agentError(event.data));
      if (event.event === 'message') {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        for (const key of [
          'createSurface',
          'updateComponents',
          'updateDataModel',
          'deleteSurface',
        ]) {
          const payload = message[key] as { surfaceId?: string } | undefined;
          if (payload?.surfaceId) touched.add(payload.surfaceId);
        }
        runtime.push(`${event.data}\n`);
      }
      if (event.event === 'done') {
        commit = parseSurfaceCommit(JSON.parse(event.data));
        if (!commit || (event.id && event.id !== `${commit.runId}:done`))
          throw new Error('提交基准无效');
      }
    },
  });
  runtime.end();
  const fixed = commit as NexusSurfaceCommit | null;
  if (
    !fixed ||
    rejected.current ||
    [...touched].some((id) => id !== fixed.surfaceId) ||
    runtime.store.getState().surfaces[fixed.surfaceId]?.catalogId !== fixed.catalogId
  ) {
    throw new Error('运行未成功提交或本地消息被拒绝，请重新生成');
  }
  return fixed;
}

type PublishedCatalogUrls = Pick<
  PublishedCatalogsPayload['catalogs'][number],
  'agentOnboardingUrl' | 'catalogContractUrl'
>;

function CatalogContractPanel({ url }: { url: string | null }): ReactElement {
  const [contract, setContract] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);

  const loadContract = async (): Promise<void> => {
    if (!url) return;
    setBusy(true);
    setStatus('loading');
    try {
      const response = await fetch(url);
      const payload = (await response.json()) as { promptContract?: string };
      if (!response.ok || !payload.promptContract) throw new Error('Catalog contract 获取失败');
      setContract(payload.promptContract);
      setStatus('done');
    } catch (error) {
      setStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="contract-panel" aria-label="Catalog Contract">
      <div className="command-row">
        <button type="button" disabled={busy || url === null} onClick={() => void loadContract()}>
          查看 Catalog Contract
        </button>
        <span className="status">{status}</span>
      </div>
      {contract ? <pre className="contract-text">{contract}</pre> : null}
    </section>
  );
}

function AgentOnboardingPanel({ url }: { url: string | null }): ReactElement {
  const [contract, setContract] = useState<AgentOnboardingContractPayload | null>(null);
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);

  const loadContract = async (): Promise<void> => {
    if (!url) return;
    setBusy(true);
    setStatus('loading');
    try {
      const response = await fetch(url);
      const payload = (await response.json()) as AgentOnboardingContractPayload;
      if (!response.ok || payload.kind !== 'agent-onboarding-contract') {
        throw new Error('Agent onboarding contract 获取失败');
      }
      setContract(payload);
      setStatus('done');
    } catch (error) {
      setStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const catalog = contract?.catalogContract.catalog;

  return (
    <section className="contract-panel" aria-label="Agent Onboarding Contract">
      <div className="command-row">
        <button type="button" disabled={busy || url === null} onClick={() => void loadContract()}>
          查看 Agent Onboarding
        </button>
        <span className="status">{status}</span>
      </div>
      {contract && catalog ? (
        <div className="onboarding-contract">
          <dl className="contract-summary">
            <div>
              <dt>Protocol</dt>
              <dd>A2UI v0.9 · JSONL</dd>
            </div>
            <div>
              <dt>Catalog</dt>
              <dd>{catalog.catalogId}</dd>
            </div>
            <div>
              <dt>Components</dt>
              <dd>{Object.keys(catalog.components).join(', ')}</dd>
            </div>
            <div>
              <dt>Actions</dt>
              <dd>{catalog.actions.map((action) => action.name).join(', ') || 'none'}</dd>
            </div>
            <div>
              <dt>RPC endpoint</dt>
              <dd>
                {contract.rpc.endpoint.disclosed ? contract.rpc.endpoint.url : 'not disclosed'}
              </dd>
            </div>
            <div>
              <dt>Boundary codes</dt>
              <dd>{contract.errors.boundaryCodes.join(', ')}</dd>
            </div>
          </dl>
          <ul className="check-list" aria-label="Agent acceptance checks">
            {contract.verification.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.id}</strong>
                <span>{check.requirement}</span>
              </li>
            ))}
          </ul>
          <div className="command-line">
            <strong>Verify command</strong>
            <code>{contract.verification.command ?? 'not provided'}</code>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DemoControls({
  pendingAction,
  rejected,
}: {
  pendingAction: ActionEvent | null;
  rejected: { current: boolean };
}) {
  const runtime = useA2UI();
  const [message, setMessage] = useState('创建营销活动审批任务');
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [actionMode, setActionMode] = useState('external');
  const commits = useRef(new Map<string, NexusSurfaceCommit>());
  const running = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const run = async (url: string, body: unknown): Promise<void> => {
    if (running.current) return;
    let request = body;
    if (url.endsWith('/event') && pendingAction) {
      const baseline = commits.current.get(pendingAction.surfaceId);
      if (!baseline) {
        setStatus('error: 缺少当前视图的提交基准，请重新生成');
        return;
      }
      commits.current.delete(pendingAction.surfaceId);
      request = {
        message: body,
        nexus: {
          sessionVersion: baseline.sessionVersion,
          actionId: pendingAction.actionId,
          surfaceRevision: baseline.surfaceRevision,
          catalogHash: baseline.catalogHash,
          inputs: runtime.getLatestInputs(pendingAction.surfaceId),
        },
      };
    } else {
      commits.current.clear();
    }
    running.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setStatus('streaming');
    try {
      const commit = await consumeRun(
        runtime,
        {
          url,
          body: request,
          signal: controllerRef.current?.signal,
        },
        rejected,
      );
      if (url.endsWith('/event') && commit.surfaceId !== pendingAction?.surfaceId)
        throw new Error('提交 surface 不匹配');
      commits.current.set(commit.surfaceId, commit);
      setStatus('done');
    } catch (error) {
      setStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running.current = false;
      setBusy(false);
      controllerRef.current = null;
    }
  };

  useEffect(() => {
    let active = true;
    void fetch('/health')
      .then(async (response) => {
        const health = (await response.json()) as { actionMode?: string };
        if (active && health.actionMode) setActionMode(health.actionMode);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingAction) return;
    void run('/api/a2ui/event', {
      version: 'v0.9',
      action: {
        actionId: pendingAction.actionId,
        name: pendingAction.name,
        surfaceId: pendingAction.surfaceId,
        sourceComponentId: pendingAction.sourceComponentId,
        timestamp: new Date().toISOString(),
        context: pendingAction.context,
      },
    });
  }, [pendingAction]);

  return (
    <section className="controls">
      <label className="input-row">
        <span>任务请求</span>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={busy}
        />
      </label>
      <div className="command-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run('/api/a2ui/generate', {
              message,
              catalogId: DEMO_CATALOG_ID,
            });
          }}
        >
          生成任务面
        </button>
        <span className="status">{status}</span>
        <span className="action-mode">
          action: {actionMode === 'local' ? 'local handler' : 'external Agent'}
        </span>
      </div>
    </section>
  );
}

const DEMO_CATALOG_ID = DEMO_AGENT_CATALOG_ID;
const demoCatalogRenderMaps = { [DEMO_CATALOG_ID]: standaloneHostRenderMap };
const standaloneHostRegistry = createStandaloneHostRegistry();

export function DemoApp(): ReactElement {
  const rejected = useRef(false);
  const [lastAction, setLastAction] = useState<ActionEvent | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionEvent | null>(null);
  const [contractUrls, setContractUrls] = useState<PublishedCatalogUrls | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    const discoverCatalogs = async (): Promise<void> => {
      try {
        const response = await fetch('/api/a2ui/published-catalogs');
        const payload = (await response.json()) as PublishedCatalogsPayload;
        if (!response.ok || payload.kind !== 'published-catalog-list') {
          throw new Error('Published catalog discovery 获取失败');
        }
        const catalog = payload.catalogs.find((item) => item.catalogId === DEMO_CATALOG_ID);
        if (!catalog) throw new Error('Published catalogs 不包含 demo catalog');
        if (!active) return;
        setContractUrls({
          agentOnboardingUrl: catalog.agentOnboardingUrl,
          catalogContractUrl: catalog.catalogContractUrl,
        });
        setDiscoveryStatus('done');
      } catch (error) {
        if (active) {
          setDiscoveryStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };

    void discoverCatalogs();
    return () => {
      active = false;
    };
  }, []);

  return (
    <A2UIProvider
      onError={() => {
        rejected.current = true;
      }}
      catalogRegistry={standaloneHostRegistry}
      catalogRenderMaps={demoCatalogRenderMaps}
      onAction={(event) => {
        const action = { ...event, actionId: crypto.randomUUID() };
        setLastAction(action);
        setPendingAction(action);
      }}
    >
      <DemoControls pendingAction={pendingAction} rejected={rejected} />
      <p className="discovery-status" aria-label="Published catalog discovery status">
        catalog discovery: {discoveryStatus}
      </p>
      <CatalogContractPanel url={contractUrls?.catalogContractUrl ?? null} />
      <AgentOnboardingPanel url={contractUrls?.agentOnboardingUrl ?? null} />
      {lastAction ? (
        <p className="status">
          action: {lastAction.name} · surface: {lastAction.surfaceId}
        </p>
      ) : null}
    </A2UIProvider>
  );
}
