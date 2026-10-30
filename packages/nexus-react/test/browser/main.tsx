// 确定性 SDK 验收载体；仅消费公开根入口，不作为业务宿主或 HTTP 服务实现。
import { useEffect, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CatalogRegistry,
  getCatalogContractHashInput,
  standardCatalogComponentDeclarations,
} from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import { createClientSession } from '@nexus-ui/client';
import type { ClientSession, SessionTransport, SseFrame } from '@nexus-ui/client';
import { A2UIProvider, A2UISurface, A2UIPreview, standardRenderMap } from '@nexus-ui/react';
import type { RenderMap } from '@nexus-ui/react';
import './style.css';

const catalogId = 'https://example.com/catalogs/browser-acceptance/v1';
const standard = standardCatalogComponentDeclarations();
const catalog: CatalogDefinition = {
  catalogId,
  components: {
    ...standard,
    FixtureInput: { ...standard.TextField, inputs: { value: { type: 'string', maxLength: 200 } } },
    FixtureAction: standard.Button,
  },
  actions: [
    {
      name: 'apply',
      sources: ['FixtureAction'],
      paramSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
};
const renderMap: RenderMap = {
  ...standardRenderMap,
  FixtureInput: standardRenderMap.TextField,
  FixtureAction: standardRenderMap.Button,
};

type Mode = 'normal' | 'eof' | 'unknown' | 'hold';
function createFixture(hash: string) {
  let mode: Mode = 'normal';
  let notify = () => {};
  let sequence = 0;
  let opens = 0;
  let closes = 0;
  const pending = new Set<() => void>();
  const requests: unknown[] = [];
  const revisions = new Map<string, number>();
  const frame = (event: string, data: unknown): SseFrame => ({ event, data: JSON.stringify(data) });
  const transport: SessionTransport = {
    async open(request) {
      const body = request.body as {
        message?: string | { action: { surfaceId: string } };
        nexus?: { inputs?: Array<{ value: unknown }> };
      };
      const action = typeof body.message === 'object' ? body.message.action : undefined;
      const surfaceId = action?.surfaceId ?? String(body.message);
      const runId = `browser-${++sequence}`;
      const currentMode = mode;
      const identity = {
        sessionVersion: 1,
        runId,
        surfaceId,
        catalogId,
        contractVersion: 2,
        catalogHash: hash,
      };
      const revision = (revisions.get(surfaceId) ?? 0) + 1;
      const value = action
        ? String(body.nexus?.inputs?.[0]?.value ?? 'unchanged').toUpperCase()
        : `${surfaceId} initial`;
      requests.push(structuredClone(request.body));
      opens++;
      let closed = false;
      let unblock: (() => void) | undefined;
      const gate =
        currentMode === 'hold'
          ? new Promise<void>((resolve) => {
              unblock = resolve;
              pending.add(resolve);
            })
          : undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        closes++;
        request.signal?.removeEventListener('abort', close);
        unblock?.();
        if (unblock) pending.delete(unblock);
        notify();
      };
      request.signal?.addEventListener('abort', close, { once: true });
      if (request.signal?.aborted) close();
      notify();
      return {
        runIdHeader: runId,
        close,
        frames: (async function* () {
          if (closed) return;
          yield frame('start', { type: 'start', ...identity });
          const messages: unknown[] = action
            ? []
            : [
                { version: 'v0.9', createSurface: { surfaceId, catalogId } },
                {
                  version: 'v0.9',
                  updateComponents: {
                    surfaceId,
                    components: [
                      { id: 'root', component: 'Column', children: ['field', 'submit'] },
                      {
                        id: 'field',
                        component: 'FixtureInput',
                        label: '验收输入',
                        value: { path: '/value' },
                        validationRegexp: '^[A-Z].*',
                      },
                      {
                        id: 'submit',
                        component: 'FixtureAction',
                        child: 'label',
                        action: { event: { name: 'apply', context: {} } },
                      },
                      { id: 'label', component: 'Text', text: '应用输入' },
                    ],
                  },
                },
              ];
          messages.push({
            version: 'v0.9',
            updateDataModel: { surfaceId, value: { value } },
          });
          for (const message of messages) {
            if (closed) return;
            yield frame('message', message);
          }
          if (gate) await gate;
          if (closed || currentMode === 'eof') return;
          if (currentMode === 'unknown') {
            yield frame('error', {
              type: 'error',
              ...identity,
              code: 'RUN_COMMIT_UNKNOWN',
              message: '确定性 unknown 反例；不代表业务失败',
              commitState: 'unknown',
            });
            return;
          }
          revisions.set(surfaceId, revision);
          yield frame('done', { ...identity, surfaceRevision: revision });
        })(),
      };
    },
  };
  const session: ClientSession = createClientSession({
    endpoints: { generate: 'fixture:generate', event: 'fixture:action' },
    catalogHashes: new Map([[catalogId, hash]]),
    runtimeOptions: {
      catalogRegistry: new CatalogRegistry([catalog]),
      onAction: (event) => {
        void session.action(event);
      },
    },
    transport,
  });
  return {
    session,
    observe(listener: () => void) {
      notify = listener;
      const unsubscribe = session.subscribe(listener);
      return () => {
        notify = () => {};
        unsubscribe();
      };
    },
    setMode(value: Mode) {
      mode = value;
    },
    finish() {
      for (const resolve of pending) resolve();
    },
    diagnostics() {
      return { opens, closes, active: opens - closes, requests };
    },
  };
}

function App({ hash }: { hash: string }) {
  const [fixture] = useState(() => createFixture(hash));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [message, setMessage] = useState('就绪');
  const [mounted, setMounted] = useState(true);
  const [renders, setRenders] = useState(0);
  const { session } = fixture;
  useEffect(() => {
    const stop = fixture.observe(refresh);
    return () => {
      stop();
      session.dispose();
    };
  }, [fixture, session]);
  const generate = async (surfaceId: string) => {
    const result = await session.generate({ catalogId, message: surfaceId });
    setMessage(`生成 ${surfaceId}: ${result.status}`);
  };
  const recover = (surfaceId: string, invalid: boolean) => {
    const fixed = session.getCommittedSurface(surfaceId);
    if (!fixed) return;
    try {
      const input = invalid
        ? {
            ...structuredClone(fixed),
            commit: { ...fixed.commit, catalogHash: `sha256:${'0'.repeat(64)}` },
          }
        : structuredClone(fixed);
      setMessage(`恢复 ${surfaceId}: ${session.recover(input).status}`);
    } catch {
      setMessage(`恢复 ${surfaceId}: rejected`);
    }
  };
  return (
    <main>
      <header>
        <h1>Nexus SDK 浏览器验收</h1>
        <p>宿主布局 · 自定义输入/action · 双 surface · 确定性 transport</p>
      </header>
      <aside aria-label="宿主控制区">
        <label>
          响应场景
          <select
            defaultValue="normal"
            onChange={(event) => fixture.setMode(event.target.value as Mode)}
          >
            <option value="normal">正常提交</option>
            <option value="hold">挂起终态</option>
            <option value="eof">缺失 done</option>
            <option value="unknown">提交未知</option>
          </select>
        </label>
        <button onClick={() => fixture.finish()}>交付终态</button>
        <button onClick={() => session.cancel()}>取消运行</button>
        <button onClick={() => setRenders(renders + 1)}>父组件重渲 {renders}</button>
        <button onClick={() => setMounted(!mounted)}>
          {mounted ? '卸载视图' : '重新挂载视图'}
        </button>
        <a href="/">重置验收夹具</a>
        <p role="status">{message}</p>
      </aside>
      {mounted && (
        <A2UIProvider runtime={session.runtime} renderMap={{ ...renderMap }}>
          <div className="surfaces">
            {['A', 'B'].map((id) => {
              const state = session.getSurface(id);
              return (
                <section key={id} aria-label={`Surface ${id}`}>
                  <h2>Surface {id}</h2>
                  <button disabled={state !== undefined} onClick={() => void generate(id)}>
                    生成 {id}
                  </button>
                  <button onClick={() => recover(id, true)}>非法恢复 {id}</button>
                  <button onClick={() => recover(id, false)}>恢复 {id}</button>
                  <button
                    onClick={() => {
                      session.runtime.removeSurfaceView(id);
                      refresh();
                    }}
                  >
                    删除 {id}
                  </button>
                  <p role={state?.phase === 'desync' ? 'alert' : 'status'}>
                    {state
                      ? `${state.phase} · revision ${state.baseline?.surfaceRevision ?? 0} · action ${state.actionOpen ? 'open' : 'closed'}${state.blockReason ? ` · ${state.blockReason}` : ''}`
                      : '无视图'}
                  </p>
                  <A2UISurface surfaceId={id} actionsEnabled={state?.actionOpen ?? false} />
                  {state?.preview && <A2UIPreview view={state.preview} renderMap={renderMap} />}
                </section>
              );
            })}
          </div>
        </A2UIProvider>
      )}
      <details open>
        <summary>公开契约观测：请求 / 资源</summary>
        <pre aria-label="请求与资源">{JSON.stringify(fixture.diagnostics(), null, 2)}</pre>
      </details>
    </main>
  );
}

async function boot() {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(getCatalogContractHashInput(catalog)),
  );
  const hash = `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;
  createRoot(document.getElementById('root')!).render(<App hash={hash} />);
}
void boot();
