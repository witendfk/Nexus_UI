import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
// S4.2 联合验收：从构建产物公开根入口驱动 React + client 会话全链（不 import 源码）。
import * as core from '@nexus-ui/core';
import * as client from '@nexus-ui/client';
import * as react from '../dist/index.js';

/**
 * S4.2 联合验收（CURRENT S4.2/SPEC §7）：React 渲染层与 @nexus-ui/client 会话
 * 经公开入口联合装配（生成 → 只读预览 → 提交渲染 → 输入写回 → action →
 * 失败/desync → 恢复 → 卸载释放）。矩阵：
 * - 全链主 cell：请求体（revision/hash/inputs/actionId）与 patch 提交渲染；
 * - 生成中 A2UIPreview 只读（键盘/点击零出口）→ 完成后 A2UISurface 挂载；
 * - desync（EOF 无终态 / commitState unknown）：动作禁用、旧视图保留、
 *   renderer 回调出口（含 keyDown）与网络双封闭；
 * - 合法恢复重启动作出口；非法恢复拒绝且 UI 不变；
 * - 双 surface 独立更新/删除（client 会话驱动）；
 * - 外部实例归创建者销毁、自建实例跨重渲稳定（useA2UI 探针）、样式显式选择。
 * 走真实 fetchSseTransport + fetch mock（SSE ReadableStream），与浏览器同路径。
 */

const sessions = new Set<client.ClientSession>();
afterEach(() => {
  cleanup();
  for (const session of sessions) session.dispose();
  sessions.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function barrier(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const CATALOG_ID = 'https://example.com/catalogs/react-joint/v1';

function jointCatalog(): core.CatalogDefinition {
  return {
    catalogId: CATALOG_ID,
    components: {
      ...core.standardCatalogComponentDeclarations(),
      TextField: {
        ...core.standardCatalogComponentDeclarations().TextField,
        inputs: { value: { type: 'string', maxLength: 200 } },
      },
    },
    actions: [
      {
        name: 'save',
        sources: ['Button'],
        paramSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ],
  };
}

const HASH = `sha256:${createHash('sha256')
  .update(core.getCatalogContractHashInput(jointCatalog()))
  .digest('hex')}`;

function formMessages(surfaceId: string, name: string): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['confirm', 'field'] },
          {
            id: 'confirm',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'save', context: {} } },
          },
          { id: 'label', component: 'Text', text: '提交' },
          { id: 'field', component: 'TextField', value: { path: '/name' }, label: '姓名' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId, value: { name } } },
  ];
}

function startData(runId: string, surfaceId: string): Record<string, unknown> {
  return {
    type: 'start',
    sessionVersion: 1,
    runId,
    surfaceId,
    catalogId: CATALOG_ID,
    contractVersion: 2,
    catalogHash: HASH,
  };
}

function doneData(
  runId: string,
  surfaceId: string,
  surfaceRevision: number,
): Record<string, unknown> {
  return {
    sessionVersion: 1,
    runId,
    surfaceId,
    catalogId: CATALOG_ID,
    contractVersion: 2,
    catalogHash: HASH,
    surfaceRevision,
  };
}

interface SseScript {
  frames: Array<{ event: string; data: unknown }>;
  runIdHeader?: string | null;
  /** 保持流打开到 gate 释放（EOF 未到）；已取消则不再关流。 */
  hangBeforeClose?: Promise<void>;
  /** gate 之后才交付的帧；区别于仅挂起 EOF。 */
  tailFrames?: SseScript['frames'];
  /** 记录底层流是否被取消（reader 释放证据）。 */
  cancelLog?: { canceled: boolean };
}

function sseResponse(script: SseScript): Response {
  const encoder = new TextEncoder();
  const start = script.frames.find((frame) => frame.event === 'start');
  const startRunId = start ? (start.data as { runId: string }).runId : 'missing-run-id';
  const headers: Record<string, string> = { 'Content-Type': 'text/event-stream' };
  if (script.runIdHeader !== null) {
    headers['X-Nexus-Run-Id'] = script.runIdHeader ?? startRunId;
  }
  const encode = (frames: SseScript['frames']) =>
    encoder.encode(
      frames
        .map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`)
        .join(''),
    );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(script.frames));
      if (script.hangBeforeClose) {
        void script.hangBeforeClose.then(() => {
          if (script.cancelLog?.canceled) return;
          try {
            if (script.tailFrames) controller.enqueue(encode(script.tailFrames));
            controller.close();
          } catch {
            // 流已被取消：晚到 EOF 不复活会话。
          }
        });
      } else {
        controller.close();
      }
    },
    cancel() {
      if (script.cancelLog) script.cancelLog.canceled = true;
    },
  });
  return new Response(stream, { status: 200, headers });
}

function scriptFetch(routes: { generate?: SseScript[]; event?: SseScript[] }): {
  fetchMock: unknown;
  calls: Array<{ url: string; body: unknown; signal?: AbortSignal | null }>;
} {
  const calls: Array<{ url: string; body: unknown; signal?: AbortSignal | null }> = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({
      url,
      body: init?.body != null ? JSON.parse(String(init.body)) : undefined,
      signal: init?.signal,
    });
    const queue = url.endsWith('/generate')
      ? routes.generate
      : url.endsWith('/event')
        ? routes.event
        : undefined;
    const next = queue?.shift();
    if (!next) return Promise.reject(new Error(`script exhausted: ${url}`));
    return Promise.resolve(sseResponse(next));
  });
  return { fetchMock, calls };
}

function genScript(
  surfaceId: string,
  name: string,
  runId: string,
  hang?: Promise<void>,
): SseScript {
  return {
    frames: [
      { event: 'start', data: startData(runId, surfaceId) },
      ...formMessages(surfaceId, name).map((message) => ({
        event: 'message' as const,
        data: message,
      })),
      ...(!hang ? [{ event: 'done', data: doneData(runId, surfaceId, 1) }] : []),
    ],
    hangBeforeClose: hang,
    tailFrames: hang ? [{ event: 'done', data: doneData(runId, surfaceId, 1) }] : undefined,
  };
}

function patchScript(
  runId: string,
  surfaceId: string,
  name: string,
  revision: number,
  extra?: Partial<SseScript>,
): SseScript {
  return {
    frames: [
      { event: 'start', data: startData(runId, surfaceId) },
      {
        event: 'message',
        data: { version: 'v0.9', updateDataModel: { surfaceId, value: { name } } },
      },
      { event: 'done', data: doneData(runId, surfaceId, revision) },
    ],
    ...extra,
  };
}

function makeSession(fetchMock: unknown): client.ClientSession {
  const ref: { session?: client.ClientSession } = {};
  const session = client.createClientSession({
    runtimeOptions: {
      catalogRegistry: new core.CatalogRegistry([jointCatalog()]),
      // 与参考宿主同口径：runtime action 事件由宿主转发给会话（会话不自动接管）。
      onAction: (event) => {
        void ref.session?.action(event);
      },
    },
    catalogHashes: new Map([[CATALOG_ID, HASH]]),
    transport: client.fetchSseTransport({ fetch: fetchMock as typeof fetch }),
    endpoints: { generate: '/api/a2ui/generate', event: '/api/a2ui/event' },
  });
  ref.session = session;
  sessions.add(session);
  return session;
}

/** 宿主布局：Provider 只提供上下文，Surface 位置与动作资格由宿主按会话状态决定。 */
function JointHost(props: {
  session: client.ClientSession;
  surfaceIds: string[];
  surfaceRenderMap?: react.RenderMap;
  previewRenderMap?: react.RenderMap;
}): ReactNode {
  const { session, surfaceIds, surfaceRenderMap, previewRenderMap } = props;
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => session.subscribe(() => force()), [session]);
  return createElement(
    'div',
    null,
    surfaceIds.map((surfaceId) => {
      const status = session.getSurface(surfaceId);
      const open = status?.actionOpen === true && status?.busy !== true;
      return createElement(
        'div',
        { key: surfaceId, 'data-host-surface': surfaceId },
        status?.preview
          ? createElement(react.A2UIPreview, { view: status.preview, renderMap: previewRenderMap })
          : null,
        createElement(react.A2UISurface, {
          surfaceId,
          actionsEnabled: open,
          renderMap: surfaceRenderMap,
        }),
      );
    }),
  );
}

function mountJoint(
  session: client.ClientSession,
  surfaceIds: string[],
  surfaceRenderMap?: react.RenderMap,
  previewRenderMap?: react.RenderMap,
) {
  return render(
    createElement(
      react.A2UIProvider,
      { runtime: session.runtime },
      createElement(JointHost, { session, surfaceIds, surfaceRenderMap, previewRenderMap }),
    ),
  );
}

async function typeInput(value: string): Promise<void> {
  const input = document.querySelector('input');
  expect(input, 'TextField 输入框已渲染').to.exist;
  fireEvent.change(input!, { target: { value } });
}

function surfaceButton(surfaceId: string): HTMLButtonElement {
  const container = document.querySelector(`[data-host-surface="${surfaceId}"]`);
  const button = Array.from(container?.querySelectorAll('button') ?? []).find((candidate) =>
    (candidate.textContent ?? '').includes('提交'),
  );
  if (!button) throw new Error(`surface ${surfaceId} 内找不到「提交」按钮`);
  return button;
}

const S1 = 'joint-1';
const RUN_1 = 'a2u10000-0000-4000-8000-000000000001';
const RUN_2 = 'a2u10000-0000-4000-8000-000000000002';

describe('S4.2 联合 · 生成、输入与 action（dist 公开入口）', () => {
  it('全链：生成渲染 → 输入写回 → action 请求体（revision/hash/inputs/actionId）→ patch 提交渲染', async () => {
    const { fetchMock, calls } = scriptFetch({
      generate: [genScript(S1, 'base', RUN_1)],
      event: [patchScript(RUN_2, S1, 'submitted', 2)],
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession(fetchMock);
    mountJoint(session, [S1]);

    expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交' })).to.exist;
    });
    expect((document.querySelector('input') as HTMLInputElement).value).to.equal('base');

    await typeInput('typed');
    fireEvent.click(screen.getByRole('button', { name: '提交' }));

    await waitFor(() => {
      expect((document.querySelector('input') as HTMLInputElement).value).to.equal('submitted');
    });
    const actionCall = calls.find((call) => call.url.endsWith('/event'));
    expect(actionCall, 'action POST 已出网').to.exist;
    const body = actionCall!.body as {
      message: { action: { name: string; surfaceId: string; actionId: string } };
      nexus: {
        surfaceRevision: number;
        catalogHash: string;
        inputs: Array<{ value: unknown }>;
        actionId: string;
      };
    };
    expect(body.message.action.name).to.equal('save');
    expect(body.message.action.surfaceId).to.equal(S1);
    expect(body.nexus.surfaceRevision).to.equal(1, '固定提交基准随请求发送');
    expect(body.nexus.catalogHash).to.equal(HASH);
    expect(body.nexus.inputs[0].value).to.equal('typed', '草稿作为 inputs 发送');
    expect(body.nexus.actionId).to.be.a('string').and.not.equal('');
    expect(body.nexus.actionId).to.equal(body.message.action.actionId);
    expect(session.getSurface(S1)?.baseline?.surfaceRevision).to.equal(2);
    expect(session.getSurface(S1)?.actionOpen).to.equal(true);
  });

  it('生成中 A2UIPreview 只读（点击/键盘零出口）→ 完成后 A2UISurface 挂载且可交互', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchMock, calls } = scriptFetch({ generate: [genScript(S1, 'base', RUN_1, gate)] });
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession(fetchMock);
    mountJoint(session, [S1]);

    void session.generate({ catalogId: CATALOG_ID });
    await waitFor(() => {
      expect(screen.getByLabelText('界面预览')).to.exist;
    });
    expect(document.querySelector('[data-surface-id]'), '提交视图未挂载').to.equal(null);
    const triggerSpy = vi.spyOn(session.runtime, 'triggerAction');
    const previewButton = screen.getByRole('button', { name: '提交' });
    fireEvent.click(previewButton);
    fireEvent.keyDown(previewButton, { key: 'Enter' });
    expect(triggerSpy).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(0);

    release();
    await waitFor(() => {
      expect(document.querySelector('[data-surface-id="joint-1"]')).to.exist;
    });
    expect(screen.queryByLabelText('界面预览'), '候选预览已清除').to.equal(null);
    expect(
      document.querySelector('[data-surface-id="joint-1"]')?.getAttribute('data-actions-disabled'),
    ).to.equal('false');
    expect(session.getSurface(S1)?.actionOpen).to.equal(true);
  });

  for (const custom of [false, true]) {
    it(`action 预览不写回；提交视图仍可编辑且下次 inputs 一致（custom=${custom}）`, async () => {
      const gate = barrier();
      const patch = patchScript(RUN_2, S1, 'server-normalized', 2);
      const { fetchMock, calls } = scriptFetch({
        generate: [genScript(S1, 'base', RUN_1)],
        event: [
          {
            frames: patch.frames.slice(0, -1),
            tailFrames: patch.frames.slice(-1),
            hangBeforeClose: gate.promise,
          },
          patchScript('after-preview', S1, 'next-commit', 3),
        ],
      });
      const session = makeSession(fetchMock);
      const actionSpy = vi.spyOn(session, 'action');
      const writeResults: boolean[] = [];
      const customMap: react.RenderMap = {
        ...react.standardRenderMap,
        TextField: (node, _children, ctx) =>
          createElement('input', {
            'aria-label': 'preview-input',
            value: String(node.props.value),
            onChange: () =>
              writeResults.push(ctx.setInputValue(node.id, node.surfaceId, 'value', 'forged')),
          }),
        // 无原生 disabled 的出口，检验只读上下文自身的保护。
        Button: (node, _children, ctx) =>
          createElement('div', {
            role: 'button',
            'aria-label': 'preview-action',
            tabIndex: 0,
            onClick: () => ctx.triggerAction(node.id, node.surfaceId),
            onKeyDown: () => ctx.triggerAction(node.id, node.surfaceId),
          }),
      };
      mountJoint(session, [S1], undefined, custom ? customMap : undefined);
      try {
        expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
        await waitFor(() => expect(screen.getByRole('button', { name: '提交' })).to.exist);
        await typeInput('sent');
        fireEvent.click(screen.getByRole('button', { name: '提交' }));
        const pending = actionSpy.mock.results[0].value as Promise<client.RunResult>;
        await waitFor(() => {
          expect(session.getSurface(S1)?.preview?.dataModel).to.deep.equal({
            name: 'server-normalized',
          });
          expect(screen.getByLabelText('界面预览')).to.exist;
        });
        const preview = screen.getByLabelText('界面预览');
        const original = document.querySelector('[data-surface-id="joint-1"]')!;
        const input = original.querySelector('input')!;
        const previewInput = preview.querySelector('input')!;
        expect(
          input.closest('[aria-disabled="true"], [disabled]'),
          '提交输入不能继承动作禁用语义',
        ).to.equal(null);
        expect(previewInput.closest('fieldset[disabled]'), '候选输入保持只读').not.to.equal(null);
        if (!custom) {
          expect((original.querySelector('label') as HTMLLabelElement).control).to.equal(input);
          expect((preview.querySelector('label') as HTMLLabelElement).control).to.equal(
            previewInput,
          );
          expect(input.id).not.to.equal(previewInput.id, '同 surface 的预览和提交控件也必须独立');
        }
        const viewBefore = session.runtime.getSurfaceView(S1);
        const draftsBefore = session.runtime.extractLatestInputDrafts(S1);
        const fixed = session.getCommittedSurface(S1);
        const writeSpy = vi.spyOn(session.runtime, 'setInputValue');
        const triggerSpy = vi.spyOn(session.runtime, 'triggerAction');
        fireEvent.change(previewInput, { target: { value: 'forged' } });
        const button = preview.querySelector('[role="button"], button')!;
        fireEvent.click(button);
        fireEvent.keyDown(button, { key: 'Enter' });
        if (custom) expect(writeResults).to.deep.equal([false]);
        expect(writeSpy).not.toHaveBeenCalled();
        expect(triggerSpy).not.toHaveBeenCalled();
        expect(session.runtime.getSurfaceView(S1)).to.equal(viewBefore);
        expect(session.runtime.extractLatestInputDrafts(S1)).to.deep.equal(draftsBefore);
        expect(session.getCommittedSurface(S1)).to.equal(fixed);
        expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(1);

        fireEvent.change(input, { target: { value: 'edited-later' } });
        expect(writeSpy).toHaveBeenCalledWith('field', S1, 'value', 'edited-later');
        expect((original.querySelector('input') as HTMLInputElement).value).to.equal(
          'edited-later',
        );
        await act(async () => {
          gate.resolve();
          expect((await pending).status).to.equal('committed');
        });
        expect(screen.queryByLabelText('界面预览')).to.equal(null);
        expect((original.querySelector('input') as HTMLInputElement).value).to.equal(
          'edited-later',
        );
        expect(session.getCommittedSurface(S1)?.view.dataModel).to.deep.equal({
          name: 'server-normalized',
        });
        fireEvent.click(screen.getByRole('button', { name: '提交' }));
        await act(async () => {
          expect(
            (await (actionSpy.mock.results[1].value as Promise<client.RunResult>)).status,
          ).to.equal('committed');
        });
        const actionBodies = calls
          .filter((call) => call.url.endsWith('/event'))
          .map((call) => call.body as { nexus: { inputs: core.NexusActionInput[] } });
        expect(actionBodies.map((body) => body.nexus.inputs)).to.deep.equal([
          [{ componentId: 'field', property: 'value', value: 'sent' }],
          [{ componentId: 'field', property: 'value', value: 'edited-later' }],
        ]);
        expect(session.runtime.getLatestInputs(S1)).to.deep.equal([]);
      } finally {
        gate.resolve();
        session.dispose();
      }
    });
  }
});

describe('S4.2 联合 · 失败收敛与恢复（dist 公开入口）', () => {
  async function desyncCase(ending: 'eof' | 'unknown'): Promise<void> {
    const errorFrames =
      ending === 'unknown'
        ? [
            {
              event: 'error',
              data: {
                sessionVersion: 1,
                runId: RUN_2,
                surfaceId: S1,
                code: 'RUN_COMMIT_UNKNOWN',
                commitState: 'unknown',
              },
            },
          ]
        : [];
    const { fetchMock, calls } = scriptFetch({
      generate: [genScript(S1, 'base', RUN_1)],
      event: [{ frames: [{ event: 'start', data: startData(RUN_2, S1) }, ...errorFrames] }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession(fetchMock);
    mountJoint(session, [S1]);
    expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交' })).to.exist;
    });
    const triggerSpy = vi.spyOn(session.runtime, 'triggerAction');

    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => {
      expect(session.getSurface(S1)?.phase).to.equal('desync');
    });
    // desync 收敛后重新计数：动作禁用 + 出口封闭，回调不达 runtime，也无第二次出网。
    triggerSpy.mockClear();
    const disabledButton = screen.getByRole('button', { name: '提交' });
    fireEvent.click(disabledButton);
    fireEvent.keyDown(disabledButton, { key: 'Enter' });
    expect(triggerSpy).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(1);
    expect(
      document.querySelector('[data-surface-id="joint-1"]')?.getAttribute('data-actions-disabled'),
    ).to.equal('true');
    expect(screen.getByText('提交'), '旧已提交视图保留展示').to.exist;
    expect(session.getSurface(S1)?.baseline?.surfaceRevision).to.equal(1);
  }

  it('EOF 无终态 → desync：动作禁用、旧视图保留、出口与网络双封闭', async () => {
    await desyncCase('eof');
  });

  it('error 帧 commitState unknown → desync：同样收敛禁用且基准不推进', async () => {
    await desyncCase('unknown');
  });

  it('自定义组件键盘/变更动作统一门控：unknown 收敛后事件不再到达 runtime', async () => {
    // 自定义渲染元素没有原生 disabled 可依赖，动作出口封闭由 Surface 门控承担。
    const customMap: react.RenderMap = {
      ...react.standardRenderMap,
      Button: (vnode, _children, ctx) =>
        createElement('input', {
          key: vnode.id,
          'aria-label': 'custom-action',
          readOnly: true,
          'aria-disabled': ctx.actionsEnabled === false,
          onKeyDown: () => ctx.triggerAction(vnode.id, vnode.surfaceId),
          onChange: () => ctx.triggerAction(vnode.id, vnode.surfaceId),
        }),
    };
    const { fetchMock, calls } = scriptFetch({
      generate: [genScript(S1, 'base', RUN_1)],
      event: [
        {
          frames: [
            { event: 'start', data: startData(RUN_2, S1) },
            {
              event: 'error',
              data: {
                sessionVersion: 1,
                runId: RUN_2,
                surfaceId: S1,
                code: 'RUN_COMMIT_UNKNOWN',
                commitState: 'unknown',
              },
            },
          ],
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession(fetchMock);
    mountJoint(session, [S1], customMap);
    expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
    let field!: HTMLElement;
    await waitFor(() => {
      field = screen.getByLabelText('custom-action');
      expect(field).to.exist;
    });
    expect(field.getAttribute('aria-disabled')).to.equal('false');

    // 键盘动作照常出网；unknown 收敛后统一关闭。
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(session.getSurface(S1)?.phase).to.equal('desync');
    });
    const triggerSpy = vi.spyOn(session.runtime, 'triggerAction');
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: 'x' } });
    expect(triggerSpy).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(1);
    expect(field.getAttribute('aria-disabled')).to.equal('true');
    expect(
      document.querySelector('[data-surface-id="joint-1"]')?.getAttribute('data-actions-disabled'),
    ).to.equal('true');
  });

  it('合法恢复重启动作出口；非法恢复拒绝且 UI 不变', async () => {
    const { fetchMock, calls } = scriptFetch({
      generate: [genScript(S1, 'base', RUN_1)],
      event: [
        { frames: [{ event: 'start', data: startData(RUN_2, S1) }] },
        patchScript(RUN_2, S1, 'recovered', 2),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession(fetchMock);
    mountJoint(session, [S1]);
    const generated = await session.generate({ catalogId: CATALOG_ID });
    expect(generated.status).to.equal('committed');
    const commit = (generated as { commit: core.NexusSurfaceCommit }).commit;
    const view = session.runtime.getSurfaceView(S1)!;
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交' })).to.exist;
    });

    // desync（EOF 无终态）后动作关闭。
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => {
      expect(session.getSurface(S1)?.actionOpen).to.equal(false);
    });
    expect(
      document.querySelector('[data-surface-id="joint-1"]')?.getAttribute('data-actions-disabled'),
    ).to.equal('true');

    // 非法恢复：surface 与提交身份不一致 → 拒绝且 UI 保持禁用。
    expect(() => session.recover({ view: { ...view, surfaceId: 'other' }, commit })).toThrow(
      /surface 与提交身份不一致/,
    );
    expect(
      document.querySelector('[data-surface-id="joint-1"]')?.getAttribute('data-actions-disabled'),
    ).to.equal('true');
    expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(1);

    // 合法恢复：宿主提供同次读取的视图 + 固定提交 → 动作出口重启。
    expect(session.recover({ view, commit }).status).to.equal('committed');
    await waitFor(() => {
      expect(
        document
          .querySelector('[data-surface-id="joint-1"]')
          ?.getAttribute('data-actions-disabled'),
      ).to.equal('false');
    });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => {
      expect((document.querySelector('input') as HTMLInputElement).value).to.equal('recovered');
    });
    expect(session.getSurface(S1)?.baseline?.surfaceRevision).to.equal(2);
    expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(2);
  });
});

describe('S4.2 联合 · 隔离、所有权与样式（dist 公开入口）', () => {
  it('双 surface 独立更新/删除：一个删除不影响另一个的动作资格与视图', async () => {
    const SA = 'joint-a';
    const SB = 'joint-b';
    const { fetchMock, calls } = scriptFetch({
      generate: [genScript(SA, 'base-a', RUN_1), genScript(SB, 'base-b', RUN_2)],
      event: [patchScript(RUN_2, SB, 'patched-b', 2), patchScript(RUN_1, SA, 'patched-a', 2)],
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession(fetchMock);
    mountJoint(session, [SA, SB]);
    expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
    expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-surface-id]')).to.have.length(2);
    });
    for (const surfaceId of [SA, SB]) {
      const container = document.querySelector(`[data-host-surface="${surfaceId}"]`)!;
      expect((container.querySelector('label') as HTMLLabelElement).control).to.equal(
        container.querySelector('input'),
      );
    }
    const inputs = () => Array.from(document.querySelectorAll('input')) as HTMLInputElement[];

    // 只更新 B：A 的视图与门控不变。
    fireEvent.click(surfaceButton(SB));
    await waitFor(() => {
      expect(inputs().some((input) => input.value === 'patched-b')).to.equal(true);
    });
    expect(inputs().some((input) => input.value === 'base-a')).to.equal(true);
    expect(session.getSurface(SA)?.actionOpen).to.equal(true);

    // 删除 B：DOM 清空，A 不受影响且仍可出网。
    session.runtime.removeSurfaceView(SB);
    await waitFor(() => {
      expect(document.querySelector('[data-host-surface="joint-b"] [data-surface-id]')).to.equal(
        null,
      );
    });
    expect(document.querySelector('[data-host-surface="joint-a"] [data-surface-id]')).to.exist;
    fireEvent.click(surfaceButton(SA));
    await waitFor(() => {
      expect(session.getSurface(SA)?.baseline?.surfaceRevision).to.equal(2);
    });
    expect(inputs().some((input) => input.value === 'patched-a')).to.equal(true);
    expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(2);
  });

  it('外部实例归创建者销毁；自建实例跨配置重渲稳定；卸载后外部视图保留', async () => {
    const { fetchMock } = scriptFetch({ generate: [genScript(S1, 'base', RUN_1)] });
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession(fetchMock);
    expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
    const runtimeBefore = session.runtime;
    const viewBefore = session.runtime.getSurfaceView(S1);

    const mapA = { ...react.standardRenderMap };
    const mapB = { ...react.standardRenderMap };
    const view = render(
      createElement(
        react.A2UIProvider,
        { runtime: session.runtime, renderMap: mapA },
        createElement(JointHost, { session, surfaceIds: [S1] }),
      ),
    );
    expect(session.runtime).to.equal(runtimeBefore);
    // 父重渲 + renderMap 变更：runtime 与已提交视图引用不重置。
    view.rerender(
      createElement(
        react.A2UIProvider,
        { runtime: session.runtime, renderMap: mapB },
        createElement(JointHost, { session, surfaceIds: [S1] }),
      ),
    );
    expect(session.runtime).to.equal(runtimeBefore, '配置重渲不重置外部 runtime');
    expect(session.runtime.getSurfaceView(S1)).to.equal(viewBefore);
    expect(screen.getByRole('button', { name: '提交' })).to.exist;

    // 卸载：外部实例归创建者，React 不触碰；dispose 后才释放。
    view.unmount();
    expect(session.runtime.getSurfaceView(S1)).to.equal(viewBefore, '卸载不销毁外部实例');

    // 自建实例：跨重渲稳定（useA2UI 探针）。
    const seen: core.A2UIRuntime[] = [];
    const registry = new core.CatalogRegistry([jointCatalog()]);
    function SelfHost(props: { map: react.RenderMap }): ReactNode {
      return createElement(
        react.A2UIProvider,
        { renderMap: props.map, runtimeOptions: { catalogRegistry: registry } },
        createElement(RuntimeProbe, { seen }),
      );
    }
    const self = render(createElement(SelfHost, { map: mapA }));
    self.rerender(createElement(SelfHost, { map: mapB }));
    self.rerender(createElement(SelfHost, { map: mapA }));
    expect(seen.length).to.be.at.least(3);
    expect(new Set(seen).size).to.equal(1, '自建 runtime 只创建一次，配置重渲不重建');

    session.dispose();
    expect(session.runtime.getSurfaceView(S1), 'dispose 后创建者释放视图').to.equal(undefined);
  });

  it('实际 fetch/SSE 在途卸载并 dispose：abort、reader cancel 与运行结束', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancelLog = { canceled: false };
    const { fetchMock, calls } = scriptFetch({
      generate: [genScript(S1, 'base', RUN_1)],
      event: [
        {
          frames: [{ event: 'start', data: startData(RUN_2, S1) }],
          hangBeforeClose: gate,
          cancelLog,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession(fetchMock);
    const actionSpy = vi.spyOn(session, 'action');
    const view = mountJoint(session, [S1]);
    expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交' })).to.exist;
    });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(1);
    });

    try {
      view.unmount();
      session.dispose();
      expect(calls.find((call) => call.url.endsWith('/event'))!.signal?.aborted).to.equal(true);
      expect(
        (await (actionSpy.mock.results[0].value as Promise<client.RunResult>)).status,
      ).to.equal('desync');
      expect(cancelLog.canceled, '在途响应体已实际释放').to.equal(true);
      expect(session.surfaces()).to.deep.equal([]);
      expect(session.runtime.getSurfaceView(S1)).to.equal(undefined);
      expect(document.querySelector('[data-surface-id]'), '卸载后无 surface DOM').to.equal(null);
      expect(calls.filter((call) => call.url.endsWith('/event'))).to.have.length(1);
    } finally {
      release();
      session.dispose();
    }
  });

  for (const late of ['message', 'done'] as const) {
    it(`卸载销毁后实际交付晚到 ${late}：候选、外部视图与草稿不被改写`, async () => {
      const entered = barrier(),
        release = barrier();
      const runtime = new core.A2UIRuntime({
        catalogRegistry: new core.CatalogRegistry([jointCatalog()]),
        onAction: (event) => {
          void session.action(event);
        },
      });
      let candidate: core.A2UIRuntime | undefined;
      const createCandidate = runtime.createViewRuntime.bind(runtime);
      vi.spyOn(runtime, 'createViewRuntime').mockImplementation(() => {
        candidate = createCandidate();
        return candidate;
      });
      const { fetchMock } = scriptFetch({ generate: [genScript(S1, 'base', RUN_1)] });
      const base = client.fetchSseTransport({ fetch: fetchMock as typeof fetch });
      let signal: AbortSignal | undefined,
        closed = 0;
      const delivered: string[] = [];
      const session = client.createClientSession({
        runtime,
        catalogHashes: new Map([[CATALOG_ID, HASH]]),
        endpoints: { generate: '/api/a2ui/generate', event: '/api/a2ui/event' },
        transport: {
          async open(request) {
            if (request.url.endsWith('/generate')) return base.open(request);
            signal = request.signal;
            return {
              runIdHeader: RUN_2,
              close() {
                closed++;
              },
              frames: (async function* () {
                yield {
                  event: 'start',
                  data: JSON.stringify({ ...startData(RUN_2, S1), surfaceRevision: 1 }),
                };
                yield {
                  event: 'message',
                  data: JSON.stringify({
                    version: 'v0.9',
                    updateDataModel: { surfaceId: S1, path: '/candidate', value: true },
                  }),
                };
                entered.resolve(); // 上一条候选 patch 已消费，下一次 next 确实挂起。
                await release.promise;
                delivered.push(late);
                yield late === 'message'
                  ? {
                      event: 'message',
                      data: JSON.stringify({
                        version: 'v0.9',
                        updateDataModel: { surfaceId: S1, path: '/late', value: true },
                      }),
                    }
                  : { event: 'done', data: JSON.stringify(doneData(RUN_2, S1, 2)) };
              })(),
            };
          },
        },
      });
      sessions.add(session);
      const actionSpy = vi.spyOn(session, 'action');
      const host = mountJoint(session, [S1]);
      // 独立挂载的消费者在第一个宿主卸载后继续观察同一外部 runtime。
      const observer = render(
        createElement(
          react.A2UIProvider,
          { runtime },
          createElement(react.A2UISurface, { surfaceId: S1, actionsEnabled: false }),
        ),
      );
      try {
        expect((await session.generate({ catalogId: CATALOG_ID })).status).to.equal('committed');
        await waitFor(() => expect(surfaceButton(S1)).to.exist);
        const field = document.querySelector(
          '[data-host-surface="joint-1"] [data-surface-id] input',
        )!;
        fireEvent.change(field, { target: { value: 'keep-draft' } });
        fireEvent.click(surfaceButton(S1));
        const pending = actionSpy.mock.results[0].value as Promise<client.RunResult>;
        await act(async () => {
          await entered.promise;
        });
        const candidateBefore = candidate!.getSurfaceView(S1)!;
        expect(core.getByPath(candidateBefore.dataModel, '/candidate')).to.equal(true);
        const viewBefore = runtime.getSurfaceView(S1),
          draftsBefore = runtime.extractLatestInputDrafts(S1);
        const fixed = session.getCommittedSurface(S1)!;
        expect(fixed.commit.surfaceRevision).to.equal(1);
        let notifications = 0;
        const off = runtime.subscribeSurfaceRender(S1, () => {
          notifications++;
        });
        host.unmount();
        session.dispose();
        expect(signal?.aborted).to.equal(true);
        expect(delivered).to.deep.equal([]);
        await act(async () => {
          release.resolve();
          expect((await pending).status).to.equal('desync');
        });
        expect(delivered).to.deep.equal([late], '晚到帧确实交付给消费者');
        expect(candidate!.getSurfaceView(S1)).to.equal(candidateBefore, '失效帧不得先写候选');
        expect(runtime.getSurfaceView(S1)).to.equal(viewBefore);
        expect(runtime.extractLatestInputDrafts(S1)).to.deep.equal(draftsBefore);
        expect((observer.container.querySelector('input') as HTMLInputElement).value).to.equal(
          'keep-draft',
        );
        expect(notifications).to.equal(0);
        expect(fixed.commit.surfaceRevision).to.equal(1);
        expect(session.getCommittedSurface(S1)).to.equal(undefined);
        expect(session.surfaces()).to.deep.equal([]);
        expect(closed).to.equal(1);
        session.dispose();
        expect(closed).to.equal(1);
        off();
      } finally {
        release.resolve();
        session.dispose();
      }
    });
  }

  it('样式显式选择：import 包无自动注入，injectNexusStyle 幂等', () => {
    expect(document.getElementById('nexus-react-style'), 'import 不注入样式').to.equal(null);
    react.injectNexusStyle();
    expect(document.getElementById('nexus-react-style')).to.exist;
    react.injectNexusStyle();
    expect(document.querySelectorAll('#nexus-react-style')).to.have.length(1);
  });
});

function RuntimeProbe(props: { seen: core.A2UIRuntime[] }): null {
  props.seen.push(react.useA2UI());
  return null;
}
