# CURRENT — 唯一任务与进度源

更新：2026-10-16。产品判据见 [PRD](../PRD.md)，契约见 [SPEC](../SPEC.md)，结构与取舍见 [ARCHITECTURE](../ARCHITECTURE.md)、[DESIGN](../DESIGN.md)。本文件维护唯一实施计划，不以目标设计替代交付证据。

## 当前结论

**产品方向已敲定：宿主约束的 Agent UI Runtime SDK。** SDK 提供协议、Catalog、绑定、渲染、运行与交互基建；业务 prompt、模型/工具编排、具体流程、业务权限与副作用由宿主负责。

当前只有 core/react/server 三包；目标新增 client，并拆开 Provider/Surface、通用 server runtime/Koa 适配。上述改造尚未实施。验证宿主与 Agent 尚未选定，不能将已有 demo 或 `examples/agent-demo/` 占位视为已选接入工程。SDK 通过可替换的确定性夹具和仓外契约验收验证，不评审接入方应用内部工程，也不等待其重建。

**下一实施任务：S1 的安全反例与中立默认值/参考程序分离。** 先核对触发路径并建立证伪测试，再分批修复和迁移；文档与 SDK review skill 已完成；当前先保存并推送基线，S1–S5 改造后续执行。

## 阶段与依赖

| 阶段                     | 状态                 | 交付与依赖                                                           |
| ------------------------ | -------------------- | -------------------------------------------------------------------- |
| S0 文档与评审范围基线    | 已完成（文档/skill） | PRD/SPEC/ARCHITECTURE/DESIGN、README、本计划与 SDK review skill 对齐 |
| S1 安全基线与业务中立    | 待实施               | 关闭可达安全缺陷；显式装配；参考程序迁出。可并行开展早期产物检查     |
| S2 Catalog v2 与交互扩展 | 待实施，依赖 S1      | 声明式展示/输入/action；共享准入与最新输入                           |
| S3 通用 server runtime   | 待实施，依赖 S2      | 单一调度、Session v1 与提交语义；Koa/RPC 薄适配                      |
| S4 client 与可嵌入 React | 待实施，依赖 S2/S3   | 新 client、Provider/Surface、两个浏览器消费方迁移                    |
| S5 独立契约验收与发行    | 待实施，依赖 S1–S4   | 当前产物仓外安装、公开 API/兼容、浏览器和 CI 门禁                    |

S1–S4 每个切片同步其消费方与迁移说明，保持已交付路径可运行；破坏性变化显式区分契约版本，不长期保留两套通用解释器。任务 ID 已重新编排，旧 S1 已收口事项仅为回归基线，不表示新 S1 完成。

## S1 — 安全基线与中立默认值

1. 逐项核实原型/继承属性、URL scheme、Catalog schema.pattern、run 查询访问控制的可达路径，先写能在修复前失败的测试，再修复。预算非法值显式报错。
2. 移除 Adapter 对示例 Catalog、LLM、业务 Policy、全局 history 的隐式选择；必要依赖缺失即报错。模型凭证不改变 SDK 默认运行策略；标准组件与安全限制保留。
3. 将参考服务、模型/prompt、联系人/任务/Workbench 演示 Catalog 与流程 Policy 迁至目标 `examples/playground-server/`，只用公开 SDK 入口。更新根 dev/递归脚本、依赖与示例说明，不为目录整齐重命名无关前端。
4. 早期检查三包 exports/types、dist 加载和参考程序迁出后的依赖；正式仓外接入和兼容验收仍在 S5。无版本发布需求时不恢复 tarball 仪式。

完成判据：安全反例通过；两个无关 Catalog 不受搜索/表单等业务词影响；示例功能保留；SDK 根入口无 listener/项目环境读取/模型 SDK 前置；无反向依赖。新增或迁移测试遵循包 `test/` 镜像结构，现有 server `tests/` 不因本轮计划顺手全量搬迁。

## S2 — Catalog v2、输入与 action

1. 定义并版本化 props schema、显式 actions、输入能力与值 schema、action 挂载能力和参数 schema；不支持/缺失配置显式拒绝。
2. core 统一解释，移除五种内置输入及 Button/TaskButton 特判；前后端共用正常/非法 fixture。
3. 宿主配置精确可编辑 JSON Pointer；浏览器只提交组件/绑定属性/值，server 从已提交声明取路径。禁止任意 dataModel 合并；SDK 准入不可被 resolver 覆盖跳过。
4. 用临时合法输入模型重新解析服务端 action 声明并校验参数；宿主 handler 仍负责业务事实与授权。

完成判据：只通过声明与注册新增展示、输入、action 组件；最新输入到达 handler；额外字段、只读/越权路径、错误类型和未声明 action 被拒且不改快照。v1/v2 不静默混用，根 API 与迁移示例同步。

## S3 — 单一运行调度与 Session v1

1. 抽离不接受 Koa Context 的运行模块；每 runtime/surface 一个调度所有者，覆盖读取快照、revision/hash/action 准入、handler 和 UI 提交。移除全局队列/双锁与 HTTP 标志耦合。
2. 落地 SPEC 的 Nexus Session v1 envelope、start/message/done/error、唯一终态、UI commitState 与结构化 diagnostics；明确提交发布点及结果不确定时的 unknown。
3. ledger、store、scheduler 按实例隔离；failed/取消/断线不自动重放业务操作。history/观察者失败不能把已提交 UI 报成未提交；持久化 store 不被宣称为分布式协调。
4. Koa 只负责响应占用、序列化、连接和背压；保持 await/void、排队响应与错误转发时序。通用 runtime 用非 Koa 事件消费者对测。
5. 为活动/排队 run、消息、缓冲和记录保留建立真实预算；超限显式拒绝，不淘汰仍在执行的保护记录；取消能释放源、锁、reader 和监听器。

完成判据：并发/重复 action、排队取消、慢消费、超限、跨实例隔离和提交前后失败均有反例；宿主副作用替身已执行后，patch/网络失败不会触发 SDK 重放或回滚。handler 不会在排队准入前执行；原取消与 Koa 回归全保留。

## S4 — client 与 Provider/Surface

1. 新建 `@nexus-ui/client`：稳定 runtime、会话/按 surface 订阅、生成/action、取消、恢复、dispose；fetch/SSE 适配可替换且不依赖 React 或 server 实现。
2. 隔离预览、已提交视图和输入草稿。必须核对终态与本地校验；EOF 不成功，缺失确认/版本不一致标失同步并禁用 action。
3. Provider 只提供上下文，新增 `A2UISurface` 由宿主布局；renderMap/回调重渲不重置 runtime；明确外部/内部实例销毁与订阅释放。样式显式选择。
4. playground 与 standalone-host-demo 迁移到同一 client 状态机，删除复制的 SSE 消费逻辑；展示禁用态与动作出口双重门控。

完成判据：自定义控件、双 surface 独立更新/删除、缺失 done、坏流顺序、取消/晚到响应、unknown、恢复、卸载释放在 headless 和相关 React 用例验证；真实浏览器验证宿主布局嵌入、输入、action、错误反馈与基本可访问性。使用契约 fixture 即可，不依赖真实模型或指定业务应用。

## S5 — 当前产物验收与发行

- API 定型后，在仓外干净 React + Node 项目仅使用公开根入口完成 PRD §5.1；验证生成源、Catalog、transport 和 handler 可替换，非 Koa 路径一致。该项目是 SDK 契约验收夹具，具体宿主 Agent 仍可后续选择。
- 按 DESIGN D10 统一 ESM + 类型声明与可选样式；显式 .js 源码路径/NodeNext 迁移和产物验证后移除 fix-esm-imports。校验四包 types/exports/files/依赖/兼容声明、加载副作用、API 快照与升级说明；测试须基于本次构建产物，不能用源码直链代替。
- 当前 conformance 及偏差、根 typecheck/lint/test/build/format、干净环境 CI 与浏览器关键路径有实际执行证据。先标注支持子集和限制，再按 PRD 门禁决定 alpha/正式发行；未通过不宣称 production-ready。
- workspace 同居期不刷 tarball；真实拆分/发行时按 AGENTS.md 恢复版本与消费端同步规则。包管理器/Node 声明与实际 Node 24 门禁一致性在产物检查中核实。

## 既有挂账归属与暂缓项

| 既有问题                                                                                                   | 归属与处置                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| resolveContext 保留 key、render 继承属性、媒体 URL scheme、schema.pattern 原生 RegExp、runs 查询无访问准入 | S1：先核实、证伪，再修复                                           |
| 默认 Catalog/LLM/业务 Policy、参考程序混装                                                                 | S1：显式注入与参考应用迁移                                         |
| 输入/动作组件名硬编码、客户端最新输入缺失、resolver 替换安全链                                             | S2：能力声明与共享准入                                             |
| Protocol/Profile 近重复解释                                                                                | S2 结合共享规则整理；保留 conformance 分类证据                     |
| 双锁、模块全局队列、failed 重入、背压无硬限额、重放/超限组合反例                                           | S3：运行所有权与预算                                               |
| Provider 固定布局、单 tree、runtime 重建、两处 SSE 消费、EOF/预览门控                                      | S4：会话与视图拆分                                                 |
| 每消息全量重校验所有组件                                                                                   | S2–S4 保持有界正确行为并加观测；精细增量优化暂缓，以真实瓶颈为依据 |
| freestanding Catalog 包、Vue、完整 v0.9/v1.0、分布式调度                                                   | 暂缓；非首发范围，不与本轮门禁混合                                 |

## 验证规则与历史基线

代码切片：先 `node -v` 核对 Node 24；相关单测、typecheck、根与相关包 lint、构建；跨包改动加根 `pnpm test`。core API 改动先构建 core 再跑 React 测试。安全/隔离/幂等保证必须有触发失败路径的证伪测试。声明仓外、浏览器或 CI 可用必须实际在对应环境执行。

以下均为旧证据，不是新阶段完成声明：

- Layer 0：2026-09-30 `3dc308a`；conformance `261ea43`，9 份用例，33 pass / 47 已决策偏差 / 0 fail。
- 2026-10-15 `105ee34`：Koa 调用时同步占用响应；await/void 与排队 run 三条证伪。取消传播也已收口，重构必须保留双侧 AbortSignal 反例。
- 2026-10-16 结构调整后已有快照：根测试 core 179 / server 127 / React 32 / playground 9 / demo 21；根 typecheck/lint/build 通过、三包 dist 根入口齐全。此证据不包含本轮目标改造；本轮不据此宣称通过代码门禁。

本轮验证（2026-10-16，仅文档与 skill）：

- 12 份变更 Markdown 经定向 Prettier 格式化；使用 `--ignore-path /dev/null` 绕过仓库对 Markdown 的默认忽略，定向 check 通过。
- 32 个本地 Markdown 链接目标存在；相关文件 `git diff --check` 通过；旧业务专项、失效文档路径和旧任务描述扫描无残留。
- skill 内置 `quick_validate.py` 因 Python 缺少 PyYAML 未执行成功；改用已安装的 js-yaml 完成 YAML、允许字段、命名、描述和未完成占位结构检查，结果通过，未安装依赖。
- 人工复核评审范围：SDK 变更检查公开契约与生命周期；示例只检查 SDK 消费；未选定宿主不阻塞 fixture 验证。无应用内部工程评审要求。
- 未改运行代码，未运行单测/typecheck/lint/build、仓外安装、浏览器或 CI；上述目标阶段仍待实施。

## 提交前验证快照（2026-10-16）

范围为已有仓库结构整理（server 包等内容迁移、旧业务示例移除、workspace/锁文件同步）与文档/skill 基线。另补齐 ESLint 忽略目录和 Vite 注释的旧路径；ESM + 类型声明及后续移除产物修补的约定已入 SPEC §8.1 / DESIGN D10，本轮不实施构建重构。

- Node v24.16.0：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、server 包 lint 均退出 0。
- 根 `pnpm test` 退出 0：core 179、server 127、React 32、playground 9、standalone Node 测试 21 + jsdom 测试 1。沙箱首次因 tsx IPC EPERM 失败，获准后在沙箱外重新执行通过。
- 根 `pnpm format:check` 退出 1：13 个 core/React 文件有已有格式差异，逐一确认与 HEAD 字节相同；不扩大本次提交为全仓格式改动。变更文件另行定向检查，Markdown 显式绕过忽略。
- React 预算测试输出已有重复 key 警告，测试仍通过；不作为浏览器行为已验收的证据，后续 S4 核对节点 key 与渲染稳定性。
- server 56 个文件相对原路径为等内容迁移；评审结论 COMMENT，本次差异未发现新增 P0/P1，既有安全/生命周期差距仍在 S1–S4，不据此宣称 SDK 可正式发行。
- 未执行仓外干净安装、真实浏览器或远端 CI；未开始 S1–S5 运行代码改造。实际提交哈希只在提交成功后使用，不预填。

状态变化同步本文件与 README；契约/结构/决策/需求分别同步 SPEC/ARCHITECTURE/DESIGN/PRD，返工经验写回根 AGENTS.md。
