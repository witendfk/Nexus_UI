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
import { formatSseEvent, prepareSseResponse } from '../transport/sse';

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
 */
function claimSseResponse(ctx: Koa.Context): PassThrough {
  prepareSseResponse(ctx);
  const stream = new PassThrough();
  ctx.body = stream;
  ctx.respond = false;
  ctx.res.flushHeaders?.();
  stream.pipe(ctx.res);
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
    if (sent.length === 0) throw new Error('Agent 没有返回 A2UI 消息');
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
 */
export function sendAgentRun(
  ctx: Koa.Context,
  run: AgentRun,
  idPrefix: string,
  options: Omit<SendMessagesOptions, 'signal'> & {
    signal?: AbortSignal;
    /** Required run-records owner; hosts (or createAgentRouter) pass their instance explicitly. */
    manager: AgentRunManager;
    dispose?: () => void;
  },
): Promise<SendMessagesResult> {
  if (!options?.manager) {
    throw new Error('sendAgentRun 需要显式传入 manager（AgentRunManager）；SDK 不再内置全局单例');
  }
  const manager = options.manager;
  // Claim the run before anything consumes it: the per-surface lock from
  // prepareAction must only release after this queue settles commit/onError.
  // Claim the response before enqueueing: a run waiting behind a same-surface
  // predecessor must already own its response, or Koa answers 404 while the
  // queued run still streams and commits.
  const stream = claimSseResponse(ctx);
  manager.create({
    id: idPrefix,
    surfaceId: run.sequence.surfaceId,
    kind: run.sequence.kind,
  });

  const controller = new AbortController();
  const abort = (): void => {
    if (ctx.res?.writableEnded === false) controller.abort();
  };
  if (typeof ctx.req?.once === 'function') ctx.req.once('aborted', abort);
  if (typeof ctx.res?.once === 'function') ctx.res.once('close', abort);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  }

  const previous = surfaceRunQueues.get(run.sequence.surfaceId) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      manager.transition(idPrefix, 'running');
      const result = await pumpMessages(
        stream,
        run.source,
        idPrefix,
        run.sequence,
        async (messages) => {
          const result = await run.commit(messages);
          return result ? { ...result, runId: idPrefix } : undefined;
        },
        {
          signal: controller.signal,
          ...(options.streamDelayMs === undefined ? {} : { streamDelayMs: options.streamDelayMs }),
        },
      );
      if (!result.ok) {
        run.onError?.(controller.signal.aborted ? new Error('客户端断开') : undefined);
      }
      manager.transition(
        idPrefix,
        controller.signal.aborted ? 'canceled' : result.ok ? 'succeeded' : 'failed',
      );
      return result;
    })
    .catch((error: unknown) => {
      manager.transition(
        idPrefix,
        controller.signal.aborted ? 'canceled' : 'failed',
        error instanceof Error ? error.message : undefined,
      );
      return { messages: [], ok: false };
    });

  surfaceRunQueues.set(run.sequence.surfaceId, queued);
  void queued.finally(() => {
    run.dispose?.();
    if (typeof ctx.req?.off === 'function') ctx.req.off('aborted', abort);
    if (typeof ctx.res?.off === 'function') ctx.res.off('close', abort);
    if (surfaceRunQueues.get(run.sequence.surfaceId) === queued) {
      surfaceRunQueues.delete(run.sequence.surfaceId);
    }
    options.dispose?.();
  });
  return queued;
}

// Per-surface run queues are module-level until S3 moves dispatch ownership into
// a per-runtime scheduler (SPEC §6); the run-record manager itself is now
// explicitly owned by the host or the router instance.
const surfaceRunQueues = new Map<string, Promise<SendMessagesResult>>();
