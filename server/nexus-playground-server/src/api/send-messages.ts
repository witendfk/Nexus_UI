import type Koa from 'koa';
import { PassThrough } from 'stream';
import { validateA2UIMessage } from '@nexus-ui/core';
import {
  createAgentStreamState,
  validateAgentStreamFinal,
  validateAgentStreamMessageDetailed,
} from '../agent/agent-guard';
import type { AgentSequenceOptions } from '../agent/agent-guard';
import type { ComponentSchemaDiagnostic } from '@nexus-ui/core';
import type { AgentRun } from '../agent/adapter';
import { formatSseEvent, prepareSseResponse } from '../transport/sse';

export interface SendMessagesResult {
  messages: unknown[];
  ok: boolean;
}

type BeforeDone = (messages: unknown[]) => void | Promise<void>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type AgentStreamError = Error & { diagnostics?: readonly ComponentSchemaDiagnostic[] };

function createAgentStreamError(
  message: string,
  diagnostics?: readonly ComponentSchemaDiagnostic[],
) {
  const error = new Error(message) as AgentStreamError;
  if (diagnostics !== undefined) error.diagnostics = diagnostics;
  return error;
}

export function sendMessages(
  ctx: Koa.Context,
  messages: Iterable<unknown> | AsyncIterable<unknown>,
  idPrefix: string,
  sequence: AgentSequenceOptions,
  beforeDone: BeforeDone = () => undefined,
): Promise<SendMessagesResult> {
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
        const result = validateA2UIMessage(candidate);
        if (!result.ok || !result.message) {
          throw new Error(result.error?.message ?? 'A2UI 消息结构非法');
        }
        const sequenceIssue = validateAgentStreamMessageDetailed(
          result.message,
          index,
          sequence,
          streamState,
        );
        if (sequenceIssue) {
          throw createAgentStreamError(sequenceIssue.message, sequenceIssue.diagnostics);
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
        await sleep(200);
      }
      if (sent.length === 0) throw new Error('Agent 没有返回 A2UI 消息');
      if (!hasRoot) throw new Error('生成流必须包含 id 为 root 的组件');
      const finalError = validateAgentStreamFinal(sequence, streamState);
      if (finalError) throw new Error(finalError);
      await beforeDone(sent);
      stream.write(formatSseEvent('done', {}, `${idPrefix}:done`));
    } catch (error) {
      const streamError = error as AgentStreamError;
      const diagnostics = streamError.diagnostics;
      stream.write(
        formatSseEvent('error', {
          code: 'AGENT_STREAM_ERROR',
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
): Promise<SendMessagesResult> {
  return sendMessages(ctx, run.source, idPrefix, run.sequence, (messages) => run.commit(messages));
}
