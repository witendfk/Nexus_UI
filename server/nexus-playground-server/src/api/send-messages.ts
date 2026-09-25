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
import { formatSseEvent, prepareSseResponse } from '../transport/sse';

export interface SendMessagesResult {
  messages: unknown[];
  ok: boolean;
}

type BeforeDone = (messages: unknown[]) => void | Promise<void>;

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
        await sleep(200);
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
): Promise<SendMessagesResult> {
  return sendMessages(ctx, run.source, idPrefix, run.sequence, (messages) => run.commit(messages));
}
