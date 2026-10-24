import { describe, it } from 'mocha';
import { strict as assert } from 'node:assert';
import { CATALOG_CONTRACT_VERSION } from '../../src/catalog';
import {
  NEXUS_SESSION_DIAGNOSTIC_LIMIT,
  NEXUS_SESSION_VERSION,
  createSessionStreamCheck,
  parseSessionEvent,
} from '../../src/session';
import type {
  NexusSessionErrorEvent,
  NexusSessionErrorCode,
  NexusSessionStartEvent,
} from '../../src/session';

const HASH = `sha256:${'a'.repeat(64)}`;

const COMMIT = {
  sessionVersion: NEXUS_SESSION_VERSION,
  runId: 'run-1',
  surfaceId: 'surface-1',
  catalogId: 'catalog-1',
  contractVersion: CATALOG_CONTRACT_VERSION,
  catalogHash: HASH,
  surfaceRevision: 1,
} as const;

const VALID_START = {
  type: 'start',
  sessionVersion: NEXUS_SESSION_VERSION,
  runId: 'run-1',
  surfaceId: 'surface-1',
  catalogId: 'catalog-1',
  contractVersion: CATALOG_CONTRACT_VERSION,
  catalogHash: HASH,
} as const;

const VALID_ERROR = {
  type: 'error',
  sessionVersion: NEXUS_SESSION_VERSION,
  runId: 'run-1',
  surfaceId: 'surface-1',
  code: 'RUN_FAILED',
  commitState: 'notCommitted',
} as const;

const VALID_MESSAGE = {
  version: 'v0.9',
  deleteSurface: { surfaceId: 'surface-1' },
} as const;

const startEvent: NexusSessionStartEvent = { ...VALID_START };
const messageEvent = { type: 'message' as const, message: VALID_MESSAGE };
const errorEvent = (code: NexusSessionErrorCode): NexusSessionErrorEvent => ({
  ...VALID_ERROR,
  code,
});
const doneEvent = { type: 'done' as const, commit: COMMIT };

function assertRejected(name: string, data: unknown, fragment?: string): void {
  const result = parseSessionEvent(name, data);
  assert.equal(result.ok, false, `${name} 应被拒绝: ${JSON.stringify(data)}`);
  if (!result.ok && fragment !== undefined) {
    assert.match(result.error.message, new RegExp(fragment));
  }
}

describe('session start event parsing', () => {
  it('accepts generation start without baseline and action start with revision', () => {
    const result = parseSessionEvent('start', VALID_START);
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual(JSON.parse(JSON.stringify(result.event)), {
        ...VALID_START,
        sessionVersion: 1,
      });
    }
    const actionStart = parseSessionEvent('start', { ...VALID_START, surfaceRevision: 3 });
    assert.ok(actionStart.ok);
    if (actionStart.ok && actionStart.event.type === 'start') {
      assert.equal(actionStart.event.surfaceRevision, 3);
    }
  });

  it('rejects unknown session version, bad identity fields and malformed hash/revision', () => {
    assertRejected('start', { ...VALID_START, sessionVersion: 2 }, '不支持的 Nexus Session 版本');
    assertRejected('start', { ...VALID_START, sessionVersion: '1' }, '不支持的 Nexus Session 版本');
    assertRejected('start', { ...VALID_START, runId: '' }, 'runId');
    assertRejected('start', { ...VALID_START, surfaceId: undefined }, 'runId');
    assertRejected('start', { ...VALID_START, contractVersion: 1 }, 'contractVersion');
    assertRejected('start', { ...VALID_START, catalogHash: 'sha256:xyz' }, 'catalogHash');
    assertRejected('start', { ...VALID_START, surfaceRevision: 0 }, 'surfaceRevision');
    assertRejected('start', { ...VALID_START, surfaceRevision: -1 }, 'surfaceRevision');
    assertRejected('start', { ...VALID_START, type: 'error' }, 'type');
    assertRejected('start', null);
  });

  it('round-trips through JSON stably', () => {
    for (const data of [VALID_START, { ...VALID_START, surfaceRevision: 7 }]) {
      const first = parseSessionEvent('start', data);
      assert.ok(first.ok);
      if (!first.ok) return;
      const second = parseSessionEvent('start', JSON.parse(JSON.stringify(first.event)));
      assert.ok(second.ok);
      assert.deepEqual(second.ok ? second.event : null, first.event);
    }
  });
});

describe('session error event parsing', () => {
  it('accepts the locked shape with optional message/diagnostics/actionId', () => {
    const result = parseSessionEvent('error', {
      ...VALID_ERROR,
      message: 'x'.repeat(NEXUS_SESSION_DIAGNOSTIC_LIMIT + 50),
      actionId: 'action-1',
      diagnostics: [
        { code: 'POLICY_REJECTED', message: 'final policy rejected', path: 'root.text' },
        { code: 'CATALOG_UNSUPPORTED', message: 'missing declaration', dataPath: '/score' },
      ],
    });
    assert.ok(result.ok);
    if (result.ok && result.event.type === 'error') {
      assert.equal(result.event.code, 'RUN_FAILED');
      assert.equal(result.event.actionId, 'action-1');
      assert.equal(result.event.message?.length, NEXUS_SESSION_DIAGNOSTIC_LIMIT);
      assert.equal(result.event.diagnostics?.length, 2);
      assert.equal(result.event.diagnostics?.[0]?.path, 'root.text');
      assert.equal(result.event.diagnostics?.[1]?.dataPath, '/score');
    }
  });

  it('rejects unknown codes, committed state and malformed diagnostics', () => {
    assertRejected('error', { ...VALID_ERROR, code: 'MYSTERY' }, '未知的 Session 错误码');
    assertRejected('error', { ...VALID_ERROR, commitState: 'committed' }, 'commitState');
    assertRejected('error', { ...VALID_ERROR, runId: '' }, 'runId');
    assertRejected('error', { ...VALID_ERROR, sessionVersion: 3 }, '不支持的 Nexus Session 版本');
    assertRejected('error', { ...VALID_ERROR, diagnostics: 'nope' }, 'diagnostics');
    assertRejected('error', { ...VALID_ERROR, diagnostics: [{ code: 'X' }] }, 'code 与 message');
    assertRejected('error', { ...VALID_ERROR, actionId: '' }, 'actionId');
  });

  it('rejects the legacy transitional shape (no session identity on the wire)', () => {
    // S2 过渡形状（code AGENT_STREAM_ERROR + runCode 附加字段、无 sessionVersion/
    // runId/surfaceId）不再可解析：身份字段是 error 事件必需项。
    assertRejected('error', {
      code: 'AGENT_STREAM_ERROR',
      runCode: 'RUN_FAILED',
      commitState: 'notCommitted',
      message: 'legacy',
    });
  });
});

describe('session message and done parsing', () => {
  it('message data must be a valid raw A2UI envelope', () => {
    const result = parseSessionEvent('message', VALID_MESSAGE);
    assert.ok(result.ok);
    assertRejected('message', { version: 'v0.9', bogusPayload: {} });
    assertRejected('message', 'text');
  });

  it('done data must carry a usable NexusSurfaceCommit', () => {
    const result = parseSessionEvent('done', { ...COMMIT });
    assert.ok(result.ok);
    assertRejected('done', { surfaceRevision: 1 });
  });

  it('rejects unknown event names', () => {
    assertRejected('ping', {});
    assertRejected('', {});
  });
});

describe('session stream sequence check', () => {
  it('accepts an explicit beforeStart failure but rejects it after start or with unknown commit', () => {
    const parsed = parseSessionEvent('error', { ...VALID_ERROR, beforeStart: true });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal('beforeStart' in parsed.event && parsed.event.beforeStart, true);
    const check = createSessionStreamCheck();
    assert.equal(check.push(parsed.event), null);
    assert.equal(check.end(), null);
    const started = createSessionStreamCheck();
    started.push(startEvent);
    assert.notEqual(started.push(parsed.event), null);
    assertRejected('error', { ...VALID_ERROR, beforeStart: true, commitState: 'unknown' });
    assertRejected('error', { ...VALID_ERROR, beforeStart: true, code: 'RUN_COMMIT_UNKNOWN' });
    assertRejected('error', { ...VALID_ERROR, beforeStart: false });
  });

  for (const field of ['runId', 'surfaceId', 'catalogId', 'catalogHash'] as const) {
    it(`rejects a done with a different ${field}`, () => {
      const check = createSessionStreamCheck();
      check.push(startEvent);
      const parsed = parseSessionEvent('done', {
        ...COMMIT,
        [field]: field === 'catalogHash' ? `sha256:${'b'.repeat(64)}` : 'other',
      });
      assert.ok(parsed.ok);
      if (parsed.ok) assert.notEqual(check.push(parsed.event), null);
    });
  }

  it('rejects another surface message, another catalog create, and another run error', () => {
    for (const [name, data] of [
      ['message', { version: 'v0.9', deleteSurface: { surfaceId: 'other' } }],
      [
        'message',
        { version: 'v0.9', createSurface: { surfaceId: 'surface-1', catalogId: 'other' } },
      ],
      ['error', { ...VALID_ERROR, runId: 'other' }],
      ['error', { ...VALID_ERROR, surfaceId: 'other' }],
    ] as const) {
      const check = createSessionStreamCheck();
      check.push(startEvent);
      const parsed = parseSessionEvent(name, data);
      assert.ok(parsed.ok);
      if (parsed.ok) assert.notEqual(check.push(parsed.event), null);
    }
  });

  it('requires action done revision to advance and snapshots start identity', () => {
    for (const revision of [9, 10, 11]) {
      const start = { ...startEvent, surfaceRevision: 10 };
      const check = createSessionStreamCheck();
      check.push(start);
      start.runId = 'mutated-after-push';
      const result = check.push({ type: 'done', commit: { ...COMMIT, surfaceRevision: revision } });
      if (revision > 10) assert.equal(result, null);
      else assert.notEqual(result, null);
    }
  });

  it('accepts normal generation and admission-failure streams', () => {
    const generation = createSessionStreamCheck();
    assert.equal(generation.push(startEvent), null);
    assert.equal(generation.push(messageEvent), null);
    assert.equal(generation.push(doneEvent), null);
    assert.equal(generation.end(), null);
    assert.equal(generation.terminalSeen(), true);

    const admission = createSessionStreamCheck();
    assert.equal(admission.push(startEvent), null);
    assert.equal(admission.push(errorEvent('RUN_ADMISSION_REJECTED')), null);
    assert.equal(admission.end(), null);
  });

  it('accepts the queued-cancel exception: a lone cancelled error is a complete stream', () => {
    const check = createSessionStreamCheck();
    assert.equal(check.push(errorEvent('RUN_CANCELLED')), null);
    assert.equal(check.end(), null);
    assert.equal(check.terminalSeen(), true);
  });

  it('accepts cancel after start and empty action streams', () => {
    const cancelAfterStart = createSessionStreamCheck();
    cancelAfterStart.push(startEvent);
    assert.equal(cancelAfterStart.push(errorEvent('RUN_CANCELLED')), null);
    assert.equal(cancelAfterStart.end(), null);

    const emptyAction = createSessionStreamCheck();
    emptyAction.push(startEvent);
    assert.equal(emptyAction.push(doneEvent), null);
    assert.equal(emptyAction.end(), null);
  });

  it('rejects duplicate terminal and post-terminal events', () => {
    const duplicate = createSessionStreamCheck();
    duplicate.push(startEvent);
    duplicate.push(errorEvent('RUN_FAILED'));
    assert.equal(duplicate.push(errorEvent('RUN_CANCELLED')), '终态之后不得再有任何事件');
    assert.equal(duplicate.push(messageEvent), '终态之后不得再有任何事件');
    assert.equal(duplicate.push(doneEvent), '终态之后不得再有任何事件');
  });

  it('rejects start-less terminals outside the cancel exception', () => {
    const startLess = createSessionStreamCheck();
    assert.equal(
      startLess.push(doneEvent),
      '终态前必须有 start（准备失败须 beforeStart:true，排队取消例外）',
    );
    const failedStartLess = createSessionStreamCheck();
    assert.equal(
      failedStartLess.push(errorEvent('RUN_FAILED')),
      '终态前必须有 start（准备失败须 beforeStart:true，排队取消例外）',
    );
  });

  it('rejects missing terminal at EOF and a second start', () => {
    const incomplete = createSessionStreamCheck();
    incomplete.push(startEvent);
    assert.match(incomplete.end() ?? '', /EOF 前未收到终态/);

    const empty = createSessionStreamCheck();
    assert.match(empty.end() ?? '', /EOF 前未收到终态/);

    const doubleStart = createSessionStreamCheck();
    doubleStart.push(startEvent);
    assert.equal(doubleStart.push(startEvent), 'start 只能是首事件');
  });

  it('rejects message before start', () => {
    const check = createSessionStreamCheck();
    assert.equal(check.push(messageEvent), 'message 必须出现在 start 之后');
  });
});
