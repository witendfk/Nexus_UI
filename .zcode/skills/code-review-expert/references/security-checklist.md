# 安全与可靠性清单

来源：sanyuan0704/sanyuan-skills `code-review-expert`（适配 OrderOps）。

## 输入/输出安全

- **XSS**：`dangerouslySetInnerHTML`、未转义模板、`innerHTML` 赋值、用户输入直接进 URL/src。
- **注入**：SQL 拼接（本项目 SQL 必须参数化）、命令拼接、log 注入。
- **SSRF**：用户可控 URL 进入 `fetch`/request；重定向绕过白名单。
- **原型污染**：对客户端 JSON 做 deep merge / `Object.assign` 到共享对象。
- **反序列化**：不受信来源的 `JSON.parse` 结果直接当内部类型使用（必须过 zod schema）。

## 信任边界（OrderOps 特有）

- `action.context` 客户端字段 ≠ 订单事实；案件归属只能经 `surface_bindings` 反查。
- 过期 surface（case_version 不匹配）提交必须拒绝。
- 模型输出只进受 schema 约束通道；证据 ID 必须属于工具快照。
- `/internal/*` 路由必须有 token 校验，仅本机进程可达。

## 认证/授权/密钥

- 硬编码凭据、`.env` 提交、密钥进日志。
- 越权：ID 直接来自请求而未校验归属（IDOR）。
- 鉴权缺失的路由（本项目除 health 外的 API 在多用户前必须有 actor）。

## 并发/竞态

- check-then-act 无锁（先查后写窗口）。
- 双击/重复提交：幂等键、唯一约束、ledger 是否兜底。
- 异步完成后的状态覆盖（过期响应晚到覆盖新状态）。
- SSE 流与业务事务的时序：事务先行，流失败不回滚。

## 错误处理

- 空 catch / 只打印不处理的异常吞噬。
- 未捕获的 promise rejection（尤其 `void fetch(...)`、`.then` 无 `.catch`）。
- 错误信息泄露内部细节（堆栈、SQL、路径）给客户端。

## 资源与边界

- 流/文件句柄未关闭；定时器/监听器未清理。
- 无上限的缓冲（字符串拼接流、无 maxBytes 的请求体读取）。
- 循环边界、`null`/`undefined` 访问、数组越界。
