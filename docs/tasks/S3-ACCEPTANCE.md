# S3 阶段验收 — 通用 server runtime 与 Session v1

验收日期：2026-10-28。范围：S3.1–S3.7，七个单元、28 项子任务。实现基线为已推送的 S3.6 `f50bd6f`；S3.7 新增公开产物/HTTP 回归和文档收口，尚未提交。环境：macOS arm64、Node v24.16.0、pnpm 9.15.9。

## 1. 结论与交付

**APPROVE：S3 已完成，范围内无未关闭的 P0/P1。** 交付传输无关 `createAgentRuntime`、按记录所有者唯一调度、固定提交结果与三态提交事实、Session v1、访问准入、资源预算、HTTP/非 HTTP 背压及取消隔离。SDK 不选择宿主 Agent，不提供业务编排、权限规则或业务结果库。

S3.7 四项交付：

| 子任务 | 结果与证据 |
| --- | --- |
| S3.7.1 公开 API/消费迁移 | 三包根入口、类型与 dist 清单核验；server API 快照改从包根消费；普通 Node 执行生成→action→查询→旧基准拒绝，见 §3。server README 修正访问装配、自动提交、自定义 store 结果和异常语义 |
| S3.7.2 需求矩阵/S2 回归 | R5/R6/R7 的 server 切片逐项定位，S2 八项遗留逐条处置，见 §4/§5；core 数组越界通过本次 dist 的小规模反例复现，不误称只能由宿主白名单触达 |
| S3.7.3 门禁/SDK review | 本次 Node 24 门禁与四维 review，见 §2/§7；不以 S3.6 历史日志代替 |
| S3.7.4 报告/交接 | 本报告为 S3 最终证据；CURRENT 收敛为阶段摘要与后续范围，README/SPEC/ARCHITECTURE/DESIGN 同步，见 §6 |

**尚未交付**：client 预览/提交双视图隔离、失同步恢复、稳定 Provider/独立 Surface 属 S4；仓外安装、原生 NodeNext 迁移、兼容/发行与远端 CI 门禁属 S5。当前私有三包、workspace 产物验证不等于已可发布 alpha 或 production-ready。

## 2. 本次工程门禁

以下均在本次工作区实际执行，不引用旧快照；命令使用 Node 24 PATH。日志为本地临时证据，后续可用命令复跑。

| 命令/检查 | 结果 | 本地日志 |
| --- | --- | --- |
| `node -v` / `pnpm -v` | v24.16.0 / 9.15.9 | 环境实测 |
| `pnpm build:packages` | exit 0 | `/tmp/s37-build-packages.log` |
| `pnpm build` | exit 0 | `/tmp/s37-build.log` |
| 构建后 `pnpm typecheck` | exit 0 | `/tmp/s37-typecheck.log` |
| `pnpm lint` | exit 0 | `/tmp/s37-lint.log` |
| `pnpm -r --if-present lint` | exit 0 | `/tmp/s37-package-lint.log` |
| `pnpm test` | exit 0，1029 项 | `/tmp/s37-test.log` |
| 本次变更 TS/MJS 定向 Prettier | 通过 | 定向检查 |
| 变更文档相对链接/围栏 | 通过 | 本地结构检查 |
| `git diff --check` | exit 0 | 工作区检查 |

测试分布：core 346、server 447、React 51、playground 38、standalone 45+11、参考服务 91；全部通过。新增 5 项：三包普通 Node 根入口加载各 1 项、公开产物生成/action 接入 1 项、真实 HTTP 占用失败 1 项。既有反例继续覆盖 S3.5 三项和 S3.6 八项复审整改；这些是历史修复，不重复算本次新增。

conformance 随 core 套件逐条对拍当前基线：官方 9 份用例、80 条，pass 36；已决策偏差 44（Profile 不支持 13、Profile 兜底 23、值级降级 5、方向不适用 3），0 fail。分类无变化，无需更新基线；这只证明 Protocol/Profile 分类，不是完整官方 Basic Catalog 兼容声明。

## 3. 公开 API、产物与迁移

- 三包 `exports["."]` 均指向本次构建的 ESM 与 `.d.ts`；`files` 为 dist/README；包间依赖单向 core ← react/server，消费方仅使用公开根入口。源码无反向导入 examples/web，无 listener 或 `process.env` 读取；构建配置的 core 别名只指向 dist 声明，未回退源码 paths。
- `server/test/build-artifact.test.ts` 核验三包完整文件清单，对照当前 src 的 JS/map/d.ts/declarationMap，能发现删除源码后残留与漏产物。另在清除 NODE_OPTIONS 的普通 Node 子进程从各包名导入根入口，禁止 import 期间启动 listener；不会由 tsx 掩盖 ESM 路径问题。
- `server/tests/public-api.test.ts` 从 `@nexus-ui/server` 锁定运行时符号快照并导入 S3 类型（含 runtime、access、budgets、handle、store 提交结果和诊断）；本次 typecheck 消费 dist 声明。core/React 的根 API 快照亦随全仓套件通过。
- `server/test/runtime/fixtures/public-entry.mjs` 仅导入 core/server 包根，以普通 Node 执行生成和 action，逐事件经过 core 序列检查；核对 done/result/固定查询相同、revision 1→2、旧基准拒绝且 handler 零新增调用、默认访问拒绝与记录隔离。可复跑：`node packages/nexus-server/test/runtime/fixtures/public-entry.mjs`（先构建三包，Node 24）。这是仓内 workspace 公开产物验证，不是仓外安装验收。

删除与保留决策：

| 项目 | 当前处置/原因 |
| --- | --- |
| HTTP `surfaceRunQueues` / adapter `acquireSurfaceLock` | 已删除；所有运行入口委托同一 scheduler，源码无该实现残留 |
| hook/history 异常回滚快照 / ledger failed 重入 | 已删除；提交后仅诊断，留存窗口内任意已知 action 拒绝重入 |
| `runsAccess` / sender idPrefix 四参槽位 | 已迁移 `access.read` / 三参 `sendAgentRun`；两个参考服务与必要浏览器解析已迁移并经本轮回归 |
| `prepareGeneration/prepareAction` / `AgentPlan` | 保留公开兼容外壳，委托同一调度；ok:false 仅入队前，不能据此判断 handler 的业务结果 |
| 模块内 `sendMessages` | 按 SPEC §6.7 保留非运行工具路径，仅内部测试引用、不从包根导出；无 run/commitState 承诺，不能替代 SDK 运行入口。SDK sender 不经过其 pump，不构成并行运行解释器 |
| `fix-esm-imports.mjs` | 当前构建仍必需，原生 NodeNext 迁移与移除属 S5；本次不临时删脚本破坏产物 |

Session/server API/RPC/onboarding 版本保持 1，Catalog Contract 保持 2；包版本保持 0.1.0/private。显式迁移的是装配与失败行为，不静默保留两套公开解释器；分发发版另按 S5 与 AGENTS 执行。

## 4. R5/R6/R7 证据矩阵

以下测试路径除特别说明外相对 `packages/nexus-server/`。R5 只验收 server 部分；浏览器预览隔离与恢复不列作已实现。

| 需求/不变式 | 真实入口 | 正反例与证据 |
| --- | --- | --- |
| R5 候选不是提交；source EOF 后完整校验，再发布唯一终态 | runtime generate/action → events/result；sender | `test/runtime/session-events.test.ts`、`session-fixtures.test.ts` 读取共享 oracle；core `test/session/events.test.ts` 覆盖无终态 EOF/重复终态/错身份/revision |
| R5 store 确认是提交权威；UI 结果与业务结果分开 | store 提交 → commit-result/run lifecycle | `test/agent/commit-facts.test.ts`、`test/runtime/commit-failures.test.ts`；提交前拒绝、写后确认丢失 unknown、副作用后 patch 拒绝、提交中取消、history/record/ledger 组合故障 |
| R5 旧基准不能借查询恢复资格 | action 调度内核对；固定 run 查询 | `test/api/surface-state-query-interleave.test.ts` 同验查询前后另一提交；`test/runtime/fixtures/public-entry.mjs` 公开产物 handler 调用计数；旧 revision 拒绝且快照不变 |
| R5 取消及时收敛且不放行业务重叠 | signal/cancel/dispose/断连 → runtime | `test/runtime/resource-boundaries.test.ts`：prepare/next/return 挂起、queue pin 清理、隔离总容量、store 在飞确认；`test/api/send-messages-regressions.test.ts`：两阶段 signal、监听交接/重复关闭 |
| R6 Koa 与非 Koa 共用准入/提交/Session 事实 | runtime + router/sendAgentRun | `test/api/http-parity.test.ts` 真实 socket 消费；正常生成、带输入、空 action、旧基准拒绝、提交失败/unknown、403/404/409/503、排队即时带头、void 增量、断连与占用失败；`tests/sse-response-claim.test.ts` 保留 await 流式行为 |
| R6 可替换依赖与实例隔离 | createAgentRuntime / Adapter / 原始自定义 run | `test/runtime/agent-runtime.test.ts`（跨实例同名 surface、兼容入口共享调度）、`surface-scheduler.test.ts`；`test/runtime/custom-run-cleanup.test.ts` 初始化/清理组合失败；standalone 双 Catalog/外部 verifier/RPC 回归 |
| R6 访问缺省拒绝、授权目标与执行一致 | access.generate/action；HTTP access.read | `test/agent/access.test.ts`、`access-isolation.test.ts`：异步钩子/调用方修改、标准/反向受限对照、源/handler 零调用；查询是可信宿主本地只读接口，对外读授权在适配层 |
| R7 有界资源且原子失败 | budgets → scheduler/guard/default stores/handle/sender | `test/runtime/budgets.test.ts` 默认值逐项对拍 fixture；`resource-boundaries.test.ts` 跨 run 累积/保护容量；`test/agent/storage-budgets.test.ts` UTF-8/稀疏数组/完整快照/history；非法预算与超限显式拒绝 |
| R7 两种消费均有背压；响应结束独立回收 | events() 拉源前水位；SSE write/drain/finish | `test/api/sse-backpressure.test.ts` 合法大流、真正慢消费与取消；`sse-drain-recovery.test.ts` drain 早到/最终帧堵塞；`resource-boundaries.test.ts` 非 HTTP 暂停/恢复/超时与迭代接续 |
| R7 诊断/公开产物/conformance 可复现 | core Session、server 根入口与默认预算 | 诊断 64 条及字段截断、JSON 往返、beforeStart；公开产物与类型见 §3，conformance 与工程门禁见 §2 |

S2 回归继续通过：catalog-v2 共享非法/正常 fixture、最终 handler 参数 schema/resolver 后置、双 Catalog 最新输入与连续 action/双 surface、草稿代次与在途编辑、固定 runId/hash/revision/查询、快照 LRU/编号不复用、准备/ledger 抛错后释放。证据分别在 `test/agent/action-admission-fixtures.test.ts`、`adapter-admission.test.ts`、core `test/runtime/input-draft-confirm.test.ts`、两个浏览器测试及 `tests/surface-action-state.test.ts`，不只以测试总数判断完成。

## 5. S2 遗留项逐条处置

来源为 [S2 报告](S2-ACCEPTANCE.md)「记录与归属」，原历史记录保持不改。

| 遗留 | 当前核实 | 处置 |
| --- | --- | --- |
| SSE write 忽略背压 | SDK sender 有 write/drain/最终响应期限，真实目的流反例通过 | S3 已关闭；内部非运行 sendMessages 不作公开运行保证 |
| 草稿恢复路径变标量时 confirm 整体 false | core 原子失败测试保持模型与有效草稿均不变；消费者不开放新基准 | 当前 fail-closed 契约保留；重新生成是现有恢复路径。S4 接完整恢复接口，不引入静默按条成功 |
| strict-path 数组越界扩张 | 本次普通 Node 从 core dist 复现：模型 arr 长度 1，组件绑定 /arr/3，setInputValue 成功后长度 4；本地 core 无 server 白名单，不能把可达性限定到宿主许可。注册期无法据动态模型证明长度 | S3 server 完整快照字节预算及原子拒绝反例已覆盖；core 普适数组/模型资源边界仍有缺口，S4 入口优先处理，alpha/S5 前须验收。不得宣称 core 任意直调用已受同等预算保护 |
| setInputValue 不做 checks 门控 | 写回仍执行 inputs 值 schema；checks 在 triggerAction 与服务端准入处执行 | 明确为提交门控，保留输入编辑能力，无需将 checks 增补为写回前置；SPEC §4.3 同步，S4 保持动作出口门控 |
| 非 HTTP 不消费/不 dispose 占用 | 高层运行主动推进并自动提交，仅 await result 有 run 总量预算；迭代暂停有水位/30 s 期限；原始手动 run 须显式结束 | S3 所有权已明确；非协作宿主保持有界隔离，不宣称杀死业务代码 |
| recordCommit 失败将已提交误标失败 | 提交确认后记录故障只诊断，done/result 保持 committed；外部记录未写成功仍按实际查询 | S3 已关闭，commit-failures/commit-facts 回归 |
| claim 抛错后 500 带 SSE 头 | 本次新增真实 Koa/HTTP 反例确实到达 flushHeaders 注入失败；响应 500/plain、无运行头、源工厂零调用、句柄 canceled | S3 已核实关闭；真正已发出的 HTTP 头不能回滚，连接损坏由传输失败处理 |
| sender signal 已 aborted 时无 error | SDK sender 仍发唯一取消 error，并清理监听/禁止源工厂；断线无法投递时只留本地终态 | S3 已关闭；原始内部工具路径不改变为 Session |

## 6. S4/S5 交接

- **S4 入口优先项**：core 直调用的数组寻址与模型资源边界（含本地写回/协议更新），定义兼容语义并建立真正超限反例；不能依赖 server 白名单或 React 装配掩盖。保留现有非规范数组别名/原型段拒绝。
- **S4 client**：新增无 React/server 依赖的会话控制器与 fetch/SSE 适配，隔离预览/提交/草稿，核对终态/本地校验/身份；EOF 不成功，unknown/失同步禁 action，通过受控快照或重生成恢复。
- **S4 React/消费迁移**：Provider 只供上下文，独立 A2UISurface、稳定 runtime/订阅/销毁所有权；两个浏览器共用 client，删除重复 SSE 消费，验证双 surface、自定义控件、输入/动作门控及既有重复 key 问题。
- **S5**：仓外干净安装、NodeNext/ESM 修补移除、兼容/版本/升级与远端 CI/发行；运行环境声明 >=18 与真实 Node 24 工程要求的一致性必须解决。S4 真实浏览器验收尚未执行，不将 jsdom/HTTP 测试当作浏览器实测。

## 7. SDK review 与边界

按 `.zcode/skills/code-review-expert/SKILL.md` 及四份清单执行：

- SOLID/架构：追踪公开工厂→adapter→唯一 scheduler→guard→store→Session→sender，运行事实没有第二个 HTTP 所有者；无新增门面包/业务默认依赖。
- 安全/可靠性：复核访问快照、调度内基准/输入与最终参数、提交确认及副作用边界；资源/取消/背压反例与共享 oracle 均在本次套件执行。
- 质量/证据：公开产物测试使用普通 Node 与包根，类型消费 dist；HTTP 失败反例核对注入点调用计数及实际目的响应，防止其他提前失败碰巧通过。
- 删除/迭代：§3 保留/删除有明确替代与契约依据，§5/§6 标明尚存 core 边界与 S4/S5 责任。修正原工作区报告中取消释放、无非 HTTP 背压、允许 snapshot 越界的旧描述，及 README 中默认访问/自动提交/history 失败的过期指引。

复核结果：本次 S3 范围无新增未修复 actionable finding。已知 core 直调用资源缺口按 §5 明确交接，不等于已关闭；S3 验收不覆盖接入方业务工程。未运行仓外安装、真实浏览器、远端 CI，也未执行 S4 改造或提交推送。
