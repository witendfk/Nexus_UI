import { z } from 'zod';

// ---------- 业务 action 输入契约（浏览器 → Host，经 resolveActionContext 提纯后）----------
// 客户端输入不可信：strict + 显式字段白名单。案件归属不经此契约——
// Host 通过 surfaceId 反查 surface_bindings，浏览器传什么都忽略（architecture.md §5.2）。

/** 备注长度上限与 A2UI TextField longText 的可用长度匹配；允许为空（备注非建单前置条件）。 */
export const CreateTicketInputSchema = z
  .object({
    note: z.string().max(1000),
  })
  .strict();

export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>;
