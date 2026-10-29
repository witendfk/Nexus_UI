import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NEXUS_RUN_ID_HEADER } from '@nexus-ui/core';
import * as publicApi from '../src/index';
import type {
  ClientSession,
  ClientSessionOptions,
  RunResult,
  RecoverInput,
  SessionTransport,
  SseTransportOptions,
  SurfaceStatus,
  TransportResponse,
} from '../src/index';

describe('client 公开入口契约', () => {
  it('exports only the documented root-entry contract', () => {
    assert.deepEqual(Object.keys(publicApi).sort(), [
      'NEXUS_RUN_ID_HEADER',
      'createClientSession',
      'fetchSseTransport',
    ]);
  });

  it('type-only 导出在 typecheck 时锚定（契约面）', () => {
    const probes: Array<unknown> = [
      null as ClientSession | null,
      null as ClientSessionOptions | null,
      null as RunResult | null,
      null as RecoverInput | null,
      null as SessionTransport | null,
      null as SseTransportOptions | null,
      null as SurfaceStatus | null,
      null as TransportResponse | null,
    ];
    assert.ok(probes.length === 8);
  });

  it('运行标识头与 core/server 同源（单一常量定义）', () => {
    assert.equal(publicApi.NEXUS_RUN_ID_HEADER, 'X-Nexus-Run-Id');
    assert.equal(publicApi.NEXUS_RUN_ID_HEADER, NEXUS_RUN_ID_HEADER);
  });

  it('缺 endpoints 在工厂入口抛错', () => {
    assert.throws(
      // @ts-expect-error 故意缺 endpoints
      () => publicApi.createClientSession({ runtime: new (class {})() as never }),
      /endpoints/,
    );
  });
});
