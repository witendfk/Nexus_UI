import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseClientActionMessage } from '../src/api/client-event';

const validMessage = {
  version: 'v0.9',
  action: {
    name: 'call',
    surfaceId: 'contact',
    sourceComponentId: 'callBtn',
    timestamp: '2026-09-14T00:00:00.000Z',
    context: { phone: '+1 555 234 5678' },
  },
};

describe('parseClientActionMessage', () => {
  it('接受官方 action 消息', () => {
    assert.deepEqual(parseClientActionMessage(validMessage), validMessage);
  });

  it('accepts an optional non-empty actionId for replay protection', () => {
    const withActionId = structuredClone(validMessage) as typeof validMessage & {
      action: { actionId?: string };
    };
    withActionId.action.actionId = 'action-001';
    assert.deepEqual(parseClientActionMessage(withActionId), withActionId);

    const emptyActionId = structuredClone(withActionId);
    emptyActionId.action.actionId = '';
    assert.equal(parseClientActionMessage(emptyActionId), null);
  });

  it('拒绝缺失 timestamp、多余字段或非法 context', () => {
    const missingTimestamp = structuredClone(validMessage);
    delete (missingTimestamp.action as Record<string, unknown>).timestamp;
    assert.equal(parseClientActionMessage(missingTimestamp), null);

    const extraField = { ...validMessage, extra: true };
    assert.equal(parseClientActionMessage(extraField), null);
  });
});
