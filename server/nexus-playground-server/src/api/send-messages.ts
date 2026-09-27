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
import { defaultAgentRunManager } from '../agent/run-manager';
import type { AgentRunManager } from '../agent/run-manager';
import { formatSseEvent, prepareSseResponse } from '../transport/sse';

export interface SendMessagesResult {
  messages: unknown[];
  ok: boolean;
}

type BeforeDone = (messages: unknown[]) => void | Promise<void>;

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

export function sendMessages(
  ctx: Koa.Context,
  messages: Iterable<unknown> | AsyncIterable<unknown>,
  idPrefix: string,
  sequence: AgentSequenceOptions,
  beforeDone: BeforeDone = () => undefined,
  options: SendMessagesOptions = {},
): Promise<SendMessagesResult> {
  if (options.signal?.aborted) {
    return Promise.resolve({ messages: [], ok: false });
  }

  const streamDelayMs = options.streamDelayMs ?? 200;
  prepareSseResponse(ctx);
  const stream = new PassThrough();
  ctx.body = stream;
  ctx.res.flushHeaders?.();

  const sent: unknown[] = [];
  const run = async (): Promise<SendMessagesResult> => {
    try {
      let index = 0;
      let hasRoot = sequence.kind === 'action';
      const streamState = createAgentStreamState();
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
      await beforeDone(sent);
      stream.write(formatSseEvent('done', {}, `${idPrefix}:done`));
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
  };

  return run().catch(() => ({ messages: sent, ok: false }));
}

export function sendAgentRun(
  ctx: Koa.Context,
  run: AgentRun,
  idPrefix: string,
  options: Omit<SendMessagesOptions, 'signal'> & {
    signal?: AbortSignal;
    manager?: AgentRunManager;
    dispose?: () => void;
  } = {},
): Promise<SendMessagesResult> {
  const manager = options.manager ?? defaultAgentRunManager;
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
      const result = await sendMessages(
        ctx,
        run.source,
        idPrefix,
        run.sequence,
        (messages) => run.commit(messages),
        {
          signal: controller.signal,
          ...(options.streamDelayMs === undefined ? {} : { streamDelayMs: options.streamDelayMs }),
        },
      );
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
    if (typeof ctx.req?.off === 'function') ctx.req.off('aborted', abort);
    if (typeof ctx.res?.off === 'function') ctx.res.off('close', abort);
    if (surfaceRunQueues.get(run.sequence.surfaceId) === queued) {
      surfaceRunQueues.delete(run.sequence.surfaceId);
    }
    options.dispose?.();
  });
  return queued;
}

const surfaceRunQueues = new Map<string, Promise<SendMessagesResult>>();
