# fixtures/catalog-v2 — Catalog Contract v2 共享契约 fixture

S2.1 定稿（2026-10-16）。本目录是 core 注册闸门与 server 权威准入的双端对测数据源：
同一份 fixture 在两端必须得到一致结论（AGENTS.md「共享正常/非法 fixture 的双端准入对测」）。
fixture 为纯数据，全部业务中立；不等待任何宿主 Agent 或业务应用。

## 文件分类

- `catalog-*.json`：Catalog 声明注册夹具。core 注册闸门（S2.2 实施）据此判定接受/拒绝。
- `request-*.json`：action 请求准入夹具。server 权威准入（S2.4 实施）据此判定接受/拒绝，
  依赖的 Catalog 与 surface 初始消息均在文件内自描述。
- `baseline-*.json`：按运行查询固定提交结果的时序夹具。`initialSurfaceFixture` 引用
  合法请求夹具的初始 surface；`commits` 顺序描述生成与其他 action 提交，
  `queryAfterRunId` 指定查询发生在哪次提交后。`expectedResponse` 始终对应
  `query.runId` 的提交，`expectedNextAction` 描述旧视图随后应被拒绝的结果。

## 文件 envelope

catalog 夹具：

```json
{
  "id": "目录内唯一的夹具名",
  "kind": "catalog",
  "expect": "accept | reject-registration",
  "reason": "expect 为 reject 时必填；说明触发失败的契约条款",
  "catalog": { "catalogId": "...", "components": { "...": {} }, "actions": [] }
}
```

request 夹具：

```json
{
  "id": "目录内唯一的夹具名",
  "kind": "action-request",
  "expect": "accept | reject-admission",
  "reason": "expect 为 reject 时必填",
  "catalog": "引用的 catalog 夹具 id",
  "editablePaths": ["/score", "/note"],
  "surface": { "messages": ["…建立已提交 surface 的 v0.9 消息序列…"] },
  "request": { "message": { "version": "v0.9", "action": {} }, "nexus": {} }
}
```

## 约定

- 请求夹具中的 `"{{catalogHash}}"` 是占位符：测试装载时以引用 catalog 夹具按
  `createCatalogContractHash` 实算的 hash 原样替换，保证夹具字节稳定。
- `surface.messages` 以 v0.9 生成流表示已提交权威状态（含 `root` 组件）；
  `surfaceRevision` 基线为快照初始 version（1）。
- 非法夹具在合法基线上只注入单一目标偏差（v1 形状夹具除外，其偏差即整体形状），
  保证反例命中的是声称的契约条款而非前置状态非法。
- 绑定能力唯一权威是 schema 节点的 `dynamic`；`fields` 不承载 `binding`
  （v1 风格双源声明见 `catalog-reject-legacy-fields-binding.json` 反例）。
- 同一批 `inputs` 的写入与数组顺序无关：同目标路径、祖先/后代路径冲突均拒绝，
  两种顺序分别有反例（`request-reject-path-ancestor-conflict` /
  `request-reject-path-descendant-first`）；白名单自身允许嵌套重叠。
- 准入语义、注册拒绝范围与字段定义见 SPEC §4；nexus 元数据字段与基线来源见
  SPEC §5.1 与 core/server 公开类型（`NexusActionMetadata`/`NexusSurfaceCommit` /
  `SurfaceStateBaseline`）。基线查询必须指定 surfaceId/runId；缺失、淘汰或不可确认
  的结果拒绝，不得从最新快照补齐。
- 两份 baseline 时序夹具分别覆盖「流完成后查询前」「查询后 action 前」发生其他提交。
  当前 server `test/api/surface-state.test.ts` 用真实状态存储验证前置消息、版本和模型确实
  改变，以及预期基准与所渲染运行一致；它不实现或验收尚未接线的查询路由。
  S2.5 必须消费同一 oracle 验证 HTTP 响应、runId 响应头/跨源暴露、结果不可用拒绝、
  本地关联与晚到响应、实际 action 拒绝且 handler 未调用/快照未改变。
- 新增夹具必须业务中立、确定性（无时间/随机依赖），并在 `expect: reject` 时给出
  可指向契约条款的 `reason`。
