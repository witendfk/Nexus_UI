import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import type { ActionEvent, A2UIRuntime } from '@nexus-ui/core';
import type { AgentOnboardingContractPayload } from '@nexus-ui/server';
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

function feedRuntime(runtime: A2UIRuntime, event: SseEvent): void {
  if (event.event === 'message') {
    runtime.push(`${event.data}\n`);
    return;
  }
  if (event.event === 'error') throw new Error(agentError(event.data));
}

function CatalogContractPanel(): ReactElement {
  const [contract, setContract] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);

  const loadContract = async (): Promise<void> => {
    setBusy(true);
    setStatus('loading');
    try {
      const response = await fetch(
        `/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(DEMO_CATALOG_ID)}`,
      );
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
        <button type="button" disabled={busy} onClick={() => void loadContract()}>
          查看 Catalog Contract
        </button>
        <span className="status">{status}</span>
      </div>
      {contract ? <pre className="contract-text">{contract}</pre> : null}
    </section>
  );
}

function AgentOnboardingPanel(): ReactElement {
  const [contract, setContract] = useState<AgentOnboardingContractPayload | null>(null);
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);

  const loadContract = async (): Promise<void> => {
    setBusy(true);
    setStatus('loading');
    try {
      const response = await fetch(
        `/api/a2ui/agent-onboarding?catalogId=${encodeURIComponent(DEMO_CATALOG_ID)}`,
      );
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
        <button type="button" disabled={busy} onClick={() => void loadContract()}>
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
              <dd>{catalog.components.join(', ')}</dd>
            </div>
            <div>
              <dt>Actions</dt>
              <dd>{catalog.actions?.join(', ') || 'none'}</dd>
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

function DemoControls({ pendingAction }: { pendingAction: ActionEvent | null }) {
  const runtime = useA2UI();
  const [message, setMessage] = useState('创建营销活动审批任务');
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [actionMode, setActionMode] = useState('external');
  const controllerRef = useRef<AbortController | null>(null);

  const run = async (url: string, body: unknown): Promise<void> => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setStatus('streaming');
    try {
      await streamSse({
        url,
        body,
        signal: controllerRef.current?.signal,
        onEvent: (event) => feedRuntime(runtime, event),
      });
      runtime.end();
      setStatus('done');
    } catch (error) {
      setStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
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
  const [lastAction, setLastAction] = useState<ActionEvent | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionEvent | null>(null);

  return (
    <A2UIProvider
      catalogRegistry={standaloneHostRegistry}
      catalogRenderMaps={demoCatalogRenderMaps}
      onAction={(event) => {
        setLastAction(event);
        setPendingAction(event);
      }}
    >
      <DemoControls pendingAction={pendingAction} />
      <CatalogContractPanel />
      <AgentOnboardingPanel />
      {lastAction ? (
        <p className="status">
          action: {lastAction.name} · surface: {lastAction.surfaceId}
        </p>
      ) : null}
    </A2UIProvider>
  );
}
