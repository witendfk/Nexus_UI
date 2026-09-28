# OrderOps Copilot Product Direction

状态：当前具象 Agent 方向锚点。  
日期：2026-09-28。  
用途：把 Nexus UI 的下一个业务验证场景收敛到电商内部订单异常运营，而不是继续发散到 C 端导购、通用 BI 或低代码平台。

## 1. Position

> OrderOps Copilot：面向电商公司内部运营、客服主管和店铺管理者的订单异常处理 Agent。

一句话定位：

> OrderOps Copilot 自动扫描订单、物流、库存、退款和客诉数据，发现异常并解释原因；它给出处理建议，但退款、补发、优惠券、升级和建单等高风险动作必须由内部人员在受控确认界面中批准后执行。

它不是 C 端导购，也不是通用 BI 报表工具。图表、卡片和表单都服务于一个业务目标：更快、更稳定地处理订单异常，减少退款损失和客诉升级。

## 2. Target Business

首选窄行业：

```text
3C 配件独立站 / 跨境电商
```

示例商品：

- 手机壳。
- 充电器。
- 数据线。
- 无线耳机。
- 桌面支架。

目标团队规模：

```text
10-200 人电商内部团队
```

这不是大规模平台假设，而是一个真实、可理解的内部运营场景。小团队通常同时使用店铺后台、物流商后台、表格、客服工具和群聊，异常处理容易遗漏和延迟。

## 3. Market Problem

| 问题 | 业务损失 |
| --- | --- |
| 物流长时间无更新 | 客户催单、差评和退款增加。 |
| 包裹疑似丢失 | 处理慢会造成重复投诉和平台评分下降。 |
| 超时未发货 | 触发平台处罚或客户取消。 |
| 高金额退款请求 | 误批会直接损失利润，误拒会升级客诉。 |
| 缺货但仍投广告 | 广告费用浪费，新增订单继续产生投诉。 |
| VIP 客户异常 | 处理不及时影响复购。 |
| 处理记录分散 | 无法复盘哪些 SKU、物流商或规则反复出问题。 |

业务方关心的结果：

- 缩短异常确认时间。
- 减少退款和补发损失。
- 避免高风险动作被误执行。
- 让普通运营按照统一策略处理异常。
- 保留可复盘的决策链。

## 4. Agent Workflow

Agent 不做自由自主循环，而是遵循固定业务流水线：

```text
ingest orders / logistics / inventory / tickets
  -> detect anomalies
  -> enrich order, customer, product, and logistics context
  -> classify severity
  -> recommend resolution
  -> render controlled review surface
  -> human approves / edits / escalates
  -> execute action through host handler
  -> patch same surface
  -> write action log
```

### 自动处理

Agent 可以自动完成：

1. 汇总每日异常。
2. 识别物流超时、疑似丢件、重复投诉、库存不足和高金额退款。
3. 关联订单、客户、物流和商品上下文。
4. 解释异常原因。
5. 生成处理建议。
6. 生成受控 Nexus surface。

### 必须人工确认

以下动作不能由 Agent 直接执行：

1. 全额或部分退款。
2. 补发商品。
3. 发放优惠券。
4. 升级给主管。
5. 关闭客诉。
6. 向客户做出新的送达承诺。

## 5. Core Surfaces

### Daily Ops Briefing Surface

运营每天首先看到的异常简报：

```text
KpiCard          今日待处理异常
KpiCard          高优先级异常
KpiCard          超时未发货
KpiCard          昨日退款金额
TrendChart       近 7 / 30 天退款与异常趋势
AnomalyQueue     待处理异常列表
Button           investigate
```

示例数据：

```text
今日待处理异常：18
高优先级：5
超时未发货：7
物流异常：6
缺货 SKU：3
VIP 客诉：1
```

### Exception Resolution Surface

点击某个异常后生成的处理界面：

```text
OrderSummary
CustomerSummary
LogisticsTimeline
RiskNotice
ChoicePicker    /resolution/action
TextField       /resolution/note
TextField       /resolution/refundAmount
DateTimeInput   /resolution/followUpAt
CheckBox        /resolution/notifyCustomer
Button          executeResolution
Button          createTicket
Button          escalate
```

示例场景：

```text
订单：SO-9182
商品：降噪耳机
金额：¥899
承诺送达：2026-09-26
物流状态：清关后 3 天无更新
客户：金牌会员，历史订单 4，最近两次催单

Agent 建议：
联系物流商 + 发送 $10 优惠券
理由：包裹未确认丢失，但已超过承诺送达；客户价值较高，应先安抚并保留处理证据。
```

action context 绑定当前 dataModel：

```json
{
  "orderId": { "path": "/order/id" },
  "customerId": { "path": "/customer/id" },
  "anomalyId": { "path": "/anomaly/id" },
  "resolution": { "path": "/resolution/action" },
  "refundAmount": { "path": "/resolution/refundAmount" },
  "note": { "path": "/resolution/note" },
  "followUpAt": { "path": "/resolution/followUpAt" },
  "notifyCustomer": { "path": "/resolution/notifyCustomer" }
}
```

### Monthly Ops Review Surface

用于轻量复盘，不做完整 BI 平台：

```text
KpiCard          GMV
KpiCard          订单数
KpiCard          退款率
KpiCard          平均处理时长
TrendChart       周 GMV / 退款趋势
DataTable        Top 异常 SKU
InsightCard      Agent 归因摘要
Button           createRestockTask
Button           exportReview
```

图表数据必须来自 BI / orders mock service，不能由 LLM 编造。A2UI 只描述：

```json
{
  "component": "TrendChart",
  "props": {
    "title": "Refund trend",
    "datasetId": "ds_refund_trend_30d",
    "xField": "date",
    "yField": "refundAmount"
  }
}
```

## 6. Catalog and Action Boundary

业务 catalog：

```text
https://example.com/catalogs/order-ops/v1
```

自定义组件：

```text
KpiCard
AnomalyQueue
TrendChart
DataTable
OrderSummary
CustomerSummary
LogisticsTimeline
RiskNotice
InsightCard
ResolutionForm
```

复用基础组件：

```text
TextField
CheckBox
ChoicePicker
DateTimeInput
Button
Text
Column
Row
Card
Divider
```

action 白名单：

```json
[
  "investigateAnomaly",
  "createTicket",
  "contactCustomer",
  "contactCourier",
  "approveRefund",
  "approveReship",
  "sendCoupon",
  "escalate",
  "scheduleFollowUp",
  "closeCase",
  "createRestockTask"
]
```

Agent 不能发明：

```text
deleteOrder
changePassword
openAdminPanel
paySupplier
updateInventoryDirectly
```

即使模型输出了这些 action，也必须在 catalog guard / server guard / runtime guard 被拒绝。

## 7. MVP Data Scope

第一阶段不接真实 Shopify、物流商、ERP 或支付系统。

使用 mock service 和本地数据即可：

| 数据 | 规模 |
| --- | --- |
| SKU | 30 个 |
| 订单 | 500-1000 笔 |
| 时间范围 | 90 天 |
| 异常案例 | 20-30 个 |
| 物流时间线 | 覆盖所有异常订单 |
| 客户档案 | 覆盖异常订单相关客户 |

异常类型：

1. 超时未发货。
2. 物流长时间无更新。
3. 疑似丢件。
4. 客户重复催单。
5. 高金额退款请求。
6. 地址疑似错误。
7. 缺货但仍有销售。
8. VIP 客诉。
9. 重复下单。
10. 破损或质量问题。

每种异常准备 2-4 个 fixture，保证 Agent、guard、surface 和 action handler 都能用同一批数据验证。

OrderOps 是独立业务 Agent/Host；上述业务数据与领域 action 不进入 Nexus 通用包。模拟退款、补发、优惠券和工单也要有领域状态、输入校验、幂等键和失败结局。Nexus 当前 action 边界的待纠偏事项见 [engineering-priorities.md](engineering-priorities.md)。

## 8. Evaluation Metrics

### Business Metrics

| 指标 | 说明 |
| --- | --- |
| 异常识别率 | fixture 中应发现的异常是否被发现。 |
| 建议采纳率 | 人工是否直接采纳 Agent 建议。 |
| 人工修改幅度 | 处理方案、备注、金额、时间需要改多少。 |
| 处理步骤数 | 从发现异常到完成处理需要几步。 |
| 处理时长 | Agent 辅助流程与人工基线对比。 |
| 风险拦截率 | 超额退款、非法 action、未声明组件是否被拦截。 |
| 审计完整度 | 每次退款 / 补发能否追溯到原因、上下文和批准动作。 |

异常识别率、风险拦截率和记录完整度可以在标注 fixture 上验证。建议采纳率、人工修改幅度和真实处理时长需要实际参与者与可复现人工基线；仅有 mock dataset 时应报告模拟结果，不能宣称真实业务收益已得到证明。

### SDK Validation Metrics

| 指标 | 说明 |
| --- | --- |
| catalog coverage | OrderOps 自定义组件是否都能声明 schema。 |
| guard coverage | 非法组件、非法 props、未声明 action 是否被拒绝。 |
| binding correctness | 表单提交时 action context 是否拿到最新值。 |
| patch correctness | 提交后同 surface 是否原地更新。 |
| history correctness | 失败流是否不提交 history。 |
| transport correctness | 外部 Agent RPC 的超时、超限和错误契约是否稳定。 |

## 9. MVP Delivery Order

### 首条端到端业务切片

先完整实现一个标注的“物流长时间无更新”案例，再用不同处理方式的第二种异常验证复用性。这是开发顺序，不缩减 Daily Briefing、Monthly Review、其他异常类型或 action 的长期范围。

```text
标注订单与物流事件
  -> 只读工具查询订单和物流事实
  -> Agent 引用事件 ID 解释停滞并建议建单
  -> Nexus 渲染 OrderSummary + LogisticsTimeline + Text + TextField + Button
  -> 运营人员修改备注并确认 createTicket
  -> Host 校验当前订单/物流事实与用户输入，幂等创建 mock 工单
  -> 同一 surface 更新工单号和处理状态
```

首条切片建议新增 `OrderSummary` 与 `LogisticsTimeline` 两个业务组件，用现有 `TextField` 和 `Button` 完成人工确认；组件数量以证据能否被用户检查为准，不作为硬性限制。业务数据至少包含一条停滞物流案例、一条正常对照案例及可追溯的订单/物流事件 ID。确定性 fixture 用于测试；真实 LLM Agent 在这条切片内就要接入，用来验证证据选择、原因解释和处理建议，不能等整个运营工作台完成后才接入。

切片验收同时覆盖业务与 SDK：Agent 的事实引用能回查工具结果；Host 拒绝伪造订单 ID、未声明输入与重复建单；错误或中断不会把未完成的业务 action 误报成功；core/React/服务端接入面可由独立宿主通过打包产物使用。此阶段无需真实商户系统或真实退款执行。

第二条流程建议用高金额退款请求：它需要不同的风险提示、金额输入和确认 action，能够检验 Catalog 与 Host 装配是否真的适用于不同任务。两条流程通过后，再稳定高层 SDK API 和批量扩展组件；如果第二条流程暴露不合理抽象，应先修边界。

### 后续扩展路线

1. 扩大到 30 SKU、90 天订单、20-30 个标注异常，逐步加入检测规则和对照样本。
2. 根据工作流增加 `AnomalyQueue`、`LogisticsTimeline`、`RiskNotice`，完成 Daily Ops Briefing 和更丰富的 Exception Resolution。
3. 逐步接入 mock 退款、补发、优惠券、物流查询及其他 handler；每个新 action 都复用同一输入校验、领域幂等和失败状态模板。
4. 增加 Monthly Ops Review；图表数据来自 mock BI service，Agent 只做基于证据的归因摘要。
5. 用标注 fixture 持续评测识别、证据引用、风险拦截和 patch 正确性；有实际参与者及人工基线后再报告采纳率和处理时长收益。

## 10. Narrative

正确叙事：

> OrderOps Copilot 是一个电商内部订单异常运营 Agent；Nexus UI 是它的人机协同执行层。Agent 可以发现异常、解释原因和建议处理方案，但业务系统只执行宿主声明过、用户确认过的 action。

错误叙事：

> 我为了测试 Nexus UI，临时做了一个订单异常表单。

OrderOps Copilot 的价值不依赖 Nexus 存在；Nexus 的价值在于让这类内部 Agent 的动态确认界面更安全、更可复用、更可测试。
