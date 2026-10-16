# SDK 安全与可靠性

## 不可信输入与准入

- Agent JSON、HTTP 字节和浏览器 action 是否经运行时结构校验？类型断言不能替代校验，不限定校验库。
- Protocol/Profile/Catalog/Host Policy 的拒绝是否阻止状态落地？未知/不支持配置是否显式失败？
- JSON Pointer、写回、对象合并与 registry 查表是否防原型保留段和继承属性？合法普通 key 不应被误拒。
- schema.pattern、checks 正则和所有动态模式是否使用安全实现与长度/复杂度限制？
- URL/src/link 是否按用途限制 scheme？是否有 HTML/脚本注入、路径穿越、命令拼接或密钥/诊断 raw 泄露？
- RPC endpoint 的可信配置与不可信请求字段是否分开？仅当存在用户可控网络访问路径时评估 SSRF、重定向和超时边界。

## action 与权威

- 是否核对已提交 surface 的 revision/hash、组件来源、action 声明、输入路径/值和参数 schema？客户端 context 与模型字段都不是业务事实。
- 自定义 resolver/handler 是否能跳过 SDK 的基本准入？schema/hash/actionId 是否被误用为权限凭据？
- HTTP 适配是否在执行、查询或恢复 surface/run 前执行宿主访问准入？本地演示放行是否显式配置？不规定宿主身份系统的实现。
- 是否清晰区分 SDK 去重和领域幂等？failed/取消/断线后是否隐式重放可能已执行的业务操作？

## 状态、并发与流

- 调度是否覆盖快照读取、准入、handler 和提交？是否双锁、全局队列串扰、排队期间提前执行 handler？
- 预览是否被隔离且不能 action？EOF 是否误判成功？done 是否只表示 UI 提交？
- 提交前后失败能否正确报告 notCommitted/committed/unknown？history/观察者失败是否错误改写提交事实？
- revision 不一致、缺失终态、晚到响应是否导致失同步却仍开放旧 action？恢复快照是否重新校验？
- cancel/超时/dispose 是否关闭源、reader、监听器、timer 并释放锁？取消不能宣称撤销宿主事务。

## 有界资源

- 请求、JSONL 行、SSE frame/总响应、组件树、队列、活动 run、错误 raw 和存储是否有真正执行的预算？明确 bytes 与代码单元。
- 慢消费者是否产生无限缓冲？写流是否尊重背压？取消是否能打断排队与慢消费？
- 保留条数是否被误称并发硬上限？运行中 ledger/run 是否被静默淘汰，导致重放保护失效？
- 安全/隔离/幂等结论是否有真正触发失败路径的证伪测试？不要求审查接入方业务数据库或事务代码。
