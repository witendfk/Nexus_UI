# S4 阶段验收 — client 与可嵌入 React

验收日期：2026-10-30。范围：S4.0–S4.4。实现基线为 `1495238`（S4.2 联合验收整改），前置完整矩阵为 `5b8d53e`；本轮包含浏览器夹具、可访问性修复与文档收口，对应提交从 Git 历史追溯。环境：macOS arm64、Node v24.16.0、pnpm 9.15.9、Codex 内置浏览器实际页面。

## 1. 结论与交付

**APPROVE：S4 范围内完成，无未关闭的 P0/P1。** client 负责会话、预览/提交隔离、草稿协调、失同步与恢复；React 负责上下文、独立 Surface 和声明式映射；core 保持协议/绑定/状态原语；server 与客户端不互相依赖实现。业务规则与副作用继续由宿主负责。

| 单元 | 最终交付与证据 |
| --- | --- |
| S4.0 | core 数组紧凑寻址、模型 UTF-8 字节与组件数量预算；合法写入对照及整体拒绝反例，`core/test/runtime/model-bounds.test.ts` 与 server 资源分类回归 |
| S4.1 | 新增私有 `@nexus-ui/client`；可替换 transport、稳定 runtime、候选隔离、固定提交、草稿代次、完整恢复与稳定订阅；公开产物 acceptance 30 项 / 17 cell，client 总计 108 项 |
| S4.2 | React API 2：Provider 不规定布局，Surface 独立订阅，Preview 只读，动作出口统一门控；联合 acceptance 14 项，控件 DOM 身份回归 3 项，React 总计 78 项 |
| S4.3 | Playground / standalone-host-demo 统一经公开 client 根入口消费；删除两份 SSE 消费器、基准/草稿复制逻辑；自定义动作与标准控件同样受门控 |
| S4.4 | 实际浏览器布局/输入/action/错误/可访问性验收、确定性 SDK 夹具、Surface 可访问性修复、当前门禁/conformance、报告与 S5 交接 |

当前四个包仍为 private 0.1.0；core/server API 1、React API 2，Catalog Contract 2、Session 1。阶段通过不等于 alpha 可安装或 production-ready，最终发行仍由 S5 验收。

## 2. 本轮工程门禁

下列为本轮工作区实测。源码修复后重新构建，并重跑 typecheck、根/包 lint 与根测试；根测试首次被沙箱 IPC/HTTP 监听 EPERM 阻断，沙箱外同命令通过。夹具最终调整后另做定向类型、lint、格式和打包检查。

| 命令/检查 | 结果 | 本地日志 |
| --- | --- | --- |
| `pnpm build` | exit 0；四包与两处 Vite 生产构建 | `/tmp/nexus-s44-build.log` |
| 构建后 `pnpm typecheck` | exit 0 | `/tmp/nexus-s44-typecheck.log` |
| `pnpm lint` | exit 0 | `/tmp/nexus-s44-lint.log` |
| `pnpm -r --if-present lint` | exit 0 | `/tmp/nexus-s44-package-lint.log` |
| `pnpm test` | exit 0，1190 项 | `/tmp/nexus-s44-test.log` |
| `pnpm --filter @nexus-ui/react build:browser` | exit 0；仅验收夹具打包 | `/tmp/nexus-s44-browser-build.log` |
| S4.4 变更源码/夹具定向 Prettier | exit 0 | `/tmp/nexus-s44-changed-format.log` |
| 文档本地链接/结构、`git diff --check` | 通过 | 本轮检查 |
| `pnpm format:check` | **exit 1：5 处既有格式问题** | `/tmp/nexus-s44-format.log` |

1190 项分布：core 360 Mocha + 14 Node、client 108、server 448、React 78、playground 34、standalone 45 Node + 12 DOM、参考服务 91。本轮加强既有两项在途编辑用例，未以新增测试数量充当验收结论。独立示例 DOM 套件仍有既有 act 环境警告，测试 exit 0。

conformance 随本轮 core 测试实际对拍：9 份官方套件、80 条，36 pass / 44 已决策偏差 / 0 fail；偏差为不支持 13、Profile 兜底 23、值级降级 5、方向不适用 3。基线无变化，不宣称完整官方 Basic Catalog 兼容。

全仓格式问题：`examples/playground-server/tests/policy.test.ts`、`packages/nexus-server/test/agent/access.test.ts`、`packages/nexus-server/test/api/sse-backpressure.test.ts` 三个未改动文件，以及原有未提交的 `docs/architecture-visual.html`、`scripts/quality-report.mjs`。保留用户工作区改动，S5 完整格式门禁前清理；不宣称所有根门禁全绿。

## 3. headless / React / 浏览器矩阵

下列包内路径均是可复跑的当前测试；更早整改与证伪的过程记录从对应提交追溯，不重复保留中间快照。

| 能力 / 反例 | headless / core 证据 | React / 实际浏览器证据 |
| --- | --- | --- |
| 自定义输入/action、两个 Catalog | `nexus-client/test/acceptance.test.ts` 读取共享 generation/action/stale oracle，核对实际请求 inputs/context/actionId/revision/hash | `nexus-react/test/acceptance.test.tsx` 全链；真实 Basic 表单与中立 scorecard，见 §4 |
| 双 surface 更新/删除与稳定订阅 | 同文件：只 patch B，A 快照与通知不变；core 受控删除一方，另一方保留 | 联合矩阵及 `test/surface/index.test.tsx`；浏览器双栏、独立 patch/删除、卸载重挂 |
| 预览与提交隔离 | done-only/缺 root/坏消息、本地准入拒绝不发布候选 | 标准/自定义候选 change/click/key 不写 runtime；浏览器挂起生成只有只读预览，B 可同时完成提交 |
| EOF / 坏顺序 / 身份与版本 | 缺 done、message 先于 start、start 前终态、hash/runId 错配、重复/倒退 revision 拒绝 | 联合 EOF/unknown 保留旧 UI 且动作关闭；浏览器实际失败反馈 |
| 发送不确定性与同步取消 | open 抛错、首帧前取消、busy 通知内 cancel/dispose，分别核对发送与基准 | 联合真实 fetch signal/reader 释放；浏览器挂起取消后 active=0，动作不复开 |
| 晚到与销毁隔离 | opening/reading 销毁、取消后实际交付晚到 done，不改候选/公开状态 | 联合不协作 transport 实际交付晚到 message/done，独立观察者 DOM/草稿不变；浏览器替身会停止送帧，不替代此反例 |
| unknown 与完整恢复 | 旧 revision 保留；合法固定视图恢复；过期/身份/内容/预算冲突拒绝且状态不变 | 联合非法恢复保持禁用、合法恢复后可 action；浏览器复验同次固定快照恢复 |
| 在途编辑与草稿代次 | 挂起实际 open 后编辑，当前/下次 inputs、固定提交与草稿确认分开断言 | 联合标准/自定义两条路径；浏览器 Before pending → After pending，后续请求确实发送新值 |
| DOM 身份、标签和动作禁用语义 | core 写回仍使用协议 componentId/surfaceId | `test/components/input-dom-id.test.tsx` 3 项；浏览器同名字段标签/错误说明隔离；本轮修复见 §5 |
| 外部/自建实例与样式 | session dispose 幂等、外部 runtime 由创建者销毁 | 联合 runtime/配置重渲/卸载/显式样式；浏览器父重渲与外部视图卸载重挂保留草稿 |
| 资源与传输边界 | client fetch/SSE 分片、帧/总字节、建连/空闲/总时长、错误体与 abort；core 模型/数组预算 | 根测试全部重跑；浏览器真实 HTTP 为补充，不以本地替身证明服务端背压 |

headless 30 项覆盖 17 cell；React 联合 14 项覆盖 12 cell，另有 DOM 身份 3 项。client/core/React 均通过本次构建产物根入口联合；原始定向源码测试作为第二层证据。S3 真实 HTTP、调度、业务副作用隔离与资源反例继续随根测试执行，S4 不复制服务端解释器。

## 4. 实际浏览器记录与复跑

使用内置浏览器打开真实本地页面，非 jsdom；当前默认页面实际视口 789×664。截图、AX/DOM 记录与请求观测保存在 `/tmp/nexus-s44-browser/`（本地临时证据），可按夹具 README 复跑。曾尝试 390×844 override，页面实测仍为默认尺寸，因此**不计作移动端验收**。未执行 Chrome/Firefox/Safari 矩阵、实际屏幕阅读器或完整 WCAG 扫描。

| 页面 / 实测链路 | 结果 |
| --- | --- |
| SDK 夹具 `127.0.0.1:4174` | 宿主控制区与两个 Surface 独立布局；自定义 FixtureInput/FixtureAction 仅声明与映射。A 挂起预览时 B 提交；交付 done 后 A 开放动作 |
| SDK 输入/action | Enter 实际触发请求；A 的输入规范化和 revision 前进，B 的值/revision 保持；父重渲保留 DOM id，卸载重挂保留外部草稿；删除 B 只移除 B 控件 |
| SDK 在途编辑 | 提交输入保持可编辑、候选输入与两个动作禁用；Before pending 已发送，期间改为 After pending；下一实际请求 inputs 为 After pending，固定基准未混入本地新草稿 |
| SDK 失败/恢复/取消 | EOF 与合法 RUN_COMMIT_UNKNOWN 分别 desync，旧值/revision 保留、动作关闭；错 hash 恢复拒绝；合法固定快照恢复；取消后交付按钮不复活运行，最后 opens=3 / closes=3 / active=0（重置后的独立轮次） |
| SDK 基本可访问性 | 标签可定位输入；小写触发可见错误，aria-invalid=true，aria-describedby 指向本实例错误 id；Tab/Enter 可操作；AX 确认提交输入可编辑、预览输入与 action 禁用 |
| Playground `127.0.0.1:5173` | 确定性参考服务，真实 fetch/SSE。Basic 表单输入 Nexus Browser、勾选订阅、Enter 提交，patch 显示 `name=Nexus Browser，subscribed=true`，同 surface action 状态 done |
| 独立示例 `127.0.0.1:3100` | 确定性 Agent + local handler。scorecard 自定义数字 82、布尔 true 经真实 HTTP 提交，patch 显示 `score=82，pinned=true`，action done |

Playground 另观察到 Workbench 缺少提醒时间时返回宿主校验文案且保留输入；未把该业务拒绝解释为 SDK 失败。日期控件的自动填充未形成可复核的成功提交证据，因此不列入通过项；不扩展评审接入方业务逻辑。三页最终 console 无 warn/error。

复跑：先 `pnpm build:packages`；夹具用 `pnpm --filter @nexus-ui/react test:browser`，操作步骤见 [夹具 README](../../packages/nexus-react/test/browser/README.md)。真实 HTTP 链路分别启动 `OPENAI_API_KEY='' pnpm --filter @nexus-ui/playground-server start` 与 `pnpm dev:web`；独立示例用 `NEXUS_DEMO_AGENT_MODE=deterministic NEXUS_DEMO_ACTION_MODE=local pnpm demo:standalone`，均无需模型密钥。

## 5. 本轮 SDK review 与整改

按 [code-review-expert](../../.zcode/skills/code-review-expert/SKILL.md) 覆盖 SOLID/边界、安全可靠性、质量和删除迭代四维。发现并关闭一项可访问性缺陷：Surface 根节点的 `aria-disabled=true` 向后代传播，使仍可编辑的提交输入在 AX 中报告禁用。现改为 `data-actions-disabled` 状态标记，仅由实际动作控件表达 disabled/aria-disabled；候选 fieldset 继续整体禁用，动作回调门控不变。

联合验收标准/自定义两项在途编辑用例新增断言：提交输入无禁用祖先，候选确有禁用 fieldset，并继续验证实际写回与下次 inputs。临时 dist 副本证伪：当前保护 2/2 通过、恢复根 aria-disabled 后两项均断言失败（exit 1），证据 `/private/var/folders/rc/scz639ld13l_2qqb96_l5cbh0000gn/T/nexus-s44-counterfact-c1b9p7ks/`；仓库源码与正常 dist 未为实验修改。浏览器修复前/后 AX 复验一致。

删除/迭代：完成的 S4 拆分与重复快照从 CURRENT 移除，由本报告和 Git 历史承接；保留可复跑夹具，放在 React test/ 下且不进入发行产物；现有 ESM 修补脚本仍为构建所需，S5 原生路径迁移验收后再删除。不新增业务模型、恢复 HTTP 路由、总门面包或 Agent 框架。

## 6. S5 交接与限制

| 事项 | S5 退出条件 |
| --- | --- |
| 原生 ESM / NodeNext | 显式 .js 相对路径、JS/d.ts 原生解析；验证后移除 fix-esm-imports，不直接删除必需脚本 |
| 四包发行与兼容 | 当前产物 files/exports/types、公开 API 快照、版本/升级说明、样式选择、React peer；Node/pnpm engines 与实际 Node 24 基线一致 |
| 仓外独立安装 | 干净 React + Node 项目按 PRD §5.1 仅消费当前包根；真实打包/安装时恢复版本与消费端同步规则，同居期不刷 tarball |
| 完整门禁 | 清理上述 5 处格式问题，干净环境执行构建/类型/lint/test/format/conformance 与远端 CI；不以本轮工作区和旧 CI 快照替代 |
| 浏览器兼容 | 保留本轮关键路径复跑；声明支持矩阵并补实际目标浏览器/视口，日期等原生控件按声明验证；基本 AX 检查不等于完整无障碍认证 |

无须选定业务 Agent 才能进入 S5。Vue、独立 Catalog 包、完整协议、多实例调度、增量渲染优化和业务结果库继续不在当前首发范围。
