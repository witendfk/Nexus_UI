# A2UI v0.9 官方 Conformance 基线与 Profile 偏差声明

更新：2026-09-30。数据源：官方规范仓 `specification/v0_9/test/cases` 的 **9 份用例**（8 份 JSON Schema 套件共 76 条判定 + 1 份 contact form 完整示例流 4 条消息）。执行挂具：`packages/nexus-core/tests/conformance.test.ts`，机器可读基线：`packages/nexus-core/tests/conformance-baseline.json`。

## 结论

| 判定 | 数量 | 含义 |
| --- | --- | --- |
| **pass** | 33 | 官方 schema 与本仓两层校验结论一致（含示例流 3 条完全合法消息） |
| **known-deviation** | 47 | 已决策偏差，分四类见下 |
| **fail** | **0** | 不存在「官方合法但协议层拒绝」的分层回归 |

各套件分布：button_checks 7 · checkable_components 12 · client_messages 3 · contact_form_example.jsonl 4 · contact_form_example_test 3 · function_catalog_validation 43 · tabs_checks 2 · text_variants 2 · theme_validation 4。

## 方法

官方用例的 `valid` 字段是官方 JSON Schema 的判定。本仓把每条用例过两层：

1. `validateProtocolMessage` —— 官方结构对齐层（结论面应与官方 schema 一致）；
2. `validateNexusProfileMessage` —— Nexus Runtime Profile 支持边界（Agent 线能力裁剪）。

两层的组合结论与官方判定比对后归类。**任何校验器行为变化若改变本基线，conformance 测试即失败**——必须显式重新生成基线（重跑分类器写回 JSON）并在本文档补决策记录，不允许静默漂移。

## 偏差决策

### 1. `profile-unsupported`（16 条）：官方合法，Profile 明确不支持

协议层正确放行（结构合法），Profile 层以 `FEATURE_UNSUPPORTED` 可预测拒绝。

- **FunctionCall 全家**（`formatString/formatNumber/formatCurrency/formatDate/pluralize/openUrl`、`action.functionCall`、以及示例流中 `submit_button` 的 `formatDate`）——Agent 线不支持服务端函数调用，对齐「当前 Agent 线」边界。
- **checks 组合器 `and/or/not`** 与 **`ChoicePicker/CheckBox/DateTimeInput.checks`**——Profile 的 checks 只支持五个确定性函数（`required/regex/length/numeric/email`）且只挂在可校验输入组件上。

决策：**接受**。这是 Runtime Profile 的能力边界声明，不是结构错误；消费方拿到的拒绝是结构化的、逐条可解释的。

### 2. `profile-catches-protocol-loose`（23 条）：官方判非法，协议层偏松、Profile 兜住

协议层是官方 schema 的**结构子集**（信封 + payload 形状），不复制官方 schema 的值级/参数深校验（函数参数类型、URL 格式等）。这些用例协议层放行，但全部被 Profile 的契约校验（checks 参数契约、FunctionCall 裁剪）拒绝，**运行时不会消费任何一条**。

决策：**接受**。与 L0-07 确立的分层一致——协议层管结构，语义约束归 Profile/Catalog。风险剩余量：无（两层串联后结论与官方一致）。

### 3. `degraded-value-constraint`（5 条）：官方判非法，协议与 Profile 均放行，渲染降级

- `Button` 携带 deprecated 的 `enabled`/`primary`（官方 schema 已删除这些字段）；
- `Text.variant` 拼写非法；
- `theme.primaryColor` 类型错误 / 非 hex 颜色。

决策：**接受，记录为已知限制**。这些值只影响渲染质量：渲染器对未知 variant/属性降级或忽略，theme 值由宿主消费时自然失效——无状态污染、无崩溃路径。若未来收紧，收在 Profile/catalog 层（保持协议层结构对齐），不回到协议层。

### 4. `scope-client-to-server`（3 条）：方向不适用

`client_messages.json` 针对官方 `client_to_server.json` schema（客户端发出的 `action`/`error`）。core 校验器的契约是 **server→client 流入边界**；client→server 消息由宿主/服务端包边界处理（orderops web transport 对回流 action 补齐信封后 POST，host-server 侧校验）。

决策：**接受（范围声明）**。core 对这类消息返回「必须且只能包含一个 A2UI payload」是正确行为——它们不该出现在 server→client 流上。

## 与 Layer 0 加固偏差的关系

L0-02/L0-07 引入的两条偏差已包含在上述分类中并随基线固化：

- **正则求值仅支持无反向引用/环视的子集**（L0-02）：官方合法但被准入面拒绝的 pattern 落在 `profile-unsupported` 类（本轮官方用例未覆盖该形态，由 `safe-regex.test.ts` 覆盖）。
- **保留字 ID 拒绝在 Profile 层而非协议层**（L0-07）：保证「官方合法 → 协议层放行」的零 fail 不变量成立；Profile 层拒绝行为由 `protocol-validator.test.ts` L0-07 用例覆盖。

## 再生流程

校验器有意变更后：

1. `NODE_OPTIONS='--import tsx --no-warnings' npx tsx -e "import { buildConformanceReport } from './tests/conformance/classify'; import { writeFileSync } from 'node:fs'; writeFileSync('./tests/conformance-baseline.json', JSON.stringify(buildConformanceReport(), null, 2) + '\n')"`（在 `packages/nexus-core` 下执行）；
2. 更新本文档的结论表与偏差决策；
3. 提交时说明哪类偏差发生了变化及原因。
