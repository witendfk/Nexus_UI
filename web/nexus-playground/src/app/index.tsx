import { useEffect, useRef, useState } from 'react';
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import { parseSurfaceCommit } from '@nexus-ui/core';
import type { InputDraftSnapshot, NexusSurfaceCommit } from '@nexus-ui/core';
import type { ActionEvent, A2UIRuntime } from '@nexus-ui/core';
import { streamSse } from '../lib/sse-client';
import type { SseEvent } from '../lib/sse-client';
import { toClientActionMessage } from '../lib/client-action';
import { TASK_CATALOG_ID, catalogRenderMaps as taskCatalogRenderMaps } from '../catalog/task';
import { WORKBENCH_CATALOG_ID, workbenchRenderMap } from '../catalog/workbench';
import { loadPlaygroundCatalogContracts } from '../catalog/registry';
import type { PlaygroundCatalogContracts } from '../catalog/registry';

const BASIC_CATALOG_ID = 'https://example.com/catalogs/nexus-basic-task/v1';
const CATALOG_OPTIONS = [
  {
    id: WORKBENCH_CATALOG_ID,
    label: 'Workbench',
    message: '帮我给华云科技创建一条客户跟进任务，并在明天 10:00 提醒我。',
  },
  { id: BASIC_CATALOG_ID, label: 'Nexus Basic', message: '生成一张联系人卡片' },
  { id: TASK_CATALOG_ID, label: 'Task' },
] as const;

const catalogRenderMaps = {
  ...taskCatalogRenderMaps,
  [WORKBENCH_CATALOG_ID]: workbenchRenderMap,
} as const;

function agentErrorMessage(data: string): string {
  try {
    const payload = JSON.parse(data) as {
      message?: unknown;
      diagnostics?: Array<{ path?: unknown; dataPath?: unknown }>;
    };
    const message = payload.message === undefined ? 'Agent 输出失败' : String(payload.message);
    const diagnostics = Array.isArray(payload.diagnostics)
      ? payload.diagnostics.map((diagnostic) =>
          diagnostic.dataPath === undefined
            ? String(diagnostic.path ?? '')
            : `${String(diagnostic.path ?? '')} <- ${String(diagnostic.dataPath)}`,
        )
      : [];
    return diagnostics.length > 0 ? `${message} (${diagnostics.join('; ')})` : message;
  } catch {
    return 'Agent 输出失败';
  }
}

/**
 * S2.6.3.2：运行标识以 `X-Nexus-Run-Id` 响应头为权威关联来源（event id 只作帧
 * 信息）；成功 done 必须与响应头同 runId，且 catalog/hash 与本次加载的契约一致。
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
      if (event.event === 'error') throw new Error(agentErrorMessage(event.data));
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

interface ControlsProps {
  pendingAction: ActionEvent | null;
  lastAction: ActionEvent | null;
  rejected: { current: boolean };
  contractHashes: ReadonlyMap<string, string>;
}

function scrollGeneratedSurfaceIntoView(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document
        .querySelector('.nexus-surface')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  });
}

function Controls({ pendingAction, lastAction, rejected, contractHashes }: ControlsProps) {
  const runtime = useA2UI();
  const [message, setMessage] = useState<string>(CATALOG_OPTIONS[0].message);
  const [catalogId, setCatalogId] = useState<string>(WORKBENCH_CATALOG_ID);
  const [generateStatus, setGenerateStatus] = useState('idle');
  const [generating, setGenerating] = useState(false);
  const [actionStatus, setActionStatus] = useState('idle');
  const commits = useRef(new Map<string, NexusSurfaceCommit>());
  const running = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // S2.6.3.3 请求代次：重新生成、切换 Catalog、取消、卸载都使旧运行失效；晚到结果不写回。
  const epochRef = useRef(0);

  const cancelCurrent = () => {
    epochRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    running.current = false;
    commits.current.clear();
    setGenerating(false);
    setGenerateStatus('canceled');
    setActionStatus('canceled');
  };

  useEffect(
    () => () => {
      epochRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  const generate = async () => {
    if (running.current) return;
    running.current = true;
    commits.current.clear();
    const epoch = ++epochRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setGenerateStatus('streaming');

    try {
      const commit = await consumeRun(
        runtime,
        {
          url: '/api/a2ui/generate',
          body: { message, catalogId },
          signal: controller.signal,
          isCurrent: () => epochRef.current === epoch,
          target: { kind: 'generate', catalogId },
          expectedCatalogHashes: contractHashes,
        },
        rejected,
      );
      if (epochRef.current !== epoch) return;
      commits.current.set(commit.surfaceId, commit);
      setGenerateStatus('done');
      scrollGeneratedSurfaceIntoView();
    } catch (error) {
      if (epochRef.current !== epoch) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        runtime.end();
        setGenerateStatus('canceled');
      } else {
        setGenerateStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (epochRef.current === epoch) {
        running.current = false;
        setGenerating(false);
        abortRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (!pendingAction) return;

    const sendAction = async () => {
      if (running.current) return;
      const baseline = commits.current.get(pendingAction.surfaceId);
      if (!baseline) {
        setActionStatus('error: 缺少当前视图的提交基准，请重新生成');
        return;
      }
      // 只有真正发出请求才占用代次；被 running 挡住的空尝试不废在途运行。
      const epoch = ++epochRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      running.current = true;
      commits.current.delete(pendingAction.surfaceId);
      // S2.6.4.1：发送快照——提取即定代次；成功提交且本地校验通过后才确认。
      const draftSnapshot: InputDraftSnapshot = runtime.extractLatestInputDrafts(
        pendingAction.surfaceId,
      );
      setActionStatus('streaming');
      try {
        const commit = await consumeRun(
          runtime,
          {
            url: '/api/a2ui/event',
            body: {
              message: toClientActionMessage(pendingAction),
              nexus: {
                sessionVersion: baseline.sessionVersion,
                actionId: pendingAction.actionId,
                surfaceRevision: baseline.surfaceRevision,
                catalogHash: baseline.catalogHash,
                inputs: draftSnapshot.entries.map((entry) => entry.input),
              },
            },
            signal: controller.signal,
            isCurrent: () => epochRef.current === epoch,
            target: { kind: 'action', baseline },
            expectedCatalogHashes: contractHashes,
          },
          rejected,
        );
        if (commit.surfaceId !== pendingAction.surfaceId) throw new Error('提交 surface 不匹配');
        if (epochRef.current !== epoch) return;
        if (!runtime.confirmInputDrafts(draftSnapshot) || rejected.current) {
          throw new Error('新草稿无法恢复到当前视图，请重新生成');
        }
        commits.current.set(commit.surfaceId, commit);
        setActionStatus('done');
      } catch (error) {
        if (epochRef.current !== epoch) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          setActionStatus('canceled');
        } else {
          setActionStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        if (epochRef.current === epoch) {
          running.current = false;
          abortRef.current = null;
        }
      }
    };

    void sendAction();
    // 在途重复 action 由 running 忽略，不因 pendingAction 变化取消当前运行。
    // 卸载清理由组件级 effect 统一持有，生成和 action 共用同一所有者。
  }, [pendingAction, runtime, contractHashes]);

  return (
    <section style={{ display: 'grid', gap: 12, marginTop: 16 }}>
      <div role="group" aria-label="Catalog" style={{ display: 'flex', gap: 8 }}>
        {CATALOG_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={catalogId === option.id}
            onClick={() => {
              if (option.id !== catalogId) cancelCurrent();
              setCatalogId(option.id);
              if ('message' in option) setMessage(option.message);
            }}
            style={{
              padding: '6px 10px',
              border: '1px solid #ccc',
              borderRadius: 4,
              backgroundColor: catalogId === option.id ? '#222' : '#fff',
              color: catalogId === option.id ? '#fff' : '#222',
              cursor: 'pointer',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ color: '#666', fontSize: 13 }}>自然语言输入</span>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          style={{
            padding: '8px 10px',
            border: '1px solid #ccc',
            borderRadius: 4,
            minWidth: 280,
          }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={generate} disabled={generating}>
          生成 UI
        </button>
        <button onClick={cancelCurrent} disabled={!generating}>
          取消
        </button>
        <span style={{ color: '#667', fontSize: 13 }}>{generateStatus}</span>
      </div>

      {lastAction ? (
        <p style={{ margin: 0, color: '#667', fontSize: 13 }}>
          action: {lastAction.name} · surface: {lastAction.surfaceId} · {actionStatus}
        </p>
      ) : null}
    </section>
  );
}

export function App() {
  const rejected = useRef(false);
  const [lastAction, setLastAction] = useState<ActionEvent | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionEvent | null>(null);
  const [contracts, setContracts] = useState<PlaygroundCatalogContracts | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadPlaygroundCatalogContracts(
      CATALOG_OPTIONS.map(({ id }) => id),
      controller.signal,
    )
      .then((loaded) => {
        // 取消/晚到加载不替换当前契约。
        if (!controller.signal.aborted) setContracts(loaded);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => controller.abort();
  }, []);

  if (catalogError) return <p role="alert">界面配置加载失败：{catalogError}</p>;
  if (!contracts) return <p role="status">正在加载界面配置…</p>;

  return (
    <A2UIProvider
      onError={() => {
        rejected.current = true;
      }}
      catalogRegistry={contracts.registry}
      catalogRenderMaps={catalogRenderMaps}
      onAction={(event) => {
        const actionWithId = { ...event, actionId: crypto.randomUUID() };
        setLastAction(actionWithId);
        setPendingAction(actionWithId);
      }}
    >
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, color: '#222' }}>
        <h2 style={{ margin: 0 }}>Nexus UI · Agent Task Surface</h2>
        <Controls
          pendingAction={pendingAction}
          lastAction={lastAction}
          rejected={rejected}
          contractHashes={contracts.contractHashes}
        />
      </div>
    </A2UIProvider>
  );
}
