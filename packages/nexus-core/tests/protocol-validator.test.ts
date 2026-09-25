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
});
