# Nexus UI — 工作区指令

## 宿主仓与业务宿主应用阶段（每次会话必读）

本仓（Nexus_UI）是受约束 A2UI v0.9 运行时（协议/Catalog/Policy 校验、surface 状态、渲染、SDK 打包）。`examples/agent-demo/` 预留为 Agent 宿主应用（业务集成示例），当前为空目录占位；其场景与判据由该应用自行定义。

硬规则：

1. **依赖方向单一**（所有消费方适用）：`examples/agent-demo` 只消费本仓公开入口（`@nexus-ui/core` / `@nexus-ui/client` / `@nexus-ui/react` / `@nexus-ui/server`），经 pnpm `workspace:*` 链接；绝不 import 源码/深路径。本仓 `packages/nexus-server`（SDK server 包）代码绝不反向依赖业务宿主应用模型。仓库目录地图见 README「仓库地图」与 ARCHITECTURE §2.0。
2. **同居期不刷 tarball**：core/react/server 变更后只需根目录 `pnpm install` 即对 workspace 消费方生效；`pnpm pack:nexus` + 版本提升 + overrides 同步的整套仪式**暂停使用**，拆分/发行时恢复——届时必须先升三包 patch 版本并让对方同步 overrides/deps（pnpm 不重读同名同版本的 file: tarball，`--force` 也不行；2026-09-29 已实际踩坑）。
3. **校验行为变更**（Catalog/协议/Profile）验证入口：本仓 conformance 与共享正常/非法 fixture 的双端准入对测；验证宿主与 Agent 尚未选定，不等待业务应用重建。评审仅覆盖 SDK 及其公开接入契约，不评审接入方业务工程。
4. **测试入口**：根 `pnpm test` 覆盖 core/client/react/server/playground/standalone-host-demo；业务载体专属命令（`pnpm -C examples/agent-demo <script>`）随重建恢复。重建若含 `better-sqlite3` 类原生模块，必须 Node 24（ABI 敏感，2026-10-10 曾因 Node 18/22 全量挂）。
5. 产品与任务事实源依次为 `docs/PRD.md`、`docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/DESIGN.md`、`docs/tasks/CURRENT.md`；业务宿主应用的业务模型绝不进入本仓通用包。

## 工程 SOP（强制）

1. 动手前读 `docs/tasks/CURRENT.md` 的当前任务和完成判据，再对照代码核实“已知缺陷”；产品线任务优先，方向变化先写明依据并与用户对齐。返工教训写回本节，不再开并行 SOP。
2. 测试放在所在包 `test/`，路径镜像 `src/`。安全、正确性、幂等或隔离声明要有真正触发失败条件的证伪测试；oracle 期望先与实现对拍，fixture 的数据作用域与断言作用域一致。资源预算反例先证明同一 Catalog/路径的合法写入成功，避免缺声明提前拒绝形成假阳性；共享提交拒绝分类覆盖生成与 action。共享常量在定义处导出；配置非法要显式报错。
3. 验证命令看真实退出码；用管道时必须 `set -o pipefail`。core 公开 API 改动后先构建 core 再跑 React 测试。完成声明需对应单测、typecheck、lint（根与相关包）、涉及构建面的 build；跨包改动加跑根 `pnpm test`。声称 CI、fresh clone 或浏览器可用时，必须真的在相应环境验证，不能引用旧快照。
4. 同一任务状态变化时同步 `docs/tasks/CURRENT.md` 与 README 对外状态；契约、结构、决策、需求分别更新 SPEC、ARCHITECTURE、DESIGN、PRD。历史证据标日期，提交哈希只在实际提交后回填。
5. 显著变更或安全/协议面代码提交前按下述 review skill 评审。若用户要求提交，先给出提交范围与 message 供确认，再 commit/push；业务宿主应用与 Nexus 基建不混成无关提交。
6. 含 `better-sqlite3` 类原生模块的工程必须 Node 24（ABI 敏感）；先核对 `node -v`。根 `pnpm install` 同样必须在 Node 24 下执行：Node 18 安装会把 better-sqlite3 编成 ABI 108，测试全量报 NODE_MODULE_VERSION；且 `pnpm rebuild` 不重编，需进 `.pnpm/better-sqlite3-*` 目录 `rm -rf build && npm run install`（2026-10-10 踩坑）。仓库结构变动后复查递归脚本和 fresh clone 的 `dist` 构建依赖。Vite 首次依赖预构建可能触发 full reload，应用状态问题须二次访问或生产构建复验。

7. 目录迁移不等于 SDK 边界收口，须追踪默认调用链；文档明确区分现状/目标、消息接受/UI 提交/业务结果。验证夹具不决定业务模型，不将固定布局或组件名分支当通用扩展点。

8. S1 复审教训：原型防护需覆盖准入、组件/Catalog 查表和 renderer 实际调用；迁出默认依赖要通过实际装配入口验证；非法预算在初始化或调用入口拒绝；删除源码后的增量构建须清理旧产物并校验文件清单，不能仅以根入口加载成功宣称边界收口。

9. 提交基准必须关联本地实际渲染的运行结果；不能用查询到的最新 revision 给旧视图刷新资格。并发反例同时覆盖流完成后查询前、查询后 action 前的其他提交；区分夹具前置验证与尚未实现的路由/准入验收。

10. 能力声明的权威必须是当前宿主 Catalog，不能以 SDK 标准声明查表替代名字分支；验证须覆盖标准名覆盖、自定义名与继承名。语法豁免须限定到已校验的消息位置，并继续递归检查参数，不能按任意层级的同名键跳过安全检查。

11. 本地写回与输入收集不得有异常泄漏：写路径失败（含 dataModel 中间节点非容器等 `setValueAtPath` 抛错）收敛为显式拒绝，已提交状态与输入草稿保持不变；声明缺失（未注入 registry）即整体拒绝写回，不以标准组件名兜底。

12. 校验点必须放在契约声明的作用对象上（如 paramSchema 校验最终交给 handler 的参数，而非共享准入的中间重算值），否则 resolver 路径会被提前否决；迁移期消费方测试出现成批语义红时，先核对校验点与拒绝顺序，再改夹具。schema 只约束形状，取值合法性与业务文案留在宿主 Policy/handler。

12. 草稿提取须隔离返回对象及嵌套值；失效草稿在组件更新时清除，不能只在读取时过滤，以免替换再恢复导致旧值复活。默认能力收紧后须检查实际 Provider/应用装配入口，不能只搜索直接 API 调用；测试补入 registry 不代表消费入口已迁移。

13. 权限路径须与实际容器的寻址语义一致，不能仅靠字符串规范化排除部分数组别名；引用隔离覆盖存储入界、出界、临时模型和待提交值。组合提交按「输入基础模型 → handler patch」顺序，消费消息与权威状态同序。容量淘汰不得重用提交编号；正常 source EOF 不是终态，非 HTTP 也须持锁至显式结束。HTTP 不用当前快照或新 actionId 替客户端声明其旧视图。

14. 运行提交边界须验证完整结果与 run/surface/catalog/hash 身份，不能依赖类型或非空检查；HTTP/非 HTTP 共用传输无关生命周期和记录所有者。发布必须绑定实际 adapter 的固定执行声明，不能让可选的平行 registry 代替核对。容量/响应占用失败覆盖运行与宿主清理；证伪必须在工厂/handler 函数体入口观察调用，不能仅观察生成器首次 yield。

15. 流验收须消费实际响应目的流并等待收完，不能用未读取的 PassThrough 或仅 body.data 观察替代；证伪覆盖超过缓冲阈值的合法输出。发布/消费的同一契约共用完整校验；报告参数须来自实际 handler 的权威入参并深拷贝，不能用输入前的本地解析结果代替。

16. 消费流的失效校验必须位于每次 runtime 写入之前，不能只在 await 结束后核 epoch；重复 action 与卸载清理分开持有。生成基准须绑定本次实际创建的视图，不能凭已有 surface 或 done-only 响应恢复资格。请求期间编辑测试必须挂起真实请求，核对可见值与下次 inputs 一致；契约 hash 须经 JSON 往返验证。

17. 入队请求须在入口隔离可变引用，调度键与实际执行始终使用同一快照；同一记录所有者的所有运行入口复用唯一调度器。记录接口异常不得阻断句柄终态，排队取消即释放额度；取消测试分别覆盖准备入口与发送入口注入 signal。

18. 提交事实隔离须覆盖自定义 run 与 adapter 全部入口；store 返回确认须校验，不以确认结构错误推断未提交。取消不能覆盖确定拒绝，组合生命周期故障不能覆盖原错误码；ledger 收敛覆盖提交步内最终校验失败，成功终态记录失败须可诊断，不伪造外部记录已修复。

19. Session 契约覆盖身份准备失败：不得伪造 start，准备前失败显式标记并与解析器对拍。序列校验须关联实际 run/surface/Catalog/hash 与 revision；迭代器接续须移交未读缓存（含终态），并用生产快于消费的屏障验证。共享 oracle 必须实际读取；有冲突先按契约核对并注明校准依据，不以手写同名场景代替。

20. 访问钩子与调度/执行必须基于同一入口请求快照；钩子持有的请求隔离且只读，异步反例覆盖受限目标切为允许目标及反向对照。托管记录已终态不能代表宿主资源已清理，初始化/预留失败与清理自身抛错须组合证伪并保留原错误。signal 是附加取消源，不能据此推断连接监听所有权；监听交接覆盖真实断连与重复关闭/abort。

21. 句柄终态不等于宿主退出：取消/超时必须触发源关闭，未退出操作须有界隔离并拒绝同 surface 重叠。背压反例覆盖 drain 先于等待、最后一帧堵塞与非 HTTP 消费暂停；snapshot/history 按跨 run 累积后的最终状态计量，不能用每 run 限额代替持久占用预算。容量保护不得绕过硬上限，排队取消同时释放 pin/timer。

22. 客户端须逐条观察 runtime 准入结果，不能以有界错误日志数量代替；open 未返回或本地取消不证明请求未送达，准入拒绝不证明旧基准有效。运行先登记再通知，EOF 后仍检查失效；错误响应体与成功流共用超时/取消边界，单帧预算须对分片方式不敏感。

23. 候选隔离必须用候选 patch 后失败/取消的原视图对照证伪，关闭动作资格不能代替隔离。恢复复用完整 Protocol/Profile/Catalog 并校验引用；观察者异常不能制造“报错但已发布”的假拒绝。恢复来源由可信宿主保证，SDK 拒绝已知版本倒退与同版本冲突，不用重复身份字段伪造内容认证。React 动作门控放在 renderer 回调出口，覆盖自定义键盘/变更事件；配置更新、订阅间隙与受控删除须有实际渲染回归。

24. 公开契约验收须捕获实际请求体，输入测试贯通当前发送、请求期间编辑后的可见模型与下次 inputs。销毁/释放在真实在途请求上观测 abort、response.close 与 reader cancel；同一 revision 对照同时验证流内 start 与本地固定基准。共享 oracle 的 expected 须参与独立断言，不能只读取 setup/source；取消/晚到用消费屏障，不用固定 sleep 推断已到达。

## Code Review 标准（强制）

所有代码 review（如 "review 这次改动"、"审查代码"、提交前检查）必须按工程级 skill
`.zcode/skills/code-review-expert/SKILL.md` 执行：

- **严重级别**：P0（安全/数据丢失/正确性，阻断合并）、P1（逻辑错误/重大 SOLID 违反/性能回退，合并前应修）、P2（代码坏味道/可维护性）、P3（风格/命名/小建议）。
- **review 维度**：SOLID 与架构边界、安全与可靠性（注入/XSS/SSRF/鉴权/竞态/资源泄漏）、代码质量（错误处理/性能/边界条件）、可删除项与迭代计划。
- **输出格式**：总结（APPROVE / REQUEST_CHANGES / COMMENT）→ 按严重级别分组的 findings（含 `file:line`、问题描述、建议修复）→ 删除/迭代计划 → 仅评审时询问修复范围；已授权实施时完成并报告，不重复确认。
- **文件级问题**用 `::code-comment{title body file start end priority}` 指令逐条输出，P0–P3 对应 `priority=0–3`。
- **默认只 review 不改码**；用户已明确授权修复、文档或 skill 调整时直接完成授权范围。接入示例仅检查公开契约，不评审其业务工程。
- 检查清单在 `.zcode/skills/code-review-expert/references/`（solid / security / code-quality / removal-plan），review 时按 SKILL.md 的流程加载。
