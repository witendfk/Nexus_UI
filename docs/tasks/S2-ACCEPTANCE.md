# S2 阶段验收证据（S2.7）

- 被测基准：Git `5a5c5a1`（origin/feature）+ 本轮未提交差异（S2.7 任务拆分文档、本文档、S2.7.1 补测 6 个测试文件改动）。
- 环境：Node v24.16.0、pnpm 9.15.9、macOS arm64（darwin 25.5.0）。
- 改动前门禁基线（2026-10-21 14:09）：`pnpm build:packages` / `build` / `typecheck` / `lint` / `-r --if-present lint` / `test` 退出码全部为 0；分包测试数 core 319、server 286、react 51、playground 36、standalone 42+11、playground-server 91，合计 836。
- 测试数量只作结果统计，不作为通过判据。

## S2.7.1 需求与证伪覆盖矩阵

### S2.7.1.1 PRD 保证 → S2 已交付切片覆盖表

「后续阶段」列标明不计入 S2 完成的部分；这些不作为 S2 验收依据，也不得对外宣称。

| PRD 保证 | S2 已交付切片 | 公开入口 / 位置 | 正常用例 | 失败反例与不变式 | 证据（文件 · 用例） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 受约束协议运行时 | 校验链 Protocol→Profile→Catalog→Host Policy；写回/草稿不破坏已提交状态 | core `A2UIRuntime`、`setInputValue`、`parseSurfaceCommit` | 双 Catalog 生成→渲染→编辑（playground/standalone App 测试）；官方用例基线（见 S2.7.3.1） | 保留段键、媒体 URL、pattern 语法、预算非法值均拒绝；写路径失败收敛为显式拒绝且快照/草稿不变 | core `test/render/limits.test.ts`、`test/dataModel/*`、`test/runtime/input-write.test.ts`（「写路径中间节点非容器时收敛为 false」「危险绑定路径拒绝」等） | 已覆盖（S1 协议/安全基线 + S2 写回切片） |
| R2 同源能力契约 | Catalog Contract v2 声明形状、注册闸门、hash/prompt、双端同闸门 | core `CatalogRegistry`、`createCatalogPromptContract`、`getCatalogContractHashInput`；server 发布/discovery/onboarding | 2 份 accept 夹具双端通过；JSON 往返 hash 不漂移、键序无关 | 7 份 reject 夹具注册期拒绝（core 9/9、server 装配 7/7）；浏览器加载拒绝版本/身份/hash↔内容/伪造 prompt/非法声明 | core `test/catalog/registration.test.ts`、`test/catalog/contract-hash.test.ts`；server `test/api/catalog-publication.test.ts`（「全部非法 Catalog 夹具在装配期被 core 注册闸门拒绝」，S2.7.1 补测）；playground `tests/catalog-contracts.test.ts`、standalone `tests/catalog-loader.test.ts` | 已覆盖 |
| R4 完整交互扩展 | 声明驱动本地写回 + 服务端权威准入 + 参数重算 + resolver 后置 + 草稿快照/确认 | core `setInputValue`/`getLatestInputs`/`extractLatestInputDrafts`/`confirmInputDrafts`；server `AgentAdapter.prepareAction` | 最新合法输入到达 handler；整数非 value、布尔、自定义触发器走同一声明路径 | 12 类运行拒绝（缺 nexus、未声明、越权/伪造路径、类型、重复/冲突、paramSchema、旧 revision、错 hash、v1/v2 混用等）全部 handler 零调用、快照/revision 不变 | server `test/agent/action-admission-fixtures.test.ts`（12 夹具逐份）、`test/agent/adapter-admission.test.ts`（拒绝类反例 + resolver 边界 + paramSchema 默认路径，S2.7.1 补测）、`test/agent/action-admission.test.ts`；core `test/runtime/input-write.test.ts`、`input-draft-confirm.test.ts` | 已覆盖 |
| R5 明确运行与失败语义（S2 切片） | 固定提交基准、runId 关联、按 run 查询、旧基准拒绝、晚到/取消/卸载失效 | server `NexusSurfaceCommit`/`X-Nexus-Run-Id`/`surface-state` 路由；消费方基准门控 | 查询恒返该运行自己的固定结果；done 与响应头同源；正常 done+本地校验通过才开放 action | 查询前/查询后并发提交都不能替旧视图刷新资格（revision 1 的下一 action 400）；done-only 不能换基准；取消/卸载晚到不写回 | server `test/api/surface-state-query.test.ts`、`surface-state-query-interleave.test.ts`、`surface-state.test.ts`、`send-agent-run-response-header.test.ts`、`run-identity.test.ts`；playground `test/app/index.test.tsx`（「取消后 fetch 忽略 abort 仍返回」「第二次生成只有新 done 不能给旧视图换基准」等）；standalone `tests/browser-app.test.tsx`（缺头/头错配/hash 错配拒绝） | 已覆盖（完整预览隔离/失同步恢复归 S3/S4，不计入） |
| R6 可组合服务端（S2 切片） | HTTP 与非 HTTP 共用 adapter 提交边界与同一记录所有者 | server `AgentAdapter`、`sendAgentRun`、managed run | 真实查询路由返回与两条路径固定 commit 一致 | 非 HTTP 源 EOF 未显式提交按 409；排队 stale revision 在 handler 前拒绝；查询与容量淘汰窗口交错不回退最新快照 | server `test/agent/admission-regressions.test.ts`（「holds non-HTTP lock past source exhaustion…」）、`test/agent/run-manager-result.test.ts`、`test/api/surface-state-query-interleave.test.ts`（「查询与容量淘汰的窗口期交错」） | 已覆盖（通用 runtime/Koa 解耦全面验收归 S3，不计入） |
| R7 可安装、可诊断、可维护（S2 切片） | 公开 API 快照、三包 dist 清单、结构化诊断码、conformance 基线、CI 配置 | 三包根入口；core `tests/public-api.test.ts`；server `test/build-artifact.test.ts` | 快照与实现一致；dist 清单与 src 对应 | API 偏离/产物残留由快照与清单测试拦截 | 产物核对见 S2.7.2；conformance 见 S2.7.3.1；CI 为配置存在，本次远端运行证据见 S2.7.4.3 | S2 范围内覆盖；仓外安装/发行门禁归 S5，未验证 |

明确不计入 S2 完成：R3 独立 Surface 与 Provider/Surface 分离（S4）；R5 完整预览恢复与 Session 生命周期（S3/S4）；R6 通用调度与实例隔离（S3）；R7 仓外安装、NodeNext 迁移与发行（S5）。当前消费方的 React 集成为参考实现回归，不等于 React 包级 Provider/Surface 契约验收。

### S2.7.1.2 共享 fixture 对测（`fixtures/catalog-v2/`，23 份）

- 消费矩阵：catalog 9 份（2 accept + 7 reject）——core `test/catalog/registration.test.ts` 全量消费，含「夹具清单完整：2 份正常 + 7 份非法注册」清单守卫，reject 断言按 id 映射命中 SPEC §4.2 条款关键词；server 端装配复用同一 `CatalogRegistry` 闸门，`test/api/catalog-publication.test.ts` 对全部 7 份 reject 夹具断言装配期抛错且消息命中同一关键词映射（S2.7.1 补测前仅直接对测 1 份，属覆盖缺口已闭合）。accept 夹具另经真实 HTTP 发布/执行多文件消费。
- request 12 份（2 accept + 10 reject）——server `test/agent/action-admission-fixtures.test.ts` 全量消费：每份先以实算 hash 建立真实已提交面，再跑 `admitAction`，断言 `result.ok` 与夹具 `expect` 一致且准入后快照 version 不变。request 夹具按 fixtures README 定位为 server 权威准入单端消费（core 不实现 HTTP 准入），属设计而非缺口。
- baseline 2 份——双消费：内存 oracle `test/api/surface-state.test.ts`（逐 commit 重放对拍 `expectedLatestRevisionAtQuery`/`expectedResponse`/前后 dataModel 必须真有差异）与真实 HTTP `test/api/surface-state-query.test.ts`（Koa+fetch，before/after 两种时序，查询恒返 A 的 revision 1，旧基准 action 400）。
- 夹具 oracle 一致性（S2.7.1 补测 F4）：`expectedNextAction` 的 `decision`/`handlerCalls`/`snapshotUnchanged` 字段原先未被任何断言消费（退化为文档）；现两个消费文件均逐项断言夹具声明值与实际行为一致。
- 无孤儿夹具；夹具数据作用域与断言作用域一致。

### S2.7.1.3 提交基准与并发证据

| 保证 | 失败不变式 | 证据 |
| --- | --- | --- |
| 固定 run/surface/catalog/hash/revision 基准 | 查询只读 run 记录所有者，不读当前快照，结构上不存在回退最新基准 | `surface-state-query.test.ts`「200 只读该记录的固定结果，与成功 done 载荷一致」 |
| 两种并发时序 | 流完成后查询前、查询后 action 前的他人提交，都不能给旧视图换资格；旧 revision action 400、handler 零调用、快照不变 | baseline 两夹具 × 内存/真实 HTTP 双消费（S2.7.1.2） |
| 容量淘汰与窗口交错 | 淘汰后 404 不回退最新快照（同 surface 更新提交作对照）；读取先于淘汰返回被查运行自己的固定结果 | `surface-state-query.test.ts`「记录容量淘汰后明确不可用」；`surface-state-query-interleave.test.ts` 交错两例 |
| 编号不复用 | 删除/淘汰后 revision/epoch 单调递增，旧基准 commit 抛错；上溢显式失败 | `admission-regressions.test.ts`「never reuses revision or epoch after eviction…」；`adapter-admission.test.ts` P1-4 |
| 跨 surface 与存在性不泄露 | 不存在 runId 与跨 surface 既有 runId 同一 404 响应体 | `surface-state-query.test.ts`「不存在的 runId 与跨 surface 的既有 runId 返回相同 404」 |
| runId 关联链 | `X-Nexus-Run-Id` ≡ SSE event id 前缀 ≡ done.runId ≡ 查询 200 全链一致；事件 id 全值作查询键必须 404 | `surface-state-query-interleave.test.ts`；`send-agent-run-response-header.test.ts`（生成/action/排队/取消/flushHeaders 六例） |
| 非 HTTP 同生命周期 | 源 EOF 不是终态，锁保持到显式结束；EOF 未提交按 409 | `admission-regressions.test.ts`；`surface-state-query-interleave.test.ts` 失败流查询 409 |

时序验证口径：并发为确定性交错注入（挂起响应/受控提交序），非真实竞态压测；S2 声明的失败不变式以此为验收口径。

### S2.7.1.4 两个参考消费方交互回归（含 S2.6 复审五项）

| 保证 | 证据（playground / standalone / headless） |
| --- | --- |
| 整数非 value、布尔、非 Button 触发器 | core `input-write.test.ts`（RatingInput 整数、CheckBox 布尔、声明权威取代名字分支）；standalone `browser-app.test.tsx`「scorecard 场景：非 value 输入与非 Button 触发器上报」经真实 React DOM 断言 wire inputs 与 sourceComponentId；`scorecard-catalog.test.ts` 注册闸门反例 |
| 连续两次 action 与服务端归一化 | playground-server `continuous-interaction.test.ts`（真实 HTTP：第二次请求 wire inputs 为空、最终模型由服务端重算不被旧草稿覆盖）；playground `index.test.tsx`「成功提交确认已发送草稿…第二次提交不重发旧草稿」；standalone `scorecard-continuous.test.ts`（partial patch 下第三次只带 score、布尔由服务端保留） |
| 双 surface 隔离 | `continuous-interaction.test.ts` 与 `scorecard-continuous.test.ts` 双 surface 对测（A 草稿/确认/基准/patch 不影响 B）；core `input-draft-confirm.test.ts`「其他 surface 的草稿不受确认影响」；playground「切换 Catalog 并完成 B 后，A 的晚到响应不改变视图、基准或 busy」 |
| 真挂起请求期间新编辑 | playground「请求挂起期间的新编辑在响应归一化后恢复可见…」（fetch 永不 resolve 手动 release，非即时 mock）；standalone scorecard 同构用例；core 同步层「请求期间的新编辑（含改回同值）不因确认被误删」「权威响应归一化已发送字段，新代次草稿恢复为可见编辑值」 |
| 逐帧失效（写入前校验） | 两消费方 `consumeRun` onEvent 首行即失效检查（实现 `web/nexus-playground/src/app/index.tsx:68-91`、`examples/standalone-host-demo/src/browser/app.tsx:47-70`），测试以「挂起→卸载→release 帧，spy push 零调用 / reader 取消」行为等价证明 |
| 重复 action 与卸载清理分持 | standalone「在途重复 action 被忽略，原运行正常完成并释放 busy」；playground 同构用例（S2.7.1 补测 F5）；卸载两阶段用例双端齐备 |
| 取消/晚到不写回 | playground「取消后 fetch 忽略 abort 仍返回」「切换 Catalog 后 A 晚到不改变视图/基准/busy」；standalone「取消后另一次生成完成，晚到 fetch 不替换新视图」 |
| 生成基准绑定本次实际创建视图 | playground「第二次生成只有新 run/revision 的 done，不能给旧视图换基准」「响应改成另一个已加载 Catalog 仍拒绝」；standalone「done 运行标识与响应头不一致拒绝」「缺运行标识头拒绝」「done 的 catalogHash 与已加载契约不一致拒绝」；headless「S2.6.3.4 查询不恢复资格（真实路由）」 |
| 契约 hash JSON 往返 | core `contract-hash.test.ts`「合法可选字段显式 undefined 与省略字段经 JSON 往返后摘要输入相同」 |
| 挂载前契约校验（版本/身份/Web Crypto hash/prompt/注册闸门） | playground `tests/catalog-contracts.test.ts`（6 例）+ App 级「配置失败时显式报错，不挂载缺少声明的交互入口」；standalone `tests/catalog-loader.test.ts`（6 例 + discovery 两层核对） |
| 取消/晚到加载不替换当前契约 | S2.7.1 补测 F6/F7：两个 loader 的 signal 贯通与中止即拒绝（loader 拒绝使「晚到 resolve 替换契约」不可达；App 层 `if (!signal.aborted)` 守卫为同步后检查，React 18 卸载后 setState 为 no-op，不具 DOM 可观测差异——记为设计说明） |

### S2.7.1 缺口处置记录

核实发现的缺口与处置（证伪测试先明确失败条件，再确认现有实现使其通过）：

| 缺口 | 处置 | 证伪测试 |
| --- | --- | --- |
| paramSchema 默认路径（无 resolver）无 adapter 级反例 | 已补 | server `adapter-admission.test.ts`「paramSchema 默认路径：无 resolver 时重算参数违规同样在 handler 前拒绝」——声明与模型错配（counter 声明 string、重算值 number），若默认路径未接最终参数校验则 handler 被调用，断言即失败 |
| server 装配期仅直接对测 1/7 非法 catalog 夹具 | 已补 | server `catalog-publication.test.ts`「全部非法 Catalog 夹具在装配期被 core 注册闸门拒绝」——7 份逐份断言装配抛错且命中与 core 相同的关键词映射 |
| baseline 夹具 `expectedNextAction` 的 decision/handlerCalls/snapshotUnchanged 未被断言消费 | 已补 | `surface-state.test.ts` 与 `surface-state-query.test.ts` 逐项断言夹具 oracle 声明值与实际行为一致 |
| playground 缺「在途重复 action 忽略且不取消当前运行」专属用例 | 已补 | playground `index.test.tsx`「在途重复 action 被忽略…」——若重复点击取消当前运行，则原运行不完成、第三次提交不能推进到 revision 2，断言即失败 |
| 「取消/晚到契约加载不替换当前契约」仅实现无测试 | 已补（loader 层） | playground `tests/catalog-contracts.test.ts` 与 standalone `tests/catalog-loader.test.ts` 各增「取消加载」用例：loader 若丢弃 AbortSignal，watchdog/哨兵显式失败；中止后 loader 拒绝使晚到结果不可达 |
| `report.actionContext` 深拷贝隔离无反例 | 不另加测试，记录说明 | 唯一赋值点即 `structuredClone`（server `src/agent/verification.ts:408`），来源正确性已有证伪（`verification.test.ts` 断言报告取权威重算值 4/true 而非客户端解析值 3/false）；handler 先于报告返回执行，别名字面不可达 |
| nexus-react 包内无非 value 整数写回、同 runtime 双 surface 专属用例 | 不另加测试，记录归属 | 两条路径由 standalone `browser-app.test.tsx` 经真实 React DOM 覆盖（同一执行路径，非消费缺口）；双 surface 的 Provider/Surface 包级契约归 S4 验收 |
| request 夹具单端消费；core triggerAction 不查 sources | 设计口径，非缺口 | 见 S2.7.1.2 与 fixtures README 定位；来源准入权威在注册闸门与服务端（SPEC §4.2） |

S2.7.1 结论：16 项判据所需证据已定位并逐条核实；发现缺口 5 处已补证伪测试（全部通过，见 S2.7.4 复跑），2 处记录为设计说明，React 包级归属项标明后续阶段。

## S2.7.2 公开 API 与当前产物

### S2.7.2.1 公开符号与签名（src/index ↔ dist ↔ 快照 ↔ README）

- 三包根入口快照测试齐备且通过：core `tests/public-api.test.ts`、react `tests/public-api.test.tsx`、server `tests/public-api.test.ts`；快照锁定的即根入口公开面，深路径与源码路径不承诺兼容（SPEC §2）。
- 当前 dist 根入口导出实测（Node 24 真实 ESM import，见 .2）：core 41 个导出含 `getCatalogContractHashInput`/`isCatalogContractHash`/`CATALOG_CONTRACT_HASH_PATTERN`（S2.6 公开，SPEC §8 旧句「未进入公开根入口」已修正）；react 28 个导出含 Provider/useA2UI/ReactRenderer/standardRenderMap 与 17 个标准组件；server 27 个导出含装配、发布、RPC、verifier、run 实现。
- 关键签名经 dist `.d.ts` 与类型消费测试核对：`setInputValue(componentId, surfaceId, property, value): boolean`（四参）、`extractLatestInputDrafts(surfaceId): InputDraftSnapshot`、`confirmInputDrafts(snapshot): boolean`、`sendAgentRun(ctx, run, options)`（三参，旧 idPrefix 槽位已删除）、`NexusSurfaceCommit`/`SendMessagesResult`/`SendAgentRunOptions` 类型公开。
- 消费方 import 边界：web/examples 全部 92 处 `@nexus-ui/*` 导入均为包根说明符（core 51、server 31、react 10），零深路径/零源码相对导入。
- README 接入片段与实际入口一致：react `tests/minimal-host-example.test.tsx` 以最小宿主样例回归公开用法。

### S2.7.2.2 产物构建与真实消费证据

- 构建：`pnpm build:packages`（各包 `rm -rf dist` 后 `tsc -p tsconfig.build.json` + `fix-esm-imports.mjs`）与根 `pnpm build` 退出码 0；server `test/build-artifact.test.ts` 校验三包 dist 文件清单与当前 src 对应、无已删残留（随根测试通过）。
- 真实 ESM 根入口消费（Node 24，package 说明符解析）：core 自 nexus-react、react 自 playground、server 自 playground-server 分别 `import('@nexus-ui/*')`，关键导出与方法（含 runtime 三草稿/写回方法）全部命中；仓内消费方运行时本就经 node_modules 链接加载 dist。
- **类型消费口径修正（本轮改动）**：`tsconfig.base.json` 原以 `paths` 把 `@nexus-ui/core`/`react` 别名到 `src`，消费方 typecheck 实际编译源码声明而非产物声明——正是本任务点名要堵的掩盖路径。已移除该别名（含 baseUrl），全部 SDK 包与消费方 typecheck 改走 node_modules 当前 dist 声明，复跑 build→typecheck 全绿。新增常设证伪测试 standalone `tests/dist-consumer.test.ts`：最小消费只用三包根入口、不继承 base tsconfig（moduleResolution 与当前一致，NodeNext 迁移归 S5），经 dist 声明编译必须通过；对文档签名的故意错用（三参调用 `setInputValue`）必须编译失败。
- 由此产生的顺序依赖与既有门禁口径一致：typecheck/依赖 dist 的测试必须在 `build:packages` 之后执行（AGENTS.md 与 CI 均为 build 先行）。

### S2.7.2.3 exports、依赖图与根入口副作用

- 三包 `exports` 均只暴露 `.`（types → dist/index.d.ts，import → dist/index.js）；`files` 仅 `dist` 与 README。
- 依赖方向成立：core 仅依赖 zustand；react 依赖 core（workspace:*）+ react/react-dom peer，无 Node/server 依赖；server 依赖 core + Koa 家族（Koa 适配按 SPEC §2 保留，通用 runtime 剥离归 S3）；SDK 不反向依赖示例或业务模型（消费方向单一，examples 只用根入口）。
- 根入口副作用：三包 dist/index.js 均无 `listen(`、无 `process.env` 读取；模型/Policy 选择不来自项目环境（参考工厂在 examples 显式装配）。
- 已声明的既有现状：React 仍在 import 时注入动画（SPEC §8.1 记录，独立样式归后续）。

## S2.7.3 conformance 与文档声明

### S2.7.3.1 conformance 实测与基线比对

- 执行 core 官方用例套件（`tests/conformance.test.ts` + `official-basic-compatibility.test.ts`，随包测试通过，退出码 0）：9 份用例 / 80 条判定，源为 `specification/v0_9/test/cases`。
- 本次输出与 `tests/conformance-baseline.json` 完全一致：pass 36 / profile-unsupported 13 / profile-catches-protocol-loose 23 / degraded-value-constraint 5 / scope-client-to-server 3，0 fail。分类无变化，无需刷新基线。
- 口径声明：该基线只测 Protocol/Profile 层分类，不证明默认标准 Catalog 已启用相关 checks，也不是完整官方 Basic Catalog 兼容声明（SPEC §1）。

### S2.7.3.2 主链文档过期声明清理（已修正，均按实现核实）

| 位置 | 原过期表述 | 修正 |
| --- | --- | --- |
| SPEC §1 | 「当前本地输入写回仍受硬编码限制（S2.3）」 | 写回由当前 Catalog `inputs` 声明驱动，未声明即拒绝（S2.3 已实施，与 §4.3 一致） |
| SPEC §5.1 | 旧四参 `sendAgentRun` 为「被忽略的兼容槽位，应迁移」 | 已随 S2.6.5.2 删除，公开入口仅存三参签名（2026-10-21 实测核实） |
| SPEC §8 | 「模块内部 isCatalogContractHash/CATALOG_CONTRACT_HASH_PATTERN 未进入公开根入口」 | S2.6 起随 `getCatalogContractHashInput` 公开，dist 根入口实测在列 |
| SPEC §8.1 | 未记录类型解析口径 | 补记：tsconfig 不设源码 paths 别名（2026-10-21 验收移除），typecheck 依赖先构建的产物 |
| fixtures/catalog-v2/README | 「不实现或验收尚未接线的查询路由；S2.5 必须…」 | 更新为已接线现状：内存 oracle + 真实 HTTP 双消费、interleave/响应头覆盖、`expectedNextAction` 逐项断言（S2.5.3 起） |
| PRD §3.1 | core 现状「自定义交互扩展待完善」 | 「Catalog v2 与通用交互扩展已交付（S2）」；文档更新日期同步 |

历史记录保留原日期；未提前标记 S3–S5 目标为完成。修正后全仓 grep 无过期残留（DESIGN 中「idPrefix 兼容槽位随 S2.6.5 删除」为删除事实记录，非兼容承诺）。

## S2.7.4 Node 24 工程门禁（最终口径，2026-10-21）

- 环境：Node v24.16.0、pnpm 9.15.9。执行顺序：`pnpm build:packages` → `pnpm build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r --if-present lint` → `pnpm test`，全部退出码 0（S2.7.1 补测与 S2.7.5 修复落地后的最终复跑）。
- 分包测试数：core 319、server 296、react 51、playground 38、standalone 45+11、playground-server 91，合计 851（本轮最终复跑；此前 836/842/844 为修复与补测过程中的中间快照，非通过判据）。
- 测试发现核实：六个执行体（core/react/server/playground/standalone/playground-server）均实际执行；新增用例被各包 runner 发现并可定位（server node:test、react/playground/standalone-browser vitest）。
- `git diff --check` 通过（曾发现 tsconfig.base.json 末尾空行，已修复后复跑为 0）；本轮全部触碰文件与新文件定向 Prettier 通过；全仓 `pnpm format:check` 仍有 8 个既有差异文件（`examples/playground-server/tests/policy.test.ts`、`packages/nexus-core/src/buffer/index.ts`、`src/checks/safe-regex.ts`、`tests/conformance/classify.ts`、`tests/protocol-validator.test.ts`、`tests/safe-regex.test.ts`、`tests/tree-builder.test.ts`、`packages/nexus-react/tests/renderer-budget.test.tsx`），全部非本轮触碰，与 README 既有记录一致。
- CI 证据边界：CI 配置为 build → typecheck → lint → test；本轮未在远端 CI 观察到对应提交的真实运行，CI 通过不予声称，本地门禁不替代远端 CI。

## S2.7.5 SDK 独立复核结论（2026-10-21）

按 code-review-expert skill 四维清单（SOLID/边界、安全可靠性、代码质量与验证、删除/迭代）对 S2.1–S2.6 公开调用链独立复核：逐行核实 core 草稿/写回、server 准入/提交/锁、SSE 占用/留存三面。**结论：APPROVE（S2 阶段验收口径）**——无 P0/P1；复核发现并修复三项可达正确性问题，均附证伪测试；其余 P2/P3 有明确归属或属已声明限制。

### 已修复（均有证伪与回归测试）

1. **合法空输出 action 被错误拒绝**（server action 提交路径）：handler 不输出消息时，准入输入仍应原子提交并推进 revision。修复空结果的提交处理；非 HTTP 与实际 HTTP 响应测试验证成功固定结果、模型及后续 action。
2. **快照容量淘汰误选刚提交的权威代**（server `surface-action-state.ts` commitGeneration/commitAction）：JS Map 对已存在键 `set` 不刷新插入位，FIFO 淘汰可在重生成场景删除刚提交的权威快照，使在途 action 提交报「surface 不存在」。修复为先删后插的 LRU 刷新；证伪测试 `tests/surface-action-state.test.ts`（maxSurfaces=2，mutation 回退即红）。
3. **获锁后未保护 await 可永久泄漏 surface 锁**（server `adapter.ts` prepareAction）：准备阶段或 ledger 操作拒绝时锁不释放，该 surface 后续 action 全部永久排队。修复为用 `try/finally` 覆盖获锁后的准备阶段并确保锁释放；证伪测试 `test/agent/adapter-admission.test.ts` 覆盖准备阶段异常与 ledger 异常。

### 记录与归属（不阻断 S2）

| 级别 | 位置 | 触发条件与后果 | 处置 |
| --- | --- | --- | --- |
| P2 | server `send-messages.ts` 写流 | `stream.write` 返回值被忽略，慢消费者下 PassThrough 缓冲无界 | SPEC §3 已声明「背压硬上限尚待补齐」；归 S3（Koa 只负责连接与背压），不属 S2 声明违背 |
| P2 | core `runtime/index.ts` 草稿恢复 | 草稿指向不可达路径（dataModel 中间节点变标量）时 confirm 整体 false，该 surface 需重新生成恢复 | 与 SPEC §4.3 声明的原子 false 语义一致，且「重新生成」是文档化恢复路径；按条降级恢复归 S3 调度重构 |
| P3 | core `dataModel/strict-path.ts` | 数组寻址不校验当前长度边界，越界写入可撑长数组 | 待核实注册层是否已约束绑定路径可达；归 S3 资源/边界 |
| P3 | core `runtime/index.ts` setInputValue | 不做 checks 门控（与 triggerAction 不同） | checks 语义为提交性门控；是否约束写回待 SPEC 判定，归后续 |
| P3 | server `adapter.ts` 非 HTTP 直用 | 宿主不消费/不 dispose plan.run 时锁与 ledger 占用 | HTTP 路径有 finally 兜底；非 HTTP 所有权契约归 S3 显式化 |
| P3 | server `run-lifecycle.ts` | recordCommit 失败时权威已提交而 run 记 failed（自定义 manager 抛错才可达） | 客户端收 error 无 done、不得以旧基准重试；归 S3 commitState 语义 |
| P3 | server `api/routes.ts` void sendAgentRun | claim 同步抛出时 500 带 SSE content-type 的观测毛边 | 资源无泄漏；归 S3 Koa 适配收口 |
| P3 | server `api/send-messages.ts` abort 短路 | signal 已 aborted 时直接 end，无 error 帧 | 与常规失败路径不一致，轻；归 S3 |

### S2.7.5.3 阶段报告口径

- S2 已交付并验收：Catalog Contract v2（注册闸门/hash/prompt/双端同闸门）、声明驱动本地写回与草稿快照/确认、服务端权威准入（含参数重算与 resolver 后置）、固定提交基准与 runId 关联（响应头/按 run 查询/结果留存）、两个参考消费方的完整交互门控与双 Catalog 对测、conformance 基线一致。
- 限制（不得对外宣称）：完整 Session 生命周期、预览/提交双视图隔离、失同步恢复归 S3/S4；背压硬上限、仓外安装、NodeNext、真实浏览器验收、远端 CI 运行证据未完成；conformance 基线不是完整官方 Basic Catalog 兼容声明。
- 16 项任务逐项证据见本文档 §S2.7.1–§S2.7.4 与上表；S2 标记完成的对外表述以 CURRENT/README 为准（哈希在实际提交后回填）。

### S2.7.5.4 S3 交接单（不启动 S3 代码）

S3 入口（承接 SPEC §6/ARCHITECTURE）：

1. 单一运行调度：抽离不接受 Koa Context 的运行模块；每 runtime/surface 一个调度所有者（读取快照、revision/hash 核对、准入、handler、UI 提交）；移除全局队列/双锁与 HTTP 标志耦合；handler 不得在排队准入前执行。
2. Nexus Session v1 envelope：start/message/done/error、唯一终态、UI commitState（notCommitted/committed/unknown）与结构化 diagnostics；提交发布点与 unknown 口径按 SPEC §5.2。
3. 实例隔离与资源边界：ledger/store/scheduler 按实例隔离；活动/排队 run、消息、缓冲、记录的真实预算；超限显式拒绝、不淘汰保护记录（含本报告快照淘汰与锁泄漏教训）；取消释放源/锁/reader/监听器；SSE 背压硬上限。
4. Koa 薄适配：响应占用、序列化、连接、await/void 时序保留；非 Koa 事件消费者对测同一生命周期。

S2 必须保留的回归（移交 S3 后仍须全绿）：

- 准入拒绝面：12 份 request 夹具、7 份 catalog 夹具双端对测、paramSchema 默认路径、resolver 后置、handler 零调用/快照不变。
- 草稿链：写回声明驱动、快照确认代次幂等、归一化恢复、请求期间编辑可见。
- 基准链：baseline 双时序（内存+真实 HTTP）、runId 关联全链、404/409/淘汰不回退、编号不复用、SSE 占用与排队 await/void 时序。
- 本轮新增：快照 LRU 淘汰、store 拒绝不泄漏锁、dist 类型消费、契约加载中止、在途重复 action。

归 S4：client 包、Provider/A2UISurface 分离、预览/提交隔离、真实浏览器验收；归 S5：仓外干净安装、NodeNext 迁移、发行门禁。
