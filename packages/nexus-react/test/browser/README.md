# SDK 浏览器验收夹具

仅验证公开 core/client/react 契约，不是业务宿主应用，不连接模型。自定义 Catalog 名称通过声明与 renderMap 映射；transport 是确定性替身，真实 HTTP/SSE 另由两个现有示例验证。

使用 Node 24，在仓库根执行：

```sh
pnpm build:packages
pnpm --filter @nexus-ui/react test:browser
```

打开 `http://127.0.0.1:4174/`。`build:browser` 可独立检查夹具打包，输出位于本目录被忽略的 `dist/`，不进入 SDK 发布产物。

每轮点击「重置验收夹具」使用新会话。生成目标 A/B 在同一会话只创建一次，遵循 client 不复用已跟踪 surface 的规则。删除按钮调用 core 的受控视图删除，仅验证视图/草稿/渲染隔离；不模拟服务端删除或销毁 client 跟踪记录。恢复仅使用本夹具同次成功提交的固定快照，不能代表任意 JSON 的来源可信。

| 操作 | 应观察到 |
| --- | --- |
| 正常模式生成 A/B，编辑 A，键盘 Enter 触发应用输入 | A 规范化为大写、revision 前进；请求 inputs 为编辑值，B 不变；标签不串联 |
| 父组件重渲；卸载/重新挂载视图 | 普通重渲不换输入节点；外部 session/runtime 保留视图与草稿，卸载不擅自销毁 |
| 首次生成 A 前选择挂起终态；改为正常模式生成 B | A 只有禁用的预览，B 可独立提交；交付终态才开放 A |
| action 前选择挂起终态，发送后继续编辑提交输入 | 提交输入可编辑、action 禁用；候选输入/action 禁用；交付后保留新编辑，下一请求发送新值 |
| 输入小写后 Tab 离开 | 格式错误文字、aria-invalid 与本实例 aria-describedby 关联 |
| action 前选择缺失 done / 提交未知 | 保留原视图/revision，报告 desync，action 禁用；未知错误必须显示提交未知原因，不能是非法 Session 帧 |
| 非法恢复 / 恢复 | 错 hash 被拒且 UI 不变；合法固定快照恢复后 action 开放，不自动重放 |
| 挂起 action 后取消，再点击交付终态 | 动作保持关闭，资源 active=0，opens=closes；本替身关闭后停止送帧，不替代 headless 的不协作晚到帧反例 |
| 删除 B | B 控件消失，A 视图/草稿/动作不变 |

「公开契约观测」展示实际 transport 请求与关闭计数。记录来自实际浏览器操作；启动命令本身不是自动浏览器测试，也不代表跨浏览器、移动端或完整 WCAG 验收。最终阶段证据见 [S4-ACCEPTANCE](../../../../docs/tasks/S4-ACCEPTANCE.md)。
