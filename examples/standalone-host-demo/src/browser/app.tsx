import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { A2UIProvider, A2UISurface, A2UIPreview } from '@nexus-ui/react';
import { CatalogRegistry } from '@nexus-ui/core';
import type { ActionEvent } from '@nexus-ui/core';
import { createClientSession } from '@nexus-ui/client';
import type { ClientSession, RunResult, SurfaceStatus } from '@nexus-ui/client';
import type { AgentOnboardingContractPayload } from '@nexus-ui/server';
import { loadHostCatalogs } from './catalog-loader';
import type { LoadedHostCatalog } from './catalog-loader';
import {
  SCORECARD_CATALOG_ID,
  scorecardHostRenderMap,
  standaloneHostCatalog,
  standaloneHostRenderMap,
} from '../shared/catalog';

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

function resultStatus(result: RunResult): string {
  if (result.status === 'committed') return 'done';
  if (result.status === 'canceled') return 'canceled';
  return result.status === 'ignored' ? 'ignored' : `error: ${result.reason}`;
}

function DemoSession({
  registry,
  expectedCatalogHashes,
  approval,
}: {
  registry: CatalogRegistry;
  expectedCatalogHashes: ReadonlyMap<string, string>;
  approval: LoadedHostCatalog;
}) {
  const [message, setMessage] = useState('创建营销活动审批任务');
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [actionMode, setActionMode] = useState('external');
  const [lastAction, setLastAction] = useState<ActionEvent | null>(null);
  const [surfaces, setSurfaces] = useState<SurfaceStatus[]>([]);
  const [binding, setBinding] = useState<{ session: ClientSession; key: number } | null>(null);
  const sequence = useRef(0);
  const owner = useRef<{ session: ClientSession; unsubscribe: () => void; busy: boolean } | null>(
    null,
  );
  const release = () => {
    const previous = owner.current;
    owner.current = null;
    previous?.unsubscribe();
    previous?.session.dispose();
  };
  useEffect(() => release, []);
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

  const cancelCurrent = () => {
    owner.current?.session.cancel();
    if (owner.current) owner.current.busy = false;
    setBusy(false);
    setStatus('canceled');
  };
  const sendAction = async (session: ClientSession, event: ActionEvent) => {
    if (
      owner.current?.session !== session ||
      owner.current.busy ||
      !session.getSurface(event.surfaceId)?.actionOpen
    )
      return;
    owner.current.busy = true;
    setBusy(true);
    setLastAction(event);
    setStatus('streaming');
    const result = await session.action(event);
    if (owner.current?.session !== session || !owner.current.busy) return;
    owner.current.busy = false;
    setBusy(false);
    setStatus(resultStatus(result));
  };
  const generate = async (request: { catalogId: string; message?: string }) => {
    if (owner.current?.busy) return;
    release();
    setSurfaces([]);
    setLastAction(null);
    const session = createClientSession({
      endpoints: { generate: '/api/a2ui/generate', event: '/api/a2ui/event' },
      catalogHashes: expectedCatalogHashes,
      runtimeOptions: {
        catalogRegistry: registry,
        onAction: (event) => {
          void sendAction(session, event);
        },
      },
    });
    owner.current = {
      session,
      unsubscribe: session.subscribe((current) => setSurfaces(current.surfaces())),
      busy: true,
    };
    setBinding({ session, key: ++sequence.current });
    setBusy(true);
    setStatus('streaming');
    const result = await session.generate(request);
    if (owner.current?.session !== session || !owner.current.busy) return;
    owner.current.busy = false;
    setBusy(false);
    setStatus(resultStatus(result));
  };

  const controls = (
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
            void generate({
              message,
              catalogId: DEMO_CATALOG_ID,
            });
          }}
        >
          生成审批面
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void generate({ catalogId: SCORECARD_CATALOG_ID });
          }}
        >
          生成反馈卡
        </button>
        <button type="button" disabled={!busy} onClick={cancelCurrent}>
          取消
        </button>
        <span className="status">{status}</span>
        <span className="action-mode">
          action: {actionMode === 'local' ? 'local handler' : 'external Agent'}
        </span>
      </div>
    </section>
  );
  return (
    <>
      {binding ? (
        <A2UIProvider
          key={binding.key}
          runtime={binding.session.runtime}
          catalogRenderMaps={demoCatalogRenderMaps}
        >
          {surfaces.map((surface) =>
            binding.session.runtime.getSurfaceView(surface.surfaceId) ? (
              <A2UISurface
                key={surface.surfaceId}
                surfaceId={surface.surfaceId}
                actionsEnabled={surface.actionOpen && !busy}
              />
            ) : surface.preview ? (
              <A2UIPreview
                key={surface.surfaceId}
                view={surface.preview}
                renderMap={
                  Object.prototype.hasOwnProperty.call(
                    demoCatalogRenderMaps,
                    surface.catalogId ?? '',
                  )
                    ? demoCatalogRenderMaps[surface.catalogId as keyof typeof demoCatalogRenderMaps]
                    : undefined
                }
              />
            ) : null,
          )}
        </A2UIProvider>
      ) : null}
      {controls}
      <CatalogContractPanel url={approval.catalogContractUrl} />
      <AgentOnboardingPanel url={approval.agentOnboardingUrl} />
      {lastAction ? (
        <p className="status">
          action: {lastAction.name} · surface: {lastAction.surfaceId}
        </p>
      ) : null}
    </>
  );
}

const DEMO_CATALOG_ID = standaloneHostCatalog.catalogId;
const demoCatalogRenderMaps = {
  [DEMO_CATALOG_ID]: standaloneHostRenderMap,
  [SCORECARD_CATALOG_ID]: scorecardHostRenderMap,
};

export function DemoApp(): ReactElement {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedHostCatalog> | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadHostCatalogs('', [DEMO_CATALOG_ID, SCORECARD_CATALOG_ID], controller.signal)
      .then((result) => {
        // 取消/晚到加载不替换当前契约。
        if (!controller.signal.aborted) setLoaded(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => controller.abort();
  }, []);

  // registry 只由实际下载并通过校验的声明组成；非法配置在 loader 处已显式失败。
  const registry = useMemo(
    () =>
      loaded === null
        ? null
        : new CatalogRegistry([...loaded.values()].map((entry) => structuredClone(entry.catalog))),
    [loaded],
  );
  const expectedCatalogHashes = useMemo(
    () => new Map([...(loaded?.entries() ?? [])].map(([id, entry]) => [id, entry.contractHash])),
    [loaded],
  );
  const approval = loaded?.get(DEMO_CATALOG_ID);

  if (catalogError) return <p role="alert">界面配置加载失败：{catalogError}</p>;
  if (!registry || !approval) {
    return <p role="status">正在加载界面配置…</p>;
  }

  return (
    <DemoSession
      registry={registry}
      expectedCatalogHashes={expectedCatalogHashes}
      approval={approval}
    />
  );
}
