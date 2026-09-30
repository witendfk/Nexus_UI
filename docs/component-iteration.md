# 组件能力迭代方向

状态：组件层迭代执行基线（配套 [iteration-plan.md](iteration-plan.md)，不替代其 Phase 定义）。
更新：2026-09-30。
背景：运行时最小功能闭环已有样例；17 个 Basic-like 组件当前是受限子集。公共边界加固仍有阻断项，详见 [Runtime 加固问题台账](runtime-hardening-review.md)。本文定义"把一个组件打穿到什么程度算完成"，以及 18 个官方 Basic 组件的迭代顺序。

## 1. 现状基线：与官方 Basic Catalog 的已知偏差

对照 `specification/v0_9/json/basic_catalog.json` 与 `common_types.json`，当前实现的受限点（截至今日代码，未跑官方用例，以下为静态核对）：

| # | 官方定义 | 当前实现 | 性质 |
| --- | --- | --- | --- |
| 1 | `checks`（Checkable）允许挂在 Button、TextField、CheckBox、ChoicePicker、Slider、DateTimeInput 共 6 个组件 | core `CHECKABLE_COMPONENTS` 只有 TextField、Slider、Button；CheckBox/ChoicePicker/DateTimeInput 的合法 checks 被拒 | 需决策：对齐或声明为 Profile 偏差 |
| 2 | 14 个 check/function：required、regex、length、numeric、email、formatString、formatNumber、formatCurrency、formatDate、pluralize、openUrl、and、or、not | core 只求值 5 个基础函数；and/or/not 组合函数与 format*/pluralize/openUrl 未实现 | 功能缺口 |
| 3 | `Button.variant`（default/primary/borderless） | React Button 未消费 variant | 渲染缺口 |
| 4 | `Text.variant` | 未消费（待确认） | 渲染缺口 |
| 5 | `ComponentCommon.accessibility`（AccessibilityAttributes，全部 18 个组件） | core 未校验、React 未透传 | 横切缺口 |
| 6 | `CatalogComponentCommon.weight`（Row/Column 直接子组件的 flex 语义，含"仅直接子组件合法"的跨字段约束） | 未支持 | 横切缺口 |
| 7 | `theme`（createSurface.theme.primaryColor 等） | core 存储，React 未应用 | 横切缺口 |
| 8 | `Modal`（trigger/content） | 未实现 | 框架级缺口 |
| 9 | `List` 的 ChildList 数据模板 | 仅静态 children | 框架级缺口 |
| 10 | `Tabs` 同时定义 `tabs` 与 `items` 两种声明 | 仅支持其一（待对确认） | 待核对 |
| 11 | `Slider` 的 checks 支持是官方定义还是 Profile 自加 | 官方 Checkable 含 Slider（一致），但 core 的允许范围与官方不同（见 #1） | 随 #1 一并定案 |

`specification/v0_9/test/cases/` 有 9 份官方 conformance 用例（button_checks、checkable_components、client_messages、tabs_checks、text_variants、theme_validation、function_catalog_validation 等，`{schema, tests:[{description, valid, data}]}` 形状），当前未接入本仓测试。

## 2. 迭代原则

- **纵向打穿优先于横向铺字段。** 一个组件算"打通"，是它在全部七层都到验收线，不是在某一层多支持几个字段。
- **模板复用。** 第一个组件建立"组件迭代模板"（验收清单 + 测试矩阵 + fixture 形状）；之后每个组件的 PR 按同一模板走，边际成本递减。
- **批次由业务牵引。** 横向批次的顺序由 OrderOps 首条切片实际需要的组件决定，不按组件家族的舒适度排。
- **偏差必须声明，不允许默认。** 每个 #1–#11 偏差，要么对齐官方，要么写进 [host-integration.md](host-integration.md) 的 Profile 边界；"实现没覆盖到"不是合法状态。

## 3. 组件"打通"验收线（DoD，七层）

每个组件完成时必须满足：

| 层 | 验收 |
| --- | --- |
| D1 协议校验 | 官方字段集、enum、required、`unevaluatedProperties: false` 语义在 core validator 支持；非法字段/值被结构化 diagnostics 拒绝 |
| D2 动态值 | 每个 `DynamicString/Number/Boolean/StringList` 字段支持字面量 + `{ path }` 绑定；绑定解析、缺失路径 pending、类型不符拒绝三态各有测试 |
| D3 渲染 | spec 字段到 React 渲染行为有映射（variant、displayStyle、filterable、fit、axis、weight 等）；theme/accessibility 按横切决策降级 |
| D4 交互闭环 | 输入组件写回 dataModel 类型正确；checks 失败有 UI 失效态且阻断 action；action 挂载符合 catalog policy |
| D5 guard 一致 | server policy 与 core 校验结论一致：同一组 fixture，两端合法的都过、非法的都拒 |
| D6 测试矩阵 | core 单测（合法/非法/边界）+ React 渲染测试 + guard 拒绝测试 + 一条 JSONL fixture 端到端（生成→渲染→交互→action→patch） |
| D7 conformance | 官方 `test/cases` 中该组件相关用例全绿；[host-integration.md](host-integration.md) §6/§7 支持矩阵与代码一致 |

## 4. Layer 0：公共地基（组件迭代的前置，一次性）

| # | 任务 | 验收 |
| --- | --- | --- |
| 0.1 | conformance harness：测试直读 `specification/v0_9/test/cases/*.json`，逐条跑 core 的 protocol/profile 校验，产出"官方用例通过率"基线，纳入 CI | 有基线数字；每份用例文件标记 pass / known-deviation / fail 三态 |
| 0.2 | 偏差定案：对 §1 表 #1–#11 逐条决策（对齐 / 声明偏差），写入 host-integration.md | 表格清零，无未声明状态 |
| 0.3 | **未通过验收**：按 [L0-01–L0-07](runtime-hardening-review.md)修复流截断、正则求值、实际渲染预算、继承属性、异常隔离、深链及协议分层；服务端剩余项按工程优先级验收 | P0/P1 关闭，P2 分层问题与 0.2 同步解决；完整渲染链及双仓同 fixture 证据齐全 |

2026-09-30 静态复核：0.1 harness 与 0.2 偏差决策仍待落地；0.3 的局部实现和历史单测结果不足以关闭加固。0.1/0.2 与 0.3 可并行，验收以台账反例、conformance 数字和双仓结果为准。

## 5. Layer 1：模板组件（先纵向打穿两个）

**TextField → Button，成对打穿。** 只打穿 TextField 会缺 action 维度，第二个组件仍要重开模板；这两个合起来恰好覆盖输入写回 + 校验 + checks + action 挂载 + variant 全部硬维度。

| # | 任务 | 验收 |
| --- | --- | --- |
| 1.1 | TextField 打穿：按 D1–D7 全链路；`validationRegexp` 与 `checks` 的优先级/共存语义定案并测试；pattern 加固落地 | D1–D7 全绿；含 number variant 写回类型 fixture |
| 1.2 | Button 打穿：`variant` 三态渲染；checks 阻断语义；action.event 与 catalog policy 全链路 | D1–D7 全绿；官方 button_checks.json 全绿（composite 部分按 0.2 决策） |
| 1.3 | 组件迭代模板定稿：从 1.1/1.2 提炼 PR checklist、fixture 形状、测试矩阵模板，作为 docs 附录或 PR 模板 | 之后每个组件 PR 引用同一模板 |

## 6. Layer 2：横向迭代（四批，顺序由 OrderOps 牵引)

| 批 | 组件 | 复用 | 新增能力 |
| --- | --- | --- | --- |
| A 输入 | CheckBox → ChoicePicker（补 checks）→ DateTimeInput（补 checks）→ Slider | TextField 模板全覆盖 | 数值/数组/日期写回类型 fixture 各一；#1 决策落地 |
| B 展示 | Text（补 variant）→ Icon → Image → Video → AudioPlayer | D1–D3 为主 | media URL 边界决策（allowlist 或声明边界）；DynamicValue 绑定全字段确认 |
| C 布局 | Divider → Row/Column（补 weight 语义）→ Card → Tabs → List | D1–D3 | `weight` 跨字段约束（仅 Row/Column 直接子组件合法）；`List` ChildList 数据模板单独排（core 新能力） |
| D 框架 | Modal | 全部模板 | core overlay 生命周期（trigger/content 关系、action 后关闭语义）+ React portal；最后做，是唯一框架级组件 |

每批完成时的横切验收：官方 conformance 对应用例全绿；该批每组件一条端到端 fixture；guard/core 一致性测试；host-integration.md 支持矩阵随批更新。

## 7. 与业务切片的衔接

组件迭代提供能力完整性，OrderOps 提供业务价值证明，两条线互相供给。**业务工程在同级独立仓 `../orderops-agent`（三包：agent-server / host-server / web），通过 `tarballs/*.tgz` + pnpm overrides 消费本仓产物；本仓 Phase 2 的"干净宿主安装证明"由该仓承担。**

1. Layer 0 + Layer 1 完成后即转 [iteration-plan.md](iteration-plan.md) Phase 3 首条切片——它恰好只消费 Text/TextField/Button + 两个业务组件，正好检验模板。
2. **tarball 纪律**：本仓每次合并加固或能力变更后，先提升 core/React/server 三包 patch 版本并同步对方 deps/overrides，再在 `orderops-agent` 执行 `pnpm pack:nexus` + `pnpm install`；记录实际安装版本和 tarball 身份。禁止覆盖同名同版本 tarball（pnpm 不会因此重读，`--force` 也不能替代版本升级）；两个仓的 guard 行为以同一批 fixture 双端验证（D5 的跨仓形式）。当前未验收的 Layer 0 改动不能作为对方 M2 的加固基线。
3. Phase 3/4（即 orderops-agent M2–M4）暴露的组件需求反过来提升对应批次在 Layer 2 中的优先级；业务等不到的批次提前，等得到的顺延。
4. 不等 17 个全好才接业务；也不在业务仓里实现绕过模板的组件能力。

## 8. 验收口径

- 进度以 conformance 基线数字与 D1–D7 矩阵为准，不以"感觉差不多了"为准。
- 每个完成的组件在本文档追加一行：组件 / 日期 / D1–D7 证据链接 / 偏差声明。
- 官方用例从基线起只允许向 pass 或 known-deviation 两个方向移动，不允许回归为 fail。
