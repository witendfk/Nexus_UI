import { describe, expect, it } from 'vitest';
import { toClientActionMessage } from '../src/lib/client-action';

describe('toClientActionMessage', () => {
  it('补齐官方 client-to-server 信封和 timestamp', () => {
    expect(
      toClientActionMessage(
        {
          name: 'call',
          surfaceId: 'contact',
          sourceComponentId: 'callBtn',
          context: { phone: '+1 555 234 5678' },
        },
        '2026-09-14T00:00:00.000Z',
      ),
    ).to.deep.equal({
      version: 'v0.9',
      action: {
        name: 'call',
        surfaceId: 'contact',
        sourceComponentId: 'callBtn',
        timestamp: '2026-09-14T00:00:00.000Z',
        context: { phone: '+1 555 234 5678' },
      },
    });
  });
});
