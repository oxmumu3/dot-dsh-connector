# Harness 原生项目任务

此前 `0.4.0-preview.1` 已通过本机真实项目的创建、文件修改、命令校验、继续及运行中取消。实际 Dot 已发现 10 个工具，完成建任务、结果查询、同会话继续和运行中取消；用户内容验收另计。分层结果由 [verification.md](verification.md) 记录。

## 正常执行路径

`harness_start_task` 为已登记真实 workspace 持久化任务意图和预定会话 ID。管理网关通过既有 owner Remote 向本机 Harness renderer 提供待处理命令；插件内的全局 worker 领取短期租约，调用正常 `workspace` / `session` API。建会话与提交提示词分开确认；稳定 request nonce 用于 Host inbox 和已保存用户消息去重。

会话使用当前 Harness 默认模型、工具、项目上下文及审批设置，可以运行命令、修改文件。无需复制模型密钥，也不要求额外创建 API key。worker 不访问 cookie 或凭据存储。

Harness Desktop 与插件必须保持打开；「Dot 连接」管理页可以切换。应用退出、worker HMR 或管理进程重启不会自动取消已提交的任务，也不重放不确定的写操作；重新连接后依据原会话、原请求 ID 核对状态。

## 插件托管与外部管理

新版普通安装使用单一 `dot-dsh-management` 包，在「Dot 连接」中准备、启动服务；见 [安装说明](install-and-connect.md)。以下手动配置仅用于保留旧外部部署或维护。

新的 managed 安装自动分配空闲 loopback 端口，服务全部就绪后保存实际地址；MCP 从私有配置读取网关地址，renderer 从可信 Host 获得本实例的 worker 地址。无需手工填写以下固定端口。一个已加载的 worker 只处理当前所选管理器的任务，切换 external/managed 不会同时服务两条通道；切换与保留边界见 [生命周期说明](setup-lifecycle.md)。

### 旧外部管理进程配置

复制 [native-management-config.json](../examples/native-management-config.json) 到私有位置，替换占位路径。示例本身不是加载即启用的插件配置。配置文件为仅所有者读写的普通单链接文件（0600），状态目录为规范绝对路径、0700 权限。

- `nativeExecution:true` 启用原生账本与 worker 通道。
- `nativeStateDir` 可省略，默认为 `<stateDir>/native-tasks`，与旧 fixture 账本隔离。
- `readUrl` 指向独立持久化读取服务。原生任务不依赖旧 `taskUrl` 或 31470 服务。
- 外部兼容部署保留 `workerPort:31474`；没有 managed Host 提供的执行器地址时，客户端沿用该端口，不要只改外部服务端。
- `principal` 与读取/MCP owner 通道保持一致，工具参数不能选择其他用户。

安全注入独立 `DOT_DSH_TOKEN` 与不同的 `DOT_DSH_ADMIN_TOKEN` 后，通过私有配置引用启动：

```sh
DOT_DSH_MANAGEMENT_CONFIG=/absolute/private/native-management-config.json \
  node /absolute/path/to/dot-dsh-connector/scripts/management.mjs
```

密钥值不写入命令、配置字面量、日志或聊天。31473 使用 admin token，31472 使用 channel token；31474 只接受正常 `dsh-app://app` 来源与短期领取/回报 capability，不把 admin token 交给浏览器。

安装与启用独立 `dot-dsh-management` 包见 [management-usage.md](management-usage.md)。Host 提供固定且严格校验的管理与本机设置方法；worker 经正常 owner Remote 调用已有 session/workspace API。

## MCP 启动环境

以下环境用于旧外部部署。插件托管模式通过自己的 `mcp-managed.mjs --data-dir ...` 自动读取实际地址，不应复制这些固定端口。外部私有 Tunnel 启动器应明确安全传递：

```text
DOT_DSH_BRIDGE_URL=http://127.0.0.1:31472/rpc
DOT_DSH_HARNESS_BRIDGE_URL=http://127.0.0.1:31472/rpc
DOT_DSH_NATIVE_TASKS_URL=http://127.0.0.1:31472/rpc
DOT_DSH_FIXTURE_TASKS=disabled
DOT_DSH_TOKEN=<由本地安全启动器注入，勿填写实际值>
```

命令为 `node /absolute/path/to/dot-dsh-connector/scripts/mcp.mjs`，不带参数。`DOT_DSH_BRIDGE_URL` 当前仍为启动必填项，即使已关闭 fixture 工具。三个 URL 均为数字 loopback `/rpc`，不得含账号、query 或 fragment。

该配置应发现六个读取工具和六个原生任务工具，共 12 个。配置 `DOT_DSH_NATIVE_TASKS_URL` 不会自动安装或启用 renderer worker；发现工具也不会启动模型任务。Tunnel、MCP、管理器和读取服务需在线，任务另依赖当前 Harness renderer 与 Host。

`harness_status` 的 `existing_harness_read_only` 仅表示持久化读取服务的模式。任务能力由原生任务工具单独提供，网关新增 `capabilities.native_tasks` 报告最近 worker 状态，不能从这个读取状态字段推断整个连接没有写入权限。

## 派活、继续与结果

1. 用 `harness_list_workspaces` 取得 workspace ID。只有当前 Host registry 中的真实项目可执行；额外 memory/skills/instructions 根不可作为项目派活。
2. 调用 `harness_start_task({workspace_id,task,request_id})`。任务最多 8,000 字符；外部 `request_id` 为 1–100 位字母、数字、下划线或短横线。
3. 保存返回的 `native_job_*` 和 `dsh_dot_*` 会话 ID，用 `harness_get_task({job_id})` 查询；不要把 session ID 当 job ID。
4. `pending_approvals` 或 `user_question_count` 大于零时，在 Harness 中审批或回答后再查询，连接器不自动批准。
5. 已结束自有任务可调用 `harness_followup_task({job_id,task,request_id})`。同一会话产生新的 attempt/job，保留 parent/root 关联。
6. 运行中补充可显式指定 `mode:queue`（排队）或 `mode:steer`（当前执行中补充）；省略 mode 仍是 `after_complete`。投递的原生 turn 不符合已记录父任务时保留待核实，不自动重发。
7. 用 `harness_list_tasks` 按 workspace_id、request_id、status、archived 与 offset/limit 查找任务。默认只列未归档；列表提供 stage、项目/会话标题和最近活动。
8. `harness_archive_task({job_id,archived:true})` 归档已结束任务；false 恢复。归档保留请求去重和结果。未结束任务最多 100 项，已结束任务不再累计触发该限制；总账本仍有 16 MiB 大小上限。

相同外部 `request_id` 和相同任务复用原 job，同 ID 配不同任务会冲突。提交超时后查询原 job，或复用完全相同请求，不换 ID 重派。只接受此连接创建的任务，不接受任意外部 session ID。

只有准确关联的用户消息、turn、非中断正文及 `turn/end completed` 才能得到 `succeeded`。`accepted`、Host 空闲或单独一段正文均不够。结果最多 16,000 Unicode 码点，截断时 `result_truncated:true`；内容验收另记为 `acceptance:unverified`。

## 取消与恢复

`harness_cancel_task({job_id})` 请求取消连接器创建并跟踪会话的当前任务。未派发的任务可在账本取消；排队消息按准确 request ID 对应的 queue item 删除；运行任务使用官方 session 级 `session.cancel`。只有精确终止证据或确认的队列删除后才显示 `cancelled`。

已经运行的命令、文件写入及外部效果不会回滚。发现手工输入或其他 request 已接管当前 turn 时，worker 拒绝取消或派入新任务。官方取消 API 没有原子 `expectedTurn` / `requestId` 参数，检查与请求之间仍有并发窗口；避免同时手工向同一连接器会话派下一项任务，不将其描述为原子逐消息取消。

回报超时只重发相同回报，不再执行命令；租约过期后禁止开始新的原生写操作。服务重启或失联导致结果未确认时保留 `unknown`，后续只读核对原身份。不要删除账本、换请求 ID 或重建会话来掩盖不确定状态。

## 验收

先核对工具发现和原生插件加载，再在本人允许的真实测试项目验证建任务、实际工具执行、精确结果、继续和运行中取消。最后通过实际 Dot 再验证这组工具；普通 ChatGPT 或本机 RPC 成功不能替代 Dot 调用。公开证据不包含私人项目正文、账号或任何 capability。

此前 0.4.0-preview.1 已通过本机完整任务验收，以及实际 Dot 的创建、查询、同会话继续和运行中取消。新版新增能力需单独验证，见 verification.md。外部任务的两个回合均有准确的 completed 终态；独立取消样本在实际命令开始后请求取消，Host 给出 aborted 终态，Dot 查询确认 cancelled。每位操作者仍需在自己的连接上复验，任务返回不等于用户内容验收。
