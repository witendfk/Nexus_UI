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
import { reportRunDiagnostic, type NexusRunDiagnostic } from '../agent/run-diagnostic';
import { assertPositiveSafeInteger } from '../agent/limits';
import type { AgentRunManager } from '../agent/run-manager';
import { RuntimeRunHandle } from '../runtime/run-handle';
import type { RunOutcome, RuntimeRunListener } from '../runtime/run-handle';
import { startCustomRunTask } from '../runtime/agent-runtime';
import {
  DEFAULT_SLOW_CONSUMER_TIMEOUT_MS,
  DEFAULT_SSE_HIGH_WATER_MARK,
  resolveSseBudgets,
} from '../runtime/budgets';
import type { AgentRuntimeBudgets } from '../runtime/budgets';
import { RunTaskError } from '../runtime/run-handle';
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

const CANCELED_OUTPUT_GRACE_MS = 100;

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
function claimSseResponse(
  ctx: Koa.Context,
  options?: PrepareSseResponseOptions & { highWaterMark?: number },
): PassThrough {
  prepareSseResponse(ctx, options);
  // 契约默认 1 MiB（SPEC §6.6）：超过即暂停读取，尊重背压。
  const highWaterMark = options?.highWaterMark ?? DEFAULT_SSE_HIGH_WATER_MARK;
  assertPositiveSafeInteger('sse.highWaterMarkBytes', highWaterMark);
  const stream = new PassThrough({ highWaterMark });
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
 * S3.5 thin adapter (SPEC §6.7): the sender owns only the response claim, SSE
 * serialization and connection teardown — no Catalog interpretation, no queue,
 * no manager, no commit. Per-surface serialization belongs to the runtime
 * scheduler; custom-run wrapping lives in `startCustomRunTask` (runtime module),
 * so every run reaches the wire as a handle whose Session events are forwarded.
 *
 * Contract kept from S2 (DESIGN D3): the SSE response is claimed synchronously
 * before this function returns, `X-Nexus-Run-Id` is written before
 * `flushHeaders` (queued runs included), and both `void` and `await` call
 * styles stream per-event. The returned promise settles after the terminal
 * event has been written; it never rejects after a successful claim.
 */
export interface SendAgentRunOptions {
  /** 附加取消源；不替代 sender 自己的 req/res 断连监听。 */
  signal?: AbortSignal;
  /** 演示用逐条间隔 ms（默认 0，不再人为限速；真实背压由 drain 闸门承担）。 */
  streamDelayMs?: number;
  /** SSE 背压预算（S3.6.3）；缺省用契约默认（HWM 1 MiB、慢消费 30s）。 */
  sse?: { highWaterMarkBytes?: number; slowConsumerTimeoutMs?: number };
  /** 自定义 run 的 run 级消息流预算（缺省契约默认，预算默认常开）。 */
  budgets?: AgentRuntimeBudgets;
  /** Defaults to the SDK run owner; custom runs require one. A different owner is rejected. */
  manager?: AgentRunManager;
  /** 自定义 AgentRun 的扩展故障诊断；SDK 句柄使用 runtime 装配的诊断回调。 */
  onRunDiagnostic?: (diagnostic: NexusRunDiagnostic) => void;
  dispose?: () => void;
}

/** 由 runtime 预算解析发送层 SSE 选项（routes 装配使用）。 */
export function sseOptionsFromBudgets(
  budgets?: AgentRuntimeBudgets,
): NonNullable<SendAgentRunOptions['sse']> {
  const resolved = resolveSseBudgets(budgets);
  return {
    highWaterMarkBytes: resolved.highWaterMarkBytes,
    slowConsumerTimeoutMs: resolved.slowConsumerTimeoutMs,
  };
}

/**
 * 薄发送层依赖的句柄端口（S3.5.1 接口隔离）：发送只消费事件、终态与取消，
 * 不触碰任务侧内部 API（lifecycle/abortSignal/emit*）。RuntimeRunHandle 结构
 * 性满足该端口；测试替身亦按此最小面实现。setEmitGate 是 S3.6.3 的可选背压
 * 闸门：安装后任务侧 message 发出前等待闸门，drain/断连/取消/慢消费超时放行。
 */
interface SessionEventSource {
  readonly runId: string;
  readonly surfaceId: string;
  readonly result: Promise<RunOutcome>;
  subscribe(listener: RuntimeRunListener): () => void;
  cancel(): void;
  interrupt?(error: RunTaskError): void;
  setEmitGate?(gate: (() => Promise<void>) | undefined, onInterrupt?: () => void): void;
}

export function sendAgentRun(
  ctx: Koa.Context,
  run: AgentRun | RuntimeRunHandle,
  options: SendAgentRunOptions = {},
): Promise<SendMessagesResult> {
  try {
    assertPositiveSafeInteger(
      'sse.highWaterMarkBytes',
      options.sse?.highWaterMarkBytes ?? DEFAULT_SSE_HIGH_WATER_MARK,
    );
    assertPositiveSafeInteger(
      'sse.slowConsumerTimeoutMs',
      options.sse?.slowConsumerTimeoutMs ?? DEFAULT_SLOW_CONSUMER_TIMEOUT_MS,
    );
    if (
      options.streamDelayMs !== undefined &&
      (!Number.isSafeInteger(options.streamDelayMs) || options.streamDelayMs < 0)
    )
      throw new Error('streamDelayMs 必须为非负安全整数');
  } catch (error) {
    if (run instanceof RuntimeRunHandle) run.cancel();
    options.dispose?.();
    throw error;
  }
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
      stream = claimSseResponse(ctx, {
        runId: run.runId,
        highWaterMark: options.sse?.highWaterMarkBytes,
      });
    } catch (error) {
      run.cancel();
      options.dispose?.();
      throw error;
    }
    return sendScheduledRun(run, options, stream, ctx);
  }
  // 自定义 run：托管/调度/容量组合属于运行模块（startCustomRunTask，含宿主
  // run 的恰好一次清理）；传输层只负责占用响应与转发 Session 事件。
  let handle: RuntimeRunHandle;
  try {
    handle = startCustomRunTask(run, options);
  } catch (error) {
    options.dispose?.();
    throw error;
  }
  let stream: PassThrough;
  try {
    stream = claimSseResponse(ctx, {
      runId: handle.runId,
      highWaterMark: options.sse?.highWaterMarkBytes,
    });
  } catch (error) {
    handle.cancel();
    options.dispose?.();
    throw error;
  }
  return sendScheduledRun(handle, options, stream, ctx);
}

async function sendScheduledRun(
  handle: SessionEventSource,
  options: SendAgentRunOptions,
  stream: PassThrough,
  ctx: Koa.Context,
): Promise<SendMessagesResult> {
  const messages: unknown[] = [];
  let settle!: (result: SendMessagesResult) => void;
  const finished = new Promise<SendMessagesResult>((resolve) => {
    settle = resolve;
  });
  const timeoutMs = options.sse?.slowConsumerTimeoutMs ?? DEFAULT_SLOW_CONSUMER_TIMEOUT_MS;
  const delayMs = options.streamDelayMs ?? 0;
  let drainPending = false;
  let gateClosed = false;
  let wakeGate: (() => void) | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let finalTimer: ReturnType<typeof setTimeout> | undefined;
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeDelay: (() => void) | undefined;
  let terminal: SendMessagesResult | undefined;
  let cleaned = false;
  let failure: RunTaskError | undefined;
  let unsubscribe = (): void => {};
  let detachConnection = (): void => {};
  let detachAbortWake = (): void => {};
  const releaseGate = (): void => {
    const wake = wakeGate;
    wakeGate = undefined;
    wake?.();
  };
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(drainTimer);
    clearTimeout(finalTimer);
    clearTimeout(delayTimer);
    gateClosed = true;
    wakeDelay?.();
    releaseGate();
    unsubscribe();
    handle.setEmitGate?.(undefined);
    stream.off('drain', onDrain);
    stream.off('error', onError);
    stream.off('close', onStreamClose);
    ctx.res.off('finish', onFinish);
    ctx.res.off('close', onClose);
    ctx.res.off('error', onError);
    detachAbortWake();
    detachConnection();
    try {
      options.dispose?.();
    } catch (error) {
      reportRunDiagnostic(options.onRunDiagnostic, {
        runId: handle.runId,
        surfaceId: handle.surfaceId,
        stage: 'run-dispose',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const failTransport = (): void => {
    if (cleaned) return;
    failure = new RunTaskError('AGENT_STREAM_ERROR', `SSE 输出未能在 ${timeoutMs}ms 内恢复或结束`);
    gateClosed = true;
    releaseGate();
    if (handle.interrupt) handle.interrupt(failure);
    else handle.cancel();
    settle({ messages, ok: false });
    cleanup();
    stream.unpipe(ctx.res);
    stream.destroy();
    ctx.res.destroy();
  };
  const onDrain = (): void => {
    drainPending = false; // drain can precede the next candidate/gate
    clearTimeout(drainTimer);
    drainTimer = undefined;
    releaseGate();
  };
  const onFinish = (): void => {
    settle(terminal ?? { messages, ok: false });
    cleanup();
  };
  const onClose = (): void => {
    if (!ctx.res.writableFinished) {
      // The shared connection listener owns cancel; avoid a second invocation.
      settle({ messages, ok: false });
    } else settle(terminal ?? { messages, ok: false });
    cleanup();
    stream.destroy();
  };
  const onError = (): void => failTransport();
  const onStreamClose = (): void => {
    if (!stream.writableFinished && !cleaned) failTransport();
  };
  stream.on('drain', onDrain);
  stream.on('error', onError);
  stream.on('close', onStreamClose);
  ctx.res.on('finish', onFinish);
  ctx.res.on('close', onClose);
  ctx.res.on('error', onError);
  const gate = async (): Promise<void> => {
    if (delayMs > 0 && !gateClosed)
      await new Promise<void>((resolve) => {
        delayTimer = setTimeout(() => {
          wakeDelay = undefined;
          resolve();
        }, delayMs);
        wakeDelay = () => {
          clearTimeout(delayTimer);
          wakeDelay = undefined;
          resolve();
        };
      });
    if (failure) throw failure;
    if (drainPending && !gateClosed)
      await new Promise<void>((resolve) => {
        wakeGate = resolve;
      });
    if (failure) throw failure;
  };
  handle.setEmitGate?.(gate, () => {
    gateClosed = true;
    wakeDelay?.();
    releaseGate();
  });
  const write = (frame: string): void => {
    if (cleaned || stream.destroyed) return;
    if (!stream.write(frame)) {
      drainPending = true;
      drainTimer ??= setTimeout(failTransport, timeoutMs);
    }
  };
  unsubscribe = handle.subscribe((event) => {
    switch (event.type) {
      case 'start':
        write(formatSseEvent('start', event, `${handle.runId}:start`));
        break;
      case 'message':
        write(formatSseEvent('message', event.message, `${handle.runId}:${messages.length}`));
        messages.push(event.message);
        break;
      case 'done':
        terminal = { messages, ok: true };
        write(formatSseEvent('done', event.commit, `${handle.runId}:done`));
        break;
      case 'error': {
        const { type: _discriminator, ...payload } = event;
        terminal = { messages, ok: false };
        write(formatSseEvent('error', payload, `${handle.runId}:error`));
        break;
      }
    }
  });
  detachConnection = attachDisconnectTeardown(handle, options, ctx);
  detachAbortWake = attachAbortWake(options, ctx, () => {
    gateClosed = true;
    wakeDelay?.();
    releaseGate();
  });
  void handle.result
    .catch(() => undefined)
    .then((outcome) => {
      if (cleaned) return;
      stream.end();
      if (ctx.res.writableFinished) onFinish();
      else
        finalTimer = setTimeout(
          failTransport,
          outcome?.terminal === 'canceled'
            ? Math.min(timeoutMs, CANCELED_OUTPUT_GRACE_MS)
            : timeoutMs,
        );
    });
  return finished;
}

function attachAbortWake(
  options: SendAgentRunOptions,
  ctx: Koa.Context,
  wake: () => void,
): () => void {
  if (typeof ctx.req?.once === 'function') ctx.req.once('aborted', wake);
  if (typeof ctx.res?.once === 'function') ctx.res.once('close', wake);
  options.signal?.addEventListener('abort', wake, { once: true });
  return () => {
    options.signal?.removeEventListener('abort', wake);
    if (typeof ctx.req?.off === 'function') ctx.req.off('aborted', wake);
    if (typeof ctx.res?.off === 'function') ctx.res.off('close', wake);
  };
}

function attachDisconnectTeardown(
  handle: SessionEventSource,
  options: SendAgentRunOptions,
  ctx: Koa.Context,
): () => void {
  let canceled = false;
  const abortSignal = (): void => {
    if (canceled) return;
    canceled = true;
    handle.cancel();
  };
  const abort = (): void => {
    if (ctx.res?.writableEnded === false) abortSignal();
  };
  if (typeof ctx.req?.once === 'function') ctx.req.once('aborted', abort);
  if (typeof ctx.res?.once === 'function') ctx.res.once('close', abort);
  options.signal?.addEventListener('abort', abortSignal, { once: true });
  if (options.signal?.aborted || ctx.req?.aborted || (ctx.res?.destroyed && !ctx.res.writableEnded))
    abortSignal();
  return () => {
    options.signal?.removeEventListener('abort', abortSignal);
    if (typeof ctx.req?.off === 'function') ctx.req.off('aborted', abort);
    if (typeof ctx.res?.off === 'function') ctx.res.off('close', abort);
  };
}
