import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { standardCatalogComponentDeclarations } from '@nexus-ui/core';
import { App } from '../../src/app';

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
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
}

function button(text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === text,
  );
  expect(result, `button ${text}`).toBeDefined();
  return result!;
}

function installServer(
  options: { fail?: boolean; wrongId?: boolean; invalidSchema?: boolean } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/a2ui/catalog-contract') {
      const catalogId = url.searchParams.get('catalogId');
      return new Response(
        JSON.stringify({
          kind: 'catalog-contract',
          catalog: {
            catalogId: options.wrongId ? 'other' : catalogId,
            components: {
              ...standardCatalogComponentDeclarations(),
              ...(options.invalidSchema ? { Broken: { schema: { unknown: true } } } : {}),
            },
            actions: [{ name: 'submit', sources: ['Button'] }],
          },
        }),
        { status: options.fail ? 503 : 200 },
      );
    }
    if (url.pathname === '/api/a2ui/generate') {
      const { catalogId } = JSON.parse(String(init?.body));
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
          .join(''),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    }
    return new Response('event: done\ndata: {}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
    const request = fetchMock.mock.calls.find(([url]) => String(url) === '/api/a2ui/event');
    expect(request).toBeDefined();
    expect(JSON.parse(String(request![1]?.body)).action.context).toEqual({
      name: 'edited',
      subscribed: true,
    });
    expect(container.querySelector('.nexus-surface input[type="text"]')).toBe(field);
  });

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
