import { useEffect, useRef, useState } from 'react';
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import type { ActionEvent, A2UIRuntime } from '@nexus-ui/core';
import { streamSse } from '../lib/sse-client';
import type { SseEvent } from '../lib/sse-client';
import { toClientActionMessage } from '../lib/client-action';
import { TASK_CATALOG_ID, catalogRenderMaps as taskCatalogRenderMaps } from '../catalog/task';
import { WORKBENCH_CATALOG_ID, workbenchRenderMap } from '../catalog/workbench';

const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const CATALOG_OPTIONS = [
  {
    id: WORKBENCH_CATALOG_ID,
    label: 'Workbench',
    message: '帮我给华云科技创建一条客户跟进任务，并在明天 10:00 提醒我。',
  },
  { id: BASIC_CATALOG_ID, label: 'Basic', message: '生成一张联系人卡片' },
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

function feedRuntime(runtime: A2UIRuntime, event: SseEvent): void {
  if (event.event === 'message') {
    runtime.push(`${event.data}\n`);
    return;
  }
  if (event.event === 'error') throw new Error(agentErrorMessage(event.data));
}

interface ControlsProps {
  pendingAction: ActionEvent | null;
  lastAction: ActionEvent | null;
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

function Controls({ pendingAction, lastAction }: ControlsProps) {
  const runtime = useA2UI();
  const [message, setMessage] = useState<string>(CATALOG_OPTIONS[0].message);
  const [catalogId, setCatalogId] = useState<string>(WORKBENCH_CATALOG_ID);
  const [generateStatus, setGenerateStatus] = useState('idle');
  const [generating, setGenerating] = useState(false);
  const [actionStatus, setActionStatus] = useState('idle');
  const abortRef = useRef<AbortController | null>(null);

  const generate = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setGenerateStatus('streaming');

    try {
      await streamSse({
        url: '/api/a2ui/generate',
        body: { message, catalogId },
        signal: controller.signal,
        onEvent: (event) => feedRuntime(runtime, event),
      });
      runtime.end();
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
      setGenerating(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (!pendingAction) return;

    const controller = new AbortController();
    let active = true;
    const sendAction = async () => {
      setActionStatus('streaming');
      try {
        await streamSse({
          url: '/api/a2ui/event',
          body: toClientActionMessage(pendingAction),
          signal: controller.signal,
          onEvent: (event) => feedRuntime(runtime, event),
        });
        runtime.end();
        if (active) setActionStatus('done');
      } catch (error) {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          setActionStatus('canceled');
        } else {
          setActionStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
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
  const [lastAction, setLastAction] = useState<ActionEvent | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionEvent | null>(null);

  return (
    <A2UIProvider
      catalogRenderMaps={catalogRenderMaps}
      onAction={(event) => {
        setLastAction(event);
        setPendingAction(event);
      }}
    >
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, color: '#222' }}>
        <h2 style={{ margin: 0 }}>Nexus UI · Agent Task Surface</h2>
        <Controls pendingAction={pendingAction} lastAction={lastAction} />
      </div>
    </A2UIProvider>
  );
}
