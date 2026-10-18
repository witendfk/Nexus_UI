import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { CatalogRegistry } from '@nexus-ui/core';
import fixture from '../../../../fixtures/checks-boundary.json';
import { sendMessages } from '../../src/api/send-messages';

function context(): { ctx: Koa.Context; output: () => string } {
  let output = '';
  const res = new PassThrough();
  res.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  return { ctx: { res, set: () => undefined } as unknown as Koa.Context, output: () => output };
}

const rootMessage = {
  version: 'v0.9',
  updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Card' }] },
};

describe('server 流式入口复用 checks 准入（共享 fixture）', () => {
  for (const props of fixture.components) {
    for (const enabled of [true, false, undefined]) {
      it(`${props.component}: enabled=${enabled}`, async () => {
        const registry = new CatalogRegistry([
          {
            catalogId: 'host',
            components: {
              [props.component]: {
                schema: { type: 'object' },
                ...(enabled === undefined ? {} : { checks: { enabled, functions: ['required'] } }),
              },
            },
            actions: [],
          },
        ]);
        const { ctx, output } = context();
        let commits = 0;
        const result = await sendMessages(
          ctx,
          [
            { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'host' } },
            {
              version: 'v0.9',
              updateComponents: {
                surfaceId: 's',
                components: [{ ...props, id: 'root', checks: fixture.checks }],
              },
            },
          ],
          'checks',
          { kind: 'generate', surfaceId: 's', catalogId: 'host', registry, supportedActions: [] },
          () => {
            commits++;
          },
          { streamDelayMs: 0 },
        );
        assert.equal(result.ok, enabled === true);
        assert.equal(commits, enabled ? 1 : 0);
        assert.equal(result.messages.length, enabled ? 2 : 1);
        if (enabled) assert.match(output(), /event: done/);
        else {
          assert.match(output(), /CATALOG_UNSUPPORTED/);
          assert.doesNotMatch(output(), /event: done/);
        }
      });
    }
  }

  for (const [index, message] of fixture.rejectedMessages.entries()) {
    it(`非组件 checks 的 FunctionCall #${index + 1} 不提交`, async () => {
      const registry = new CatalogRegistry([
        {
          catalogId: 'host',
          components: {
            Card: {
              schema: { type: 'object' },
              checks: { enabled: true, functions: ['required'] },
            },
          },
          actions: [],
        },
      ]);
      const { ctx, output } = context();
      let commits = 0;
      const source =
        'createSurface' in message
          ? [message, rootMessage]
          : [
              { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'host' } },
              rootMessage,
              message,
            ];
      const result = await sendMessages(
        ctx,
        source,
        'checks',
        {
          kind: 'generate',
          surfaceId: 's',
          catalogId: 'host',
          registry,
          supportedActions: [],
        },
        () => {
          commits++;
        },
        { streamDelayMs: 0 },
      );
      assert.equal(result.ok, false);
      assert.equal(commits, 0);
      assert.equal(result.messages.length, 'createSurface' in message ? 0 : 2);
      assert.match(output(), /FEATURE_UNSUPPORTED/);
      assert.match(output(), /FunctionCall/);
      assert.doesNotMatch(output(), /event: done/);
    });
  }

  it('普通数据的 checks 键保持可用，合法基线可提交', async () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'host',
        components: { Card: { schema: { type: 'object' } } },
        actions: [],
      },
    ]);
    const { ctx, output } = context();
    let commits = 0;
    const result = await sendMessages(
      ctx,
      [
        { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'host' } },
        rootMessage,
        fixture.ordinaryDataMessage,
      ],
      'checks',
      { kind: 'generate', surfaceId: 's', catalogId: 'host', registry, supportedActions: [] },
      () => {
        commits++;
      },
      { streamDelayMs: 0 },
    );
    assert.equal(result.ok, true);
    assert.equal(commits, 1);
    assert.equal(result.messages.length, 3);
    assert.match(output(), /event: done/);
  });
});
