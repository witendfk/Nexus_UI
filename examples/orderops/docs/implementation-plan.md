# 实施顺序与任务清单

日期：2026-09-28。任务按编号顺序执行，前一项判据未过不进下一项。阶段门禁与业务验收标准见 [architecture.md §8](architecture.md)；接线依据见 [design.md](design.md) 与 [architecture.md §10](architecture.md)。

> **进度（2026-09-30）**：M0 完全闭环。M1 进行中：T2.1 contracts ✓；T2.2 SQLite migration + 7 表 ✓；T2.3 fixtures ✓；transport 流中断 P1 已修；T2.4 停滞检测 ✓（`cases/detect.ts`：仅扫 shipping 订单、乱序按 occurred_at 取最新、终态/缺失/损坏事件跳过、occurrence_key=触发事件 ID 幂等、承诺送达定 severity、建案写审计；11 项单测含三项判据）。45/45 测试绿（同居住 workspace，Nexus core 179 同步全绿）。开发在 `feature` 分支。下一步：T2.5（案件 repository + 查询 API）。
>
> **Review 遗留（2026-09-30，cdb7504 评审，APPROVE 无 P0/P1）**：P2 — `cases/detect.ts:80` 确定性 case id 理论碰撞（carrier 事件 ID 含连字符时可与既有 id 同串，INSERT OR IGNORE 会静默吞掉合法新案件；修复方向：`changes===0` 时回查既有行 `(order_id, occurrence_key)` 是否匹配，不匹配换 uuid 重试）。P3 — detect 阈值边界校验、config 非法值静默回退改显式、测试 `dirs` 死变量、`TERMINAL_EVENT_STATUSES` M4 时上移 contracts。**M1 收口前决策处理**（评审报告全文见 2026-09-30 会话记录）。
>
> **跨仓同步（2026-09-30 更新）**：Nexus_UI Layer 0 加固七项已全部关闭、官方 conformance 基线建成（33 pass / 47 已决策偏差 / 0 fail）；本工程已以 git subtree 同居为 Nexus_UI `examples/orderops/`，经 pnpm `workspace:*` 直链消费其公开入口——**「进 M2 前版本号刷新 tarball」门禁随同居失效**，M2 入口基线已达成（guard 34 例在同居 workspace 全绿）。action 锁/ledger 修复（`44a7fee`/`1264ce7`）与 transport 流中断修复（settled 语义见 `web/src/nexus/transport.ts`）均已在本工程消费的产物中。

## 工程纪律（每个迭代 part 适用）

- **单测目录**：每个任务的单测放所在包的 `test/` 目录，路径镜像 `src/` 结构（如 `src/nexus/catalog.ts` 的测试在 `test/nexus/catalog.test.ts`）；`src/` 内不放测试文件，构建产物（`tsconfig.build.json` 只含 `src`）因此不含测试代码。
- **测试先行判据**：任务完成 = 实现通过 + 对应单测存在且绿；涉及跨包契约的（contracts、Catalog、RPC），测试必须同时锁 schema 边界（非法输入被拒）与合法行为。
- **里程碑完成硬标准**（M1 起每阶段适用）：typecheck/lint/test/build 全绿 + push 后 CI 绿 + fresh clone 演练通过 + 真浏览器操作一遍。四条缺一不叫完成。

## 从哪里开始

**第一个动作是 T0.1（Node 24 基线统一），第一周目标是完成 M0 穿刺（T1.4）。**
T0 是纯机械修正（半天）；M0 的 T1.1–T1.4 用一个玩具 Catalog 把 `analyze → 生成源 → guard → SSE → 渲染 → action 回流 → 本地 handler → patch` 整条链在浏览器里打穿。这一步做完，技术路线即锁死，后面 M1–M3 不再有外部不确定性。M0 已在 2026-09-28 对照 Nexus 源码核实过全部公开 API，不存在"接口够不够用"的悬念。

总工期估算：T0（0.5 天）+ M0（1–2 天）+ M1（3–5 天）+ M2（4–6 天）+ M3（4–6 天）≈ **3–4 周完成第一条业务切片**。M4/M5 按 architecture.md §8 在切片稳定后另排。

---

## 阶段 0：工程基线（约 0.5 天）

| 任务 | 内容                                                                                                                                                    | 完成判据                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| T0.1 | 根 `package.json` engines 改 `node >=24`；四处 `@types/node` 升 `^24`；加 `.nvmrc`（24）；`better-sqlite3` 升 `^12`（Node 24 预编译）                   | `pnpm install` 无引擎警告         |
| T0.2 | 建 `host-server/src/main.ts`、`agent-server/src/main.ts`（Koa 实例 + `GET /health`，引用 `index.ts` 的版本常量）；删除两个包的 `@koa/cors` 及其类型依赖 | `pnpm dev` 两个 health 端口可访问 |
| T0.3 | 根 `tsconfig.json` 改为 base（去掉 jsx/include），三个包 tsconfig 各自引用；服务端包无 jsx                                                              | `pnpm typecheck` 全绿             |
| T0.4 | ESLint 9 flat config + Prettier + 根脚本；Vitest workspace（内存 SQLite 跑服务端测试）；GitHub Actions `ci.yml`（install→typecheck→lint→test→build）    | CI 全绿，`pnpm lint` 可用         |

## 阶段 M0：Nexus 接入穿刺（1–2 天）

| 任务 | 内容                                                                                                                                                                                                                                                                                                                                            | 完成判据                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| T1.1 | 在 `Nexus_UI` 对 `nexus-core`、`nexus-react`、`nexus-playground-server` 各 `pnpm pack`，产物入本仓 `tarballs/`；web 三个依赖改 `file:tarballs/…`，host-server 新增 `@nexus-ui/server` tarball 依赖                                                                                                                                              | `pnpm install` 成功，类型可解析                                                                     |
| T1.2 | Host 穿刺装配：`nexus/catalog.ts` 写玩具 Catalog（Column+Text+Button，schema+policy 双声明）；`nexus/adapter.ts` 用 `fallbackGeneration` 返回手写的 3 条 A2UI 消息；`http/app.ts` 整包挂 `createAgentRouter({ adapter, catalogContracts, streamDelayMs: 0 })`，另加自有 `POST /api/cases/:id/analyze` 直调 `prepareGeneration` + `sendAgentRun` | curl analyze 能收到 SSE `message×N → done`                                                          |
| T1.3 | Web 穿刺：`nexus/transport.tsx` 用 fetch 读 analyze 流 → `runtime.push(line)`/`end()`；`A2UIProvider` 挂 `catalogRegistry` + `catalogRenderMaps`                                                                                                                                                                                                | 浏览器看到受控渲染的玩具 surface                                                                    |
| T1.4 | action 回流穿刺：render map 里 `ctx.triggerAction` → transport 补 `timestamp`+`actionId` → POST `/api/a2ui/event`；Host 注册一个回显 handler 返回 patch                                                                                                                                                                                         | 点击按钮 → patch 生效（按钮禁用）；非法消息被 guard 拦截并收到 `error` 事件；Vite 代理下 SSE 不缓冲 |

**M0 完成即技术门槛通过**：install/dev/build/typecheck 全绿 + 只用公开入口完成生成与渲染。

## 阶段 M1：案件事实（3–5 天）

| 任务 | 内容                                                                                                                                          | 完成判据                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| T2.1 | 新建 `packages/contracts`：`CaseSnapshot`、`ReadContextResponse`、`AnalysisResult`、`CreateTicketInput` 的 zod schema 与类型                  | 三个包引用通过 typecheck                           |
| T2.2 | `db/migrations/0001_init.sql`（7 表 + 唯一约束）+ `db/client.ts` migration runner（`user_version` 记版本）                                    | 重复启动不重复建表                                 |
| T2.3 | `fixtures/`：一条停滞物流案例 + 一条正常对照案例（含 `last_event_id` 可回查）                                                                 | seed 脚本可重复执行                                |
| T2.4 | `cases/detect.ts`：最新有效物流事件与当前时间差值 > `ORDEROPS_STALL_THRESHOLD_HOURS` 建案；`occurrence_key` 防重复扫描；乱序/缺失事件代码处理 | 单测：停滞唯一建案、重复扫描不重建、正常样本零误报 |
| T2.5 | `cases/repository.ts` + `http/cases.ts`：`GET /api/cases?status=&severity=&q=`、`GET /api/cases/:id`                                          | 事件 ID、时间、来源可回查                          |
| T2.6 | Web：装 react-router；`QueuePage`（筛选/搜索）、`CaseDetailPage`（订单摘要、物流时间线、触发原因），路由参数驱动刷新恢复                      | 队列→详情→刷新，状态一致                           |

## 阶段 M2：Agent 分析（4–6 天）

| 任务 | 内容                                                                                                                                                                                                                                         | 完成判据                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| T3.1 | Host `tools/read-api.ts`：`GET /internal/cases/:id/context`，`ORDEROPS_INTERNAL_TOKEN` 鉴权                                                                                                                                                  | 无 token 401；快照与 contracts schema 一致       |
| T3.2 | `nexus/catalog.ts` 转正 Catalog v1：Column/Text/TextField/Button + OrderSummary/LogisticsTimeline，6 组件 `componentSchemas` + `componentPolicies.fields` 双声明，唯一 action `createTicket`，TextField 仅绑 `/draft/note`                   | guard 对越权组件/action 报 `CATALOG_UNSUPPORTED` |
| T3.3 | Agent `rpc/handler.ts`：POST `/rpc` 按 §10.1 契约返回 `application/x-ndjson`；`catalog-contract/client.ts` 按 `contractHash` 缓存；错误用非 2xx + `{error:{message}}`                                                                        | 用 fixture 生成源 curl 打通                      |
| T3.4 | Agent `analysis/`：`fixture.ts` 确定性分析（默认）；`model.ts` OpenAI 兼容调用 + zod 校验五字段 + 证据 ID ∈ 快照（失败重试→`insufficient_evidence`）；`ORDEROPS_ANALYSIS_MODE` 切换                                                          | 非法模型输出被 schema 拒绝并重试                 |
| T3.5 | Agent `a2ui/compile.ts`：分析结果 → 首条 `createSurface` + `updateComponents`（root=Column）+ `updateDataModel`；模型只决定模块内容与顺序                                                                                                    | 确定性快照测试；`done` 前含 root 组件            |
| T3.6 | Host `nexus/adapter.ts` 转正：`createExternalAgentGenerationSource({ endpoint, timeoutMs: 120000 })`（生成源内同步校验 message=有效 caseId）；`onGenerationCommitted` 写 `surface_bindings(surface_id, case_id, case_version, catalog_hash)` | 真实模型生成可渲染 surface                       |
| T3.7 | Web `nexus/render-map.tsx` 写 OrderSummary/LogisticsTimeline 渲染；transport 正式化（done 前禁用业务按钮、`error` 事件区分网络错误）                                                                                                         | 证据引用点击可回查对应事件                       |

**M2 完成 = 真实模型生成可渲染 surface、证据引用正确、非法输出被 guard 拒。**

## 阶段 M3：人工闭环（4–6 天）

| 任务 | 内容                                                                                                                                                                                                                                                                             | 完成判据                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| T4.1 | `nexus/create-ticket.ts` 本地 handler：`resolveActionContext` 只留备注字段并按类型/长度校验（其余客户端字段拒绝）→ `surface_bindings` 核对 `case_version`（过期拒绝）→ 事务内写唯一工单（`case_id` 唯一约束）+ 案件状态 + `action_attempts` + `audit_events` → 返回 patch 消息源 | 最新备注生效；伪造/过期/重复提交被处理     |
| T4.2 | patch 编译（按钮 `disabled: true` 字面布尔 + 工单号）；`GET /api/actions/:actionId` 结果查询                                                                                                                                                                                     | 事务先于流式；SSE 中断不回滚               |
| T4.3 | Web `actions/status.tsx`：提交态、结果展示、失败重试（不盲目重发建单）、刷新与断线后按案件查询重建状态                                                                                                                                                                           | 刷新及断线后结果一致；重复提交返回已有结果 |
| T4.4 | 失败样本测试七项：编造事件 ID、非法 Catalog 字段、伪造订单 ID、旧 surface 提交、双击建单、SSE 中断、事务成功但 patch 失败                                                                                                                                                        | 全部有自动化用例覆盖                       |

**M3 完成 = 第一条业务切片（M1+M2+M3）交付。** 之后 M4（高金额退款，验证复用性）、M5（评估与简报）按 architecture.md §8 另行排期。
