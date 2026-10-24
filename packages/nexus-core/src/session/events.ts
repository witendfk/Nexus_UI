/**
 * @nexus-ui/core/session —— Nexus Session v1 流事件契约（SPEC §5.4）。
 *
 * 只放 wire 形状与纯规则：类型、逐事件解析、流序列检查。不依赖 Node/React/
 * server；HTTP SSE 与非 Koa 事件消费共用同一事实源与同一解析结论。A2UI v0.9
 * 消息保持自身形状，运行元数据只出现在 start/error 事件中，不写入 message
 * payload。每条流恰一个终态（done|error），终态后不得再有任何事件；EOF 前未
 * 收到终态为运行不完整，消费方不得据此推断成功。
 */

import { CATALOG_CONTRACT_VERSION } from '../catalog';
import type { A2UIError, A2UIMessage } from '../protocol';
import { validateProtocolMessage } from '../protocol';
import { NEXUS_SESSION_VERSION, parseSurfaceCommit, type NexusSurfaceCommit } from './index';

/**
 * 诊断文本上限（字符数）：error 的 `message` 与 diagnostics 条目的 `message`
 * 超限一律截断，不截断结构（path/dataPath 保留）。字节级预算归 S3.6。
 */
export const NEXUS_SESSION_DIAGNOSTIC_LIMIT = 512;

/** Session 流错误码枚举；`AGENT_STREAM_ERROR` 为 S2 保留的传输边界错误。 */
export type NexusSessionErrorCode =
  | 'RUN_ADMISSION_REJECTED'
  | 'RUN_FAILED'
  | 'RUN_COMMIT_UNKNOWN'
  | 'RUN_CANCELLED'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'AGENT_STREAM_ERROR';

export const NEXUS_SESSION_ERROR_CODES: readonly NexusSessionErrorCode[] = [
  'RUN_ADMISSION_REJECTED',
  'RUN_FAILED',
  'RUN_COMMIT_UNKNOWN',
  'RUN_CANCELLED',
  'RESOURCE_LIMIT_EXCEEDED',
  'AGENT_STREAM_ERROR',
];

/**
 * 结构化诊断条目：错误分类（协议/Profile/Catalog/Policy 边界码、生命周期故障）
 * 携带 `path`/`dataPath` 定位与截断后的文本。准入/资源/运行类错误可不带。
 */
export interface NexusSessionDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly dataPath?: string;
}

/** SSE 事件名；`message` 的 data 是原始 A2UI 信封，其余见各事件类型。 */
export type NexusSessionEventName = 'start' | 'message' | 'done' | 'error';

/**
 * start 事件（wire payload 即本对象，含 `type` 判别字段）。基准取调度内实际
 * 快照：action 运行必带 `surfaceRevision`，generation 运行由本次运行创建
 * surface，不携带。排队取消的 run 未进调度，不产生 start。
 */
export interface NexusSessionStartEvent {
  readonly type: 'start';
  readonly sessionVersion: typeof NEXUS_SESSION_VERSION;
  readonly runId: string;
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly contractVersion: number;
  readonly catalogHash: string;
  readonly surfaceRevision?: number;
}

/** done 事件：UI 提交成功，data 为提交边界固定的 `NexusSurfaceCommit`。 */
export interface NexusSessionDoneEvent {
  readonly type: 'done';
  readonly commit: NexusSurfaceCommit;
}

/**
 * error 事件：运行失败/取消终态，`commitState` 只允许 notCommitted|unknown
 * （已确认提交走 done）。不表示业务失败。
 */
export interface NexusSessionErrorEvent {
  readonly type: 'error';
  readonly sessionVersion: typeof NEXUS_SESSION_VERSION;
  readonly runId: string;
  readonly surfaceId: string;
  readonly code: NexusSessionErrorCode;
  readonly commitState: 'notCommitted' | 'unknown';
  readonly message?: string;
  readonly diagnostics?: readonly NexusSessionDiagnostic[];
  readonly actionId?: string;
  /** 身份/基准准备完成前的失败：唯一 error，无 start；只能确定未提交。 */
  readonly beforeStart?: true;
}

/** 进程内事件形状；wire 上 `message` 的 data 是裸 A2UI 信封，`done` 是裸 commit。 */
export type NexusSessionEvent =
  | NexusSessionStartEvent
  | NexusSessionMessageEvent
  | NexusSessionDoneEvent
  | NexusSessionErrorEvent;

/** 进程内 message 事件；wire 层只投递其中的 `message` 字段值。 */
export interface NexusSessionMessageEvent {
  readonly type: 'message';
  readonly message: A2UIMessage;
}

export type ParseSessionResult =
  | { ok: true; event: NexusSessionEvent }
  | { ok: false; error: A2UIError };

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isSessionVersion(value: unknown): boolean {
  return value === NEXUS_SESSION_VERSION;
}

function parseStart(data: Record<string, unknown>): ParseSessionResult {
  if (data.type !== undefined && data.type !== 'start') {
    return { ok: false, error: { code: 'PROTOCOL_INVALID', message: 'start 事件 type 不匹配' } };
  }
  if (!isSessionVersion(data.sessionVersion)) {
    return {
      ok: false,
      error: {
        code: 'PROTOCOL_INVALID',
        message: `不支持的 Nexus Session 版本: ${String(data.sessionVersion)}`,
      },
    };
  }
  if (
    !nonEmptyString(data.runId) ||
    !nonEmptyString(data.surfaceId) ||
    !nonEmptyString(data.catalogId)
  ) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: 'start 事件缺少非空 runId/surfaceId/catalogId' },
    };
  }
  if (data.contractVersion !== CATALOG_CONTRACT_VERSION) {
    return {
      ok: false,
      error: {
        code: 'PROTOCOL_INVALID',
        message: `start 事件 contractVersion 必须是 ${CATALOG_CONTRACT_VERSION}`,
      },
    };
  }
  if (!nonEmptyString(data.catalogHash) || !HASH_PATTERN.test(data.catalogHash)) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: 'start 事件 catalogHash 形状非法' },
    };
  }
  let surfaceRevision: number | undefined;
  if (data.surfaceRevision !== undefined) {
    if (
      typeof data.surfaceRevision !== 'number' ||
      !Number.isSafeInteger(data.surfaceRevision) ||
      data.surfaceRevision <= 0
    ) {
      return {
        ok: false,
        error: { code: 'PROTOCOL_INVALID', message: 'start 事件 surfaceRevision 必须为正安全整数' },
      };
    }
    surfaceRevision = data.surfaceRevision;
  }
  return {
    ok: true,
    event: {
      type: 'start',
      sessionVersion: NEXUS_SESSION_VERSION,
      runId: data.runId,
      surfaceId: data.surfaceId,
      catalogId: data.catalogId,
      contractVersion: data.contractVersion,
      catalogHash: data.catalogHash,
      ...(surfaceRevision === undefined ? {} : { surfaceRevision }),
    },
  };
}

function parseDiagnostics(value: unknown):
  | { ok: true; diagnostics?: NexusSessionDiagnostic[] }
  | {
      ok: false;
      message: string;
    } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value)) return { ok: false, message: 'diagnostics 必须是数组' };
  const diagnostics: NexusSessionDiagnostic[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry) || !nonEmptyString(entry.code) || !nonEmptyString(entry.message)) {
      return { ok: false, message: 'diagnostics 条目必须有非空 code 与 message' };
    }
    if (entry.path !== undefined && entry.path !== null && typeof entry.path !== 'string') {
      return { ok: false, message: 'diagnostics 条目 path 必须是字符串' };
    }
    if (
      entry.dataPath !== undefined &&
      entry.dataPath !== null &&
      typeof entry.dataPath !== 'string'
    ) {
      return { ok: false, message: 'diagnostics 条目 dataPath 必须是字符串' };
    }
    diagnostics.push({
      code: entry.code,
      message: entry.message.slice(0, NEXUS_SESSION_DIAGNOSTIC_LIMIT),
      ...(typeof entry.path === 'string' ? { path: entry.path } : {}),
      ...(typeof entry.dataPath === 'string' ? { dataPath: entry.dataPath } : {}),
    });
  }
  return { ok: true, diagnostics };
}

function parseError(data: Record<string, unknown>): ParseSessionResult {
  if (data.type !== undefined && data.type !== 'error') {
    return { ok: false, error: { code: 'PROTOCOL_INVALID', message: 'error 事件 type 不匹配' } };
  }
  if (!isSessionVersion(data.sessionVersion)) {
    return {
      ok: false,
      error: {
        code: 'PROTOCOL_INVALID',
        message: `不支持的 Nexus Session 版本: ${String(data.sessionVersion)}`,
      },
    };
  }
  if (!nonEmptyString(data.runId) || !nonEmptyString(data.surfaceId)) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: 'error 事件缺少非空 runId/surfaceId' },
    };
  }
  if (!NEXUS_SESSION_ERROR_CODES.includes(data.code as NexusSessionErrorCode)) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: `未知的 Session 错误码: ${String(data.code)}` },
    };
  }
  if (data.commitState !== 'notCommitted' && data.commitState !== 'unknown') {
    return {
      ok: false,
      error: {
        code: 'PROTOCOL_INVALID',
        message: 'error 事件 commitState 只允许 notCommitted|unknown',
      },
    };
  }
  if (data.message !== undefined && typeof data.message !== 'string') {
    return { ok: false, error: { code: 'PROTOCOL_INVALID', message: 'message 必须是字符串' } };
  }
  if (data.actionId !== undefined && !nonEmptyString(data.actionId)) {
    return { ok: false, error: { code: 'PROTOCOL_INVALID', message: 'actionId 必须是非空字符串' } };
  }
  if (
    data.beforeStart !== undefined &&
    (data.beforeStart !== true ||
      data.commitState !== 'notCommitted' ||
      data.code === 'RUN_COMMIT_UNKNOWN')
  ) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: 'beforeStart 只能为 true 且必须 notCommitted' },
    };
  }
  const diagnostics = parseDiagnostics(data.diagnostics);
  if (!diagnostics.ok) {
    return { ok: false, error: { code: 'PROTOCOL_INVALID', message: diagnostics.message } };
  }
  return {
    ok: true,
    event: {
      type: 'error',
      sessionVersion: NEXUS_SESSION_VERSION,
      runId: data.runId,
      surfaceId: data.surfaceId,
      code: data.code as NexusSessionErrorCode,
      commitState: data.commitState,
      ...(typeof data.message === 'string'
        ? { message: data.message.slice(0, NEXUS_SESSION_DIAGNOSTIC_LIMIT) }
        : {}),
      ...(diagnostics.diagnostics ? { diagnostics: diagnostics.diagnostics } : {}),
      ...(data.actionId === undefined ? {} : { actionId: data.actionId }),
      ...(data.beforeStart === true ? { beforeStart: true } : {}),
    },
  };
}

/**
 * 解析一个流事件（SSE 事件名 + data）。解析只负责单事件形状；顺序归
 * `createSessionStreamCheck`。未知版本/事件名显式拒绝；JSON 往返稳定。
 */
export function parseSessionEvent(name: string, data: unknown): ParseSessionResult {
  if (name !== 'start' && name !== 'message' && name !== 'done' && name !== 'error') {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: `未知的 Session 事件名: ${name}` },
    };
  }
  if (!isPlainObject(data)) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: `${name} 事件 data 必须是对象` },
    };
  }
  if (name === 'start') return parseStart(data);
  if (name === 'error') return parseError(data);
  if (name === 'done') {
    const commit = parseSurfaceCommit(data);
    if (!commit) {
      return {
        ok: false,
        error: { code: 'PROTOCOL_INVALID', message: 'done 事件携带的提交结果非法' },
      };
    }
    return { ok: true, event: { type: 'done', commit } };
  }
  const protocolResult = validateProtocolMessage(data);
  if (!protocolResult.ok || !protocolResult.message) {
    return {
      ok: false,
      error: protocolResult.error ?? { code: 'PROTOCOL_INVALID', message: 'A2UI 消息结构非法' },
    };
  }
  return { ok: true, event: { type: 'message', message: protocolResult.message } };
}

export interface SessionStreamCheck {
  /** 顺序规则校验下一个事件；返回拒绝原因，null 表示接受。 */
  push(event: NexusSessionEvent): string | null;
  /** EOF 检查：恰有一个终态的流才是完整的。 */
  end(): string | null;
  /** 是否已收到唯一终态。 */
  terminalSeen(): boolean;
}

/**
 * 流序列检查（SPEC §5.4）：start 是首事件（准备失败/排队取消例外：唯一 error）；
 * 保存 start 身份并核对后续事件的归属、契约及 action revision 推进。
 * 其后 message 零或多条；每条流恰一个终态
 * （done|error），终态后不得再有任何事件。
 */
export function createSessionStreamCheck(): SessionStreamCheck {
  let start: NexusSessionStartEvent | undefined;
  let terminal = false;
  return {
    push(event: NexusSessionEvent): string | null {
      if (terminal) return '终态之后不得再有任何事件';
      if (event.type === 'start') {
        if (start) return 'start 只能是首事件';
        start = { ...event };
        return null;
      }
      if (event.type === 'message') {
        if (!start) return 'message 必须出现在 start 之后';
        const payload =
          'createSurface' in event.message
            ? event.message.createSurface
            : 'updateComponents' in event.message
              ? event.message.updateComponents
              : 'updateDataModel' in event.message
                ? event.message.updateDataModel
                : event.message.deleteSurface;
        if (payload.surfaceId !== start.surfaceId) return 'message surfaceId 与 start 不一致';
        if ('catalogId' in payload && payload.catalogId !== start.catalogId) {
          return 'message catalogId 与 start 不一致';
        }
        return null;
      }
      // done | error：唯一终态
      if (
        !start &&
        !(
          event.type === 'error' &&
          event.commitState === 'notCommitted' &&
          (event.beforeStart === true || event.code === 'RUN_CANCELLED')
        )
      ) {
        return '终态前必须有 start（准备失败须 beforeStart:true，排队取消例外）';
      }
      if (start) {
        if (event.type === 'error') {
          if (event.beforeStart) return 'start 之后不得声明 beforeStart';
          if (event.runId !== start.runId || event.surfaceId !== start.surfaceId) {
            return 'error 运行身份与 start 不一致';
          }
        } else {
          for (const key of [
            'sessionVersion',
            'runId',
            'surfaceId',
            'catalogId',
            'contractVersion',
            'catalogHash',
          ] as const) {
            if (event.commit[key] !== start[key]) return `done ${key} 与 start 不一致`;
          }
          if (
            start.surfaceRevision !== undefined &&
            event.commit.surfaceRevision <= start.surfaceRevision
          ) {
            return 'action done revision 必须推进 start 基准';
          }
        }
      }
      terminal = true;
      return null;
    },
    end(): string | null {
      if (!terminal) return 'EOF 前未收到终态，运行不完整';
      return null;
    },
    terminalSeen(): boolean {
      return terminal;
    },
  };
}

export { NEXUS_SESSION_VERSION, parseSurfaceCommit };
export type { NexusSurfaceCommit };
