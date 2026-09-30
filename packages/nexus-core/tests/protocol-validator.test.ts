import { expect } from 'chai';
import { validateNexusProfileMessage, validateProtocolMessage } from '../src/protocol/validator';
import { A2UIRuntime } from '../src/runtime';
import type { A2UIError } from '../src/protocol/types';

const protocolError = (value: unknown) => validateProtocolMessage(value).error;
const profileError = (value: unknown) => validateNexusProfileMessage(value);

describe('A2UI protocol / profile boundary', () => {
  it('accepts official structures that the current Nexus profile does not support', () => {
    const messages: unknown[] = [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'd',
          catalogId: 'basic',
          sendDataModel: true,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'd',
          components: [
            {
              id: 'root',
              component: 'List',
              children: { componentId: 'item', path: '/items' },
            },
          ],
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'd',
          components: [
            {
              id: 'open',
              component: 'Button',
              action: { functionCall: { call: 'openUrl' } },
            },
          ],
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'd',
          components: [
            {
              id: 'now',
              component: 'Text',
              text: {
                call: 'formatDate',
                args: { value: '2026-01-01' },
                returnType: 'string',
              },
            },
          ],
        },
      },
    ];

    for (const message of messages) {
      expect(validateProtocolMessage(message).ok).to.equal(true);
      expect(profileError(message)?.code).to.equal('FEATURE_UNSUPPORTED');
    }
  });

  it('reports protocol errors with PROTOCOL_INVALID', () => {
    expect(protocolError({ version: 'v0.8' })?.code).to.equal('PROTOCOL_INVALID');
    expect(
      protocolError({
        version: 'v0.9',
        createSurface: { surfaceId: 'd', catalogId: 'basic' },
        deleteSurface: { surfaceId: 'd' },
      })?.code,
    ).to.equal('PROTOCOL_INVALID');
    expect(
      protocolError({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'd',
          components: [
            {
              id: 'root',
              component: 'Button',
              action: { event: { name: 'submit', context: { value: null } } },
            },
          ],
        },
      })?.code,
    ).to.equal('PROTOCOL_INVALID');
  });

  it('keeps protocol, profile, and lifecycle diagnostics separate at runtime', () => {
    const errors: A2UIError[] = [];
    const runtime = new A2UIRuntime({ onError: (error) => errors.push(error) });

    runtime.push(
      '{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic","sendDataModel":true}}\n',
    );
    runtime.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column"}]}}\n',
    );

    expect(errors.map((error) => error.code)).to.deep.equal([
      'FEATURE_UNSUPPORTED',
      'LIFECYCLE_INVALID',
    ]);
    expect(runtime.store.getState().surfaces.d).to.equal(undefined);
  });
  it('checks 正则：嵌套量词与超长 pattern 被拒', () => {
    const base = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [
          {
            id: 'root',
            component: 'Column',
            children: [],
          },
        ],
      },
    } as const;
    const withButtonChecks = (pattern: string) => ({
      ...base,
      updateComponents: {
        ...base.updateComponents,
        components: [
          ...base.updateComponents.components,
          {
            id: 'btn',
            component: 'Button',
            child: 'root',
            action: { event: { name: 'submit' } },
            checks: [
              {
                condition: {
                  call: 'regex',
                  args: { value: { path: '/v' }, pattern },
                  returnType: 'boolean',
                },
                message: 'must match',
              },
            ],
          },
        ],
      },
    });

    const catastrophic = validateNexusProfileMessage(withButtonChecks('(a+)+$') as never);
    expect(catastrophic?.message).to.include('嵌套量词');

    const tooLong = validateNexusProfileMessage(withButtonChecks(`a{${'1'.repeat(250)}}`) as never);
    expect(tooLong?.message).to.include('长度不得超过');
  });

  it('TextField.validationRegexp：嵌套量词被拒', () => {
    const message = validateNexusProfileMessage({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [
          {
            id: 'tf',
            component: 'TextField',
            label: 'L',
            value: { path: '/v' },
            validationRegexp: '^(a+)+$',
          },
        ],
      },
    } as never);
    expect(message?.message).to.include('嵌套量词');
  });

  it('L0-07：结构合法的保留字 ID 通过协议层、在 Profile 层被明确拒绝', () => {
    const messages = [
      { version: 'v0.9', createSurface: { surfaceId: '__proto__', catalogId: 'c' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: '__proto__', component: 'Text', text: 'x' }],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: '__proto__', value: { a: 1 } } },
      { version: 'v0.9', deleteSurface: { surfaceId: '__proto__' } },
    ];
    for (const message of messages) {
      // 官方协议结构不禁止保留字 ID → 协议层放行
      const protocol = validateProtocolMessage(message as never);
      expect(protocol.ok, JSON.stringify(message)).to.equal(true);
      // Nexus Runtime Profile 拒绝（安全限制在 Profile 边界，非官方协议契约）
      const rejection = validateNexusProfileMessage((protocol as { message: unknown }).message);
      expect(rejection?.code).to.equal('FEATURE_UNSUPPORTED');
      expect(rejection?.message).to.include('__proto__');
    }
  });

});
