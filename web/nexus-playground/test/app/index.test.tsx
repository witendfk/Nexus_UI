import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { createHash } from 'node:crypto';
import {
  A2UIRuntime,
  CATALOG_CONTRACT_VERSION,
  createCatalogPromptContract,
  getCatalogContractHashInput,
  standardCatalogComponentDeclarations,
} from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import { App } from '../../src/app';

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(): Promise<void> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 0),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(App)));
  // 契约加载含 Web Crypto 异步摘要，act 不会等待它：轮询到控件或错误出现为止。
  for (let i = 0; i < 50; i += 1) {
    const ready =
      [...container.querySelectorAll('button')].some((item) => item.textContent === '生成 UI') ||
      container.querySelector('[role="alert"]') !== null;
    if (ready) break;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function button(text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === text,
  );
  expect(result, `button ${text}`).toBeDefined();
  return result!;
}

/** 与 server 同源规范化：浏览器 Web Crypto 复算必须得到同一 hash。 */
function hashOf(catalog: CatalogDefinition): string {
  return `sha256:${createHash('sha256').update(getCatalogContractHashInput(catalog)).digest('hex')}`;
}

function installServer(
  options: {
    fail?: boolean;
    wrongId?: boolean;
    invalidSchema?: boolean;
    noDone?: boolean;
    wrongCommit?: boolean;
    invalidMessage?: boolean;
    noHeader?: boolean;
    headerMismatch?: boolean;
  } = {},
) {
  let currentCatalog = '';
  let actionCount = 0;
  const catalogFor = (catalogId: string): CatalogDefinition =>
    ({
      catalogId: options.wrongId ? 'other' : catalogId,
      components: {
        ...standardCatalogComponentDeclarations(),
        ...(options.invalidSchema ? { Broken: { schema: { unknown: true } } } : {}),
      },
      actions: [{ name: 'submit', sources: ['Button'] }],
    }) as unknown as CatalogDefinition;
  const sseHeaders = (runId: string): Record<string, string> => ({
    'Content-Type': 'text/event-stream',
    ...(options.noHeader
      ? {}
      : { 'X-Nexus-Run-Id': options.headerMismatch ? `${runId}-other` : runId }),
  });
  const done = (runId: string, revision: number) =>
    `event: done\ndata: ${JSON.stringify({
      sessionVersion: 1,
      runId,
      surfaceId: 's',
      catalogId: options.wrongCommit ? 'different-catalog' : currentCatalog,
      contractVersion: CATALOG_CONTRACT_VERSION,
      catalogHash: hashOf(catalogFor(currentCatalog)),
      surfaceRevision: revision,
    })}\n\n`;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/a2ui/catalog-contract') {
      const catalogId = url.searchParams.get('catalogId') ?? '';
      const catalog = catalogFor(catalogId);
      let promptContract: string;
      try {
        promptContract = createCatalogPromptContract(catalog);
      } catch {
        promptContract = 'unregistrable';
      }
      return new Response(
        JSON.stringify({
          serverApiVersion: 1,
          kind: 'catalog-contract',
          contractVersion: CATALOG_CONTRACT_VERSION,
          contractHash: hashOf(catalog),
          catalog,
          promptContract,
        }),
        { status: options.fail ? 503 : 200 },
      );
    }
    if (url.pathname === '/api/a2ui/generate') {
      const { catalogId } = JSON.parse(String(init?.body));
      currentCatalog = catalogId;
      const messages = [
        { createSurface: { surfaceId: 's', catalogId } },
        { updateDataModel: { surfaceId: 's', value: { name: 'initial', subscribed: false } } },
        {
          updateComponents: {
            surfaceId: 's',
            components: [
              { id: 'root', component: 'Column', children: ['name', 'subscribed', 'submit'] },
              { id: 'name', component: 'TextField', label: 'Name', value: { path: '/name' } },
              {
                id: 'subscribed',
                component: 'CheckBox',
                label: 'Subscribe',
                value: { path: '/subscribed' },
              },
              {
                id: 'submit',
                component: 'Button',
                child: 'submitLabel',
                action: {
                  event: {
                    name: 'submit',
                    context: { name: { path: '/name' }, subscribed: { path: '/subscribed' } },
                  },
                },
              },
              { id: 'submitLabel', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ];
      return new Response(
        messages
          .map(
            (message) =>
              `event: message\ndata: ${JSON.stringify({ version: 'v0.9', ...message })}\n\n`,
          )
          .join('') +
          (options.invalidMessage
            ? 'event: message\ndata: {"version":"v0.9","unexpected":true}\n\n'
            : '') +
          (options.noDone ? '' : done('fixture-run', 1)),
        { headers: sseHeaders('fixture-run') },
      );
    }
    actionCount += 1;
    const runId = `action-run-${actionCount}`;
    // action 响应：服务端归一化写回 name，再 done；连续提交 revision 递增。
    return new Response(
      `event: message\ndata: ${JSON.stringify({
        version: 'v0.9',
        updateDataModel: { surfaceId: 's', path: '/name', value: `normalized-${actionCount}` },
      })}\n\n${done(runId, actionCount + 1)}`,
      { headers: sseHeaders(runId) },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function eventBodies(fetchMock: ReturnType<typeof installServer>) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url) === '/api/a2ui/event')
    .map(
      ([, init]) =>
        JSON.parse(String(init?.body)) as {
          message: { action: { context: Record<string, unknown> } };
          nexus: { surfaceRevision: number; actionId: string; inputs: unknown[] };
        },
    );
}

describe('Playground 公开 Catalog 装配', () => {
  it('实际 App 加载已发布声明后，控件编辑经 SDK 写回并到达 action context', async () => {
    const fetchMock = installServer();
    await mount();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/a2ui/catalog-contract?')),
    ).toHaveLength(3);
    await act(async () => button('Nexus Basic').click());
    await act(async () => button('生成 UI').click());
    const field = container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement;
    const checkbox = container.querySelector(
      '.nexus-surface input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(field?.value).toBe('initial');
    await act(async () => {
      field.value = 'edited';
      Simulate.change(field);
    });
    await act(async () => {
      checkbox.checked = true;
      Simulate.change(checkbox);
    });
    expect(field.value).toBe('edited');
    expect(checkbox.checked).toBe(true);
    await act(async () => button('Submit').click());
    const [request] = eventBodies(fetchMock);
    expect(request).toBeDefined();
    expect(request!.message.action.context).toEqual({ name: 'edited', subscribed: true });
    expect(request!.nexus.surfaceRevision).toBe(1);
    expect(request!.nexus.actionId).toBeTruthy();
    expect(request!.nexus.inputs).toEqual([
      { componentId: 'name', property: 'value', value: 'edited' },
      { componentId: 'subscribed', property: 'value', value: true },
    ]);
    expect(container.querySelector('.nexus-surface input[type="text"]')).toBe(field);
  });

  it('S2.6.4.1：成功提交确认已发送草稿，服务端归一化值可见，第二次提交不重发旧草稿', async () => {
    const fetchMock = installServer();
    await mount();
    await act(async () => button('Nexus Basic').click());
    await act(async () => button('生成 UI').click());
    const field = container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement;
    await act(async () => {
      field.value = 'edited';
      Simulate.change(field);
    });
    await act(async () => button('Submit').click());
    // 服务端归一化写回优先于本地可见值；草稿已确认。
    expect(
      (container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement).value,
    ).toBe('normalized-1');

    await act(async () => button('Submit').click());
    const bodies = eventBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.nexus.inputs).toEqual([
      { componentId: 'name', property: 'value', value: 'edited' },
    ]);
    // 第二次：旧草稿已确认不重发，基准取自上次成功 done（revision 2）。
    expect(bodies[1]!.nexus.inputs).toEqual([]);
    expect(bodies[1]!.nexus.surfaceRevision).toBe(2);
  });

  it('S2.6.4.1：提交完成后再次编辑，下次只发送新草稿', async () => {
    const fetchMock = installServer();
    await mount();
    await act(async () => button('Nexus Basic').click());
    await act(async () => button('生成 UI').click());
    const field = container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement;
    await act(async () => {
      field.value = 'first';
      Simulate.change(field);
    });
    await act(async () => button('Submit').click());
    // 提交完成后再次编辑（新代次）；第二次提交必须携带新值。
    const after = container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement;
    await act(async () => {
      after.value = 'second';
      Simulate.change(after);
    });
    await act(async () => button('Submit').click());
    const bodies = eventBodies(fetchMock);
    expect(bodies[1]!.nexus.inputs).toEqual([
      { componentId: 'name', property: 'value', value: 'second' },
    ]);
  });

  for (const options of [
    { noDone: true },
    { wrongCommit: true },
    { invalidMessage: true },
    { noHeader: true },
    { headerMismatch: true },
  ]) {
    it(`does not send actions from an unconfirmed local view ${JSON.stringify(options)}`, async () => {
      const fetchMock = installServer(options);
      await mount();
      await act(async () => button('Nexus Basic').click());
      await act(async () => button('生成 UI').click());
      await act(async () => button('Submit').click());
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === '/api/a2ui/event'),
      ).toHaveLength(0);
    });
  }

  for (const options of [{ fail: true }, { wrongId: true }, { invalidSchema: true }]) {
    it(`配置失败时显式报错，不挂载缺少声明的交互入口 ${JSON.stringify(options)}`, async () => {
      const fetchMock = installServer(options);
      await mount();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.querySelector('.nexus-surface')).toBeNull();
      expect(
        fetchMock.mock.calls.every(([url]) =>
          String(url).startsWith('/api/a2ui/catalog-contract?'),
        ),
      ).toBe(true);
    });
  }
});

it('取消后 fetch 忽略 abort 仍返回：不写入旧视图、不开放 action', async () => {
  const fetchMock = installServer();
  const original = fetchMock.getMockImplementation()!;
  let release!: (response: Response) => void;
  let response!: Response;
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === '/api/a2ui/generate') {
      response = await original(input, init);
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return original(input, init);
  });
  await mount();
  await act(async () => button('Nexus Basic').click());
  await act(async () => button('生成 UI').click());
  await act(async () => button('取消').click());
  await act(async () => release(response));
  expect(container.querySelector('.nexus-surface input')).toBeNull();
  expect(eventBodies(fetchMock), 'cancelled run must not enable action').toHaveLength(0);
});

it('第二次生成只有新 run/revision 的 done，不能给旧视图换基准', async () => {
  const fetchMock = installServer();
  const original = fetchMock.getMockImplementation()!;
  let generation = 0;
  fetchMock.mockImplementation(async (input, init) => {
    const response = await original(input, init);
    if (String(input) === '/api/a2ui/generate' && ++generation === 2) {
      const text = await response.text();
      const headers = new Headers(response.headers);
      headers.set('X-Nexus-Run-Id', 'replacement-run');
      return new Response(
        text
          .slice(text.lastIndexOf('event: done'))
          .split('fixture-run')
          .join('replacement-run')
          .split('"surfaceRevision":1')
          .join('"surfaceRevision":2'),
        { headers },
      );
    }
    return response;
  });
  await mount();
  await act(async () => button('Nexus Basic').click());
  await act(async () => button('生成 UI').click());
  await act(async () => button('生成 UI').click());
  await act(async () => button('Submit').click());
  expect(eventBodies(fetchMock), 'done-only response cannot qualify an old view').toHaveLength(0);
});

it('在途重复 action 被忽略：挂起期间再次点击不新增请求，原运行正常完成并释放 busy', async () => {
  const fetchMock = installServer();
  const original = fetchMock.getMockImplementation()!;
  let release!: (r: Response) => void;
  let pendingResponse!: Response;
  let eventCount = 0;
  fetchMock.mockImplementation(async (input, init) => {
    const r = await original(input, init);
    if (String(input) === '/api/a2ui/event' && (eventCount += 1) === 1) {
      pendingResponse = r;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return r;
  });
  await mount();
  await act(async () => button('Nexus Basic').click());
  await act(async () => button('生成 UI').click());
  const field = container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement;
  await act(async () => {
    field.value = 'edited';
    Simulate.change(field);
  });
  await act(async () => button('Submit').click());
  await act(async () => button('Submit').click());
  expect(
    eventBodies(fetchMock),
    '在途重复 action 不得发出第二个请求，也不得取消当前运行',
  ).toHaveLength(1);
  await act(async () => release(pendingResponse));
  // 原运行正常完成：基准推进到 revision 2，busy 释放后可继续提交。
  await act(async () => button('Submit').click());
  const bodies = eventBodies(fetchMock);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]!.nexus.surfaceRevision).toBe(2);
  expect(bodies[1]!.nexus.inputs).toEqual([]);
});

it('请求挂起期间的新编辑在响应归一化后恢复可见，下次提交与可见值相同', async () => {
  const fetchMock = installServer();
  const original = fetchMock.getMockImplementation()!;
  let release!: (r: Response) => void;
  let response!: Response;
  let actionCount = 0;
  fetchMock.mockImplementation(async (input, init) => {
    const r = await original(input, init);
    if (String(input) === '/api/a2ui/event' && ++actionCount === 1) {
      response = r;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return r;
  });
  await mount();
  await act(async () => button('Nexus Basic').click());
  await act(async () => button('生成 UI').click());
  let field = container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement;
  await act(async () => {
    field.value = 'first';
    Simulate.change(field);
  });
  await act(async () => button('Submit').click());
  await act(async () => {
    field.value = 'second';
    Simulate.change(field);
  });
  await act(async () => release(response));
  field = container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement;
  const visible = field.value;
  expect(visible).toBe('second');
  await act(async () => button('Submit').click());
  const inputs = eventBodies(fetchMock)[1]!.nexus.inputs as { value: string }[];
  expect(inputs[0]!.value, 'sent input must equal the currently visible value').toBe(visible);
});

it('切换 Catalog 并完成 B 后，A 的晚到响应不改变视图、基准或 busy', async () => {
  const fetchMock = installServer();
  const original = fetchMock.getMockImplementation()!;
  let release!: (response: Response) => void;
  let oldResponse!: Response;
  let count = 0;
  fetchMock.mockImplementation(async (input, init) => {
    const response = await original(input, init);
    if (String(input) !== '/api/a2ui/generate') return response;
    if (++count === 1) {
      oldResponse = response;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    const headers = new Headers(response.headers);
    headers.set('X-Nexus-Run-Id', 'run-b');
    return new Response(
      (await response.text())
        .split('fixture-run')
        .join('run-b')
        .split('"surfaceId":"s"')
        .join('"surfaceId":"b"')
        .split('initial')
        .join('view-b'),
      { headers },
    );
  });
  await mount();
  await act(async () => button('Nexus Basic').click());
  await act(async () => button('生成 UI').click());
  await act(async () => button('Workbench').click());
  await act(async () => button('生成 UI').click());
  await act(async () => release(oldResponse));
  expect(
    (container.querySelector('.nexus-surface input[type="text"]') as HTMLInputElement).value,
  ).toBe('view-b');
  expect(button('生成 UI').disabled).toBe(false);
  await act(async () => button('Submit').click());
  const calls = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/a2ui/event');
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0]![1]?.body)).message.action.surfaceId).toBe('b');
});

for (const phase of ['generate', 'action'] as const) {
  it(`${phase} 挂起期间卸载，晚到响应不能再 push 到 runtime`, async () => {
    const fetchMock = installServer();
    const original = fetchMock.getMockImplementation()!;
    let release!: (response: Response) => void;
    let oldResponse!: Response;
    fetchMock.mockImplementation(async (input, init) => {
      const response = await original(input, init);
      if (String(input) === `/api/a2ui/${phase === 'action' ? 'event' : 'generate'}`) {
        oldResponse = response;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return response;
    });
    await mount();
    await act(async () => button('Nexus Basic').click());
    await act(async () => button('生成 UI').click());
    if (phase === 'action') await act(async () => button('Submit').click());
    const push = vi.spyOn(A2UIRuntime.prototype, 'push');
    await act(async () => root!.unmount());
    root = undefined;
    await act(async () => release(oldResponse));
    expect(push).not.toHaveBeenCalled();
  });
}

it('响应改成另一个已加载 Catalog，仍不能作为本次生成结果接受', async () => {
  const fetchMock = installServer();
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === '/api/a2ui/generate') {
      return original(input, {
        ...init,
        body: JSON.stringify({ catalogId: 'https://example.com/catalogs/nexus-task/v1' }),
      });
    }
    return original(input, init);
  });
  await mount();
  await act(async () => button('Nexus Basic').click());
  await act(async () => button('生成 UI').click());
  expect(container.querySelector('.nexus-surface input')).toBeNull();
  expect(container.textContent).toContain('生成视图与本次请求不匹配');
});
