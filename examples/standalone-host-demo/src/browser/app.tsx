import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import { CatalogRegistry, parseSurfaceCommit } from '@nexus-ui/core';
import type { InputDraftSnapshot, NexusSurfaceCommit } from '@nexus-ui/core';
import type { ActionEvent, A2UIRuntime } from '@nexus-ui/core';
import type { AgentOnboardingContractPayload } from '@nexus-ui/server';
import { streamSse } from './sse';
import type { SseEvent } from './sse';
import { loadHostCatalogs } from './catalog-loader';
import type { LoadedHostCatalog } from './catalog-loader';
import {
  SCORECARD_CATALOG_ID,
  scorecardHostRenderMap,
  standaloneHostCatalog,
  standaloneHostRenderMap,
} from '../shared/catalog';

function agentError(data: string): string {
  try {
    const value = JSON.parse(data) as { message?: unknown };
    return value.message === undefined ? 'Agent 输出失败' : String(value.message);
  } catch {
    return 'Agent 输出失败';
  }
}

/**
 * S2.6.3.2：运行标识以 `X-Nexus-Run-Id` 响应头为权威关联来源（event id 只作帧
 * 信息，不解析其格式）；成功 done 必须与响应头同 runId，且 session/run/surface/
 * catalog/hash 与本次加载的契约一致，否则不开放后续 action。
 */
async function consumeRun(
  runtime: A2UIRuntime,
  options: {
    url: string;
    body: unknown;
    signal: AbortSignal;
    isCurrent: () => boolean;
    target:
      | { kind: 'generate'; catalogId: string }
      | { kind: 'action'; baseline: NexusSurfaceCommit };
    expectedCatalogHashes: ReadonlyMap<string, string>;
  },
  rejected: { current: boolean },
): Promise<NexusSurfaceCommit> {
  const assertCurrent = (): void => {
    if (options.signal.aborted || !options.isCurrent()) {
      throw new DOMException('运行已失效', 'AbortError');
    }
  };
  assertCurrent();
  let commit: NexusSurfaceCommit | null = null;
  let headerRunId: string | null = null;
  let createdSurfaceId: string | null = null;
  const target = options.target;
  const expectedCatalogId =
    target.kind === 'generate' ? target.catalogId : target.baseline.catalogId;
  const touched = new Set<string>();
  rejected.current = false;
  await streamSse({
    url: options.url,
    body: options.body,
    signal: options.signal,
    onResponse: (response) => {
      assertCurrent();
      headerRunId = response.headers.get('X-Nexus-Run-Id');
    },
    onEvent: (event: SseEvent) => {
      assertCurrent();
      if (commit) throw new Error('成功终态之后收到额外事件');
      if (event.event === 'error') throw new Error(agentError(event.data));
      if (event.event === 'message') {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        const created = message.createSurface as
          | { surfaceId?: string; catalogId?: string }
          | undefined;
        if (created) {
          if (
            target.kind !== 'generate' ||
            createdSurfaceId !== null ||
            typeof created.surfaceId !== 'string' ||
            created.catalogId !== expectedCatalogId ||
            runtime.store.getState().surfaces[created.surfaceId]
          ) {
            throw new Error('生成视图与本次请求不匹配');
          }
          createdSurfaceId = created.surfaceId;
        }
        for (const key of [
          'createSurface',
          'updateComponents',
          'updateDataModel',
          'deleteSurface',
        ]) {
          const payload = message[key] as { surfaceId?: string } | undefined;
          if (payload?.surfaceId) {
            const expectedSurfaceId =
              target.kind === 'generate' ? createdSurfaceId : target.baseline.surfaceId;
            if (payload.surfaceId !== expectedSurfaceId)
              throw new Error('消息 surface 与本次请求不匹配');
            touched.add(payload.surfaceId);
          }
        }
        runtime.push(`${event.data}\n`);
      }
      if (event.event === 'done') {
        if (!headerRunId) throw new Error('响应缺少运行标识头，不开放后续 action');
        const parsed = parseSurfaceCommit(JSON.parse(event.data));
        if (!parsed) throw new Error('提交基准无效');
        if (parsed.runId !== headerRunId) throw new Error('done 运行标识与响应头不一致');
        const expectedHash = options.expectedCatalogHashes.get(expectedCatalogId);
        if (
          parsed.catalogId !== expectedCatalogId ||
          expectedHash === undefined ||
          parsed.catalogHash !== expectedHash
        ) {
          throw new Error('done 的 Catalog/hash 与已加载契约不一致（含本次请求 Catalog）');
        }
        if (
          target.kind === 'action' &&
          (parsed.surfaceId !== target.baseline.surfaceId ||
            parsed.sessionVersion !== target.baseline.sessionVersion ||
            parsed.contractVersion !== target.baseline.contractVersion ||
            parsed.catalogHash !== target.baseline.catalogHash ||
            parsed.surfaceRevision <= target.baseline.surfaceRevision)
        ) {
          throw new Error('提交身份或 revision 与本次 action 不匹配');
        }
        commit = parsed;
      }
    },
  });
  assertCurrent();
  runtime.end();
  const fixed = commit as NexusSurfaceCommit | null;
  if (
    !fixed ||
    rejected.current ||
    (target.kind === 'generate' &&
      (createdSurfaceId !== fixed.surfaceId ||
        !touched.has(fixed.surfaceId) ||
        !runtime.store.getState().componentsBySurface[fixed.surfaceId]?.root)) ||
    [...touched].some((id) => id !== fixed.surfaceId) ||
    runtime.store.getState().surfaces[fixed.surfaceId]?.catalogId !== fixed.catalogId
  ) {
    throw new Error('运行未成功提交或本地消息被拒绝，请重新生成');
  }
  return fixed;
}

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
  expectedCatalogHashes,
}: {
  pendingAction: ActionEvent | null;
  rejected: { current: boolean };
  expectedCatalogHashes: ReadonlyMap<string, string>;
}) {
  const runtime = useA2UI();
  const [message, setMessage] = useState('创建营销活动审批任务');
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [actionMode, setActionMode] = useState('external');
  const commits = useRef(new Map<string, NexusSurfaceCommit>());
  const running = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  // S2.6.3.3 请求代次：重新生成、取消、卸载都使旧运行失效；晚到结果不写回。
  const epochRef = useRef(0);

  useEffect(
    () => () => {
      epochRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  const cancelCurrent = () => {
    epochRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    running.current = false;
    commits.current.clear();
    setBusy(false);
    setStatus('canceled');
  };

  const run = async (url: string, body: unknown): Promise<void> => {
    if (running.current) return;
    let request = body;
    let draftSnapshot: InputDraftSnapshot | null = null;
    let target: Parameters<typeof consumeRun>[1]['target'];
    if (url.endsWith('/event') && pendingAction) {
      const baseline = commits.current.get(pendingAction.surfaceId);
      if (!baseline) {
        setStatus('error: 缺少当前视图的提交基准，请重新生成');
        return;
      }
      commits.current.delete(pendingAction.surfaceId);
      target = { kind: 'action', baseline };
      // S2.6.4.1：发送快照——提取即定代次；成功提交且本地校验通过后才确认。
      draftSnapshot = runtime.extractLatestInputDrafts(pendingAction.surfaceId);
      request = {
        message: body,
        nexus: {
          sessionVersion: baseline.sessionVersion,
          actionId: pendingAction.actionId,
          surfaceRevision: baseline.surfaceRevision,
          catalogHash: baseline.catalogHash,
          inputs: draftSnapshot.entries.map((entry) => entry.input),
        },
      };
    } else {
      commits.current.clear();
      target = { kind: 'generate', catalogId: (body as { catalogId: string }).catalogId };
    }
    const epoch = ++epochRef.current;
    controllerRef.current?.abort();
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
          signal: controller.signal,
          isCurrent: () => epochRef.current === epoch,
          target,
          expectedCatalogHashes,
        },
        rejected,
      );
      if (url.endsWith('/event') && commit.surfaceId !== pendingAction?.surfaceId)
        throw new Error('提交 surface 不匹配');
      if (epochRef.current !== epoch) return;
      if (draftSnapshot && (!runtime.confirmInputDrafts(draftSnapshot) || rejected.current)) {
        throw new Error('新草稿无法恢复到当前视图，请重新生成');
      }
      commits.current.set(commit.surfaceId, commit);
      setStatus('done');
    } catch (error) {
      if (epochRef.current !== epoch) return;
      setStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (epochRef.current === epoch) {
        running.current = false;
        setBusy(false);
        controllerRef.current = null;
      }
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
    // 重复 action 在 run 入口忽略，不打断当前运行；卸载使用独立的统一清理。
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
          生成审批面
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run('/api/a2ui/generate', { catalogId: SCORECARD_CATALOG_ID });
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
}

const DEMO_CATALOG_ID = standaloneHostCatalog.catalogId;
const demoCatalogRenderMaps = {
  [DEMO_CATALOG_ID]: standaloneHostRenderMap,
  [SCORECARD_CATALOG_ID]: scorecardHostRenderMap,
};

export function DemoApp(): ReactElement {
  const rejected = useRef(false);
  const [lastAction, setLastAction] = useState<ActionEvent | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionEvent | null>(null);
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
    <A2UIProvider
      onError={() => {
        rejected.current = true;
      }}
      catalogRegistry={registry}
      catalogRenderMaps={demoCatalogRenderMaps}
      onAction={(event) => {
        const action = { ...event, actionId: crypto.randomUUID() };
        setLastAction(action);
        setPendingAction(action);
      }}
    >
      <DemoControls
        pendingAction={pendingAction}
        rejected={rejected}
        expectedCatalogHashes={expectedCatalogHashes}
      />
      <CatalogContractPanel url={approval.catalogContractUrl} />
      <AgentOnboardingPanel url={approval.agentOnboardingUrl} />
      {lastAction ? (
        <p className="status">
          action: {lastAction.name} · surface: {lastAction.surfaceId}
        </p>
      ) : null}
    </A2UIProvider>
  );
}
