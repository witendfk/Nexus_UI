import { assertPositiveSafeInteger } from '../agent/limits';

/**
 * 运行时资源预算（S3.6，SPEC §6.6；默认值与 `fixtures/session-v1/budgets.json`
 * 同源）。所有数值预算必须为正安全整数；可空项（超时）只接受正安全整数或显式
 * null；非法值在工厂初始化时抛错，不静默采用默认值或关闭限制，0 不表示关闭。
 */
export interface AgentRuntimeBudgets {
  /** 每 surface 排队上限（默认 32；超限入队显式拒绝，HTTP 503）。 */
  maxQueuedPerSurface?: number;
  /** 活动、排队及隔离中的 surface 总上限，默认 512。 */
  maxTrackedSurfaces?: number;
  /** 单 surface 完整快照 UTF-8 JSON 字节，默认 8 MB（含固定 Catalog）。 */
  maxSnapshotBytes?: number;
  /** 单 surface 组件数量，默认 10000。 */
  maxComponentsPerSurface?: number;
  /** 每条 history turn / 每 surface history 字节上限。 */
  maxHistoryBytesPerTurn?: number;
  maxHistoryBytesPerSurface?: number;
  /** 非 HTTP 迭代消费水位及慢消费时限；最多预取一条超水位消息。 */
  eventHighWaterMarkBytes?: number;
  eventHighWaterMarkMessages?: number;
  eventSlowConsumerTimeoutMs?: number;
  /** 排队超时（默认不启用）；启用后超时按取消收敛并释放队列额度。 */
  queueTimeoutMs?: number | null;
  /** 执行超时（默认不启用）；启用后超时按取消收敛，晚到 handler 输出被丢弃。 */
  executionTimeoutMs?: number | null;
  /** 单 run 消息条数（默认 2000；超限流中结构化失败，不发布部分 UI）。 */
  maxMessagesPerRun?: number;
  /** 单条消息字节（默认 1,000,000；按 UTF-8 JSON 序列化字节计）。 */
  maxBytesPerMessage?: number;
  /** 单 run 累计消息字节（默认 8,000,000）。 */
  maxTotalBytesPerRun?: number;
  /** SSE 输出高水位字节（默认 1 MiB；超过后暂停读取，尊重背压）。 */
  sseHighWaterMark?: number;
  /** SSE 慢消费硬上限 ms（默认 30,000；暂停超时断流并失败运行）。 */
  slowConsumerTimeoutMs?: number;
  /** run 记录容量（默认 512；仅 runtime 新建的默认 manager 应用此值）。 */
  runRecords?: number;
  /** action ledger 容量（默认 1024；仅 runtime 新建的默认 ledger 应用此值）。 */
  actionLedgerRecords?: number;
  /** surface 快照容量（默认 256；仅 runtime 新建的默认 store 应用此值）。 */
  surfaceSnapshots?: number;
  /** history surface 容量（默认 64；仅 runtime 新建的默认 history 应用此值）。 */
  historySurfaces?: number;
  /** 每 surface history 轮数（默认 20）。 */
  historyTurnsPerSurface?: number;
}

/** run 级消息流预算（runtime guard 在调度任务内强制执行；默认常开）。 */
export interface RunStreamBudgets {
  maxMessagesPerRun: number;
  maxBytesPerMessage: number;
  maxTotalBytesPerRun: number;
  executionTimeoutMs: number | null;
}

/** SSE 适配预算（发送层强制执行；默认常开）。 */
export interface SseAdapterBudgets {
  highWaterMarkBytes: number;
  slowConsumerTimeoutMs: number;
}

export const DEFAULT_RUN_STREAM_BUDGETS: RunStreamBudgets = Object.freeze({
  maxMessagesPerRun: 2_000,
  maxBytesPerMessage: 1_000_000,
  maxTotalBytesPerRun: 8_000_000,
  executionTimeoutMs: null,
});
export const DEFAULT_SSE_HIGH_WATER_MARK = 1_048_576;
export const DEFAULT_SLOW_CONSUMER_TIMEOUT_MS = 30_000;

/** 可空超时项：正安全整数或显式 null；undefined 视为默认（null）。 */
function assertOptionalTimeout(name: string, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  assertPositiveSafeInteger(name, value);
}

/** 装配期校验：任何非法值显式抛错，不静默回退默认。 */
export function validateBudgets(budgets: AgentRuntimeBudgets): void {
  for (const key of [
    'maxQueuedPerSurface',
    ...(Object.keys(DEFAULT_STORAGE_BUDGETS) as (keyof typeof DEFAULT_STORAGE_BUDGETS)[]),
    'maxMessagesPerRun',
    'maxBytesPerMessage',
    'maxTotalBytesPerRun',
    'sseHighWaterMark',
    'slowConsumerTimeoutMs',
    'runRecords',
    'actionLedgerRecords',
    'surfaceSnapshots',
    'historySurfaces',
    'historyTurnsPerSurface',
  ] as const) {
    const value = budgets[key];
    if (value === undefined) continue;
    assertPositiveSafeInteger(`budgets.${key}`, value);
  }
  assertOptionalTimeout('budgets.queueTimeoutMs', budgets.queueTimeoutMs);
  assertOptionalTimeout('budgets.executionTimeoutMs', budgets.executionTimeoutMs);
}

/** 解析 run 级消息流预算；未配置项采用契约默认（预算默认常开，不等待装配）。 */
export function resolveRunStreamBudgets(budgets?: AgentRuntimeBudgets): RunStreamBudgets {
  return {
    maxMessagesPerRun: budgets?.maxMessagesPerRun ?? DEFAULT_RUN_STREAM_BUDGETS.maxMessagesPerRun,
    maxBytesPerMessage:
      budgets?.maxBytesPerMessage ?? DEFAULT_RUN_STREAM_BUDGETS.maxBytesPerMessage,
    maxTotalBytesPerRun:
      budgets?.maxTotalBytesPerRun ?? DEFAULT_RUN_STREAM_BUDGETS.maxTotalBytesPerRun,
    executionTimeoutMs:
      budgets?.executionTimeoutMs === undefined
        ? DEFAULT_RUN_STREAM_BUDGETS.executionTimeoutMs
        : budgets.executionTimeoutMs,
  };
}

/** 解析 SSE 适配预算；未配置项采用契约默认。 */
export function resolveSseBudgets(budgets?: AgentRuntimeBudgets): SseAdapterBudgets {
  return {
    highWaterMarkBytes: budgets?.sseHighWaterMark ?? DEFAULT_SSE_HIGH_WATER_MARK,
    slowConsumerTimeoutMs: budgets?.slowConsumerTimeoutMs ?? DEFAULT_SLOW_CONSUMER_TIMEOUT_MS,
  };
}

/** 独立持久状态与事件队列预算；默认值在此定义并导出供装配和 fixture 对拍。 */
export const DEFAULT_STORAGE_BUDGETS = Object.freeze({
  maxTrackedSurfaces: 512,
  maxSnapshotBytes: 8_000_000,
  maxComponentsPerSurface: 10_000,
  maxHistoryBytesPerTurn: 8_000_000,
  maxHistoryBytesPerSurface: 16_000_000,
  eventHighWaterMarkBytes: 1_048_576,
  eventHighWaterMarkMessages: 32,
  eventSlowConsumerTimeoutMs: 30_000,
});

/** Exact UTF-8 JSON size for protocol data; stop before allocating an oversized serialization. */
export function jsonBytes(value: unknown, limit = Number.MAX_SAFE_INTEGER): number {
  let bytes = 0;
  const ancestors = new WeakSet<object>();
  const add = (n: number): void => {
    bytes += n;
  };
  const visit = (item: unknown, depth: number): void => {
    if (bytes > limit) return;
    if (depth > 512) throw new Error('JSON 数据嵌套过深');
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
      add(4);
      return;
    }
    if (item === null || typeof item !== 'object') {
      if (typeof item === 'string' && Buffer.byteLength(item, 'utf8') > limit - bytes) {
        bytes = limit + 1;
        return;
      }
      add(Buffer.byteLength(JSON.stringify(item), 'utf8'));
      return;
    }
    if (ancestors.has(item)) throw new Error('JSON 数据含循环引用');
    ancestors.add(item);
    add(2);
    if (Array.isArray(item)) {
      // Even a sparse array has separators: reject enormous indices without walking holes.
      add(Math.max(0, item.length - 1));
      for (let i = 0; i < item.length && bytes <= limit; i++) visit(item[i], depth + 1);
    } else {
      let first = true;
      for (const key of Object.keys(item)) {
        const child = (item as Record<string, unknown>)[key];
        if (child === undefined || typeof child === 'function' || typeof child === 'symbol')
          continue;
        if (!first) add(1);
        first = false;
        visit(key, depth + 1);
        add(1);
        visit(child, depth + 1);
        if (bytes > limit) break;
      }
    }
    ancestors.delete(item);
  };
  if (value === undefined) return 0;
  visit(value, 0);
  return bytes;
}

/** Source return cleanup grace; unresolved work retains its bounded scheduler ownership. */
export const DEFAULT_SOURCE_CLEANUP_TIMEOUT_MS = 100;
