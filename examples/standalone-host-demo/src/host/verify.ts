import type { Server } from 'node:http';
import type { ActionEvent, Component } from '@nexus-ui/core';
import { A2UIRuntime } from '@nexus-ui/core';
import type { AgentPolicy } from '@nexus-ui/server';
import { streamSse, type SseEvent } from '../browser/sse';
import { DEMO_AGENT_CATALOG_ID } from '../contract';
import { createStandaloneHostRegistry } from '../shared/catalog';
import { createStandaloneHostApp } from './app';

export interface VerifyHostOptions {
  endpoint: string;
  message?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface VerifyHostReport {
  endpoint: string;
  surfaceId: string;
  generationMessages: number;
  actionMessages: number;
  action: ActionEvent;
  componentIdsAfterGeneration: string[];
  componentIdsAfterAction: string[];
  policyRejection: {
    rejected: boolean;
    boundaryCode?: string;
    message?: string;
  };
}

interface SseRun {
  messages: unknown[];
  done: boolean;
  error?: {
    boundaryCode?: string;
    message: string;
  };
}

const approvalPolicy: AgentPolicy = {
  name: 'nexus-verify-approval',
  validateFinal: (_context, components) => {
    const root = components.find((component) => component.id === 'root');
    const action = components.find((component) => component.action?.event);
    if (!root || root.component !== 'ApprovalSummary') {
      return '验收策略要求 root 是 ApprovalSummary';
    }
    if (!action) return '验收策略要求至少一个可执行 action';
    return null;
  },
};

const rejectionPolicy: AgentPolicy = {
  name: 'nexus-verify-policy-rejection',
  getRequiredMedia: () => ({ Image: false, Video: false, AudioPlayer: true }),
};

function assertEndpoint(endpoint: string): void {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('endpoint protocol must be http or https');
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Agent endpoint: ${endpoint} (${reason})`);
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind verification host');
  }
  return address.port;
}

async function postSse(
  baseUrl: string,
  path: string,
  body: unknown,
  runtime?: A2UIRuntime,
): Promise<SseRun> {
  const run: SseRun = { messages: [], done: false };
  const handleEvent = (event: SseEvent): void => {
    if (event.event === 'done') {
      run.done = true;
      return;
    }
    if (event.event === 'error') {
      const payload = JSON.parse(event.data) as {
        boundaryCode?: string;
        message?: string;
      };
      run.error = {
        boundaryCode: payload.boundaryCode,
        message: payload.message ?? 'Agent stream failed',
      };
      return;
    }
    if (event.event !== 'message') return;

    const message = JSON.parse(event.data) as unknown;
    run.messages.push(message);
    runtime?.push(`${event.data}\n`);
  };

  await streamSse({ url: `${baseUrl}${path}`, body, onEvent: handleEvent });
  runtime?.end();
  return run;
}

function getCreatedSurfaceId(messages: unknown[]): string {
  for (const message of messages) {
    const candidate = message as { createSurface?: { surfaceId?: unknown } };
    const surfaceId = candidate.createSurface?.surfaceId;
    if (typeof surfaceId === 'string' && surfaceId) return surfaceId;
  }
  throw new Error('外部 Agent 生成流缺少 createSurface.surfaceId');
}

function hasLifecycleCreate(messages: unknown[]): boolean {
  return messages.some((message) => {
    return Boolean((message as { createSurface?: unknown }).createSurface);
  });
}

function getComponentIds(runtime: A2UIRuntime, surfaceId: string): string[] {
  return Object.keys(runtime.store.getState().componentsBySurface[surfaceId] ?? {});
}

function getActionComponent(
  runtime: A2UIRuntime,
  surfaceId: string,
): { id: string; component: Component } | null {
  const components = runtime.store.getState().componentsBySurface[surfaceId] ?? {};
  const component = Object.values(components).find((item) => item.action?.event);
  return component ? { id: component.id, component } : null;
}

/**
 * Run an API-level acceptance against a real external JSONL Agent.
 * Browser patching is covered by the React DOM tests; this checks the host contract.
 */
export async function verifyExternalAgentIntegration(
  options: VerifyHostOptions,
): Promise<VerifyHostReport> {
  assertEndpoint(options.endpoint);
  const message = options.message ?? '创建营销活动审批任务';
  const servers: Server[] = [];

  try {
    const createHost = async (policy: AgentPolicy): Promise<string> => {
      const app = createStandaloneHostApp({
        endpoint: options.endpoint,
        headers: options.headers,
        timeoutMs: options.timeoutMs ?? 30_000,
        policy,
      });
      const server = app.listen(0, '127.0.0.1');
      servers.push(server);
      const port = await listen(server);
      return `http://127.0.0.1:${port}`;
    };

    const happyHost = await createHost(approvalPolicy);
    const actionEvents: ActionEvent[] = [];
    const runtime = new A2UIRuntime({
      catalogRegistry: createStandaloneHostRegistry(),
      onError: (error) => {
        throw new Error(error.message);
      },
      onAction: (event) => actionEvents.push(event),
    });

    const generation = await postSse(
      happyHost,
      '/api/a2ui/generate',
      { message, catalogId: DEMO_AGENT_CATALOG_ID },
      runtime,
    );
    if (generation.error) throw new Error(`生成流被拒绝: ${generation.error.message}`);
    if (!generation.done) throw new Error('生成流没有以 SSE done 结束');
    const surfaceId = getCreatedSurfaceId(generation.messages);
    const componentIdsAfterGeneration = getComponentIds(runtime, surfaceId);

    const actionComponent = getActionComponent(runtime, surfaceId);
    if (!actionComponent) throw new Error('生成流没有可回流的 action');
    runtime.triggerAction(actionComponent.id, surfaceId);
    const actionEvent = actionEvents[0];
    if (!actionEvent) throw new Error('runtime 没有解析出 action context');

    const action = await postSse(happyHost, '/api/a2ui/event', {
      version: 'v0.9',
      action: {
        name: actionEvent.name,
        surfaceId: actionEvent.surfaceId,
        sourceComponentId: actionEvent.sourceComponentId,
        timestamp: new Date().toISOString(),
        context: actionEvent.context,
      },
    });
    if (action.error) throw new Error(`action 流被拒绝: ${action.error.message}`);
    if (!action.done) throw new Error('action 流没有以 SSE done 结束');
    if (hasLifecycleCreate(action.messages)) {
      throw new Error('action 流不能 create surface');
    }

    const componentIdsAfterAction = getComponentIds(runtime, surfaceId);
    if (!componentIdsAfterAction.includes('root')) {
      throw new Error('action 更新丢失 root 组件，未形成同 surface patch');
    }
    if (runtime.store.getState().errors.length > 0) {
      throw new Error('runtime 记录了 action 更新错误');
    }

    const rejectionHost = await createHost(rejectionPolicy);
    const rejectionRuntime = new A2UIRuntime({
      catalogRegistry: createStandaloneHostRegistry(),
    });
    const rejection = await postSse(
      rejectionHost,
      '/api/a2ui/generate',
      { message, catalogId: DEMO_AGENT_CATALOG_ID },
      rejectionRuntime,
    );
    if (!rejection.error || rejection.done) {
      throw new Error('policy rejection 验收失败：预期 host policy 拒绝且没有 done');
    }

    return {
      endpoint: options.endpoint,
      surfaceId,
      generationMessages: generation.messages.length,
      actionMessages: action.messages.length,
      action: actionEvent,
      componentIdsAfterGeneration,
      componentIdsAfterAction,
      policyRejection: {
        rejected: true,
        boundaryCode: rejection.error.boundaryCode,
        message: rejection.error.message,
      },
    };
  } finally {
    while (servers.length > 0) {
      const server = servers.pop();
      server?.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        server?.close((error) => {
          // Cleanup must not mask the original integration failure.
          // eslint-disable-next-line no-console
          if (error) console.warn(error.message);
          resolve();
        });
      });
    }
  }
}
