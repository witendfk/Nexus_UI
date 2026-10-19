import { useEffect, useRef, useState } from 'react';
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import { parseSurfaceCommit } from '@nexus-ui/core';
import type { NexusSurfaceCommit } from '@nexus-ui/core';
import type { ActionEvent, A2UIRuntime, CatalogRegistry } from '@nexus-ui/core';
import { streamSse } from '../lib/sse-client';
import type { SseEvent } from '../lib/sse-client';
import { toClientActionMessage } from '../lib/client-action';
import { TASK_CATALOG_ID, catalogRenderMaps as taskCatalogRenderMaps } from '../catalog/task';
import { WORKBENCH_CATALOG_ID, workbenchRenderMap } from '../catalog/workbench';
import { loadPlaygroundCatalogRegistry } from '../catalog/registry';

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
      if (event.event === 'error') throw new Error(agentErrorMessage(event.data));
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

interface ControlsProps {
  pendingAction: ActionEvent | null;
  lastAction: ActionEvent | null;
  rejected: { current: boolean };
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

function Controls({ pendingAction, lastAction, rejected }: ControlsProps) {
  const runtime = useA2UI();
  const [message, setMessage] = useState<string>(CATALOG_OPTIONS[0].message);
  const [catalogId, setCatalogId] = useState<string>(WORKBENCH_CATALOG_ID);
  const [generateStatus, setGenerateStatus] = useState('idle');
  const [generating, setGenerating] = useState(false);
  const [actionStatus, setActionStatus] = useState('idle');
  const commits = useRef(new Map<string, NexusSurfaceCommit>());
  const running = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const generate = async () => {
    if (running.current) return;
    running.current = true;
    commits.current.clear();
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
        },
        rejected,
      );
      commits.current.set(commit.surfaceId, commit);
      setGenerateStatus('done');
      scrollGeneratedSurfaceIntoView();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        runtime.end();
        setGenerateStatus('canceled');
      } else {
        setGenerateStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      running.current = false;
      setGenerating(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (!pendingAction) return;

    const controller = new AbortController();
    let active = true;
    const sendAction = async () => {
      if (running.current) return;
      const baseline = commits.current.get(pendingAction.surfaceId);
      if (!baseline) {
        setActionStatus('error: 缺少当前视图的提交基准，请重新生成');
        return;
      }
      running.current = true;
      commits.current.delete(pendingAction.surfaceId);
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
                inputs: runtime.getLatestInputs(pendingAction.surfaceId),
              },
            },
            signal: controller.signal,
          },
          rejected,
        );
        if (commit.surfaceId !== pendingAction.surfaceId) throw new Error('提交 surface 不匹配');
        commits.current.set(commit.surfaceId, commit);
        if (active) setActionStatus('done');
      } catch (error) {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          setActionStatus('canceled');
        } else {
          setActionStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        running.current = false;
      }
    };

    void sendAction();
    return () => {
      active = false;
      controller.abort();
    };
  }, [pendingAction, runtime]);

  return (
    <section style={{ display: 'grid', gap: 12, marginTop: 16 }}>
      <div role="group" aria-label="Catalog" style={{ display: 'flex', gap: 8 }}>
        {CATALOG_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={catalogId === option.id}
            onClick={() => {
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
        <button onClick={() => abortRef.current?.abort()} disabled={!generating}>
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
  const [registry, setRegistry] = useState<CatalogRegistry | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadPlaygroundCatalogRegistry(
      CATALOG_OPTIONS.map(({ id }) => id),
      controller.signal,
    )
      .then((loaded) => {
        if (!controller.signal.aborted) setRegistry(loaded);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => controller.abort();
  }, []);

  if (catalogError) return <p role="alert">界面配置加载失败：{catalogError}</p>;
  if (!registry) return <p role="status">正在加载界面配置…</p>;

  return (
    <A2UIProvider
      onError={() => {
        rejected.current = true;
      }}
      catalogRegistry={registry}
      catalogRenderMaps={catalogRenderMaps}
      onAction={(event) => {
        const actionWithId = { ...event, actionId: crypto.randomUUID() };
        setLastAction(actionWithId);
        setPendingAction(actionWithId);
      }}
    >
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, color: '#222' }}>
        <h2 style={{ margin: 0 }}>Nexus UI · Agent Task Surface</h2>
        <Controls pendingAction={pendingAction} lastAction={lastAction} rejected={rejected} />
      </div>
    </A2UIProvider>
  );
}
