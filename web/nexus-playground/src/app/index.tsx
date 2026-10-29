import { useEffect, useRef, useState } from 'react';
import { A2UIProvider, A2UISurface, A2UIPreview } from '@nexus-ui/react';
import { createClientSession } from '@nexus-ui/client';
import type { ClientSession, RunResult, SurfaceStatus } from '@nexus-ui/client';
import type { ActionEvent } from '@nexus-ui/core';
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

function scrollGeneratedSurfaceIntoView(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document
        .querySelector('.nexus-surface')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  });
}

function resultStatus(result: RunResult): string {
  if (result.status === 'committed') return 'done';
  if (result.status === 'canceled') return 'canceled';
  return result.status === 'ignored' ? 'ignored' : `error: ${result.reason}`;
}

function Playground({ contracts }: { contracts: PlaygroundCatalogContracts }) {
  const [message, setMessage] = useState<string>(CATALOG_OPTIONS[0].message);
  const [catalogId, setCatalogId] = useState<string>(WORKBENCH_CATALOG_ID);
  const [generateStatus, setGenerateStatus] = useState('idle');
  const [actionStatus, setActionStatus] = useState('idle');
  const [lastAction, setLastAction] = useState<ActionEvent | null>(null);
  const [busy, setBusy] = useState(false);
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

  const cancelCurrent = () => {
    owner.current?.session.cancel();
    // client 同步关闭运行；这里只解除宿主控件占用，不推断服务端业务结果。
    if (owner.current) owner.current.busy = false;
    setBusy(false);
    setGenerateStatus('canceled');
    setActionStatus('canceled');
  };

  const generate = async () => {
    if (owner.current?.busy) return;
    release();
    setSurfaces([]);
    setLastAction(null);
    setActionStatus('idle');
    const session = createClientSession({
      endpoints: { generate: '/api/a2ui/generate', event: '/api/a2ui/event' },
      catalogHashes: contracts.contractHashes,
      runtimeOptions: {
        catalogRegistry: contracts.registry,
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
    setGenerateStatus('streaming');
    const result = await session.generate({ message, catalogId });
    if (owner.current?.session !== session || !owner.current.busy) return;
    owner.current.busy = false;
    setBusy(false);
    setGenerateStatus(resultStatus(result));
    if (result.status === 'committed') scrollGeneratedSurfaceIntoView();
  };

  const sendAction = async (session: ClientSession, event: ActionEvent) => {
    // 可见禁用态之外，实际动作出口再检查当前会话与 surface 资格。
    if (
      owner.current?.session !== session ||
      owner.current.busy ||
      !session.getSurface(event.surfaceId)?.actionOpen
    )
      return;
    owner.current.busy = true;
    setBusy(true);
    setLastAction(event);
    setActionStatus('streaming');
    const result = await session.action(event);
    if (owner.current?.session !== session || !owner.current.busy) return;
    owner.current.busy = false;
    setBusy(false);
    setActionStatus(resultStatus(result));
  };

  const controls = (
    <section style={{ display: 'grid', gap: 12, marginTop: 16 }}>
      <div role="group" aria-label="Catalog" style={{ display: 'flex', gap: 8 }}>
        {CATALOG_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={catalogId === option.id}
            onClick={() => {
              if (option.id !== catalogId) {
                release();
                setBinding(null);
                setSurfaces([]);
                setBusy(false);
                setLastAction(null);
                setGenerateStatus('idle');
              }
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
        <button onClick={generate} disabled={busy}>
          生成 UI
        </button>
        <button onClick={cancelCurrent} disabled={!busy}>
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
  return (
    <>
      {binding ? (
        <A2UIProvider
          key={binding.key}
          runtime={binding.session.runtime}
          catalogRenderMaps={catalogRenderMaps}
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
                  Object.prototype.hasOwnProperty.call(catalogRenderMaps, surface.catalogId ?? '')
                    ? catalogRenderMaps[surface.catalogId as keyof typeof catalogRenderMaps]
                    : undefined
                }
              />
            ) : null,
          )}
        </A2UIProvider>
      ) : null}
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, color: '#222' }}>
        <h2 style={{ margin: 0 }}>Nexus UI · Agent Task Surface</h2>
        {controls}
      </div>
    </>
  );
}

export function App() {
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

  return <Playground contracts={contracts} />;
}
