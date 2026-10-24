# fixtures/session-v1 — Session v1 运行与提交事实共享契约 fixture

S3.1 定稿（2026-10-22）。本目录是 server 运行时（S3.2–S3.6）与 core session 解析
（S3.4.1）的对测数据源：同一份 oracle 对「调度/提交/取消/预算」必须给出一致结论，
与非 Koa 消费和 Koa/SSE 消费无关（PRD R5/R6）。fixture 为纯数据与预期声明，
全部业务中立，不等待任何宿主 Agent 或业务应用。

2026-10-24 S3.4 复审接线：core `test/session/fixtures.test.ts` 与 server
`test/runtime/session-fixtures.test.ts` 实际读取 accept-generation、
accept-action-with-inputs、reject-admission-stale-revision、unknown-store-commit-throw
四份 oracle；server 同时验证直接事件与实际 SSE 目的流。旧 stale oracle 的客户端
基准误用、输入基础模型/handler patch 条数与 unknown 提交前消息漏项已按 SPEC
§5.4 和真实调用顺序校准。其余取消/重放/资源 oracle 的直接数据接线仍由相应
切片补齐，不能将本次四份对测视为整个 fixture 目录验收。

## 文件分类

- `catalog.json`：本目录共享的中立 Catalog 声明夹具，形状与 `fixtures/catalog-v2` 的
  catalog 夹具一致，供流 oracle 引用。
- `budgets.json`：运行资源预算默认值、计量单位、所有者、超限行为与拒绝点。
  实现必须据此断言「非法配置装配抛错、超限显式拒绝、活动记录不淘汰」。
- `*.json` 流 oracle（`kind: "session-stream"`）：一次运行的事件序列与提交事实预期。
  core 解析器按 `expected.events` 校验 wire 形状与序列规则；server 运行时按
  `expected.terminal`/`commitState`/计数器校验实际行为。

## 需求映射

| oracle | 需求 | 可证伪断言 |
| --- | --- | --- |
| accept-generation / accept-action-with-inputs | R5、R6 | start→message\*→done 恰一终态；done 即本次固定提交 |
| reject-admission-stale-revision | R5 | 旧基准在调度内被拒，handler 零调用，UI 不变 |
| cancel-queued / cancel-racing-commit | R5 | 排队取消不调工厂/handler；取消不倒写已提交事实 |
| fail-after-handler-side-effect | R5 | patch 拒绝不回滚已执行副作用，也不重放 handler |
| unknown-store-commit-throw | R5 | store 异常报 unknown，不推断未提交、不自动重试 |
| reject-duplicate-action-id | R5、R6 | 留存窗口内同 actionId 只进一次 handler |
| capacity-rejected-enqueue | R6、R7 | 排队超限在入队拒绝，不建运行记录、不占用响应 |
| slow-consumer-large-output | R6、R7 | 合法大流完整收到终态，不误判空输出 |
| observer-failure-after-commit | R5 | 发布后 history/hook/传输失败不改写 UI 提交事实 |

## 流 oracle envelope

```json
{
  "id": "目录内唯一的 oracle 名",
  "kind": "session-stream",
  "scenario": "generation | action | cancel | commit-facts | duplicate | capacity | slow-consumer | observer-failure",
  "requirements": ["关联的 PRD 需求 ID"],
  "catalog": "引用 catalog.json 的 id",
  "request": {
    "kind": "generate | action",
    "generate": { "catalogId": "...", "message": "..." },
    "action": { "message": {}, "nexus": {} }
  },
  "setup": {
    "fixedSurfaceId": "可选；动作基准依赖固定 surfaceId 重建场景时为 true",
    "surface": { "messages": ["与 catalog-v2 request 夹具同构的初始 surface 消息"] }
  },
  "source": {
    "messages": ["候选 A2UI 消息；或 generate 声明 messageCount/minTotalBytes 由测试批量生成"]
  },
  "steps": [
    { "enqueue": "run 标签", "suspendUntil": "可选恢复标签" },
    { "interleave": "并行注入的其他运行或故障注入", "awaitTerminal": "可选" },
    { "resume": "run 标签" },
    { "cancel": "run 标签", "at": "queued | admission | store-commit | response-write" },
    { "inject": "store-throw | history-throw | hook-throw | record-throw", "at": "提交边界位置" }
  ],
  "expected": {
    "events": [
      { "event": "start", "surfaceRevision": "正安全整数或 null（generation 无旧基准）" },
      { "event": "message", "count": 3 },
      { "event": "done", "surfaceRevision": 2 }
    ],
    "terminal": "succeeded | failed | canceled",
    "commitState": "committed | notCommitted | unknown",
    "sourceFactoryCalls": 0,
    "handlerCalls": 1,
    "sideEffectCount": 1,
    "surfaceRevisionAfter": "运行结束后的权威 revision；未提交则不变",
    "httpStatusOnEnqueueReject": "仅入队拒绝场景：503"
  }
}
```

`steps` 是声明式时序，不是可执行脚本：测试按标签挂起/恢复真实异步点
（source 工厂、admission、store 写入、响应写入），不允许用首次 yield 代替真实调用。
`inject` 声明故障注入位置；`expected` 计数器全部以真实函数体入口观察为准。

## 版本口径

Session 保持 v1（`NEXUS_SESSION_VERSION = 1`）；本目录新增 start/error 事件与
错误码枚举不改变既有 `done`/`message` 形状，server API 1、RPC 1、onboarding 1、
Catalog Contract 2 均保持。字段级契约见 SPEC §5.4；运行契约见 SPEC §6。
