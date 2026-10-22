import type Koa from 'koa';
import { PassThrough } from 'stream';
import type { A2UIErrorCode } from '@nexus-ui/core';
import { validateNexusProfileMessage, validateProtocolMessage } from '@nexus-ui/core';
import {
  createAgentStreamState,
  validateAgentStreamFinalDetailed,
  validateAgentStreamMessageDetailed,
} from '../agent/agent-guard';
import type { AgentSequenceOptions } from '../agent/agent-guard';
import type { ComponentSchemaDiagnostic } from '@nexus-ui/core';
import type { AgentRun } from '../agent/adapter';
import type { AgentRunManager } from '../agent/run-manager';
import { manageAgentRun, type ManagedAgentRun } from '../agent/run-lifecycle';
import { formatSseEvent, prepareSseResponse } from '../transport/sse';
import type { PrepareSseResponseOptions } from '../transport/sse';

export interface SendMessagesResult {
  messages: unknown[];
  ok: boolean;
}

type BeforeDone = (messages: unknown[]) => unknown | Promise<unknown>;

export interface SendMessagesOptions {
  signal?: AbortSignal;
  streamDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type AgentStreamError = Error & {
  boundaryCode?: A2UIErrorCode;
  diagnostics?: readonly ComponentSchemaDiagnostic[];
};

function createAgentStreamError(
  message: string,
  diagnostics?: readonly ComponentSchemaDiagnostic[],
  boundaryCode?: A2UIErrorCode,
) {
  const error = new Error(message) as AgentStreamError;
  if (diagnostics !== undefined) error.diagnostics = diagnostics;
  if (boundaryCode !== undefined) error.boundaryCode = boundaryCode;
  return error;
}

/**
 * Claim the HTTP response for an SSE stream, synchronously.
 *
 * Koa only hands `ctx.body` to the socket in `respond()`, which runs after the
 * middleware chain settles. Two consequences, both handled here:
 *
 * 1. The response must be claimed before the caller returns to the middleware
 *    chain. Claiming later — for example inside a per-surface queue callback —
 *    leaves `ctx.body` unset when Koa responds, so the client receives a 404
 *    while the queued run keeps streaming and committing.
 * 2. Koa's own piping must not be what starts the stream. If the host awaits
 *    `sendAgentRun`, the chain settles only after the run finishes and the whole
 *    stream would be buffered into one burst. `ctx.respond = false` takes over
 *    the response lifecycle so bytes flow from the moment of the claim, no
 *    matter when — or whether — the caller returns.
 *
 * Response headers (including the run id header when `options.runId` is given)
 * are written by `prepareSseResponse` before `flushHeaders`, so a claimed
 * response — queued runs included — carries its identity from the moment it is
 * occupied.
 */
function claimSseResponse(ctx: Koa.Context, options?: PrepareSseResponseOptions): PassThrough {
  prepareSseResponse(ctx, options);
  const stream = new PassThrough();
  const previousRespond = ctx.respond;
  try {
    ctx.body = stream;
    ctx.respond = false;
    ctx.res.flushHeaders?.();
    stream.pipe(ctx.res);
  } catch (error) {
    stream.unpipe(ctx.res);
    stream.destroy();
    ctx.body = null;
    ctx.respond = previousRespond;
    throw error;
  }
  // respond() is no longer what connects the body, so Koa's stream error
  // forwarding is gone too. Report instead of letting an 'error' event go
  // unhandled; pumpMessages always ends the stream, so the response still closes.
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') return;
    ctx.onerror?.(error);
  });
  return stream;
}

/** Write one guarded stream into an already-claimed response body. Always ends the stream. */
async function pumpMessages(
  stream: PassThrough,
  messages: Iterable<unknown> | AsyncIterable<unknown>,
  idPrefix: string,
  sequence: AgentSequenceOptions,
  beforeDone: BeforeDone,
  options: SendMessagesOptions,
): Promise<SendMessagesResult> {
  const sent: unknown[] = [];
  if (options.signal?.aborted) {
    stream.end();
    return { messages: [], ok: false };
  }

  const streamDelayMs = options.streamDelayMs ?? 200;
  try {
    let index = 0;
    let hasRoot = sequence.kind === 'action';
    const streamState = createAgentStreamState(sequence);
    for await (const candidate of messages) {
      if (options.signal?.aborted) throw new Error('客户端断开，Agent 流已取消');
      const protocolResult = validateProtocolMessage(candidate);
      if (!protocolResult.ok || !protocolResult.message) {
        throw createAgentStreamError(
          protocolResult.error?.message ?? 'A2UI 消息结构非法',
          undefined,
          protocolResult.error?.code,
        );
      }
      const profileError = validateNexusProfileMessage(protocolResult.message);
      if (profileError) {
        throw createAgentStreamError(profileError.message, undefined, profileError.code);
      }
      const result = { ok: true, message: protocolResult.message };
      const sequenceIssue = validateAgentStreamMessageDetailed(
        result.message,
        index,
        sequence,
        streamState,
      );
      if (sequenceIssue) {
        throw createAgentStreamError(
          sequenceIssue.message,
          sequenceIssue.diagnostics,
          sequenceIssue.boundaryCode,
        );
      }
      if (
        'updateComponents' in result.message &&
        result.message.updateComponents.components.some((component) => component.id === 'root')
      ) {
        hasRoot = true;
      }

      stream.write(formatSseEvent('message', result.message, `${idPrefix}:${index}`));
      sent.push(result.message);
      index += 1;
      await sleep(streamDelayMs);
      if (options.signal?.aborted) throw new Error('客户端断开，Agent 流已取消');
    }
    if (sent.length === 0 && sequence.kind !== 'action')
      throw new Error('Agent 没有返回 A2UI 消息');
    if (!hasRoot) throw new Error('生成流必须包含 id 为 root 的组件');
    const finalIssue = validateAgentStreamFinalDetailed(sequence, streamState);
    if (finalIssue) {
      throw createAgentStreamError(
        finalIssue.message,
        finalIssue.diagnostics,
        finalIssue.boundaryCode,
      );
    }
    const commit = await beforeDone(sent);
    stream.write(formatSseEvent('done', commit ?? {}, `${idPrefix}:done`));
  } catch (error) {
    const streamError = error as AgentStreamError;
    const diagnostics = streamError.diagnostics;
    stream.write(
      formatSseEvent('error', {
        code: 'AGENT_STREAM_ERROR',
        boundaryCode: streamError.boundaryCode,
        message: error instanceof Error ? error.message : 'Agent 流式输出失败',
        ...(diagnostics ? { diagnostics } : {}),
      }),
    );
    return { messages: sent, ok: false };
  } finally {
    stream.end();
  }
  return { messages: sent, ok: true };
}

/**
 * Raw guarded-stream utility: the caller owns framing and naming (`idPrefix`).
 * Unlike `sendAgentRun` this is not an SDK run — no run record, no `runId`, and
 * its terminal `done` does not carry a `NexusSurfaceCommit`.
 */
export function sendMessages(
  ctx: Koa.Context,
  messages: Iterable<unknown> | AsyncIterable<unknown>,
  idPrefix: string,
  sequence: AgentSequenceOptions,
  beforeDone: BeforeDone = () => undefined,
  options: SendMessagesOptions = {},
): Promise<SendMessagesResult> {
  const stream = claimSseResponse(ctx);
  return pumpMessages(stream, messages, idPrefix, sequence, beforeDone, options).catch(() => ({
    messages: [],
    ok: false,
  }));
}

/**
 * Stream one agent run into `ctx`, serialized per surface.
 *
 * Contract: the SSE response is claimed **synchronously**, before this function
 * returns, and the SDK owns the response lifecycle from that point (`respond` is
 * set to false and the stream is piped directly). Runs for the same surface are
 * serialized, so a run may wait for a predecessor — the waiting run still owns
 * its response from the moment of the call, which is what keeps the client from
 * falling through to Koa's 404 while the queue drains.
 *
 * Because the response is already streaming, both host styles are correct:
 * `void sendAgentRun(...)` when the response is all that matters, and
 * `await sendAgentRun(...)` when the handler also needs the run's result. The
 * returned promise settles after the stream ends and commit has been attempted;
 * awaiting it never delays delivery.
 *
 * Run identity (S2.5.1): the single immutable id is `run.runId`, allocated by
 * the run creator (the adapter for SDK runs). The manager record id, the SSE
 * event id prefix and the success `done` payload all use that same value; the
 * sender never generates a second id and never rewrites `commit.runId`. A run
 * whose `commit` produces no `NexusSurfaceCommit` cannot claim success — the
 * stream ends with an `error` event and the record is marked failed.
 *
 * Transport correlation (S2.5.4): the claimed response carries the
 * `X-Nexus-Run-Id` header set from `run.runId` before `flushHeaders` — queued
 * runs included, since the claim is synchronous. Consumers correlate the
 * response with the success `done` payload through this header; the SDK offers
 * no way to derive a runId by parsing event id formats. Cross-origin reads are
 * the host's CORS assembly responsibility (expose the header explicitly).
 *
 * Commit retention belongs to the transport-neutral managed run. HTTP and direct
 * source/commit consumption share the adapter's record owner. Custom AgentRun
 * implementations are wrapped with an explicitly supplied manager. Reservation
 * precedes response claiming; every initialization failure disposes both owners.
 */
export interface SendAgentRunOptions {
  signal?: AbortSignal;
  streamDelayMs?: number;
  /** Defaults to the SDK run owner; custom runs require one. A different owner is rejected. */
  manager?: AgentRunManager;
  dispose?: () => void;
}

export function sendAgentRun(
  ctx: Koa.Context,
  run: AgentRun,
  options: SendAgentRunOptions,
): Promise<SendMessagesResult> {
  let managed: ManagedAgentRun | undefined;
  let stream: PassThrough;
  let hostDisposed = false;
  const disposeHost = (): void => {
    if (hostDisposed) return;
    hostDisposed = true;
    options?.dispose?.();
  };
  try {
    managed = manageAgentRun(run, options?.manager, options?.signal);
    managed.reserve();
    // Synchronously claim even queued responses, but only after capacity was reserved.
    // S2.5.4: the run id header is written inside prepareSseResponse, i.e. before
    // flushHeaders — a queued run carries its identity from the moment its response
    // is occupied, without waiting for the queue or any run record consumption.
    stream = claimSseResponse(ctx, { runId: managed.runId });
  } catch (error) {
    try {
      if (managed) managed.fail(error);
      else run.dispose?.();
    } finally {
      disposeHost();
    }
    throw error;
  }
  const ownedRun = managed;
  const controller = new AbortController();
  const abort = (): void => {
    if (ctx.res?.writableEnded === false) controller.abort();
  };
  if (typeof ctx.req?.once === 'function') ctx.req.once('aborted', abort);
  if (typeof ctx.res?.once === 'function') ctx.res.once('close', abort);
  if (options?.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  }

  const previous = surfaceRunQueues.get(ownedRun.sequence.surfaceId) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      if (!controller.signal.aborted) ownedRun.start();
      const result = await pumpMessages(
        stream,
        ownedRun.source,
        ownedRun.runId,
        ownedRun.sequence,
        (messages) => ownedRun.commit(messages),
        {
          signal: controller.signal,
          ...(options?.streamDelayMs === undefined ? {} : { streamDelayMs: options.streamDelayMs }),
        },
      );
      if (controller.signal.aborted) ownedRun.cancel();
      else if (!result.ok) ownedRun.fail();
      return result;
    })
    .catch((error: unknown) => {
      try {
        if (controller.signal.aborted) ownedRun.cancel();
        else ownedRun.fail(error);
      } finally {
        stream.end();
      }
      return { messages: [], ok: false };
    })
    .finally(() => {
      try {
        ownedRun.dispose();
      } finally {
        if (typeof ctx.req?.off === 'function') ctx.req.off('aborted', abort);
        if (typeof ctx.res?.off === 'function') ctx.res.off('close', abort);
        options?.signal?.removeEventListener('abort', abort);
        if (surfaceRunQueues.get(ownedRun.sequence.surfaceId) === queued) {
          surfaceRunQueues.delete(ownedRun.sequence.surfaceId);
        }
        disposeHost();
      }
    });
  surfaceRunQueues.set(ownedRun.sequence.surfaceId, queued);
  return queued;
}

// Per-surface run queues are module-level until S3 moves dispatch ownership into
// a per-runtime scheduler (SPEC §6); the run-record manager itself is now
// owned by the adapter (or the host for a custom run).
const surfaceRunQueues = new Map<string, Promise<SendMessagesResult>>();
