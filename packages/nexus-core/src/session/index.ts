/**
 * @nexus-ui/core/session —— Nexus Session v1 传输元数据契约。
 *
 * A2UI v0.9 消息保持自身形状；SDK 元数据（session version、actionId、
 * surfaceRevision、catalogHash、输入项）独立承载于 Nexus envelope，
 * 不写入 A2UI payload。字段语义见 SPEC §5.1；S3 的 start/done/error
 * 流事件与 S2 的 action 请求复用同一版本基线。
 */

import { CATALOG_CONTRACT_VERSION } from '../catalog';

/** Nexus Session 传输元数据版本；随 Session 契约破坏性变化提升，不做静默兼容。 */
export const NEXUS_SESSION_VERSION = 1 as const;

/**
 * 某次运行实际发布的 UI 提交结果。提交时固定，后续运行不能覆盖其值；
 * S2 的按 run 查询与 S3 的成功 done 复用此类型，不能从最新快照事后拼装。
 */
export interface NexusSurfaceCommit {
  readonly sessionVersion: typeof NEXUS_SESSION_VERSION;
  /** 服务端分配、在该 runtime 中不复用的运行标识；与产生本地视图的流关联。 */
  readonly runId: string;
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly contractVersion: number;
  /** 本次提交所用的固定 Catalog hash（`sha256:` 加 64 位十六进制）。 */
  readonly catalogHash: string;
  /** 本次实际提交的正安全整数 revision，不表示查询时的最新 revision。 */
  readonly surfaceRevision: number;
}

/** 浏览器提交的一个输入项；客户端只标识组件与绑定属性，永不提交目标写路径。 */
export interface NexusActionInput {
  /** 输入来源组件 id；必须存在于服务端已提交 surface 快照。 */
  readonly componentId: string;
  /** 可写绑定属性名（Catalog inputs 声明的键，例如 `value` 或自定义属性）。 */
  readonly property: string;
  /** 新值；由服务端按该属性的声明值 schema 严格校验。 */
  readonly value: unknown;
}

/** action 请求的 SDK 元数据段（`{ message, nexus }` 中的 `nexus`）。 */
export interface NexusActionMetadata {
  readonly sessionVersion: typeof NEXUS_SESSION_VERSION;
  /** 一次用户提交的客户端标识；不是领域幂等键，重放防护由服务端 ledger 承担。 */
  readonly actionId: string;
  /** 客户端观测到的已提交 surface revision；与服务端固定值不一致即拒绝。 */
  readonly surfaceRevision: number;
  /** 客户端观测到的 Catalog Contract hash；与服务端固定值不一致即拒绝。 */
  readonly catalogHash: string;
  /** 本批最新合法输入；数组顺序不携带语义，服务端整批校验后一次性应用。 */
  readonly inputs: readonly NexusActionInput[];
}

/** Runtime validation for the fixed successful commit carried by a run's done event. */
export function parseSurfaceCommit(value: unknown): NexusSurfaceCommit | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  if (
    c.sessionVersion !== NEXUS_SESSION_VERSION ||
    c.contractVersion !== CATALOG_CONTRACT_VERSION ||
    !Number.isSafeInteger(c.surfaceRevision) ||
    (c.surfaceRevision as number) <= 0 ||
    !['runId', 'surfaceId', 'catalogId'].every(
      (key) => typeof c[key] === 'string' && c[key] !== '',
    ) ||
    typeof c.catalogHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(c.catalogHash)
  )
    return null;
  return c as unknown as NexusSurfaceCommit;
}

// Session v1 流事件契约（SPEC §5.4，S3.4）：wire 形状、逐事件解析与流序列检查。
export {
  NEXUS_SESSION_DIAGNOSTIC_LIMIT,
  NEXUS_SESSION_ERROR_CODES,
  createSessionStreamCheck,
  parseSessionEvent,
} from './events';
export type {
  NexusSessionDiagnostic,
  NexusSessionDoneEvent,
  NexusSessionErrorEvent,
  NexusSessionErrorCode,
  NexusSessionEvent,
  NexusSessionEventName,
  NexusSessionMessageEvent,
  NexusSessionStartEvent,
  ParseSessionResult,
  SessionStreamCheck,
} from './events';
