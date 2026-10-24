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
import type { NexusRunDiagnostic } from '../agent/run-diagnostic';
import type { AgentRunManager } from '../agent/run-manager';
import { manageAgentRun, type ManagedAgentRun } from '../agent/run-lifecycle';
import { RuntimeRunHandle } from '../runtime/run-handle';
import { startManagedRunTask } from '../runtime/agent-runtime';
import { schedulerForOwner } from '../runtime/scheduler-owner';
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
  // unhandled; the sender always ends the stream, so the response still closes.
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
 * Stream one scheduled run (or a wrapped custom `AgentRun`) into `ctx`.
 *
 * S3.2: per-surface serialization belongs to the runtime scheduler, not to a
 * module-global queue. For scheduled handles the response is claimed and the
 * sender merely forwards the runtime's validated events — it owns no queue,
 * no guard state and no commit. A custom `AgentRun` is wrapped with the
 * explicitly supplied manager and consumes the same task machinery without an
 * implicit queue.
 *
 * Contract kept from S2 (DESIGN D3): the SSE response is claimed synchronously
 * before this function returns, `X-Nexus-Run-Id` is written before
 * `flushHeaders` (queued runs included), and both `void` and `await` call
 * styles stream per-event. The returned promise settles after the terminal
 * event has been written; it never rejects after a successful claim.
 */
export interface SendAgentRunOptions {
  signal?: AbortSignal;
  streamDelayMs?: number;
  /** Defaults to the SDK run owner; custom runs require one. A different owner is rejected. */
  manager?: AgentRunManager;
  /** 自定义 AgentRun 的扩展故障诊断；SDK 句柄使用 runtime 装配的诊断回调。 */
  onRunDiagnostic?: (diagnostic: NexusRunDiagnostic) => void;
  dispose?: () => void;
}

export function sendAgentRun(
  ctx: Koa.Context,
  run: AgentRun | RuntimeRunHandle,
  options: SendAgentRunOptions = {},
): Promise<SendMessagesResult> {
  // Identity/owner/capacity validation stays synchronous: callers may rely on
  // a throw before any response claim (S2 contract kept).
  if (run instanceof RuntimeRunHandle) {
    if (options.manager && options.manager !== run.manager) {
      options.dispose?.();
      throw new Error('sendAgentRun manager 必须与 adapter 的 runManager 所有者一致');
    }
    // S2 同步占用契约（DESIGN D3）：claim 留在本同步段，占用失败同步抛给
    // Koa 中间件；容量预留已在入队时完成。占用失败同时收敛运行记录
    //（排队 → canceled；已开跑 → abort 后由任务侧收敛，确认提交仍胜出）。
    let stream: PassThrough;
    try {
      stream = claimSseResponse(ctx, { runId: run.runId });
    } catch (error) {
      run.cancel();
      options.dispose?.();
      throw error;
    }
    return sendScheduledRun(run, options, stream, ctx);
  }
  let managed: ManagedAgentRun | undefined;
  let stream: PassThrough | undefined;
  try {
    managed = manageAgentRun(run, options.manager, options.signal, options.onRunDiagnostic);
    // Per-owner serialization (S3.2): custom runs queue on the scheduler bound
    // to their record owner, so two runs of one surface stay serial without any
    // module-global state. Rejection happens before the response is claimed.
    const scheduler = schedulerForOwner(managed.manager);
    if (!scheduler.hasCapacity(managed.sequence.surfaceId)) {
      throw new Error('同 surface 排队运行已达上限，请稍后重试');
    }
    managed.reserve();
    // S2 同步占用契约：预留容量之后、任务启动之前同步 claim（排队 run 由此
    // 即刻带头），占用失败同步抛出并由下方清理。
    stream = claimSseResponse(ctx, { runId: managed.runId });
    const handle = startManagedRunTask(managed, options, scheduler);
    return sendScheduledRun(handle, options, stream, ctx);
  } catch (error) {
    try {
      if (managed) managed.fail(error);
      else run.dispose?.();
    } finally {
      options.dispose?.();
    }
    throw error;
  }
}

async function sendScheduledRun(
  handle: RuntimeRunHandle,
  options: SendAgentRunOptions,
  stream: PassThrough,
  ctx: Koa.Context,
): Promise<SendMessagesResult> {
  const messages: unknown[] = [];
  let settle: (result: SendMessagesResult) => void = () => undefined;
  const finished = new Promise<SendMessagesResult>((resolve) => {
    settle = resolve;
  });

  // Transitional pacing (S2 transport behavior, DESIGN D3): per-message write
  // delay keeps the await/void per-event delivery contract until S3.6 replaces
  // it with real backpressure. Writes are chained so order is preserved.
  const streamDelayMs = options.streamDelayMs ?? 200;
  let writeChain: Promise<void> = Promise.resolve();
  const write = (frame: string, paced: boolean): void => {
    writeChain = writeChain.then(async () => {
      if (paced && streamDelayMs > 0) await sleep(streamDelayMs);
      stream.write(frame);
    });
  };
  const drainThen = (fn: () => void): void => {
    writeChain = writeChain.then(fn);
  };

  const unsubscribe = handle.subscribe((event) => {
    switch (event.type) {
      case 'start':
        // Additive wire event (SPEC §5.4); S2 consumers ignore unknown names.
        write(formatSseEvent('start', event, `${handle.runId}:start`), false);
        break;
      case 'message': {
        write(formatSseEvent('message', event.message, `${handle.runId}:${messages.length}`), true);
        messages.push(event.message);
        break;
      }
      case 'done':
        write(formatSseEvent('done', event.commit, `${handle.runId}:done`), false);
        drainThen(() => settle({ messages, ok: true }));
        break;
      case 'error':
        write(
          formatSseEvent(
            'error',
            {
              code: 'AGENT_STREAM_ERROR',
              boundaryCode: event.boundaryCode as A2UIErrorCode | undefined,
              message: event.message ?? 'Agent 流式输出失败',
              ...(event.diagnostics ? { diagnostics: event.diagnostics } : {}),
              // S3.2 additive fields; the locked session error shape lands in S3.5.
              runCode: event.code,
              commitState: event.commitState,
              runId: handle.runId,
              surfaceId: handle.surfaceId,
              ...(event.actionId ? { actionId: event.actionId } : {}),
            },
            `${handle.runId}:error`,
          ),
          false,
        );
        drainThen(() => settle({ messages, ok: false }));
        break;
    }
  });

  const abort = (): void => {
    if (ctx.res?.writableEnded === false) handle.cancel();
  };
  const abortSignal = (): void => handle.cancel();
  if (options.signal?.aborted) abortSignal();
  else options.signal?.addEventListener('abort', abortSignal, { once: true });
  if (typeof ctx.req?.once === 'function') ctx.req.once('aborted', abort);
  if (typeof ctx.res?.once === 'function') ctx.res.once('close', abort);

  void handle.result
    .catch(() => undefined)
    .finally(() => {
      drainThen(() => {
        try {
          stream.end();
        } finally {
          unsubscribe();
          options.signal?.removeEventListener('abort', abortSignal);
          if (typeof ctx.req?.off === 'function') ctx.req.off('aborted', abort);
          if (typeof ctx.res?.off === 'function') ctx.res.off('close', abort);
          options.dispose?.();
        }
      });
    });
  return finished;
}
