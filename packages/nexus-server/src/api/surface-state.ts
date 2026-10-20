import type Koa from 'koa';
import type Router from '@koa/router';
import type { NexusSurfaceCommit } from '@nexus-ui/core';

import type { AgentRunManager } from '../agent/run-manager';

/**
 * S2.5.3 按运行查询的固定提交基线（SPEC §5.1）。
 * GET /api/a2ui/surface-state 必须同时指定 surfaceId/runId，查询该运行
 * 保存的提交结果；记录不可用时拒绝，不能回退为最新 surface 快照。
 * 浏览器只可把它关联到同一 run 的已校验成功流；单独查询不能恢复旧视图。
 */
export type SurfaceStateBaseline = NexusSurfaceCommit;

/** 查询准入沿用宿主 `runsAccess`（S1 口径）：未配置一律 403，不新造权限模型。 */
export interface SurfaceStateQueryOptions {
  runManager: AgentRunManager;
  runsAccess?: (surfaceId: string, ctx: Koa.Context) => boolean | Promise<boolean>;
}

/**
 * S2.5.3 查询判定顺序（SPEC §5.1）：
 * 1. 缺失/空 surfaceId 或 runId → 400；
 * 2. 合法参数先执行宿主 `runsAccess`，未配置/拒绝均为 403（先鉴权后查记录，
 *    存在性不泄露给无权限调用方）；
 * 3. 记录不存在、surface 不匹配或已淘汰 → 404（同一响应体，不区分原因）；
 * 4. 记录存在但没有可确认提交（含排队/执行中与失败/取消终态）→ 409；
 * 5. 200 只读该记录在提交边界留存的固定 `NexusSurfaceCommit`——查询路径只
 *    访问 runManager，不读当前 surface 快照，结构上不存在回退最新基准的可能；
 *    历史结果不受后续提交或当前 surface 淘汰影响。
 */
export function registerSurfaceStateQueryRoute(
  router: Router,
  options: SurfaceStateQueryOptions,
): void {
  router.get('/api/a2ui/surface-state', async (ctx: Koa.Context) => {
    const surfaceId = ctx.query.surfaceId;
    const runId = ctx.query.runId;
    if (
      typeof surfaceId !== 'string' ||
      surfaceId === '' ||
      typeof runId !== 'string' ||
      runId === ''
    ) {
      ctx.status = 400;
      ctx.body = {
        error: 'INVALID_REQUEST',
        message: 'surfaceId 与 runId 都必须是非空字符串',
      };
      return;
    }

    // Runs pin a fixed committed baseline: access is deny-by-default, and the
    // host decides from its trusted request context before any record lookup.
    if (!options.runsAccess) {
      ctx.status = 403;
      ctx.body = {
        error: 'RUNS_ACCESS_NOT_CONFIGURED',
        message: '宿主必须配置 runsAccess 准入回调后，才能查询运行提交结果',
      };
      return;
    }
    const allowed = await options.runsAccess(surfaceId, ctx);
    if (allowed !== true) {
      ctx.status = 403;
      ctx.body = {
        error: 'RUNS_ACCESS_DENIED',
        message: '该 surface 的运行提交结果查询被宿主准入策略拒绝',
      };
      return;
    }

    const record = options.runManager.get(runId);
    if (!record || record.surfaceId !== surfaceId) {
      ctx.status = 404;
      ctx.body = {
        error: 'SURFACE_STATE_NOT_FOUND',
        message: '指定运行的提交结果不存在、surface 不匹配或已淘汰',
      };
      return;
    }
    // commit 只在提交边界由 recordCommit 写入一次：排队/执行中与失败/取消
    // 终态都没有可确认的 UI 提交结果，一律 409，不得以最新快照补位。
    if (record.commit === undefined) {
      ctx.status = 409;
      ctx.body = {
        error: 'SURFACE_STATE_COMMIT_UNAVAILABLE',
        message: '运行存在但尚无可确认的 UI 提交结果',
      };
      return;
    }
    ctx.body = record.commit;
  });
}
