# DESIGN — SDK 设计决策

更新：2026-10-16。需求见 [PRD](PRD.md)，精确契约见 [SPEC](SPEC.md)，结构见 [ARCHITECTURE](ARCHITECTURE.md)，实施顺序见 [CURRENT](tasks/CURRENT.md)。已决策不代表已实现；本文不记录应用业务决策。

## 决策索引

| 决策 | 选择                                            | 状态                            |
| ---- | ----------------------------------------------- | ------------------------------- |
| D1   | Protocol / Profile / Catalog / Host Policy 分层 | 保留；默认示例规则按 D4 迁出    |
| D2   | 以独立接入和 SDK 门禁验收                       | 更新；业务应用不再是发行前置    |
| D3   | Koa 适配器调用时同步占用 SSE 响应               | 保留已有修复，限定在 Koa 适配层 |
| D4   | SDK 中立默认值与显式宿主装配                    | 已决策，待改造                  |
| D5   | 区分消息状态、运行提交与业务结果                | 已决策，待改造                  |
| D6   | 四包目标与可选框架适配                          | 已决策，client 尚未创建         |
| D7   | Provider / Surface 分离，runtime 身份稳定       | 已决策，待改造                  |
| D8   | 声明式输入与 action 能力                        | 已决策，待改造                  |
| D9   | 单一运行调度与有界资源                          | 已决策，待改造                  |
| D10  | ESM 与类型声明为首发产物，消除产物路径修补      | 已决策，构建迁移待实施          |

## D1. 分层准入

**选择**：Protocol 判断 A2UI v0.9 结构；Profile 声明支持子集；Catalog 定义组件、字段、绑定和 action 能力；Host Policy 表达显式注入的宿主规则。安全基线始终执行。prompt contract 从相同 Catalog 生成，只指导生成，不替代准入。

**依据与代价**：协议合法不代表当前宿主支持。保留分层 diagnostics 和 conformance 偏差，避免把受限 Profile 宣称为完整官方 Basic Catalog。公共纯校验逻辑只维护一份；客户端本地校验和服务端权威准入可复用它，但承担不同责任。

## D2. SDK 门禁独立于业务应用

**选择**：用仓外独立宿主、自定义组件和失败反例验收 SDK。业务副作用以可观测宿主替身证明；验证宿主与 Agent 尚未选定，不以现有 demo 代替选型。SDK 评审只核对公开接入契约，不评审业务应用的内部工程；业务应用自行定义领域验收。先解决接入模型，再冻结公开 API，随后完成最终产物/兼容/浏览器门禁。

**变更依据**：旧决策把首条业务闭环与 alpha 绑定，扩大了 SDK 的验收范围。当前用户已明确要求 SDK 只提供基建能力。真实应用继续提供集成反馈，SDK 交付不等待业务应用重建。

**代价**：须维护能触发失败条件的独立验收夹具；无法用业务演示或旧测试数字代替门禁。

## D3. Koa SSE 响应及时占用

**已有证据**：2026-10-15 修复 `105ee34`，`sendAgentRun` 调用时同步 `ctx.respond = false`、`flushHeaders`、`pipe`，让排队 run 不回落 404，宿主 `void`/`await` 均保持流式下发。

**限定范围**：这是 Koa 适配器的实现决策。后续运行模块负责调度、准入、提交、取消与释放；Koa 适配器负责响应占用、序列化、背压和连接生命周期。运行模块不接受 Koa Context，不用 `streamClaimed` 一类由 HTTP 层回写的标志决定锁所有权。

**代价与回归要求**：保留两种调用写法、排队响应和错误转发反例；移出参考服务时不得破坏已有时序。SDK 通用契约不要求其他框架复制 Koa socket 操作。

## D4. SDK 默认行为保持业务中立

**选择**：生成源、Catalog、Host Policy 和 handler 显式注入。缺少必需依赖显式报错；未声明 action 不继承示例白名单；未声明业务 Policy 不继承搜索、表单或客户跟进规则。模型 key 不改变通用 runtime 的生成源选择。

**依据**：当前 Adapter 仍引用内置 Catalog/LLM，默认 Policy 按业务关键词决定组件结构。示例 handler 已经部分分离，但默认行为尚未完成隔离。

**保留与迁出**：标准组件契约、安全 URL 使用约束、原型防护、正则与资源限制保留。联系人/任务/Workbench Catalog、流程 Policy、prompt、模型调用、模拟 handler、环境读取和 listener 迁至参考应用。外部 RPC helper 作为可选适配保留，不引入 Agent 编排或业务模型。

**代价**：默认行为变更属于破坏性迁移，须同步示例、API 契约和迁移说明；不以删除 demo 能力替代依赖隔离。

## D5. 三种状态与预览隔离

**选择**：core 按 A2UI 消息顺序更新状态；client/server 的运行层区分临时预览和已提交 revision；业务成功与失败由宿主认定。Nexus 的运行元数据不写入 A2UI 消息 payload。

client 只在明确成功终态且本地校验通过后开放当前 revision 的 action。失败丢弃本次预览；已有提交视图可保留展示，但在提交结果未知或版本不一致时必须标记失同步并禁用 action。缺失终态、网络中断和提交确认丢失不能推断服务端未提交。

**副作用边界**：取消与 patch 失败不回滚宿主事务。SDK 不自动重试业务 action，不把 ledger 的 failed 当作业务可重试。宿主可提供不透明操作关联标识及恢复回调；SDK 不内建领域结果库。

**代价**：需要已提交状态与预览的隔离存储，以及明确的恢复/重新生成路径；仅增加一个 loading 布尔值不足以实现这些语义。

## D6. 四包目标与适配分层

**选择**：目标为 core/client/react/server。core 负责协议与状态；client 依赖 core，提供无 React 依赖的浏览器会话和 fetch/SSE 适配；React 依赖 core，接收稳定 runtime/视图状态，不强制使用 client；server 依赖 core，内部区分通用运行模块与可选 HTTP/RPC 适配。client 与 server 不互相 import 实现。

**证据**：playground 与 standalone-host-demo 已重复实现 SSE 消费，EOF/终态/取消清理尚未统一；这足以支持抽取 client。Provider 的固定渲染槽和 `sendAgentRun` 的 Koa 耦合证明需要完善组合边界。

**约束**：当前仍只有三包；client 在对应切片新增，不提前宣传已可安装。共享协议与运行元数据类型放在 core 的纯契约模块；不额外拆 guard、Policy、Catalog 或 Agent 包。Koa 入口可留在 server 公开根入口，框架无关入口的加载不执行 listener/环境读取，也不要求模型 SDK。

**代价**：新增一个包的构建、兼容和发行维护；由消除跨示例关键逻辑复制获得收益。不同 transport 通过薄适配接入，不在首发建设通用插件平台。

## D7. 稳定 runtime 与独立 Surface

**选择**：Provider 管理上下文与订阅所有权；Surface 按 surfaceId 渲染到宿主选择的位置。外部 runtime 的销毁由创建者负责；Provider 自建 runtime 在卸载时释放。React 使用稳定快照订阅，renderMap/onAction 变化不意外清空已有 surface。

**依据**：当前一个 `tree` 接收全部 surface 的 onRender，且固定输出在 children 前。多 surface 和已有页面布局无法通过常规接线完整使用。

**代价**：Provider 的隐式输出迁到显式 Surface，是公开行为变更。提供迁移示例；保留轻量 core 接入，不要求本地 JSONL 使用者配置 HTTP。

## D8. 声明式输入与 action 能力

**选择**：组件声明提供可写绑定属性、值 schema；宿主运行配置限制允许编辑的 JSON Pointer。SDK 验证组件与 revision、声明路径及类型后提取最新输入；从服务端持有的 action 声明重新解析参数。宿主 handler 再核对身份、业务对象和业务状态。

自定义 action 组件依据 Catalog 能力准入，不按 Button/TaskButton 名称特判。未声明字段与 action 拒绝。schema 的支持子集和新增声明随 Catalog Contract 版本演进，禁止忽略不支持的配置。

**依据与代价**：当前写回只支持五个内置输入，默认 resolver 看不到浏览器编辑；每个宿主自写 resolver 容易复制安全逻辑。增加通用输入准入有维护成本，但不扩展为业务规则 DSL 或任意 dataModel 写接口。

## D9. 单实例调度与资源边界

**选择**：同一 server runtime 的每个 surface 只有一个运行调度所有者，覆盖读取快照、action 准入、handler 调用和 patch 提交；HTTP 适配器不另建全局 surface 队列。不同 runtime 的状态默认隔离。所有资源预算在超限时显式拒绝或降级，运行中记录不能静默淘汰。

**范围**：首发保证单实例内行为，允许宿主注入存储；持久化存储本身不产生多实例锁或领域幂等保证。分布式协调与业务唯一约束由宿主部署/业务设计承担。

**代价**：双锁/全局 store 迁移需要并发和取消反例；保留有界整树重建，暂不建设分布式执行引擎或自研 reconciler。

## D10. 产物格式与原生 ESM 路径

**选择**：首发提供 ESM JavaScript 与 `.d.ts`，建议提供可用的 `.js.map`；React/后续 Vue 可提供显式导入的独立样式。暂不双发 CJS，不提供 UMD/IIFE；有明确消费需求再评估。SDK 保留模块结构，由宿主负责最终应用打包，React/Vue 为 peer dependency，内部包间依赖不重复内嵌。

**构建方向**：源码使用显式 `.js` 模块路径，以 TypeScript NodeNext 检查 Node ESM 可解析性；浏览器包同时验证现代构建工具接入。当前 `scripts/fix-esm-imports.mjs` 是三包构建中的产物修补步骤，先保留；完成路径迁移、构建与原生 Node 加载验收后删除，不要求宿主运行该脚本。

**代价与验收**：源码路径需要统一迁移，兼顾类型导出和包边界；S5 用当前构建产物验证 Node、浏览器打包和 TS 消费。source map 若发布须包含可用的源码映射，不发布指向缺失源文件的调试资源。此决策不代表当前已有独立 CSS 或 NodeNext 配置。
