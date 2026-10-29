import type { InputDraftSnapshot, NexusSurfaceCommit, SurfaceViewSnapshot } from '@nexus-ui/core';
import {
  A2UIRuntime,
  createSessionStreamCheck,
  parseSessionEvent,
  parseSurfaceCommit,
  type RuntimeOptions,
} from '@nexus-ui/core';
import type { SessionTransport, TransportResponse } from './transport';
import { fetchSseTransport } from './transport/fetch-sse';

/**
 * 会话控制器（S4.1，SPEC §7）：稳定 runtime + per-surface 预览/已提交/失同步
 * 状态机 + 门控 action 出口。语义抽取自两个参考浏览器（S2.6.3）：响应头权威
 * runId 关联、done 身份/hash/revision 门控、生成视图归属校验、草稿 extract/
 * confirm、终态后事件拒绝、EOF 不成功。transport 可注入；本模块不依赖 React
 * 与 Node server 包。
 *
 * 失败分级（与 server 提交三态同口径）：
 * - `failed`：服务端明确未提交、未改动本地视图且基准仍可信；准入拒绝按 desync；
 * - `desync`：提交状态不可知（缺运行标识、done 身份/版本不符、无效流、EOF 无终态、
 *   unknown），或候选完整校验/发布失败——此时不能证明视图与基准一致；
 * - `canceled`：生成取消或确定未发送的 action 取消；action 可能已发送则 desync。
 * 候选消息仅写隔离 runtime；成功完整接受后才发布，失败不污染原视图。
 */

export interface ClientSessionEndpoints {
  generate: string;
  event: string;
}

export interface ClientSessionOptions {
  /**
   * 外部 runtime：销毁归创建者。缺省自建 runtime，随 `dispose()` 释放关联状态。
   * 两种方式的 runtime 都由宿主注入 Catalog registry（门控写回与契约校验需要）。
   */
  runtime?: A2UIRuntime;
  /** 自建 runtime 的 Catalog 与资源装配；外部 runtime 时忽略。 */
  runtimeOptions?: RuntimeOptions;
  /**
   * 可信 Catalog hash 表（宿主从契约加载获得，浏览器经 Web Crypto 复算核对）。
   * generate 的 catalogId 与 done/action 基准的 catalogHash 都按此表门控；
   * 缺表项的请求在入口拒绝（fail-closed，不用当前快照补）。
   */
  catalogHashes?: ReadonlyMap<string, string>;
  /** transport 缺省 `fetchSseTransport()`。 */
  transport?: SessionTransport;
  endpoints: ClientSessionEndpoints;
  /** actionId 生成器；缺省 `crypto.randomUUID`（宿主可在 ActionEvent 已带 id 时透传）。 */
  createActionId?: () => string;
  /**
   * 订阅回调异常出口。订阅者（通常是宿主渲染层）抛错不会中断会话状态机；
   * 未提供时异常被吞掉（会话状态优先，不因 UI 回调回滚运行）。
   */
  onListenerError?: (error: unknown) => void;
}

export type SurfacePhase = 'streaming' | 'ready' | 'desync';

/** per-surface 冻结快照；状态未变时引用稳定，可配合 subscribeSurface。 */
export interface SurfaceStatus {
  surfaceId: string;
  catalogId: string | null;
  phase: SurfacePhase;
  /** 动作出口门控：仅 `phase === 'ready'` 且不在运行中为 true。 */
  actionOpen: boolean;
  busy: boolean;
  /** 固定提交基准（已冻结，宿主改写不会影响会话内部状态）。 */
  baseline: NexusSurfaceCommit | null;
  /** desync 原因（仅 desync 相位）；ready/streaming 为 null。 */
  blockReason: string | null;
  /** 本次运行候选视图；不会写入公开 runtime，也不授予动作资格。 */
  preview: SurfaceViewSnapshot | null;
}

export interface GenerateRequest {
  catalogId: string;
  message?: string;
}

export interface ActionRequest {
  surfaceId: string;
  name: string;
  sourceComponentId: string;
  context?: Record<string, unknown>;
  /** 缺省由 `createActionId` 生成；宿主透传 ActionEvent.actionId 时原样使用。 */
  actionId?: string;
}

export type RunResult =
  | { status: 'committed'; surfaceId: string; commit: NexusSurfaceCommit }
  /** 服务端明确未提交且基准仍可信：generate 丢弃预览，action 保留旧视图与门控。 */
  | { status: 'failed'; reason: string; surfaceId: string | null }
  | { status: 'canceled'; reason: string; surfaceId: string | null }
  /**
   * 提交状态不可知或视图已不可信：generate 丢弃预览；action 保留可见视图但关闭
   * 动作出口，等待重新生成或恢复（S4.1.2）。
   */
  | { status: 'desync'; reason: string; surfaceId: string | null }
  /** 在途重复提交被忽略（不打断当前运行）。 */
  | { status: 'ignored'; surfaceId: string };

/** 恢复输入：可信宿主同次读取的完整视图 + 固定提交；SDK 不认证任意 JSON 的来源。 */
export interface RecoverInput {
  view: SurfaceViewSnapshot;
  commit: NexusSurfaceCommit;
}

export interface ClientSession {
  readonly runtime: A2UIRuntime;
  readonly disposed: boolean;
  generate(request: GenerateRequest): Promise<RunResult>;
  action(request: ActionRequest): Promise<RunResult>;
  /**
   * 恢复（S4.1.2-C）：重验完整视图及 surface/Catalog/hash 与提交身份的一致性，
   * 成功时一次恢复视图、基准并重新开启动作资格，同时使该 surface 的在途旧 run
   * 失效（晚到帧/终态不再写入）。恢复拒绝时抛错，原视图/基准/草稿保持不变；
   * 不使用查询到的最新 revision 给旧视图续资格，不自动重试业务 action。
   */
  recover(input: RecoverInput): RunResult;
  /** 读取同一次成功提交的固定视图与身份；不含后续本地编辑或候选 patch。 */
  getCommittedSurface(surfaceId: string): Readonly<RecoverInput> | undefined;
  /** 仅指定 surface 状态变化时通知；getSurface 在状态不变时引用稳定。 */
  subscribeSurface(surfaceId: string, listener: () => void): () => void;
  /** 取消全部在途运行；只影响本次调用时在途的运行，之后仍可发起新运行。 */
  cancel(reason?: string): void;
  /** 销毁会话：取消在途运行、清空订阅与 surface 跟踪；之后调用入口抛错。 */
  dispose(): void;
  getSurface(surfaceId: string): SurfaceStatus | undefined;
  surfaces(): SurfaceStatus[];
  /** 会话状态变化通知；监听器内应通过 `getSurface` 读取新的冻结快照。 */
  subscribe(listener: (session: ClientSession) => void): () => void;
}

interface InternalSurface {
  surfaceId: string;
  catalogId: string | null;
  phase: SurfacePhase;
  busy: boolean;
  baseline: NexusSurfaceCommit | null;
  blockReason: string | null;
}

interface RunContext {
  kind: 'generate' | 'action';
  view: A2UIRuntime;
  controller: AbortController;
  runIdHeader: string | null;
  catalogId: string;
  /** 恢复/取消使本 run 失效后置位：晚到帧/晚到终态不再触碰视图与门控。 */
  superseded: boolean;
  /** generate：start/createSurface 透露的目标 surface；action：基准 surface。 */
  surfaceId: string | null;
  baseline: NexusSurfaceCommit | null;
  draftSnapshot: InputDraftSnapshot | null;
  createdSurfaceId: string | null;
  touched: Set<string>;
  check: ReturnType<typeof createSessionStreamCheck>;
  /** 运行级取消原因：只影响本次运行，不阻塞后续运行。 */
  canceled: string | null;
  /** open 已调用即可能送达宿主，响应头未到不代表未提交。 */
  attempted: boolean;
  ownsTracking: boolean;
  publishing?: boolean;
}

/** 流本身不可信：提交状态无法证明，按 desync 收敛。 */
class StreamFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamFailure';
  }
}

export function createClientSession(options: ClientSessionOptions): ClientSession {
  if (!options.endpoints?.generate || !options.endpoints?.event) {
    throw new Error('createClientSession 需要显式 endpoints（generate/event）');
  }
  const transport = options.transport ?? fetchSseTransport();
  const runtime = options.runtime ?? new A2UIRuntime(options.runtimeOptions);
  const surfaces = new Map<string, InternalSurface>();
  const listeners = new Set<(session: ClientSession) => void>();
  const runs = new Set<RunContext>();
  const committedViews = new Map<string, Readonly<RecoverInput>>();
  const statusCache = new Map<string, SurfaceStatus>();
  const surfaceListeners = new Map<string, Set<() => void>>();
  const observed = new Map<string, SurfaceStatus | undefined>();
  const recovering = new Set<string>();
  let disposed = false;

  const notify = (): void => {
    for (const [id, callbacks] of [...surfaceListeners]) {
      if (disposed) break;
      const current = session.getSurface(id);
      if (observed.get(id) === current) continue;
      observed.set(id, current);
      for (const callback of [...callbacks]) {
        if (disposed) break;
        try {
          callback();
        } catch (error) {
          try {
            options.onListenerError?.(error);
          } catch {
            /* 观察者异常隔离。 */
          }
        }
      }
    }
    for (const listener of [...listeners]) {
      if (disposed) break;
      try {
        listener(session);
      } catch (error) {
        // 订阅者（宿主渲染层）异常不改变会话状态，也不打断其他订阅者。
        try {
          options.onListenerError?.(error);
        } catch {
          // 异常报告器同属宿主回调，不能破坏运行生命周期。
        }
      }
    }
  };

  const snapshot = (surface: InternalSurface): SurfaceStatus => {
    const active = surface.busy
      ? [...runs].find((run) => !run.superseded && run.surfaceId === surface.surfaceId)
      : undefined;
    const next: SurfaceStatus = {
      surfaceId: surface.surfaceId,
      catalogId: surface.catalogId,
      phase: surface.phase,
      actionOpen: surface.phase === 'ready' && !surface.busy,
      busy: surface.busy,
      baseline: surface.baseline,
      blockReason: surface.blockReason,
      preview: active?.view.getSurfaceView(surface.surfaceId) ?? null,
    };
    const cached = statusCache.get(surface.surfaceId);
    if (
      cached &&
      (Object.keys(next) as Array<keyof SurfaceStatus>).every((key) => cached[key] === next[key])
    )
      return cached;
    const value = Object.freeze(next);
    statusCache.set(surface.surfaceId, value);
    return value;
  };

  const touch = (): void => notify();

  const fail = (message: string): Error => new Error(message);

  const closeResponse = async (response: TransportResponse | null): Promise<void> => {
    if (!response?.close) return;
    try {
      await response.close();
    } catch {
      // 释放失败不覆盖运行结论；连接由底层超时兜底。
    }
  };

  const runStream = async (ctx: RunContext, url: string, body: unknown): Promise<RunResult> => {
    runs.add(ctx);
    let response: TransportResponse | null = null;
    try {
      if (ctx.kind === 'action') touch();
      assertActive(ctx);
      ctx.attempted = true;
      response = await transport.open({ url, body, signal: ctx.controller.signal });
      assertActive(ctx);
      if (!response.runIdHeader) {
        throw new StreamFailure('响应缺少运行标识头，本次运行不可关联');
      }
      ctx.runIdHeader = response.runIdHeader;
      // 终态之后继续消费至 EOF：终态后的任何额外事件由流序检查判为无效流。
      let terminal: RunResult | null = null;
      for await (const frame of response.frames) {
        assertActive(ctx);
        const parsedJson = parseJson(frame.data);
        const parsed = parseSessionEvent(frame.event, parsedJson);
        if (!parsed.ok) {
          throw new StreamFailure(`非法 Session 事件（${frame.event}）：${parsed.error.message}`);
        }
        const sequenceIssue = ctx.check.push(parsed.event);
        if (sequenceIssue !== null) throw new StreamFailure(`流序违反：${sequenceIssue}`);

        if (parsed.event.type === 'start') {
          const start = parsed.event;
          if (start.runId !== ctx.runIdHeader)
            throw new StreamFailure('start.runId 与响应头不一致');
          if (ctx.kind === 'action' && start.surfaceId !== ctx.baseline?.surfaceId) {
            throw new StreamFailure('start 的 surface 与 action 基准不一致');
          }
          if (ctx.kind === 'generate') {
            if (ctx.surfaceId !== null && start.surfaceId !== ctx.surfaceId) {
              throw new StreamFailure('多个 start 的 surface 不一致');
            }
            if (surfaces.has(start.surfaceId)) {
              throw new StreamFailure('生成目标 surface 已由其他运行跟踪');
            }
            ctx.surfaceId = start.surfaceId;
            ctx.ownsTracking = true;
            markStreaming(ctx.surfaceId, ctx.catalogId);
          }
        } else if (parsed.event.type === 'message') {
          if (ctx.surfaceId === null) throw new StreamFailure('start 之前收到 message');
          applyOwnedMessage(ctx, parsed.event.message as unknown as Record<string, unknown>);
        } else if (parsed.event.type === 'done') {
          terminal = validateDone(ctx, parsed.event.commit);
        } else {
          const payload = parsed.event;
          if (
            payload.runId !== ctx.runIdHeader ||
            (ctx.surfaceId !== null && payload.surfaceId !== ctx.surfaceId)
          ) {
            throw new StreamFailure('error 的运行或 surface 与本次请求不一致');
          }
          const reason = payload.message ?? `运行失败（${payload.code}）`;
          // 准入拒绝未细分 revision/hash 原因，保守失同步；不解析错误文案。
          terminal =
            payload.commitState === 'unknown' || payload.code === 'RUN_ADMISSION_REJECTED'
              ? {
                  status: 'desync',
                  reason: `运行失败且无法确认视图基准：${reason}`,
                  surfaceId: ctx.surfaceId,
                }
              : { status: 'failed', reason, surfaceId: ctx.surfaceId };
        }
      }
      // 注入的 transport 可能在 abort 后正常 EOF；终态副作用前仍须校验。
      assertActive(ctx);
      if (terminal === null) {
        // EOF 无终态：不成功（R5），提交状态不可知。
        return settle(ctx, '流在终态前结束（EOF 不等于成功）', true);
      }
      if (terminal.status === 'committed') return acceptCommitted(ctx, terminal);
      return applyTerminalSideEffects(ctx, terminal);
    } catch (error) {
      if (ctx.superseded) {
        // 恢复取代的旧 run：晚到帧/终态不再触碰视图、基准与门控。
        return {
          status: 'canceled',
          reason: '该 surface 已被恢复取代',
          surfaceId: ctx.surfaceId,
        };
      }
      if (ctx.canceled !== null) return finishCanceled(ctx, ctx.canceled);
      if (error instanceof DOMException && error.name === 'AbortError') {
        return finishCanceled(ctx, '运行已取消');
      }
      const reason = error instanceof Error ? error.message : String(error);
      const commitUnknown = error instanceof StreamFailure || ctx.attempted;
      return settle(ctx, reason, commitUnknown);
    } finally {
      await closeResponse(response);
      runs.delete(ctx);
    }
  };

  const canceledError = (ctx: RunContext): Error => {
    return new DOMException(ctx.canceled ?? '运行已取消', 'AbortError');
  };

  const assertActive = (ctx: RunContext): void => {
    if (disposed || ctx.superseded || ctx.canceled !== null || !runs.has(ctx)) {
      throw canceledError(ctx);
    }
  };

  const parseJson = (data: string): Record<string, unknown> => {
    let value: unknown;
    try {
      value = JSON.parse(data) as unknown;
    } catch (error) {
      throw new StreamFailure(
        `SSE data 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new StreamFailure('SSE data 不是 JSON 对象');
    }
    return value as Record<string, unknown>;
  };

  /** 消息归属与生成视图校验后喂入 runtime（与参考浏览器同口径）。 */
  const applyOwnedMessage = (ctx: RunContext, message: Record<string, unknown>): void => {
    assertActive(ctx);
    const created = message.createSurface as
      | { surfaceId?: unknown; catalogId?: unknown }
      | undefined;
    if (created !== undefined) {
      if (ctx.kind !== 'generate' || ctx.createdSurfaceId !== null) {
        throw new StreamFailure('action 流不允许 createSurface');
      }
      if (
        typeof created.surfaceId !== 'string' ||
        typeof created.catalogId !== 'string' ||
        created.catalogId !== ctx.catalogId ||
        (ctx.surfaceId !== null && created.surfaceId !== ctx.surfaceId) ||
        Object.prototype.hasOwnProperty.call(runtime.store.getState().surfaces, created.surfaceId)
      ) {
        throw new StreamFailure('生成视图与本次请求不匹配');
      }
      ctx.createdSurfaceId = created.surfaceId;
      ctx.touched.add(created.surfaceId);
    }
    for (const key of ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']) {
      const payload = message[key] as { surfaceId?: unknown } | undefined;
      if (payload?.surfaceId !== undefined) {
        if (ctx.surfaceId === null) throw new StreamFailure('start 之前收到消息载荷');
        if (payload.surfaceId !== ctx.surfaceId) {
          throw new StreamFailure('消息 surface 与本次运行不一致');
        }
        ctx.touched.add(String(payload.surfaceId));
      }
    }
    const accepted = ctx.view.dispatchChecked(message);
    if (!accepted.ok) {
      throw new StreamFailure(`本地 runtime 拒绝消息：${accepted.error?.message ?? '准入失败'}`);
    }
    touch();
    assertActive(ctx);
  };

  const validateDone = (ctx: RunContext, raw: unknown): RunResult => {
    if (!ctx.runIdHeader) {
      throw new StreamFailure('响应缺少运行标识头，不开放后续 action');
    }
    const parsed = parseSurfaceCommit(raw);
    if (!parsed) throw new StreamFailure('done 提交基准无效');
    if (parsed.runId !== ctx.runIdHeader) throw new StreamFailure('done 运行标识与响应头不一致');
    const expectedHash = options.catalogHashes?.get(ctx.catalogId);
    if (
      parsed.catalogId !== ctx.catalogId ||
      expectedHash === undefined ||
      parsed.catalogHash !== expectedHash
    ) {
      throw new StreamFailure('done 的 Catalog/hash 与已加载契约不一致');
    }
    if (ctx.kind === 'action') {
      const baseline = ctx.baseline!;
      if (
        parsed.surfaceId !== baseline.surfaceId ||
        parsed.sessionVersion !== baseline.sessionVersion ||
        parsed.contractVersion !== baseline.contractVersion ||
        parsed.catalogHash !== baseline.catalogHash ||
        parsed.surfaceRevision <= baseline.surfaceRevision
      ) {
        throw new StreamFailure('提交身份或 revision 与本次 action 基准不匹配');
      }
    }
    if (ctx.kind === 'generate') {
      if (ctx.surfaceId === null || ctx.createdSurfaceId !== parsed.surfaceId) {
        throw new StreamFailure('done 的 surface 与本次生成的创建不一致');
      }
      const touchedIds = [...ctx.touched];
      if (
        touchedIds.some((id) => id !== parsed.surfaceId) ||
        !ctx.touched.has(parsed.surfaceId) ||
        ctx.view.store.getState().componentsBySurface[parsed.surfaceId]?.root === undefined ||
        ctx.view.store.getState().surfaces[parsed.surfaceId]?.catalogId !== parsed.catalogId
      ) {
        throw new StreamFailure('生成流未通过本地完整性校验（root/归属）');
      }
    }
    return {
      status: 'committed',
      surfaceId: parsed.surfaceId,
      commit: Object.freeze({ ...parsed }),
    };
  };

  /** EOF 且流有效后才应用成功终态的本地副作用（baseline/门控/草稿确认）。 */
  const acceptCommitted = (ctx: RunContext, terminal: RunResult): RunResult => {
    assertActive(ctx);
    if (terminal.status !== 'committed') return terminal;
    const surface = requireSurface(ctx);
    const candidate = ctx.view.getSurfaceView(terminal.surfaceId);
    if (!candidate) throw new StreamFailure('提交缺少完整候选视图');
    // 完整 final 校验与草稿协调均先于发布；失败不污染原视图或确认草稿。
    ctx.publishing = true;
    recovering.add(terminal.surfaceId);
    try {
      if (ctx.kind === 'action' && ctx.draftSnapshot)
        runtime.commitSurfaceView(candidate, ctx.draftSnapshot);
      else runtime.restoreSurfaceView(candidate);
    } finally {
      ctx.publishing = false;
      recovering.delete(terminal.surfaceId);
    }
    if (disposed) return terminal;
    committedViews.set(
      terminal.surfaceId,
      Object.freeze({ view: candidate, commit: terminal.commit }),
    );
    surface.phase = 'ready';
    surface.busy = false;
    surface.baseline = terminal.commit;
    surface.blockReason = null;
    touch();
    return terminal;
  };

  /** 终态的本地副作用：显式失败保留旧门控；desync 关闭出口。 */
  const applyTerminalSideEffects = (ctx: RunContext, terminal: RunResult): RunResult => {
    if (terminal.status === 'failed') {
      if (ctx.kind === 'generate') {
        dropPreview(ctx);
        return terminal;
      }
      // 候选 patch 已隔离；可信 notCommitted 不改变原提交视图与基准。
      const surface = ctx.surfaceId !== null ? surfaces.get(ctx.surfaceId) : undefined;
      if (surface) {
        surface.busy = false;
        touch();
      }
      return terminal;
    }
    if (terminal.status === 'desync') return finishDesync(ctx, terminal.reason);
    return terminal;
  };

  /** generate 的预览丢弃：没有固定基准的半个视图不可交互，也不再保留跟踪。 */
  const dropPreview = (ctx: RunContext): void => {
    if (ctx.superseded) return;
    if (ctx.createdSurfaceId !== null) ctx.view.removeSurfaceView(ctx.createdSurfaceId);
    if (ctx.ownsTracking && ctx.surfaceId !== null) {
      surfaces.delete(ctx.surfaceId);
      statusCache.delete(ctx.surfaceId);
    }
    touch();
  };

  const settle = (ctx: RunContext, reason: string, commitUnknown: boolean): RunResult => {
    if (ctx.kind === 'generate') {
      dropPreview(ctx);
      return { status: commitUnknown ? 'desync' : 'failed', reason, surfaceId: ctx.surfaceId };
    }
    // action：提交状态不可知 → 关闭动作出口，候选不影响原视图。
    if (commitUnknown) return finishDesync(ctx, reason);
    const surface = ctx.surfaceId !== null ? surfaces.get(ctx.surfaceId) : undefined;
    if (surface) {
      surface.busy = false;
      touch();
    }
    return { status: 'failed', reason, surfaceId: ctx.surfaceId };
  };

  const finishDesync = (ctx: RunContext, reason: string): RunResult => {
    const surfaceId = ctx.surfaceId ?? ctx.baseline?.surfaceId ?? null;
    if (disposed || surfaceId === null) {
      return { status: 'desync', reason, surfaceId };
    }
    const surface = requireSurfaceById(surfaceId);
    surface.phase = 'desync';
    surface.busy = false;
    surface.blockReason = reason;
    touch();
    return { status: 'desync', reason, surfaceId };
  };

  const finishCanceled = (ctx: RunContext, reason: string): RunResult => {
    if (ctx.superseded) {
      return { status: 'canceled', reason: '该 surface 已被恢复取代', surfaceId: ctx.surfaceId };
    }
    // 本地取消不能证明宿主未执行；只有确定未发送的 action 保留旧资格。
    if (ctx.kind === 'action' && ctx.attempted) {
      return finishDesync(ctx, `${reason}（请求可能已提交，视图需重新同步）`);
    }
    if (ctx.kind === 'generate' && ctx.createdSurfaceId !== null)
      ctx.view.removeSurfaceView(ctx.createdSurfaceId);
    const surface = ctx.surfaceId !== null ? surfaces.get(ctx.surfaceId) : undefined;
    if (surface && ctx.kind === 'action') {
      surface.busy = false;
    } else if (surface && ctx.ownsTracking) {
      surfaces.delete(surface.surfaceId);
    }
    touch();
    return { status: 'canceled', reason, surfaceId: ctx.surfaceId };
  };

  const markStreaming = (surfaceId: string, catalogId: string): void => {
    let surface = surfaces.get(surfaceId);
    if (!surface) {
      surface = {
        surfaceId,
        catalogId,
        phase: 'streaming',
        busy: true,
        baseline: null,
        blockReason: null,
      };
      surfaces.set(surfaceId, surface);
    } else {
      surface.phase = 'streaming';
      surface.busy = true;
    }
    touch();
  };

  const requireSurface = (ctx: RunContext): InternalSurface => {
    const surfaceId = ctx.surfaceId;
    if (surfaceId === null) throw fail('运行未绑定 surface');
    return requireSurfaceById(surfaceId);
  };

  const requireSurfaceById = (surfaceId: string): InternalSurface => {
    let surface = surfaces.get(surfaceId);
    if (!surface) {
      surface = {
        surfaceId,
        catalogId: runtime.store.getState().surfaces[surfaceId]?.catalogId ?? null,
        phase: 'desync',
        busy: false,
        baseline: null,
        blockReason: '运行未经过正常状态跟踪',
      };
      surfaces.set(surfaceId, surface);
    }
    return surface;
  };

  const assertLive = (): void => {
    if (disposed) throw fail('session 已销毁');
  };

  const session: ClientSession = {
    runtime,
    get disposed(): boolean {
      return disposed;
    },

    async generate(request: GenerateRequest): Promise<RunResult> {
      assertLive();
      const expectedHash = options.catalogHashes?.get(request.catalogId);
      if (expectedHash === undefined) {
        throw fail(`未加载 Catalog 契约或缺少 hash: ${request.catalogId}`);
      }
      const ctx: RunContext = {
        kind: 'generate',
        view: runtime.createViewRuntime(),
        controller: new AbortController(),
        runIdHeader: null,
        superseded: false,
        catalogId: request.catalogId,
        surfaceId: null,
        baseline: null,
        draftSnapshot: null,
        createdSurfaceId: null,
        touched: new Set(),
        check: createSessionStreamCheck(),
        canceled: null,
        attempted: false,
        ownsTracking: false,
      };
      return runStream(ctx, options.endpoints.generate, {
        ...(request.message === undefined ? {} : { message: request.message }),
        catalogId: request.catalogId,
      });
    },

    async action(request: ActionRequest): Promise<RunResult> {
      assertLive();
      const surface = surfaces.get(request.surfaceId);
      if (!surface || surface.phase !== 'ready' || !surface.baseline) {
        return {
          status: 'desync',
          reason: '该 surface 未就绪或已失同步，动作出口被门控',
          surfaceId: request.surfaceId,
        };
      }
      if (surface.busy || recovering.has(request.surfaceId)) {
        return { status: 'ignored', surfaceId: request.surfaceId };
      }
      const baseline = surface.baseline;
      const current = runtime.getSurfaceView(request.surfaceId);
      if (!current) {
        surface.phase = 'desync';
        surface.blockReason = '已提交视图已移除';
        touch();
        return { status: 'desync', surfaceId: request.surfaceId, reason: '已提交视图已移除' };
      }
      const view = runtime.createViewRuntime();
      view.restoreSurfaceView(current);
      const draftSnapshot = runtime.extractLatestInputDrafts(request.surfaceId);
      const actionId = request.actionId ?? options.createActionId?.() ?? defaultActionId();
      const body = {
        message: {
          version: 'v0.9',
          action: {
            name: request.name,
            surfaceId: request.surfaceId,
            sourceComponentId: request.sourceComponentId,
            timestamp: new Date().toISOString(),
            context: structuredClone(request.context ?? {}),
            actionId,
          },
        },
        nexus: {
          sessionVersion: baseline.sessionVersion,
          actionId,
          surfaceRevision: baseline.surfaceRevision,
          catalogHash: baseline.catalogHash,
          inputs: draftSnapshot.entries.map((entry) => entry.input),
        },
      };
      surface.busy = true;
      const ctx: RunContext = {
        kind: 'action',
        view,
        controller: new AbortController(),
        runIdHeader: null,
        superseded: false,
        catalogId: baseline.catalogId,
        surfaceId: request.surfaceId,
        baseline,
        draftSnapshot,
        createdSurfaceId: null,
        touched: new Set(),
        check: createSessionStreamCheck(),
        canceled: null,
        attempted: false,
        ownsTracking: false,
      };
      return runStream(ctx, options.endpoints.event, body);
    },

    recover(input: RecoverInput): RunResult {
      assertLive();
      // 纯校验先行：任一失败在触碰状态前抛错（恢复拒绝保持原状态）。
      const checked = parseSurfaceCommit(input.commit);
      if (!checked) throw fail('恢复提交基准无效');
      const parsed = Object.freeze({
        sessionVersion: checked.sessionVersion,
        contractVersion: checked.contractVersion,
        runId: checked.runId,
        surfaceId: checked.surfaceId,
        catalogId: checked.catalogId,
        catalogHash: checked.catalogHash,
        surfaceRevision: checked.surfaceRevision,
      });
      const view = input.view;
      if (!view || typeof view !== 'object') throw fail('恢复输入缺少完整视图快照');
      if (view.surfaceId !== parsed.surfaceId) {
        throw fail(`恢复视图 surface 与提交身份不一致: ${view.surfaceId} ≠ ${parsed.surfaceId}`);
      }
      if (view.catalogId !== parsed.catalogId) {
        throw fail(`恢复视图 Catalog 与提交身份不一致: ${view.catalogId} ≠ ${parsed.catalogId}`);
      }
      const expectedHash = options.catalogHashes?.get(parsed.catalogId);
      if (expectedHash === undefined || parsed.catalogHash !== expectedHash) {
        throw fail('恢复提交的 Catalog/hash 与已加载契约不一致');
      }
      const previous = committedViews.get(parsed.surfaceId);
      const sameCommit =
        previous !== undefined &&
        (Object.keys(parsed) as Array<keyof NexusSurfaceCommit>).every(
          (key) => parsed[key] === previous.commit[key],
        );
      if (
        previous &&
        (parsed.surfaceRevision < previous.commit.surfaceRevision ||
          (parsed.surfaceRevision === previous.commit.surfaceRevision &&
            (!sameCommit || !sameView(view, previous.view))))
      ) {
        throw fail('恢复快照已过期或与同版本固定提交冲突');
      }
      if (recovering.has(parsed.surfaceId)) throw fail('该 surface 正在恢复');
      // 先以同一配置纯重验并持有冻结副本；观察者不能改写本次恢复输入。
      const validated = runtime.createViewRuntime();
      validated.restoreSurfaceView(view);
      const owned = validated.getSurfaceView(parsed.surfaceId)!;
      recovering.add(parsed.surfaceId);
      try {
        runtime.restoreSurfaceView(owned);
        for (const run of [...runs]) {
          if (run.surfaceId !== parsed.surfaceId) continue;
          run.superseded = true;
          runs.delete(run);
          run.controller.abort('恢复取代');
        }
        if (!disposed) {
          const fixed = sameCommit
            ? previous!
            : Object.freeze({ view: owned, commit: Object.freeze({ ...parsed }) });
          committedViews.set(parsed.surfaceId, fixed);
          const surface = requireSurfaceById(parsed.surfaceId);
          surface.phase = 'ready';
          surface.busy = false;
          surface.baseline = fixed.commit;
          surface.blockReason = null;
          touch();
        }
        return { status: 'committed', surfaceId: parsed.surfaceId, commit: parsed };
      } finally {
        recovering.delete(parsed.surfaceId);
      }
    },

    getCommittedSurface(surfaceId: string): Readonly<RecoverInput> | undefined {
      return committedViews.get(surfaceId);
    },

    subscribeSurface(surfaceId: string, listener: () => void): () => void {
      assertLive();
      let callbacks = surfaceListeners.get(surfaceId);
      if (!callbacks) {
        callbacks = new Set();
        surfaceListeners.set(surfaceId, callbacks);
        observed.set(surfaceId, session.getSurface(surfaceId));
      }
      callbacks.add(listener);
      return () => {
        const set = surfaceListeners.get(surfaceId);
        set?.delete(listener);
        if (!set?.size) {
          surfaceListeners.delete(surfaceId);
          observed.delete(surfaceId);
        }
      };
    },

    cancel(reason?: string): void {
      const message = reason ?? '会话取消';
      for (const run of [...runs]) {
        if (run.publishing) continue;
        run.canceled = message;
        run.controller.abort(message);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const run of [...runs]) {
        run.canceled = 'session 已销毁';
        run.controller.abort('session 已销毁');
      }
      runs.clear();
      surfaces.clear();
      if (options.runtime === undefined) {
        for (const id of Object.keys(runtime.store.getState().surfaces))
          runtime.removeSurfaceView(id);
      }
      listeners.clear();
      surfaceListeners.clear();
      observed.clear();
      statusCache.clear();
      committedViews.clear();
    },

    getSurface(surfaceId: string): SurfaceStatus | undefined {
      const surface = surfaces.get(surfaceId);
      return surface ? snapshot(surface) : undefined;
    },

    surfaces(): SurfaceStatus[] {
      return [...surfaces.values()].map(snapshot);
    },

    subscribe(listener: (session: ClientSession) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return session;
}

function defaultActionId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sameView(a: SurfaceViewSnapshot, b: SurfaceViewSnapshot): boolean {
  // 比较 JSON 内容而非键插入顺序；不把本地编辑模型当固定提交快照。
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    return value;
  };
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
