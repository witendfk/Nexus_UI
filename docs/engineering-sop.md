# 工程执行 SOP(标准作业程序)

更新:2026-09-30。适用范围:本仓全部工程(Nexus 运行时 + `examples/orderops`)。
性质:从实际返工事故中沉淀的作业规则,每条标注来源实例。**发生新返工后必须把教训写回本文件**(一事故一条,不新增并行文档);与 AGENTS.md 冲突时以 AGENTS.md 为准。

## 1. 任务选取与对齐

1. **任务事实源顺序**:`examples/orderops/docs/implementation-plan.md` 任务表(带完成判据)> 两份 AGENTS.md > 会话记忆。动手前先读计划里该任务的判据行,不凭印象定义"完成"。
   - 实例(2026-09-30):transport P1 记忆标注"未修",实际已随 orderops `06492a1` 修复——**"已知缺陷"先对照代码验证再行动**。
2. **产品线优先**:默认只做 implementation-plan 的当前任务;基础设施/台账/仪式工作只在被产品线拉动时做,不顺手加戏。
   - 实例(2026-09-30):Layer 0 关闭后擅自转投 conformance 基线,产品线 T2.4 停滞,被纠正。
3. **方向性工作先对齐再执行**:涉及目标、架构、优先级的判断,先输出书面理解(含依据),用户确认后才动工;理解被纠正后把修正吸收进记录再继续。
   - 实例(2026-09-30):产品定义(Nexus npm 终点 / A2UI 协议维度)连续三轮被补全后,才发现此前每轮都在残缺理解下推进。

## 2. 实现纪律

1. **测试镜像结构**:单测放所在包 `test/`,路径镜像 `src/`(`src/cases/detect.ts` → `test/cases/detect.test.ts`);`src/` 内不放测试文件。
2. **安全/正确性声明必须配证伪测试**:凡声称"防住 X"(资源上限、注入、幂等、隔离),测试要构造**触发 X 的输入**证明行为,而不是只测正常路径。范例:Layer 0 各项修复的证伪测试(`docs/runtime-hardening-review.md`)。
3. **oracle 对拍测试:期望值先逐条与真实实现对拍再写死**,不允许凭直觉写期望。
   - 实例(2026-09-30):safe-regex 用 JS RegExp 作 oracle,两处期望值写错(`aaaaa` 可匹配、`ab+c` 搜索语义),返工两轮。
4. **测试夹具作用域 = 断言作用域**:断言"只统计我的自定义数据"的用例必须用干净库;用种子库就要把种子产物算进断言。
   - 实例(2026-09-30):detect 边缘用例 4 处误用 seededDb,断言漏掉 fixture 停滞单。
5. **共享路径/常量在定义处解析一次并导出**,消费方复用,不各自重拼相对路径。
   - 实例(2026-09-30):conformance 用例目录相对深度在两文件解析不一致,ENOENT。
6. **不用 shell 文本工具(sed/perl/python)改已读文件**,一律 Edit/Write 工具——避免"file modified since read"冲突与转义事故。
   - 实例(2026-09-30):perl -0pi 与 heredoc python 混用导致两次编辑冲突。
7. **配置校验失败要显式**(log 或 throw),不静默回退默认值——静默回退把配置错误藏到运行期。

## 3. 验证门禁

声明任何"完成/全绿"前,按下表跑齐;跨包影响时加跑全仓:

| 包 | 测试入口 | 注意 |
| --- | --- | --- |
| nexus-core | `cd packages/nexus-core && npx mocha`(mocha cwd 敏感) | timeout 5s |
| nexus-react | `cd packages/nexus-react && npx vitest run` | 消费 core 的 `dist` 产物 |
| orderops | `cd examples/orderops && npx vitest run`(vitest workspace 从根匹配) | 单文件跑法:`npx vitest run host-server/test/cases/detect` |
| 全仓 | 根 `pnpm test` | 含 orderops |

- **core 公开 API 变更后、react 测试前先 `pnpm --filter @nexus-ui/core build`**(react 消费 dist)。
  - 实例(2026-09-30):core 新增 `compileSafeRegExp` 后未重建 dist,react 测试报 is not a function。
- 完成声明 = 实现通过 + 单测存在且绿 + typecheck + lint(根 + orderops 双配置)+ 涉及构建面的加 build。测试记录对应具体提交,历史全绿不算数。

## 4. 文档同步(状态承载体)

状态变更(修复/关闭/迁移/验收)的**同一提交内**更新全部状态承载体;只改台账不改自述文档 = 未完成:

| 承载体 | 承载内容 |
| --- | --- |
| `README.md` 验收状态段 | 对外一句话事实 |
| `docs/engineering-priorities.md` | 能力证明与边界 |
| `docs/iteration-plan.md` 状态表 | 门禁快照数字 |
| `docs/runtime-hardening-review.md` / `docs/conformance-baseline.md` | 台账与基线(机器可读快照同步) |
| `examples/orderops/docs/implementation-plan.md` 进度行 | 任务级进度 |

- 历史记录保留但标"历史",新事实标日期 + 证据(提交哈希/测试数字)。
  - 实例(2026-09-30):Layer 0 关闭后 README/engineering-priorities/iteration-plan 三处仍写"REQUEST_CHANGES / 7 项 OPEN",被独立分析发现自相矛盾,返工一次全面同步。
- 完成哈希回填:先提交代码,再回填哈希到台账/进度行,随文档提交收尾。

## 5. Review 与提交

1. **review 触发点**:显著变更提交前;触碰安全/正确性/协议面的代码;用户要求。一律走 `.zcode/skills/code-review-expert/SKILL.md`(P0–P3、四清单、`::code-comment`、review-first 不改码)。
2. **提交流**:`提案(含 commit message)→ 用户确认 → commit → push`。conventional commits(`feat/fix/docs/test/chore/wip`);orderops 业务提交不与 Nexus 基建混提交。
3. **push 后**:如台账/计划有"待回填哈希"占位,立即回填,不留悬空引用。

## 6. 环境注意

- orderops 需 **Node 24**(better-sqlite3 原生模块 ABI 敏感;`NODE_MODULE_VERSION 108 vs 137` 症状见 orderops AGENTS.md 规则 4)。
- 同居期:core/react/server 变更后根目录 `pnpm install` 即对 orderops 生效;**不刷 tarball**,拆分/发布时恢复版本提升纪律(2026-09-29 同版本坑存档)。
- 双 Node 版本机:先确认当前 shell 的 `node -v` 再跑 orderops 命令。

## 7. SOP 维护

- 每次返工/纠正后,把教训浓缩成"规则 + 实例"追加到对应小节;实例保留日期,让规则可追溯。
- SOP 是活的:与实际执行冲突时,先改 SOP(经用户确认),再按新 SOP 执行。
