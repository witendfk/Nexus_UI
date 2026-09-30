# Nexus UI 工程现状与优先级

状态：当前工程决策基线。更新时以代码、测试和独立宿主验收结果为准。

更新：2026-09-30；本轮为静态复核与文档同步，未重跑工程门禁。

## 目标与职责

Nexus UI 提供受约束的 Agent Task Surface Runtime；[OrderOps Copilot](order-ops-copilot.md) 是独立业务 Agent 和宿主，用来同时验证业务价值与 SDK 接入价值。功能可以逐步扩展，本文只给出工程依赖关系，不限制 OrderOps 的长期功能范围。

| 归属 | 负责内容 |
| --- | --- |
| Nexus UI | 协议/Profile/Catalog/Policy 校验、surface 状态、渲染、输入与 action 回流、通用运行边界 |
| OrderOps Agent | 异常识别、证据关联、原因解释、处理建议和受约束的 A2UI 输出 |
| OrderOps Host | 订单/物流/退款等事实、用户输入校验、业务 action、领域状态与可追溯记录 |

个人项目以单机、单用户可复现演示为目标；多租户、通用权限平台和公网部署不作为当前前置工作。即便使用 mock 业务数据，业务 action 仍应有明确的校验、状态和失败语义。

## 当前已证明的能力

- core 与 React 运行时、Catalog Registry、协议/Profile/Policy guard、SSE 和外部 Agent JSONL RPC 已有可运行样例。
- Workbench 与独立宿主样例证明生成、输入绑定、action 回流和同 surface patch 的最小闭环。
- 通用 `AgentAdapter` 已与 Basic/Task/Workbench 示例装配解耦；Catalog Contract 有版本和内容 hash，discovery 与 RPC 可以传递契约身份。
- 服务端可保存生成后的 surface 组件及 dataModel 快照，校验 action 的 surface、组件和名称；存在进程内 action ledger、run 状态与客户端断开取消信号。

这些是参考实现的能力。core/React/server 三包仍为私有包，公开入口已指向 `dist`，并有 `files`/`exports` 打包配置。[迭代记录](iteration-plan.md)保存了 2026-09-28 的 tarball 安装冒烟与 OrderOps M0 接入证据；这些历史结果不覆盖当前工作区加固改动。OrderOps 已在同级独立仓推进，完整业务切片与当前里程碑须以对方仓验收为准。

历史门禁记录（2026-09-28）：`pnpm test` 全仓通过（core 92、React 23、server 117、web 9、standalone-host-demo 22）；`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm format:check` 通过。独立宿主 discovery 测试已同步 `contractVersion` / `contractHash` 响应字段。当前快照的门禁结果需在修复后重新记录。

## 需要纠偏的工程边界

### 当前阻断：Layer 0.3 Runtime 加固未通过验收

2026-09-30 静态复核结论为 **REQUEST_CHANGES**。当前有 4 项 P0、2 项 P1、1 项 P2，全部为 `OPEN`，具体触发路径与关闭条件以 [Runtime 加固问题台账](runtime-hardening-review.md)为准：

- L0-01 / P0：JSONL 在切行前截断，合法完整消息会随 chunk 大小被丢弃。
- L0-02 / P0：正则长度限制和嵌套量词启发式不能保证匹配耗时有界。
- L0-03 / P0：memo 只限制唯一 VNode 创建，React 展开和占位节点仍可能超预算。
- L0-04 / P0：继承属性可把 dataModel 路径导向共享函数对象并修改它。
- L0-05 / P1：配置 CatalogRegistry 时，保留路径异常可穿出运行时并中断后续消息。
- L0-06 / P1：深链仍有递归栈与平方级路径复制成本。
- L0-07 / P2：保留 ID 的实现限制被归为官方协议结构错误。

其中 L0-01、L0-05 是本次加固引入的行为回归，L0-07 是边界偏移，其余为既有风险尚未闭合。不得将局部测试通过等同于安全边界完成。Layer 0.1 的官方 conformance harness、0.2 的偏差决策与跨仓同 fixture 验证仍需交付；当前改动不能作为 OrderOps M2 的入口基线。

### P0：业务 action 必须进入真正的串行与提交边界

2026-09-29 已记录修复：`prepareAction()` 在调用 handler 前取得 surface 锁；由 `sendAgentRun` 消费时，锁保持至 commit/onError 结束并释放，已有“第二个 handler 读到前一个提交后的 dataModel”证伪测试。生成成功 hook/history 提交失败时回滚 action 快照的实现与测试也已记录，见[迭代记录](iteration-plan.md)。

剩余验收：连接取消时 `AbortSignal` 传播到业务 handler 的 HTTP 路径测试（1.1.3）仍待补；handler 已完成的领域副作用如何 reconcile，仍由 Host 明确定义。进程内 surface 串行和快照回滚不保证领域事务或外部副作用可回滚。

验收目标：同一 surface 的读取权威快照、校验输入、执行 handler 和提交结果遵循一致的顺序；并发提交不能基于旧状态执行两次。为副作用定义明确的 commit/reconcile 语义，测试 handler 成功但输出失败、连接取消和重复提交。

继续保留失败生成不留可执行 surface 的回归，并在端到端验收中确认流式预览阶段的业务 action 在提交成功前禁用。

### P0：区分服务端事实与用户输入

默认 resolver 路径拒绝未声明客户端 context 字段的修复与测试已记录（1.2.1）。服务端 action 快照保存的是已提交的 A2UI dataModel，浏览器后续输入不会自动同步；这项字段检查不等于类型、范围、可编辑权限或领域事实校验，自定义 `resolveActionContext()` 也必须遵守宿主信任边界。

验收目标：服务端从领域服务读取订单、金额上限、物流和库存等事实；只接受 surface 声明过的可编辑字段作为用户输入，按字段类型、范围、当前业务状态校验。测试伪造订单号、退款金额、处理方式及过期 surface，确认客户端 context 不能覆盖服务端事实。

### P0：幂等记录与失败状态闭合

当前 action ledger 在内存中；`actionId` 由客户端生成，只能识别相同请求重放，不能单独阻止两个不同 ID 对同一业务事件重复执行。已记录关闭流失败、`getHistory` 失败的 running 记录，并跳过 running 记录的容量淘汰。完整取消/提交失败路径和重启后的领域恢复仍需按 1.3.1/1.3.2 验收，不能从已覆盖路径推导全部失败结局已闭合。

验收目标：OrderOps Host 用 SQLite 为业务操作建立领域幂等键和最终状态；同一订单异常的同一处理决策只能执行一次。每个 action 在成功、失败、取消后都有可查询结局，重启后能恢复或明确标记待核查状态。Nexus 的通用 ledger 不替代领域事务。

### P1：验证加固后的安装产物与跨仓契约

已有 `dist` 打包和历史 tarball 安装冒烟；下一步是关闭 Runtime 台账后验证新产物。每次刷新先提升本仓三包 patch 版本，同步 `orderops-agent` deps/overrides，再在对方仓执行 `pnpm pack:nexus` + `pnpm install`。记录实际安装版本与 tarball 身份，用同一批 fixture 跑本仓 conformance 和对方 guard，再验收生成、输入、action 和 patch。不得覆盖同名同版本 tarball，也不能把历史冒烟当作新快照的证明。reference server 继续称为有限装配 API，暂不宣称生产 SDK。

### P1：统一内部模型提示与 Catalog 契约

reference `llm-agent.ts` 仍手写 Basic/Task/Workbench 组件与工作流规则。Catalog hash 解决契约身份识别，不等于内部 prompt 已完全由 CatalogDefinition 生成。OrderOps Agent 应消费发布的 Catalog Contract，业务提示由 OrderOps 工程维护，Nexus 通用层不新增订单领域分支。

server guard 仍把 action 挂载组件写死为 `Button`，Task 另有 `TaskButton` 特例；这与 Catalog 已能声明组件 action policy 的方向不一致。首条业务切片先复用现有 `Button`，在增加自带 action 的宿主组件之前，使 guard 消费 Catalog 能力契约并补自定义组件验收。

### P2：surface 生命周期与运行时体验

当前 React 宿主只显示一个 active surface；core 的多 surface 存储不代表多 surface UI 已完成。reset/dispose/切换语义、Provider 配置变更行为和运行状态展示，在需要多任务工作流时再推进；当前先把单 surface 的失败、重试和恢复语义讲清楚。

## 验证口径

| 结论 | 需要的证据 |
| --- | --- |
| Runtime 可运行 | 仓库测试与真实模型/确定性样例的生成、action、patch 验收 |
| SDK 可接入 | 脱离 monorepo 的 tarball 安装和独立宿主闭环 |
| OrderOps Agent 有效 | 标注异常样本上的识别与证据引用、处理建议质量、人工确认流程 |
| 有业务收益 | 与可复现的人工流程基线比较步骤、用时或错误；没有基线时只报告模拟样本结果，不宣称真实运营改善 |

文档中的“已实现”“已通过测试”“已完成独立宿主验收”和“规划中”应分别标注，不用单一“完成”代替。下一阶段先关闭 Runtime 台账并建立 conformance/双仓门禁，再刷新 SDK 产物；action 剩余验收和 OrderOps 业务闭环按依赖推进。

## 降低返工的开发节奏

以一条完整业务切片为迭代单位，不以组件数量或包数量为单位。首条切片的功能边界见 [OrderOps Copilot](order-ops-copilot.md#首条端到端业务切片)。组件数量由完成真实业务判断所需的信息决定；只做一张卡片不足以证明 Agent 和 Nexus 的价值，先做完整组件库又会延迟外部接入反馈。

1. **固定最小契约**：先定义 CatalogDefinition、订单摘要/物流时间线 props、只读订单/物流查询结果、可编辑备注、`createTicket` action 的输入/结果和业务幂等键。只锁这条切片实际用到的字段；契约样例同时供 Agent、Host、guard 与测试使用。
2. **清除集成阻断**：关闭 Runtime 台账，补齐端到端与证伪场景，建立 conformance/双仓共用 fixture 门禁；完成 action 取消和失败恢复的剩余验收。避免业务 handler 在 guard 最终通过前产生不可恢复副作用。
3. **刷新可安装产物**：沿已有 `dist` + tarball 路径，按三包 patch 版本纪律刷新快照，在独立宿主验证新版本。继续使用有限 `@nexus-ui/server` 装配 API；后续抽出 guard 时保留兼容入口。无需先完成 Vue、通用高层组件或正式 npm 发布。
4. **尽早接真实 Agent**：用一个标注的物流停滞案例和只读工具调用，让真实模型生成证据引用与处理建议；同一案例保留确定性 fixture 供 CI 重放。Agent 输出 A2UI，订单事实仍由 Host 校验。
5. **用第二个场景检验抽象**：首条流程完成后，增加处理方式和确认界面显著不同的异常，例如高金额退款请求。先观察 Catalog、guard、绑定和 Host action 是否能复用；若必须加入业务特判，再调整通用边界。完成两个场景后才稳定高层宿主 API 和扩展组件库。

每个新组件先回答：现有控件为何无法表达该业务信息，是否需要新绑定/action 语义，是否能复用同一 Catalog/guard/渲染验收模板。先通过独立安装暴露接入成本；`client`、`NexusSurface` 等高层抽象在至少两条业务流程中确有重复后再定型，避免把单个 Demo 的流程写死进 SDK。
