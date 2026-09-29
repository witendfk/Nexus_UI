# SOLID 坏味道提示

来源：sanyuan0704/sanyuan-skills `code-review-expert`（适配 OrderOps）。

## SRP（单一职责）

- 一个文件混装不相关关注点（HTTP + DB + 领域规则）。
- 巨型类/函数（>100 行、圈复杂度肉眼过高）。
- 命名为 "Manager"/"Helper"/"Utils" 的万能模块。

## OCP（开闭）

- 加一种异常类型/组件/action 需要改多处 switch/if —— 本项目 Catalog 扩展点应通过注册而非修改 guard。
- 硬编码类型码替代多态/注册表。

## LSP（里氏替换）

- 子类/实现收窄了入参或放宽了约束。
- 违反契约的 override（如 handler 返回的消息违反 catalog 声明）。

## ISP（接口隔离）

- 依赖了用不到的大接口（如 Agent import Host 的 DB 模块 —— 架构红线，见 architecture.md §8.1）。
- 跨包共享超出"版本化契约"的东西。

## DIP（依赖倒置）

- 高层模块直接依赖低层实现细节（HTTP 层直接写 SQL 字符串拼接）。
- 应经构造注入的依赖被模块级单例写死（测试无法替换）。

## OrderOps 结构红线

- `agent-server` 不得 import `host-server` 内部模块；共享只经 `contracts`。
- OrderOps 领域类型不得放进 Nexus 通用包。
- 业务副作用只允许在 Host 事务内；Agent/生成源不得写库。
