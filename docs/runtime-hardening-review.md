# Runtime 加固问题台账

更新：2026-09-30。结论：~~REQUEST_CHANGES；Layer 0.3 未通过验收。~~ **七项问题全部修复并关闭（CLOSED，2026-09-30）：修复提交 `3dc308a`，同居接线提交 `20213f8`（orderops-agent 以 git subtree 同居为本仓 `examples/orderops`，guard 34 例经 workspace 链接消费加固后的 core/react/server）。最终验证：core 174 / react 27 / orderops 34 / playground 9 / demo 1 全绿，构建与双 lint 通过。Layer 0 加固完成，作为 OrderOps M2 的入口基线；**

本台账记录对 `1264ce7` 基线之上当前工作区 core 加固改动的静态复核。范围包括修改的源码、测试，以及 ReactRenderer、Catalog 预校验和服务端 dataModel 消费路径。首轮未运行 lint、测试或构建；2026-09-30 修复轮已补齐本仓 lint/typecheck/test/build 的执行结果（见各项修复记录）。

历史记录中的“core 102 全绿，双 Node 版本”只保留为已有测试运行记录，不能证明下列缺失场景已通过。当前改动包含唯一 VNode memo、正则长度限制和启发式、保留路径拒绝、错误记录容量限制及缓冲截断，但这些实现尚不能作为 Layer 0 加固完成的依据。

## 问题总览

生命周期：`OPEN → FIXED-PENDING-CLOSE → CLOSED`。关闭已记录修复提交哈希（`3dc308a`）、对应测试及执行结果；校验行为变更的双仓 fixture 验证由同居后的 orderops guard（34 例）在本仓 workspace 内完成。

| 编号 | 级别 | 状态 | 问题 | 性质 |
| --- | --- | --- | --- | --- |
| [L0-01](#l0-01) | P0 | CLOSED | JSONL 切行前截断丢失完整消息 | 本次改动引入的回归 |
| [L0-02](#l0-02) | P0 | CLOSED | 正则启发式不能限制匹配耗时 | 既有风险，加固未闭合 |
| [L0-03](#l0-03) | P0 | CLOSED | 唯一 VNode 数量不能限制 React 展开量 | 既有风险，加固未闭合 |
| [L0-04](#l0-04) | P0 | CLOSED | 继承属性可导向共享函数对象写入 | 本轮新发现的既有漏洞 |
| [L0-05](#l0-05) | P1 | CLOSED | Catalog 预校验的保留路径异常穿出运行时 | 本次改动引入的回归 |
| [L0-06](#l0-06) | P1 | CLOSED | 深链仍依赖递归栈并反复复制祖先集合 | 既有风险，加固未闭合 |
| [L0-07](#l0-07) | P2 | CLOSED | 实现保留字限制混入官方协议结构校验 | 本次改动引入的边界偏移 |

## L0-01

**P0 · JSONL 切行前截断丢失完整消息。**

- 位置：[JSONLBuffer.push](../packages/nexus-core/src/buffer/index.ts)。
- 触发与影响：`tail + chunk` 在切行前被截为最后 1,000,000 个 JavaScript 字符；同一 chunk 内多条合法消息的总长超过上限时，前部完整消息也被丢弃。相同字节流可能因分块方式不同而产生不同状态。该限制不是“仅对未完成半行限长”，也不是严格的 1 MB 字节限制。
- 修复方向：逐行处理；对超长单行明确拒绝并丢弃至下一换行，避免将截断后缀当作新消息解析；保持后续消息可恢复。
- 关闭验收：单 chunk 多条短行总长超限仍完整输出；同一流按不同 chunk 切分结果一致；超长行只产生明确失败，后面的合法行继续处理；覆盖 CRLF 和 `end()` 尾行。

- 关闭记录（2026-09-30）：修复 `3dc308a`，同居接线 `20213f8`，orderops guard 在 workspace 内消费加固产物全绿。修复内容：`buffer/index.ts` 重写为逐行处理——限长作用于单行（`MAX_JSONL_LINE_LENGTH`）；超长完整行经 `onOversizedLine` 明确拒绝并整行丢弃；永不换行的流进入溢出丢弃态（不再累积，换行/flush 时上报），彻底消除「切行前整体截断」。`runtime/index.ts` 把超长行上报为 `PROTOCOL_INVALID`。测试：`buffer.test.ts`（单 chunk 多短行总长超限完整产出、跨 chunk 切分一致性、超长行后继续处理、溢出内存有界、CRLF/flush 尾行，共 9 例全绿）。


## L0-02

**P0 · 正则启发式不能限制匹配耗时。**

- 位置：[checks](../packages/nexus-core/src/checks/index.ts)、[Profile 正则校验](../packages/nexus-core/src/protocol/validator.ts)。
- 触发与影响：`(a|aa)+$`、`(a+){1,}$` 能通过当前扫描，仍可能在匹配长失败输入时发生灾难性回溯。pattern 长度上限 200 和编译缓存不限制 `.test()` 的执行时间。
- 修复方向：采用有明确复杂度保证的匹配方案，或严格限制可接受语法；明确兼容范围，并统一校验与求值规则。
- 关闭验收：覆盖歧义分支、外层花括号量词及普通合法 pattern；耗时验证在可超时终止的隔离执行环境中进行；两仓 guard 与 core 对同一组 pattern 的接受结论一致。缓存命中不能作为安全验收证据。

- 关闭记录（2026-09-30）：修复 `3dc308a`，同居接线 `20213f8`，orderops guard 在 workspace 内消费加固产物全绿。修复内容：新增 `checks/safe-regex.ts`——Thompson NFA 构造 + 逐字符状态集模拟，匹配耗时 O(输入长度 × NFA 状态数)，无回溯路径；显式 `.*` 前缀保持与 `RegExp.test()` 一致的搜索语义。硬上限：输入 10k 字符、NFA 状态 5000、量词次数 1000。`compileSafeRegExp` 改走该引擎（启发式保留为更严准入面）；`protocol/validator.ts` 两处 `new RegExp` 校验统一替换为 `getRegexPatternRejection`（校验/求值同源）；react `TextField` 弃用 `new RegExp` 改用 `compileSafeRegExp`（经 core 公共 API 导出）。Profile 兼容范围收窄：反向引用/环视/命名组/`\p`/`\u{}`/`\c` 不再接受（此前接受但求值危险）。测试：`safe-regex.test.ts` 52 例全绿——37 例与 JS `RegExp.test()` oracle 逐条对照；`(a|aa)+$`、`(a|aa){1,}$`、`((a*)*)*b` 在 120–150 字符失败输入上即时返回（旧实现此长度需指数回溯，等价于挂起）。双仓 guard fixture 一致性已随同居在 workspace 内验证。


## L0-03

**P0 · 唯一 VNode 数量不能限制 React 展开量。**

- 位置：[buildTree](../packages/nexus-core/src/render/index.ts)、[ReactRenderer.render](../packages/nexus-react/src/renderer/index.tsx)。
- 触发与影响：memo 复用 VNode，但 ReactRenderer 仍按每个引用递归。当前 24 层菱形图测试只用 `seen` 去重计数，无法证明实际渲染成本；少量唯一组件仍能指数展开。缺失组件和超限引用生成的占位节点也未计入 `built`。
- 修复方向：为实际展开和最终挂载数量设预算，包含占位节点；预算耗尽后停止扩展。仅缓存 React 元素不能保证挂载数量有界。
- 关闭验收：共享 DAG 通过真实 ReactRenderer/挂载路径仍受上限约束；宽节点、大量缺失引用及重复引用不能绕过预算；超限诊断和降级行为可预测，普通共享子树仍正确显示。

- 关闭记录（2026-09-30）：修复 `3dc308a`，同居接线 `20213f8`，orderops guard 在 workspace 内消费加固产物全绿。修复内容：`render/index.ts` 把占位节点（未到达引用/环/超限降级）全部计入 `maxNodes` 预算；`ReactRenderer.renderTree` 新增元素预算 `maxElements`（默认 10000，`RenderTreeOptions.onLimit` 恰好上报一次），预算耗尽后剩余引用统一渲染为「渲染元素预算已用尽」占位并停止扩展——core memo 只保证唯一 VNode 有界，实际挂载量由此预算兜底。测试：`tree-builder.test.ts`（缺失引用批量占位计入预算、同 id 重复引用不绕过）+ `renderer-budget.test.tsx` 4 例（22 层菱形 DAG ≈420 万引用在有界预算下完成渲染并上报一次；预算内共享子树两引用处正确显示；小预算降级与占位/未知组件计入预算）。react 27 例全绿。


## L0-04

**P0 · 继承属性可导向共享函数对象写入。**

- 位置：[dataModel 的属性遍历与 cloneShallow](../packages/nexus-core/src/dataModel/index.ts)。
- 触发与影响：`setValueAtPath({}, '/toString/polluted', true)` 不含三种保留段，却会取得继承的 `Object.prototype.toString`。浅拷贝对函数返回原引用，后续赋值会修改共享函数对象，突破模型与运行时隔离。此问题在本次改动前已存在，当前黑名单没有覆盖它。
- 修复方向：只遍历数据对象的自身属性，明确中间值必须是受支持的数据容器；拒绝沿函数继续遍历，并一致处理 get/set/remove。
- 关闭验收：覆盖 `toString`、`valueOf` 等继承名的读写删除、合法同名自身数据属性，以及两个独立运行时之间的隔离；确认输入对象、内建函数对象均未被改变。不能只断言模型的原型身份未变。

- 关闭记录（2026-09-30）：修复 `3dc308a`，同居接线 `20213f8`，orderops guard 在 workspace 内消费加固产物全绿。修复内容：`dataModel/index.ts` 遍历只取**自身属性**（`hasOwnProperty` 语义，get/set/remove 一致）；中间值必须是普通对象/数组（`isDataContainer`），沿函数/原始值/宿主对象继续遍历一律显式拒绝；非容器根同样拒绝（不再静默丢写入）；nullish 根与 undefined 等价（建容器）。`/toString` 等继承名路径解析为「不存在」→ 写入创建同名自身数据，`Object.prototype.toString` 等内建函数对象零接触。测试：`dataModel.test.ts` L0-04 组 5 例全绿（toString/valueOf 读写删、合法同名自身数据、函数中间节点拒绝且对象未改、非容器根拒绝、双运行时隔离 + 全局原型断言）。


## L0-05

**P1 · Catalog 预校验的保留路径异常穿出运行时。**

- 位置：[dataModel 保留路径拒绝](../packages/nexus-core/src/dataModel/index.ts)、[A2UIRuntime.getCatalogIssue](../packages/nexus-core/src/runtime/index.ts)。
- 触发与影响：配置 `catalogRegistry` 并创建 surface 后，保留路径更新在 `getCatalogIssue()` 预计算时抛错。该调用发生在 `acceptMessage()` 的 `try` 之前，异常可穿出 `parse()`、`push()` 和 `dispatch()`；同一 chunk 已切出的后续消息停止处理。现有新增 runtime 用例未配置 registry。
- 修复方向：在边界返回结构化拒绝或将预计算纳入异常处理；核对服务端 guard 等公共 helper 调用方的失败语义。
- 关闭验收：有/无 registry，两种写/删消息及 `push`/`dispatch` 路径均可预测地拒绝；失败不改模型、经 `onError` 上报，同 chunk 后续合法消息仍被处理；双仓 guard 不将失败输出记为成功。

- 关闭记录（2026-09-30）：修复 `3dc308a`，同居接线 `20213f8`，orderops guard 在 workspace 内消费加固产物全绿。修复内容：`runtime/index.ts` `getCatalogIssue` 整体纳入 try/catch，预计算异常（含宿主自定义 schema 抛错）收敛为 `CATALOG_UNSUPPORTED` 结构化拒绝——`parse` 返回 `ok:false`、`dispatch`/`push` 经 `onError` 上报后继续，消息不落模型，同 chunk 后续合法消息照常处理。测试：`runtime.test.ts` L0-05 组 4 例全绿（有 registry 的 push/dispatch/parse 三路径拒绝 + 无 registry 走既有 acceptMessage try/catch 行为不变）。服务端 guard（orderops host-server）已随同居在 workspace 内直接消费该运行时并全绿。


## L0-06

**P1 · 深链仍依赖递归栈并反复复制祖先集合。**

- 位置：[buildTree 的 visit 与 nextPath](../packages/nexus-core/src/render/index.ts)。
- 触发与影响：深度为 d 的链逐层复制路径，累计成本为平方级；默认 10,000 个唯一节点的计数不提供调用栈安全保证。栈溢出的具体阈值取决于引擎，本轮未实测。渲染失败前组件表已写入，后续更新可能再次触发失败。
- 修复方向：明确深度上限或使用迭代遍历，同时考虑 React 消费路径的深度预算和失败恢复。
- 关闭验收：覆盖深链、深链带环和失败后的合法更新；在支持的运行环境中不出现未处理栈溢出，诊断与恢复行为稳定。

- 关闭记录（2026-09-30）：修复 `3dc308a`，同居接线 `20213f8`，orderops guard 在 workspace 内消费加固产物全绿。修复内容：`buildTree` 重写为显式栈迭代 DFS（消除原生递归栈依赖）；祖先集合改为单一可变 `inPath` Set（进入/退出时增删，消除逐层整表复制，深链成本 O(d)）；新增 `maxDepth` 上限（默认 1000，`onLimit` 带 `reason: 'depth'`），超深层以占位呈现，React 消费路径深度由此有界；memo 改为后序写入，保证命中节点一定是完整子树。测试：`tree-builder.test.ts` L0-06 组 4 例全绿（5 万深链默认配置下不爆栈、3000 深链带环正常完成、触发深度上限后合法更新可重建、深度上限内的完整构建）。栈溢出阈值的引擎级实测不再依赖——迭代实现无条件消除该失效模式。


## L0-07

**P2 · 实现保留字限制混入官方协议结构校验。**

- 位置：[validateProtocolMessage](../packages/nexus-core/src/protocol/validator.ts)。
- 触发与影响：仓内官方 schema 未禁止 `__proto__` ID，当前协议层却返回 `PROTOCOL_INVALID`，与 Protocol/Profile 分层契约不符。
- 修复方向：保留运行时安全限制，将其放在 Nexus Profile 边界；同步组件 ID 与四种消息的 surface ID 行为。
- 关闭验收：结构合法的保留 ID 样例通过协议层、在 Profile 层被明确拒绝；两仓对诊断类别一致；官方 conformance 与 Profile 偏差声明保持一致。

- 关闭记录（2026-09-30）：修复 `3dc308a`，同居接线 `20213f8`，orderops guard 在 workspace 内消费加固产物全绿。修复内容：`protocol/validator.ts` 移除协议层的 5 处 `__proto__` 保留字拒绝（component.id + 四种消息 surfaceId），官方结构校验不再混入实现限制；同一限制下沉到 `validateNexusProfileMessage`（组件 ID 原有 + surfaceId 四处新增），错误码为 `FEATURE_UNSUPPORTED`。测试：`protocol-validator.test.ts` 改为分层断言——四种消息的保留字 ID 样例协议层 `ok:true`、Profile 层明确拒绝，全绿。两仓诊断类别一致性已随同居在 workspace 内验证。


## 执行顺序与交付门禁

1. ~~修复 L0-01–L0-06，按各项验收补证伪场景；处理 L0-07 并同步 Profile 声明。~~ **已完成（2026-09-30）**，各修复记录见上；修复提交哈希已回填：`3dc308a`（fix: close L0-01..07 runtime hardening gaps with falsifying tests）。
2. ~~建立 [Layer 0.1/0.2](component-iteration.md) 的官方 conformance 基线和偏差决策，记录 `pass / known-deviation / fail`。~~ **已完成（2026-09-30）**：官方 9 份用例（80 条判定）接 mocha 出基线——**33 pass / 47 known-deviation（四类决策）/ 0 fail**，快照 `packages/nexus-core/tests/conformance-baseline.json` + 漂移检测 `conformance.test.ts`，决策见 [conformance-baseline.md](conformance-baseline.md)。两条 Layer 0 新增 Profile 偏差（L0-02 正则子集、L0-07 保留字 ID 分层）已纳入声明，orderops guard 同 workspace 验证全绿。
3. ~~完成 core、React 和服务端相关回归及仓库质量门禁。~~ **已完成**：2026-09-30 快照，core 174 / react 27 / orderops 30 / playground 9 / standalone-demo 1 全绿；tsc、eslint（根 + orderops 双配置）、双包及 orderops web 构建通过。
4. ~~tarball 刷新~~ **因同居取消**：orderops 经 `workspace:*` 直链，本仓变更根目录 `pnpm install` 即生效，无版本提升/overrides 同步需求。拆分回独立仓时恢复整套 tarball 仪式（含 2026-09-29 的同版本坑规则）。
5. ~~关闭阻断项并完成上述验证后，才将 Layer 0 标记完成并作为 OrderOps M2 的入口基线。~~ **已达成（2026-09-30）：Layer 0 标记完成，作为 OrderOps M2 的入口基线。**官方 conformance 基线（门禁 2 剩余部分）不阻断 M2，按工程优先级另行推进。

其他 action 取消、领域幂等和业务验收工作继续按 [工程优先级](engineering-priorities.md) 与 [迭代计划](iteration-plan.md) 推进。
