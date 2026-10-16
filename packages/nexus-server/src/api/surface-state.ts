import type { NexusSurfaceCommit } from '@nexus-ui/core';

/**
 * S2 按运行查询的固定提交基线（SPEC §5.1）。
 * GET /api/a2ui/surface-state 必须同时指定 surfaceId/runId，查询该运行
 * 保存的提交结果；记录不可用时拒绝，不能回退为最新 surface 快照。
 * 浏览器只可把它关联到同一 run 的已校验成功流；单独查询不能恢复旧视图。
 * 路由、提交结果留存与宿主准入（runsAccess，缺省 403）由 S2.5 实施。
 */
export type SurfaceStateBaseline = NexusSurfaceCommit;
