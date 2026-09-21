import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseClientActionMessage } from '../src/api/client-event';
import { createActionResponse } from '../src/agent/mock-agent';

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

  it('拒绝缺失 timestamp、多余字段或非法 context', () => {
    const missingTimestamp = structuredClone(validMessage);
    delete (missingTimestamp.action as Record<string, unknown>).timestamp;
    assert.equal(parseClientActionMessage(missingTimestamp), null);

    const extraField = { ...validMessage, extra: true };
    assert.equal(parseClientActionMessage(extraField), null);
  });
});

describe('createActionResponse', () => {
  it('返回同 surface 的 dataModel 与 components 更新', () => {
    type UpdateMessage = {
      updateDataModel?: { surfaceId: string };
      updateComponents?: { surfaceId: string };
    };
    const messages = createActionResponse('contact') as UpdateMessage[];
    assert.equal(messages[0]?.updateDataModel?.surfaceId, 'contact');
    assert.equal(messages[1]?.updateComponents?.surfaceId, 'contact');
  });
});
