import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { createSessionStreamCheck, parseSessionEvent } from '../../src/session';
import { getCatalogContractHashInput, type CatalogDefinition } from '../../src/catalog';

interface Oracle {
  id: string;
  source: { messages: Record<string, unknown>[] };
  expected: {
    events: {
      event: string;
      count?: number;
      surfaceRevision?: number | null;
      code?: string;
      commitState?: string;
    }[];
  };
}

const root = new URL('../../../../fixtures/session-v1/', import.meta.url);
const catalog: CatalogDefinition = JSON.parse(
  readFileSync(new URL('catalog.json', root), 'utf8'),
).catalog;
const catalogHash = `sha256:${createHash('sha256').update(getCatalogContractHashInput(catalog)).digest('hex')}`;

describe('Session v1 shared fixture wire oracles', () => {
  for (const name of [
    'accept-generation',
    'accept-action-with-inputs',
    'reject-admission-stale-revision',
    'unknown-store-commit-throw',
  ]) {
    it(name, () => {
      const oracle: Oracle = JSON.parse(readFileSync(new URL(`${name}.json`, root), 'utf8'));
      const candidate = oracle.source.messages[0];
      const surfaceId = (candidate.createSurface ?? candidate.updateDataModel) as {
        surfaceId: string;
      };
      const identity = {
        sessionVersion: 1,
        runId: oracle.id,
        surfaceId: surfaceId.surfaceId,
        catalogId: catalog.catalogId,
        contractVersion: 2,
        catalogHash,
      };
      const check = createSessionStreamCheck();
      // core 验证 oracle 声明的 wire 形状/顺序；server 以同文件校验实际运行与计数。
      for (const expected of oracle.expected.events) {
        const count = expected.event === 'message' ? expected.count! : 1;
        for (let index = 0; index < count; index++) {
          const data =
            expected.event === 'message'
              ? oracle.source.messages[index % oracle.source.messages.length]
              : expected.event === 'error'
                ? {
                    sessionVersion: 1,
                    runId: identity.runId,
                    surfaceId: identity.surfaceId,
                    code: expected.code,
                    commitState: expected.commitState,
                  }
                : {
                    ...identity,
                    ...(expected.event === 'start' ? { type: 'start' } : {}),
                    ...(expected.surfaceRevision === null
                      ? {}
                      : { surfaceRevision: expected.surfaceRevision }),
                  };
          const parsed = parseSessionEvent(expected.event, JSON.parse(JSON.stringify(data)));
          assert.ok(parsed.ok, `${name}: ${expected.event} must parse`);
          assert.equal(check.push(parsed.event), null);
        }
      }
      assert.equal(check.end(), null);
    });
  }
});
