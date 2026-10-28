# CURRENT — 唯一任务与进度源

更新：2026-10-28。需求、契约、结构、决策分别见 [PRD](../PRD.md)、[SPEC](../SPEC.md)、[ARCHITECTURE](../ARCHITECTURE.md)、[DESIGN](../DESIGN.md)。本文件只保留当前详细计划、后续阶段概要、已验收摘要与待办；已完成阶段的拆分、修复过程和中间快照从 Git 历史追溯，最终验收证据保留在阶段报告。

## 当前结论

**产品方向：宿主约束的 Agent UI Runtime SDK。** SDK 提供协议、Catalog、绑定、渲染、运行与交互基建；业务 prompt、模型/工具编排、业务权限与副作用由宿主负责。评审覆盖 SDK 与公开接入契约，不评审接入方业务工程；验证宿主与 Agent 尚未选定，不阻塞确定性夹具验收。

**当前节点：S4 进行中（2026-10-28）。** S4.0 core 资源边界已完成并通过复核；S4.1 会话契约与实现拆分已明确，client 尚未创建。S3.1–S3.7 已验收，S3.7 随 `021f27f` 推送，历史矩阵与限制见 [S3-ACCEPTANCE](S3-ACCEPTANCE.md)。S1/S2 已验收；当前只有 core/react/server 三包，client 在 S4 新增。按 DESIGN D12 保留分包，通过层内高层 API 简化接入，暂不新增总门面包。

## 阶段与依赖

| 阶段 | 状态 | 交付与依赖 |
| --- | --- | --- |
| S0 文档与评审规范 | 已完成 | 产品方向、契约/结构/决策基线、SDK review 范围 |
| S1 安全基线与业务中立 | 已验收 | 安全防护、显式装配、参考程序迁出、早期产物检查 |
| S2 Catalog v2 与交互扩展 | 已验收 | 声明驱动交互、共享准入、固定运行结果与消费方迁移 |
| S3 通用 server runtime | 已完成（2026-10-28，验收报告 [S3-ACCEPTANCE](S3-ACCEPTANCE.md)） | 依赖 S2；单一调度、Session 与提交语义、Koa/RPC 薄适配 |
| S4 client 与可嵌入 React | 进行中（S4.0 已完成，S4.1 待实施） | 依赖 S2/S3；core 边界、新 client、Provider/Surface、消费方迁移 |
| S5 独立契约验收与发行 | 待实施 | 依赖 S1–S4；仓外安装、公开 API/兼容、浏览器和 CI 门禁 |

各实施切片同步消费方与迁移说明，保持已交付路径可运行；破坏性变化明确版本，不长期保留两套通用解释器。

## 已验收阶段摘要

| 阶段 | 最终交付 | 验收与追溯 |
| --- | --- | --- |
| S1 | 保留段/原型查表/媒体 URL/pattern 安全防护；预算非法值拒绝；Adapter/guard 显式装配与 runs 查询默认拒绝；参考服务迁至 examples；构建清理旧 dist | 2026-10-16 独立评审四项已修复，随 `b44b639` 推送；原始实施与验收记录见该提交的本文件 |
| S2 | Catalog Contract v2、共享解释器、声明式输入/草稿确认、服务端权威准入、固定 run 提交基准/查询/响应头、RPC/verifier 与两组 Catalog 消费验证 | 2026-10-21 阶段验收 APPROVE，无 P0/P1；随 `eb5f8cd` 推送；完整证据与限制见 [S2-ACCEPTANCE](S2-ACCEPTANCE.md) |

历史门禁：S1 在 Node v24.16.0 下 build/build:packages/typecheck、根与包 lint、根 test 均退出 0（479 项），三包 ESM 根入口和 dist 清单通过；修改文件格式检查通过，全仓 format 当时仍有 13 处既有差异。S2 最终同类工程门禁通过（851 项），conformance 36 pass / 44 已决策偏差 / 0 fail，细节以验收报告为准。上述均为历史证据，不代替后续阶段实测；当时未完成真实浏览器、仓外安装与远端 CI 验收。

## S3 — 已验收摘要

| 单元 | 最终交付 | 实施/追溯 |
| --- | --- | --- |
| S3.1 | 运行工厂/句柄、Session、提交事实、预算与共享 oracle 契约 | 2026-10-22 |
| S3.2 | 传输无关入口、唯一调度、实例隔离、公开兼容路径归一 | 2026-10-23，`565415f`，含六项复审整改 |
| S3.3 | store 确认三态、ledger 去重、扩展失败与提交事实隔离 | 2026-10-23/24，`7054e7d`，含六项复审整改 |
| S3.4 | Session v1 事件、解析/序列检查、结构化诊断 | 2026-10-24，`6bfb335` |
| S3.5 | Koa/RPC 薄适配、访问准入、消费迁移与真实 HTTP 对测 | 2026-10-27，`42d2df3`，含三项复审整改 |
| S3.6 | 资源硬边界、取消隔离、HTTP/非 HTTP 背压、持久状态预算 | 2026-10-27，`f50bd6f`，含八项复审整改 |
| S3.7 | 公开产物接入、S2 遗留处置、需求矩阵、独立门禁与交接 | 2026-10-28，`021f27f`，见阶段报告 |

最终门禁（2026-10-28，本次实测，Node v24.16.0）：build:packages、根 build、构建后 typecheck、根/包 lint、根 test 均 exit 0，1029 项测试通过；conformance 36 pass / 44 已决策偏差 / 0 fail。新增公开根入口普通 Node 加载与生成/action 验证、真实 HTTP 占用失败回归共 5 项；变更源码格式、文档链接/结构与 diff 检查通过。SDK code-review-expert 四维复核无未关闭的 S3 阻断项。命令、证据与边界只维护在 [S3 阶段报告](S3-ACCEPTANCE.md)，完成的拆分和整改过程从 Git 历史追溯。

S3 验收时仍为私有三包，未执行仓外安装、真实浏览器或远端 CI；R5 的 client 双视图隔离/恢复归 S4，R7 发行门禁归 S5。当时实测的 core 直调用数组/模型资源缺口已交接 S4.0，当前处置见下方记录，不能以 server 预算或白名单宣称全端已解决。

## S4 — client 与 Provider/Surface

入口优先核实并收紧 core 直调用的数组寻址与模型资源边界（协议更新、本地输入写回均覆盖），在 alpha/S5 前完成证伪验收；server 白名单不能代替 core 边界。

1. 新建 `@nexus-ui/client`：稳定 runtime、会话/按 surface 订阅、生成/action、取消、恢复、dispose；fetch/SSE 适配可替换且不依赖 React 或 server 实现。
2. 隔离预览、已提交视图和输入草稿。必须核对终态与本地校验；EOF 不成功，缺失确认/版本不一致标失同步并禁用 action。
3. Provider 只提供上下文，新增 `A2UISurface` 由宿主布局；renderMap/回调重渲不重置 runtime；明确外部/内部实例销毁与订阅释放。样式显式选择。
4. playground 与 standalone-host-demo 迁移到同一 client 状态机，删除复制的 SSE 消费逻辑；展示禁用态与动作出口双重门控。

完成判据：自定义控件、双 surface 独立更新/删除、缺失 done、坏流顺序、取消/晚到响应、unknown、恢复、卸载释放在 headless 和相关 React 用例验证；真实浏览器验证宿主布局嵌入、输入、action、错误反馈与基本可访问性。使用契约 fixture 即可，不依赖真实模型或指定业务应用。

### S4 拆分（2026-10-28）

| ID | 交付 | 主要位置 | 完成判据 |
| --- | --- | --- | --- |
| S4.0 | core 直调用边界收紧（入口优先） | core `dataModel/strict-path.ts`、runtime 写回/协议更新路径 | **已完成并复核（2026-10-28）**：数组越界/模型字节/组件数量上限，合法声明下输入与确认的证伪测试、生成/action 资源分类；契约见 SPEC §1.1 |
| S4.1 | client 会话与传输 | 新建 `packages/nexus-client/`（依赖 core，不依赖 React/server）及必要 core 原语 | 按下方 S4.1.1–.4 逐项验收：契约/包骨架 → 视图与草稿恢复 → fetch/SSE → headless 公开入口验收；全部完成后才交付 client |
| S4.2 | React Provider/Surface | `packages/nexus-react` | `A2UIProvider` 只提供上下文与订阅所有权；`A2UISurface(surfaceId)` 按宿主布局渲染；renderMap/回调/父重渲不重置 runtime；外部 runtime 创建者销毁、自建卸载释放；订阅可解除、并发渲染无状态撕裂；样式显式选择不随 import 注入 |
| S4.3 | 消费方迁移 | `web/nexus-playground`、`examples/standalone-host-demo` 浏览器侧 | 两处删除复制的 SSE 消费逻辑，改用同一 client 状态机；展示禁用态与动作出口双重门控；核对 S1 遗留 React 重复 key 警告 |
| S4.4 | 阶段验收 | `docs/tasks/S4-ACCEPTANCE.md` | 完成判据矩阵（自定义控件、双 surface、坏流、取消/晚到、unknown、恢复、卸载释放）在 headless 与 React 用例证据化；真实浏览器验收（布局嵌入/输入/action/错误反馈/可访问性）实际执行记录；conformance/门禁记录；S5 交接 |

实施顺序：S4.0 验收 → S4.1.1 → S4.1.2 → S4.1.3 → S4.1.4 → S4.2 → S4.3 → S4.4。工程门禁随每个切片执行；client 精确类型在 S4.1.1 同步 SPEC §7，职责与恢复决策同步 ARCHITECTURE §4/§5、DESIGN D5/D6/D7，不提前宣称目标能力已交付。

### S4.1 子任务（待实施）

| ID | 核心交付 | 子任务与验收边界 |
| --- | --- | --- |
| S4.1.1 | 会话契约与包骨架 | 定型 `createClientSession`、稳定 runtime、session/per-surface 快照与可解除订阅、generate/action/cancel/recover/dispose、可注入 transport 类型；列出状态转移、错误与所有权。会话内同 surface 至多一个活动 run，重复 action 显式拒绝，不同 surface 独立；取消/恢复/dispose 使旧 run 失效。区分展示视图、固定提交基准、可交互状态；恢复输入包含完整视图与提交身份，不接受仅刷新元数据。建立包配置、根导出/API 快照与最小契约测试，依赖只指向 core |
| S4.1.2 | 视图隔离、草稿协调与恢复 | 先盘点并补齐 core 的受控 surface 快照/恢复/订阅原语：入界出界隔离、完整校验与资源预算、单 surface 原子替换及删除，不以裸 store 修改绕过检查。client 保持 runtime 身份稳定，按 surface 隔离预览、已提交视图与草稿；仅本次生成完整建立的视图可提升，action 基于真实提交基准；发送时 extract，成功且完整接受后 confirm，保留请求期间新编辑与 serial。失败丢弃预览，unknown/身份不符/本地拒绝标失同步并禁用 action；恢复须重验完整快照及 surface/Catalog/hash/revision 与提交身份，一次恢复视图和基准，不能查询最新 revision 给旧视图续资格。用注入的确定性 transport 验证原子失败、引用隔离、双 surface 与取消/晚到，不实现业务结果库或自动 action 重试 |
| S4.1.3 | fetch/SSE 适配 | 实现可替换的 POST fetch/SSE transport，复用 core Session 解析/序列校验，不复制协议解释器；HTTP 以响应头 runId 关联 start/done，非 HTTP transport 显式提供同等运行身份。content-type、UTF-8 分片、frame/总响应、超时及非法配置均有明确预算/拒绝行为；EOF 缺终态、重复终态/终态后事件失败；每次 runtime 写入前检查 run 是否仍有效。取消/失败/dispose 关闭 reader、移除监听与 timer，晚到结果不能覆盖新运行；用真实 Response/ReadableStream 与挂起请求验证清理、请求期间编辑和失同步，不依赖 React/server 实现 |
| S4.1.4 | headless 公开契约验收 | 从本次构建的 core/client 公开根入口验证生成 → 提交 → 输入/action → patch → 失败/unknown → 恢复链路；实际读取共享正常/非法 Session 与 Catalog fixture。矩阵覆盖自定义输入/action、两个 Catalog、双 surface 更新/删除、缺失 done、坏顺序、done-only 生成、身份/版本不符、取消/晚到、恢复拒绝、请求期间编辑、订阅与 dispose 幂等释放；断言视图、草稿、固定基准、动作门控与资源清理，而非仅计数或状态字符串。完成相关单测、根 test、构建/typecheck/lint 和迁移说明后进入 S4.2；真实浏览器与仓外发行分别留 S4.4/S5 |

受控恢复快照由宿主提供可信来源，SDK 验证结构与视图/提交身份一致性；不因此新增业务查询模型或强制 server 恢复 HTTP 路由。React 仍可只消费本地 core runtime，不强依赖 client。以上只细化既定 S4 范围，不启动实现。

**S4.0 实施与复核记录（2026-10-28）**：core 直调用边界收紧落地，三项评审整改已关闭；本切片提交从 Git 历史追溯。

- 数组越界确定性拒绝：`setValueAtPath`/`removeAtPath`（协议 updateDataModel 路径）与 `setStrictPath`（server inputWrites 与本地输入写回共用路径）——数组容器只允许修改界内元素或在末尾紧凑追加（index === length），越界跳写与越界删除一律抛 `DataModelResourceLimitError`（code `RESOURCE_LIMIT_EXCEEDED`，core 公开导出）；拒绝自动建数组时造稀疏空洞。server 生成与 action 提交前失败共用分类，返回确定性 notCommitted + RESOURCE_LIMIT_EXCEEDED；对照验证拒绝不发布状态、不推进 revision，合法紧凑追加仍可提交。
- 模型规模上限（RuntimeOptions 新增，默认常开，非法值构造抛错）：`maxDataModelBytes`（默认 1 MiB，UTF-8 JSON）——updateDataModel 应用后超限整条消息以 FEATURE_UNSUPPORTED 结构化拒绝（状态不变），setInputValue/confirmInputDrafts 超限返回 false（全或无语义不变）；`maxComponentsPerSurface`（默认 10000，与渲染 maxNodes 同量级）——updateComponents 超限整条消息拒绝。均不依赖 catalogRegistry 注入。
- 证伪入口改为 core `test/runtime/model-bounds.test.ts`（12 项），合法 Catalog 下证明输入界内/恰好上限可写、超 UTF-8 字节拒绝且模型/草稿不变；补实际输入数组越界/紧凑追加与 confirm 恢复超限的整体拒绝/合法恢复对照。server `test/agent/storage-budgets.test.ts` 补生成/action 同类错误与 revision 原子性。临时移除输入字节检查、确认字节检查、生成资源映射时，对应三组测试均断言失败（exit 1），随后完整恢复源码。此前缺声明的假阳性测试已替换。
- 本轮 Node v24.16.0 实测：先构建 core，再执行根 `pnpm build`、构建后 `pnpm typecheck`、根 `pnpm lint`、`pnpm -r --if-present lint`、根 `pnpm test`，均最终 exit 0；根测试 **1042 项通过**（core 358、server 448、React 51、playground 38、standalone 45+11、参考服务 91），含 conformance 36 pass / 44 已决策偏差 / 0 fail。根 test 首次在沙箱内因 tsx IPC socket `listen EPERM` 退出 1，经授权在沙箱外重跑同一命令后完整通过；不以单包重跑代替根门禁，不对未复现的并行失败归因环境。变更 TypeScript 格式、文档链接/表格结构与 `git diff --check` 通过；SDK review 四维复核未发现未关闭项。未执行真实浏览器、仓外安装或远端 CI。

## S5 — 当前产物验收与发行

- API 定型后，在仓外干净 React + Node 项目仅使用公开根入口完成 PRD §5.1；验证生成源、Catalog、transport 和 handler 可替换，非 Koa 路径一致。该项目是 SDK 契约验收夹具，具体宿主 Agent 仍可后续选择。
- 按 DESIGN D10 统一 ESM + 类型声明与可选样式；显式 .js 源码路径/NodeNext 迁移和产物验证后移除 fix-esm-imports。校验四包 types/exports/files/依赖/兼容声明、加载副作用、API 快照与升级说明；测试须基于本次构建产物，不能用源码直链代替。
- 当前 conformance 及偏差、根 typecheck/lint/test/build/format、干净环境 CI 与浏览器关键路径有实际执行证据。先标注支持子集和限制，再按 PRD 门禁决定 alpha/正式发行；未通过不宣称 production-ready。
- workspace 同居期不刷 tarball；真实拆分/发行时按 AGENTS.md 恢复版本与消费端同步规则。包管理器/Node 声明与实际 Node 24 门禁一致性在产物检查中核实。

## 待办归属与暂缓项

只列未完成项；已解决问题不再重复挂账。S2 报告中的历史问题表不自动等于当前阶段新增承诺，具体实施以本计划和契约决策为准。

| 待办 | 归属与处置 |
| --- | --- |
| 草稿失败后的完整视图恢复 | 现有 confirm 原子 false 与重新生成路径保持；checks 已明确为提交门控，输入仍执行 inputs schema。S4 承接恢复与统一动作门控，见 S3 报告 §5 |
| Provider 固定布局/runtime 重建、两处 SSE 消费、预览隔离/恢复、草稿读取入口收敛 | S4；同时核对 S1 留下的 React 重复 key 警告与渲染稳定性 |
| NodeNext/ESM 修补脚本、运行环境声明一致性、仓外安装/真实浏览器/远端 CI | 按 S4/S5 实际验收范围推进，不引用历史单测替代 |
| 每消息全量组件重校验的增量优化 | 保持有界正确行为；优化暂缓，依据真实瓶颈决定 |
| 独立 Catalog 包、Vue、完整 v0.9/v1.0、分布式调度 | 非首发范围，暂缓 |

## 验证与文档维护

代码门禁遵循根 AGENTS.md：Node 24、相关单测/typecheck、根与相关包 lint、构建；跨包改动加根 test。core API 变更先构建 core 再跑 React 测试；安全/隔离/幂等声明须有证伪测试，显著或协议面变更须执行 SDK review。仓外、浏览器与 CI 结论只使用实际环境证据。

文档维护：当前阶段保留可执行细项；验收后收敛为交付摘要、最终证据入口及未解决事项，移除已完成拆分、重复修复日志和被取代快照。契约/结构/决策回到主链文档，阶段报告保存验收证据，过程由 Git 追溯，CURRENT 不追加会话流水账。
