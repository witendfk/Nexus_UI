# 代码质量清单

来源：sanyuan0704/sanyuan-skills `code-review-expert`（适配 OrderOps）。

## 错误处理

- 异常吞噬：空 catch、catch 后仅打印。
- 未处理 rejection：`void asyncFn()`、`.then` 无 `.catch`。
- 降级路径缺失：模型失败/网络断开/超时后的 UI 状态（本项目的 SSE 错误必须区分服务端 `error` 事件与网络失败）。
- 错误状态卡死：失败后 loading 态永不复位。

## 代码坏味道

- 重复代码（三处以上复制粘贴；测试里重复的 SSE fixture 构造）。
- 魔法数字/字符串（端口、阈值、路径散落各处 —— 应进 config）。
- 死代码/防御性死分支（永远不会走到的 fallback）。
- 绕圈实现：已解析对象再 stringify 回字符串过解析器（如 `runtime.push(JSON.stringify(msg))` vs `runtime.dispatch(msg)`）。
- 注释掉的代码块留存。

## 并发问题

- 共享可变状态无同步（模块级 Map 被并发请求读写）。
- 竞态窗口：check-then-act、先 render 后校验。
- 异步完成后引用过期闭包变量。

## 资源管理

- 测试里启动的 server/句柄未在 afterEach/beforeAll 生命周期关闭。
- 流读取中途放弃时未 cancel reader。
- 定时器/事件监听未清理。

## 测试质量

- 断言过弱（只断言不抛错、只断言 200）。
- 测试间共享可变全局状态（顺序依赖）。
- mock 掩盖真实契约（mock 的响应 shape 与真实服务端漂移）。

## 可维护性

- 命名不达意（`data2`、`handleTmp`）。
- 单导出文件的 barrel 缺失导致深路径 import。
- 配置散落：同一常量在多处定义（catalogId、端口）。
