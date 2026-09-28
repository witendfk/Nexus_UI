# Nexus UI 架构边界

状态：当前运行时分层与命名基线。业务方向见 [OrderOps Copilot](order-ops-copilot.md)，实现缺口见 [工程现状与优先级](engineering-priorities.md)。

Nexus UI 基于 A2UI v0.9 消息模型实现受约束的 Agent 任务界面运行时，当前交付为 **Nexus Agent Task Profile**。它不承诺接受任意合法 v0.9 Agent 输出，也不宣称完整实现官方 Basic Catalog。

## 四层边界

| 层 | 负责内容 | 不负责内容 |
| --- | --- | --- |
| Protocol | A2UI v0.9 信封、payload 结构和 surface 生命周期 | 因当前未实现某特性而宣称协议本身非法 |
| Capability | Nexus Profile、Catalog 的组件、字段、绑定与 action 声明 | 冒充完整官方 Catalog |
| Policy | 宿主的工作流、媒体、action 归属与业务规则 | 绕过 Catalog 或充当新的协议方言 |
| Renderer | 将受约束的 VNode 映射为宿主组件并上报交互 | 拥有协议解析、领域授权或业务事实 |

诊断使用 `PROTOCOL_INVALID`、`LIFECYCLE_INVALID`、`CATALOG_UNSUPPORTED`、`FEATURE_UNSUPPORTED` 和 `POLICY_REJECTED` 区分错误来源。server guard 是 Agent 输出进入浏览器前的边界；浏览器 runtime 校验是附加防线，不能代替服务端校验。

## Catalog 身份

| 名称 | 含义 |
| --- | --- |
| Nexus Agent Task Profile | 整体产品能力范围 |
| Nexus Basic Task Profile | 默认演示用的有限 Basic-like 组件子集 |
| Official Basic Catalog | `specification/v0_9/json/basic_catalog.json` 声明的官方 Catalog；当前未注册为可用实现 |
| Host Catalog | 业务宿主声明的自定义组件、schema 和 action 能力 |

默认演示 Catalog ID 为 `https://example.com/catalogs/nexus-basic-task/v1`。Catalog Contract 由同一份 CatalogDefinition 生成并带版本/hash；它帮助 Agent 理解能力边界，最终允许什么仍由 guard 判断。

## 当前 Profile

```text
createSurface
  -> 静态组件树
  -> 有限的 Basic-like 控件与 Host Catalog
  -> { path } dataModel 绑定
  -> action.event 与 context
  -> 同 surface updateComponents / updateDataModel
```

当前不支持官方 `Modal`、通用 `FunctionCall`、`ChildList` template、`sendDataModel`、完整组件字段和多 surface 并发展示。具体支持矩阵见 [宿主接入契约](host-integration.md)，协议来源见 `specification/v0_9`。

## 决策规则

新增能力前确认：它服务于哪个真实 Agent 工作流，属于哪一层，由哪份 Catalog Contract 声明，非法和暂不支持的输出分别如何诊断，以及哪项测试或独立宿主验收证明它。OrderOps 是当前业务验证锚点，但其订单、物流、退款和工单领域模型属于独立 Agent/Host 工程，不进入 Nexus 通用包。
