import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createContactFixture, createActionResponse } from '../src/agent/mock-agent';
import { BASIC_CATALOG, NEXUS_BASIC_TASK_CATALOG } from '../src/agent/catalog';

describe('playground mock fixtures', () => {
  it('联系人卡片 fixture 携带 Nexus Basic Task Profile 身份', () => {
    const messages = createContactFixture('contact') as Array<{
      createSurface?: { surfaceId: string; catalogId: string };
    }>;
    assert.equal(messages[0]?.createSurface?.surfaceId, 'contact');
    assert.equal(messages[0]?.createSurface?.catalogId, NEXUS_BASIC_TASK_CATALOG);
    assert.equal(BASIC_CATALOG, NEXUS_BASIC_TASK_CATALOG);
  });

  it('createActionResponse 返回同 surface 的 dataModel 与 components 更新', () => {
    type UpdateMessage = {
      updateDataModel?: { surfaceId: string };
      updateComponents?: { surfaceId: string };
    };
    const messages = createActionResponse('contact') as UpdateMessage[];
    assert.equal(messages[0]?.updateDataModel?.surfaceId, 'contact');
    assert.equal(messages[1]?.updateComponents?.surfaceId, 'contact');
  });
});
