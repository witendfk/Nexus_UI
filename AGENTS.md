# Nexus UI — 工作区指令

## 宿主仓与业务宿主应用阶段（每次会话必读）

本仓（Nexus_UI）是受约束 A2UI v0.9 运行时（协议/Catalog/Policy 校验、surface 状态、渲染、SDK 打包）。`examples/agent-demo/` 预留为 Agent 宿主应用（业务集成示例），当前为空目录占位；其场景与判据由该应用自行定义。

硬规则：

1. **依赖方向单一**（所有消费方适用）：`examples/agent-demo` 只消费本仓公开入口（`@nexus-ui/core` / `@nexus-ui/react` / `@nexus-ui/server`；目标 client 待 S4 新增后纳入），经 pnpm `workspace:*` 链接；绝不 import 源码/深路径。本仓 `packages/nexus-server`（SDK server 包）代码绝不反向依赖业务宿主应用模型。仓库目录地图见 README「仓库地图」与 ARCHITECTURE §2.0。
2. **同居期不刷 tarball**：core/react/server 变更后只需根目录 `pnpm install` 即对 workspace 消费方生效；`pnpm pack:nexus` + 版本提升 + overrides 同步的整套仪式**暂停使用**，拆分/发行时恢复——届时必须先升三包 patch 版本并让对方同步 overrides/deps（pnpm 不重读同名同版本的 file: tarball，`--force` 也不行；2026-09-29 已实际踩坑）。
3. **校验行为变更**（Catalog/协议/Profile）验证入口：本仓 conformance 与共享正常/非法 fixture 的双端准入对测；验证宿主与 Agent 尚未选定，不等待业务应用重建。评审仅覆盖 SDK 及其公开接入契约，不评审接入方业务工程。
4. **测试入口**：根 `pnpm test` 覆盖 core/react/server/playground/standalone-host-demo；业务载体专属命令（`pnpm -C examples/agent-demo <script>`）随重建恢复。重建若含 `better-sqlite3` 类原生模块，必须 Node 24（ABI 敏感，2026-10-10 曾因 Node 18/22 全量挂）。
5. 产品与任务事实源依次为 `docs/PRD.md`、`docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/DESIGN.md`、`docs/tasks/CURRENT.md`；业务宿主应用的业务模型绝不进入本仓通用包。

## 工程 SOP（强制）

1. 动手前读 `docs/tasks/CURRENT.md` 的当前任务和完成判据，再对照代码核实“已知缺陷”；产品线任务优先，方向变化先写明依据并与用户对齐。返工教训写回本节，不再开并行 SOP。
2. 测试放在所在包 `test/`，路径镜像 `src/`。安全、正确性、幂等或隔离声明要有真正触发失败条件的证伪测试；oracle 期望先与实现对拍，fixture 的数据作用域与断言作用域一致。共享常量在定义处导出；配置非法要显式报错。
3. 验证命令看真实退出码；用管道时必须 `set -o pipefail`。core 公开 API 改动后先构建 core 再跑 React 测试。完成声明需对应单测、typecheck、lint（根与相关包）、涉及构建面的 build；跨包改动加跑根 `pnpm test`。声称 CI、fresh clone 或浏览器可用时，必须真的在相应环境验证，不能引用旧快照。
4. 同一任务状态变化时同步 `docs/tasks/CURRENT.md` 与 README 对外状态；契约、结构、决策、需求分别更新 SPEC、ARCHITECTURE、DESIGN、PRD。历史证据标日期，提交哈希只在实际提交后回填。
5. 显著变更或安全/协议面代码提交前按下述 review skill 评审。若用户要求提交，先给出提交范围与 message 供确认，再 commit/push；业务宿主应用与 Nexus 基建不混成无关提交。
6. 含 `better-sqlite3` 类原生模块的工程必须 Node 24（ABI 敏感）；先核对 `node -v`。根 `pnpm install` 同样必须在 Node 24 下执行：Node 18 安装会把 better-sqlite3 编成 ABI 108，测试全量报 NODE_MODULE_VERSION；且 `pnpm rebuild` 不重编，需进 `.pnpm/better-sqlite3-*` 目录 `rm -rf build && npm run install`（2026-10-10 踩坑）。仓库结构变动后复查递归脚本和 fresh clone 的 `dist` 构建依赖。Vite 首次依赖预构建可能触发 full reload，应用状态问题须二次访问或生产构建复验。

7. 目录迁移不等于 SDK 边界收口，须追踪默认调用链；文档明确区分现状/目标、消息接受/UI 提交/业务结果。验证夹具不决定业务模型，不将固定布局或组件名分支当通用扩展点。

8. S1 复审教训：原型防护需覆盖准入、组件/Catalog 查表和 renderer 实际调用；迁出默认依赖要通过实际装配入口验证；非法预算在初始化或调用入口拒绝；删除源码后的增量构建须清理旧产物并校验文件清单，不能仅以根入口加载成功宣称边界收口。

9. 提交基准必须关联本地实际渲染的运行结果；不能用查询到的最新 revision 给旧视图刷新资格。并发反例同时覆盖流完成后查询前、查询后 action 前的其他提交；区分夹具前置验证与尚未实现的路由/准入验收。

10. 能力声明的权威必须是当前宿主 Catalog，不能以 SDK 标准声明查表替代名字分支；验证须覆盖标准名覆盖、自定义名与继承名。语法豁免须限定到已校验的消息位置，并继续递归检查参数，不能按任意层级的同名键跳过安全检查。

## Code Review 标准（强制）

所有代码 review（如 "review 这次改动"、"审查代码"、提交前检查）必须按工程级 skill
`.zcode/skills/code-review-expert/SKILL.md` 执行：

- **严重级别**：P0（安全/数据丢失/正确性，阻断合并）、P1（逻辑错误/重大 SOLID 违反/性能回退，合并前应修）、P2（代码坏味道/可维护性）、P3（风格/命名/小建议）。
- **review 维度**：SOLID 与架构边界、安全与可靠性（注入/XSS/SSRF/鉴权/竞态/资源泄漏）、代码质量（错误处理/性能/边界条件）、可删除项与迭代计划。
- **输出格式**：总结（APPROVE / REQUEST_CHANGES / COMMENT）→ 按严重级别分组的 findings（含 `file:line`、问题描述、建议修复）→ 删除/迭代计划 → 仅评审时询问修复范围；已授权实施时完成并报告，不重复确认。
- **文件级问题**用 `::code-comment{title body file start end priority}` 指令逐条输出，P0–P3 对应 `priority=0–3`。
- **默认只 review 不改码**；用户已明确授权修复、文档或 skill 调整时直接完成授权范围。接入示例仅检查公开契约，不评审其业务工程。
- 检查清单在 `.zcode/skills/code-review-expert/references/`（solid / security / code-quality / removal-plan），review 时按 SKILL.md 的流程加载。
