import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { readJsonBody } from '../src/api/request';

function createRequest(
  chunks: readonly string[] = [],
  headers: Record<string, string> = { 'content-type': 'application/json' },
): IncomingMessage {
  const stream = Readable.from(chunks.map((chunk) => Buffer.from(chunk, 'utf8')));
  return Object.assign(stream, { headers }) as IncomingMessage;
}

describe('readJsonBody deployment limits', () => {
  it('accepts an empty JSON body', async () => {
    assert.deepEqual(await readJsonBody(createRequest()), {});
  });

  it('requires a JSON content type', async () => {
    await assert.rejects(
      readJsonBody(createRequest(['{}'], { 'content-type': 'text/plain' })),
      /Content-Type/,
    );
  });

  it('rejects an oversized Content-Length before reading the body', async () => {
    let readStarted = false;
    const stream = new Readable({
      read() {
        readStarted = true;
        this.push('{}');
        this.push(null);
      },
    });
    const request = Object.assign(stream, {
      headers: { 'content-type': 'application/json', 'content-length': '1024' },
    }) as IncomingMessage;

    await assert.rejects(readJsonBody(request, { maxBodySize: 16 }), /请求体超过 16 字节限制/);
    assert.equal(readStarted, false);
  });

  it('rejects when streamed body bytes exceed the configured limit', async () => {
    await assert.rejects(
      readJsonBody(createRequest(['0123456789', '0123456789']), { maxBodySize: 16 }),
      /请求体超过 16 字节限制/,
    );
  });

  it('rejects a request body that does not finish before the timeout', async () => {
    const stream = new Readable({ read() {} });
    const request = Object.assign(stream, {
      headers: { 'content-type': 'application/json' },
    }) as IncomingMessage;

    await assert.rejects(readJsonBody(request, { timeoutMs: 10 }), /请求体超过 10ms 未完成/);
  });

  it('rejects invalid limit configuration', async () => {
    await assert.rejects(readJsonBody(createRequest(['{}']), { maxBodySize: 0 }), /maxBodySize/);
    await assert.rejects(readJsonBody(createRequest(['{}']), { timeoutMs: 0 }), /timeoutMs/);
  });
});
