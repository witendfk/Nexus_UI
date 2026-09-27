# AI 导购方向与 Nexus UI 架构评审

状态：方向决策与待修复问题基线  
日期：2026-09-27

本文档记录 Nexus UI 下一阶段示例 Agent 的产品方向，以及当前架构在承载真实业务 Agent 前需要处理的问题。AI 导购必须有独立业务价值；Nexus UI 是它的动态任务界面运行时，不是这个 Agent 的唯一目的。

## 0. Responsibility Boundary

本仓库只负责 **Nexus UI Runtime 与通用宿主边界**。AI 导购是一个独立业务工程；商品、报价、库存、购物车、交易 session、领域权限和业务审计都不进入 Nexus 包或 reference server。

| 归属 | 职责 |
| --- | --- |
| Nexus UI | A2UI v0.9 校验、surface 投影、Catalog/Policy guard、流式渲染、action 回流、通用幂等与运行边界 |
| 独立 Agent 工程 | 导购意图理解、商品查询、候选对比、报价/库存校验、购物车领域状态和业务授权 |
| 独立业务宿主 | 注入领域 action resolver、业务 action handler、持久化 session、权限、审计和部署边界 |

Nexus 侧不能解释 `productId`、`offerId`、`price`、`cartItemId` 等业务字段；它只能保证这些字段来自受控 surface 契约和宿主注入的权威解析边界。

## 0.1 Nexus P0 Status

已完成通用 P0 第一阶段：

- 服务端维护成功生成/action 流后的 surface 组件与 dataModel 投影。
- action 必须命中服务端快照中的 `surfaceId + sourceComponentId + actionName`。
- 默认 context 由服务端根据 action declaration 和快照 dataModel 重新解析，不信任客户端 context。
- 宿主可注入 `resolveActionContext` 显式处理用户输入；`clientContext` 只作为不可信输入传给该 seam。
- 增加进程内 action ledger 与可选 `actionId`，精确重放会被拒绝。
- 历史 transcript 不再能复活 action 权威；重启后必须由宿主业务 session / action state 恢复。

仍未纳入本阶段：跨进程持久化 action ledger、SQLite ShoppingSession、客户端断开取消传播、per-session run manager、外部 Agent RPC 的完整 catalog contract hash。这些继续按 Nexus 通用能力推进，不引入导购领域模型。

## 1. 方向决策

### 产品方向

构建一个 **AI 商品决策与导购 Agent**。首个垂直品类为 **笔记本电脑**，后续再评估扩充其他品类。

目标用户用自然语言描述用途、预算和偏好。Agent 负责澄清需求、组织候选商品和解释差异；商品服务负责提供可验证的价格、规格、库存和购物车状态；Nexus UI 根据当前决策阶段提供筛选、比较和操作界面。

目标不只是“根据问句展示商品卡片”，而是帮助用户从需求走到有依据的购买决定：

```text
描述用途和预算
  -> Agent 识别缺失条件并澄清
  -> 生成可交互筛选面
  -> 查询真实商品目录
  -> 展示推荐理由和候选差异
  -> 用户调整条件并比较商品
  -> 后端重新校验价格、库存并更新购物车
```

### 业务价值

- 减少用户在大量规格字段间自行筛选和比较的成本。
- 把抽象购买需求转换成明确、可修改的筛选条件。
- 给出基于商品数据的推荐理由和取舍，而不是只返回关键词匹配结果。
- 在加入购物车前确认价格、库存和规格，避免 Agent 把推测当成交易事实。

首版用结构化商品数据和可解释的规则 / 排序实现候选召回。LLM 可做需求解析、追问和结果说明，不负责编造商品属性或替代商品服务的事实校验。

### Nexus UI 的必要性

商品结果网格本身可以用固定页面实现，因此它单独不足以证明 Nexus UI 的价值。价值在于一个任务会经历不同决策阶段，而且需要不同的可交互 surface：

- 需求不完整时，需要 Agent 生成针对当前缺口的追问控件。
- 不同用途需要不同筛选项和权重，例如轻薄办公关注重量 / 续航，游戏关注 GPU / 散热。
- 比较阶段需要从候选结果转为多商品比较和差异解释。
- 用户更改筛选条件后，需要把最新状态提交给商品服务并原地更新结果。
- 价格、库存、购物车等副作用由 Host 执行；Agent 只能请求白名单 action。

因此演示必须展示 **需求澄清、筛选、比较、业务 action、结果 patch** 的完整流程，不能只展示一次生成的商品卡片。

### 最终功能分层

为了避免 Agent 退化成“带聊天框的商品搜索”，首版按下面四层组织能力：

1. **需求理解层**：从自然语言提取预算、用途、便携性、性能、品牌和时间约束；缺少关键条件时只追问最有价值的问题。
2. **决策编排层**：根据需求选择筛选策略，解释候选排序，支持用户修改条件、锁定候选和发起比较。
3. **业务事实层**：商品、规格、报价、库存和购物车由后端服务提供；Agent 不能直接生成或修改这些事实。
4. **任务界面层**：Nexus UI 根据当前阶段生成追问控件、筛选器、商品结果、比较表和操作反馈，并在同一个任务 surface 中持续更新。

### 首次演示主流程

演示用一个明确场景贯穿完整闭环：用户说“预算 7000 元以内，主要用于编程和出差，希望轻一点，偶尔玩游戏”。

```text
自然语言需求
  -> Agent 识别缺少的关键偏好并生成追问
  -> Nexus UI 展示可修改的预算、重量、续航和性能筛选器
  -> 商品服务返回候选，Agent 解释推荐理由和取舍
  -> 用户选择 2 至 4 款，Nexus UI 生成规格差异比较
  -> 用户调整条件或要求更看重续航，结果在原 surface 更新
  -> 用户点击查看报价 / 加入购物车
  -> Host 二次校验价格和库存，反馈成功或失败原因
```

首版的 Agent 输出应稳定落在三类结果：**需要用户补充信息、展示可操作的候选决策界面、执行经过校验的购物 action**。这三类结果足以验证 Nexus UI 的动态界面能力，也能说明 Agent 对真实购买决策的帮助。

### 面试展示重点

- **业务价值**：把模糊购买意图转成可解释、可调整、可执行的决策流程，减少用户筛选和比较成本。
- **Nexus UI 价值**：同一任务根据状态动态切换追问、筛选、结果、比较和 action feedback，而不是预先堆叠静态页面。
- **工程能力**：Agent 负责意图和编排，Host 负责权限与 action，商品服务负责事实，Nexus Runtime 负责受约束的界面投影；边界清晰且可测试。
- **可信性**：价格、库存和规格来自结构化后端，关键 action 可审计、幂等并支持会话恢复。

后续新增品类（如显示器或手机）应复用这套分层和契约，只替换商品 schema、筛选策略和业务数据，不复制一套新的 Agent 主流程。

### 首版范围

纳入：

- 一个品类：笔记本电脑。
- 用户购买需求解析和最多数轮澄清。
- 商品目录查询、预算 / 用途 / 品牌 / 核心规格筛选。
- 2 至 4 款商品对比及推荐理由。
- 价格和库存二次确认。
- 收藏或加入购物车，操作后更新同一任务 surface。
- 单用户或匿名购物 session；本地开发环境可运行。

暂不纳入：

- 全品类、多商户、支付、物流和真实订单履约。
- 复杂个性化推荐训练、向量检索平台和分布式服务。
- Agent 自行执行任意 SQL 或任意工具调用。
- 把模型输出中的价格、库存或商品规格作为可信事实。

### 建议的业务后端边界

首版可以用 SQLite 持久化，至少定义以下领域数据：

- `products`：商品身份、品牌、型号和可展示摘要。
- `product_specs`：结构化 CPU、GPU、内存、存储、屏幕、重量和续航等属性。
- `offers`：商家、当前价格、币种和有效时间。
- `inventory`：库存状态及更新时间。
- `shopping_sessions`：当前需求、筛选条件、对比项和收藏 / 购物车。
- `cart_items`：商品、规格、数量及加购时确认的报价引用。

后端服务边界：

```text
parseShoppingIntent       需求解析结果仍由业务规则校验
searchProducts            结构化、可分页的候选查询
compareProducts           返回统一规格差异
checkOfferAndInventory    加购前重新确认价格与库存
updateShoppingSession     保存筛选、比较和偏好状态
addToCart                 校验商品、offer、库存和数量后写入购物车
```

LLM 只获得完成当前步骤所需的结构化结果。Host 校验 action 和参数，后端是商品、报价、库存与购物车状态的权威来源。

## 2. 当前架构评审

当前项目适合作为 A2UI Runtime 参考实现和受控演示宿主。core、React、Catalog、协议 guard、SSE 与外部 Agent RPC 已有清晰模块边界；主要缺口出现在服务端的业务 session 权威性、通用宿主抽象、运行管理和部署边界。以下问题针对“真实业务 Agent 的工程骨架”，不否定当前作为单进程个人项目的 MVP 定位。

### P0：客户端可伪造 action 及业务上下文

位置：

- `server/nexus-playground-server/src/api/client-event.ts`：action 完整 context 由客户端提交。
- `server/nexus-playground-server/src/api/routes.ts`：解析后直接交给 Adapter。
- `server/nexus-playground-server/src/agent/adapter.ts`：action 目前按 surface catalog 和 action 名分发，没有验证该组件 / action 是否属于成功生成的 surface。

影响：调用方可伪造退款金额、商品 id、库存或 action context；重复请求也可能重复产生业务副作用。当前没有认证时，即便 surface id 难以猜测，也不能将其视为授权机制。

建议：

- 服务端记录 surface 当前组件 action 声明和权威业务状态。
- action 必须匹配服务端记录的 `surfaceId + sourceComponentId + actionName`。
- 从服务端 session / dataModel 重建业务参数，不信任客户端 context 中的关键事实。
- 未知、过期或未注册的 surface 明确拒绝，不回退到默认 catalog。
- 引入 action id / 幂等键、session 归属检查和业务授权 hook。
- 对加购等副作用在 Host / domain service 再校验价格、库存和数量。

### P1：通用 AgentAdapter 混入示例业务

位置：`server/nexus-playground-server/src/agent/adapter.ts`。

Adapter 内部默认注册 Basic、Task、Workbench action handler 和 fallback fixture。新增 AI 导购 catalog 时，宿主可能不得不继续修改通用 server 包；这会让垂直业务逐步沉入基础设施层。

建议：

- 通用 Adapter 只负责请求编排、guard、Catalog 选择和 action dispatch。
- 将 Basic / Task / Workbench 示例 handler 与 fixture 移到 reference assembly 或 examples。
- Host 显式注入 Catalog Registry、generation source、action handlers 和业务策略。
- 为自定义 catalog 提供不修改 server 包的端到端装配测试。

### P1：LLM prompt 与 Catalog 契约存在手写业务分支

位置：`server/nexus-playground-server/src/agent/llm-agent.ts`。

prompt 对 Basic / Task / Workbench 有专用字段与流程规则。`createCatalogPromptContract` 已经能从 CatalogDefinition 输出能力契约，但内部 LLM prompt 并未完全由该契约驱动。新增导购 Catalog 后若继续追加条件分支，Catalog 与模型提示将出现两套事实源。

建议：

- 将通用协议规则和 Host 业务工作流要求拆开。
- Catalog schema / policy 由同一 CatalogDefinition 生成 prompt contract，并继续由 guard 做最终裁决。
- 业务特定的意图说明通过 Host 注入，不在通用 LLM Agent 里硬编码品类流程。
- 为 contract 增加版本或内容 hash，便于发现 prompt / Agent / Host 契约不一致。

### P1：外部 Agent RPC 没有携带完整 Catalog 能力契约

位置：`server/nexus-playground-server/src/agent/external-agent.ts`。

RPC 当前传 `catalogId`、组件名、action 名和 history，没有完整的 props schema、component policies、绑定约束或 Catalog 版本。外部 Agent 仅靠名称无法可靠生成自定义商品组件。

建议：RPC 至少传稳定的 `contractVersion` / `contractHash` 和契约 URL；需要离线调用时可传规范化的 CatalogDefinition。Host guard、生成 prompt 和 Agent 应消费相同版本的能力定义。

### P1：持久化的是模型 transcript，不是可恢复的业务 session

位置：`server/nexus-playground-server/src/agent/history.ts`、`file-history.ts`、`adapter.ts`。

当前 history 主要保存 catalog id 和 LLM turn。它没有保存当前 surface 投影、筛选条件、商品候选、购物车状态、已执行 action ledger 或业务运行状态；action `commit` 为空实现。Task / Workbench 业务状态仍在进程内 Map，重启后无法从持久化 history 恢复流程。

影响：不能可靠继续中断的购物流程，无法分辨 action 是未执行、执行中还是已完成，也无法审计一次加购基于哪个报价 / 库存检查。

建议：为示例 Host 建立明确的 `ShoppingSession` / `AgentRunStore`，保存领域状态、surface action 声明、action ledger、Catalog 版本和更新时间。先用 SQLite；无需为个人项目引入多实例基础设施。

### P1：没有 per-session 并发、取消和 action 运行状态

位置：`server/nexus-playground-server/src/api/routes.ts`、`api/send-messages.ts`、`agent/external-agent.ts`。

路由以 fire-and-forget 启动流；SSE 传输没有把客户端断开传播到上游 Agent / 工具；同一 surface 的多个 action 没有串行或版本控制。`send-messages.ts` 对每条消息固定等待 200ms，适合作为演示节奏，不应是通用 runtime 行为。

影响：断开连接后工作可能继续，重复或并发 action 可能竞态；后到的更新可能覆盖较新的购物 session 状态。

建议：

- 引入 per-session run manager 和 `AbortSignal` 传播。
- 同一 session 的写操作串行化，或用 session version / expected version 做乐观并发控制。
- 为可见业务 action 记录 queued / running / succeeded / failed / canceled。
- 固定节奏延迟移至 demo-only 选项；生产默认无额外 sleep。

### P2：浏览器 Runtime 的 surface 生命周期不完整

位置：`packages/nexus-core/src/runtime/index.ts`、`packages/nexus-react/src/provider/index.tsx`。

Core store 可以持有多个 surface，但 React Provider 只维护单棵 tree；Runtime 没有显式 reset / dispose / surface eviction API。Provider 又会在 renderMap / registry 对象引用变化时重建 Runtime，宿主若不稳定 memo 配置会意外丢失运行时状态。

建议：明确当前 Provider 是单 active surface 还是多 surface host；提供显式清理和切换语义，并通过 API 文档、运行时警告和测试固定 Provider 配置变更行为。

### P2：当前部署只能定位为本地受控单进程宿主

位置：`server/nexus-playground-server/src/main.ts` 和 routes 装配。

参考服务开启开放 CORS，没有认证、授权、租户、审计或公网限流。这些是当前 MVP 明确排除项，不是单机 Demo 的缺陷；但在补齐前，不应称为可公开部署的 Agent 平台。

建议：AI 导购首版保持本地 / 受控演示部署；业务 Host 显式提供 session 归属、action 权限和购物车校验。未来如需公网访问，再单独定义认证、授权、限流、审计和部署目标。

## 3. 验收与测试缺口

当前协议、Profile、Catalog、schema / policy guard 和基础 action 测试覆盖较好；`pnpm typecheck` 与 `pnpm lint` 已通过。

本次评审环境运行全仓 `pnpm test` 时，Node test runner 的 IPC socket 和测试 HTTP listener 因 sandbox 权限返回 `EPERM`，所以本次没有得到完整测试通过结论。core 测试完成；server 的部分测试在不能监听本地端口的环境中失败。这是验证环境限制，不应计作产品代码失败或全仓测试通过。

后续实现至少补以下回归：

- 未知 / 过期 surface 的 action 被拒绝。
- 伪造 component id、action name、购物车商品、价格和数量被拒绝。
- action 重放不会重复加购。
- 并发更新采用预期 session version，旧更新不能覆盖新状态。
- 客户端断开会取消可取消的模型 / 查询工作。
- 进程重启后 session 和 action ledger 可恢复。
- Agent、Host 与 LLM prompt 使用不匹配 Catalog 版本时明确失败。
- 商品数据中的价格、库存、规格事实不会由 LLM 输出覆盖。

## 4. 推荐实施顺序

1. 先定义 AI 导购的 Catalog、购物 session 和商品业务 API 契约。
2. 处理 P0 action 权威性和幂等边界。
3. 解耦 AgentAdapter 中的示例业务行为，建立 Host 注入装配。
4. 让内部 prompt 与外部 RPC 消费同一版本的 Catalog Contract。
5. 建立 SQLite shopping session / action ledger。
6. 增加取消与并发控制，再构建商品查询、对比、库存确认和加购流程。
7. 最后制作完整演示和 onboarding 文档。

这样 AI 导购本身有业务闭环，Nexus UI 则承担它确实需要的动态任务界面、安全组件边界和用户操作回流。
