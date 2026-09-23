import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import type { ActionEvent, A2UIRuntime } from '@nexus-ui/core';
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

function DemoControls({ pendingAction }: { pendingAction: ActionEvent | null }) {
  const runtime = useA2UI();
  const [message, setMessage] = useState('创建营销活动审批任务');
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
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
      {lastAction ? (
        <p className="status">
          action: {lastAction.name} · surface: {lastAction.surfaceId}
        </p>
      ) : null}
    </A2UIProvider>
  );
}
