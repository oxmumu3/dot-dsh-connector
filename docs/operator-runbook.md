# 操作与验收流程

此前 `0.4.0-preview.1` 已通过本机真实项目的创建、文件修改、命令校验、继续与运行中取消。实际 Dot 已发现 10 个工具，完成建任务、查询结果、同会话继续和运行中取消；用户内容验收另计。[verification.md](verification.md) 保留分层证据；以下步骤用于每位操作者安装后复验。

## 安装入口

当前普通安装使用单一 `dot-dsh-management` 原生包，按 [安装并连接 Dot](install-and-connect.md) 操作。本页也保留维护者需要的外部服务配置。

把实际收到的原生插件包交给 Harness：

> 请按这个包的 README 安装 Dot → DeepSeek Harness 连接器，启用项目读取和原生任务通路，沿用我的现有模型、工具和审批设置，关闭旧 fixture 工具，并验证 Dot 的建任务、读结果、继续和取消。

作者身份为牛村木木山，发布命名空间 `oxmumu3`。公开包与下载地址须实际核对归属、版本和内容；当前不提供未经验证的 Release URL。不要将旧命名空间的链接机械替换后当作新发布地址。

## 1. 安装前核对

检查本包 README、依赖、许可和本地测试。使用当前 Harness Desktop 的官方插件安装界面或其自带 desktop CLI，安装独立 `dot-dsh-management` 包；不使用旧 Lab CLI 冒充当前 Desktop 安装流程。

只加载本连接器自己的组件。不要为了安装重启正在工作的 Host、触发其他插件的全局 reconcile，或修改微信/模型/网络设置。若官方安装返回 restart-required，保留已准备产物和原因，在适当时段完成该步骤；不能把包安装记录当作运行时已加载。

当前原生执行沿用已登录 Harness 的正常模型和权限，不要求单独创建模型 API key，也不读取或复制原 cookie、模型密钥或微信凭据。需要在账号页面登录或确认授权时由用户本人操作。

## 2. 读取与管理服务

新版在「Dot 连接」设置中准备并启动本机服务，自动生成私有配置。已有 `tokenFile` 外部部署按以下步骤保留，不在升级时自动迁移。

按 [harness-read-usage.md](harness-read-usage.md) 配置 31471 持久化读取服务，指向已有 Harness 数据根。读取不唤醒已有 agent，凭据文件不在范围内。

按 [native-execution-usage.md](native-execution-usage.md) 配置管理服务：`nativeExecution:true`、gateway 31472、admin 31473、worker 31474。示例为 [native-management-config.json](../examples/native-management-config.json)，需复制到私有目录并替换规范绝对路径。该路径不需要旧 31470 fixture 模型宿主。

独立 channel token 与 admin token 安全注入本地启动器；不要把值写进配置、命令参数、日志或聊天。状态目录使用 0700、配置和 token 文件使用 0600，未知状态锁先核对归属，不自动清除。

按 [management-usage.md](management-usage.md) 在本插件自有 Cordis 行设置 `disabled:false`、`enabled:true` 和专用 admin token 文件引用。仅 Host 读取该文件；浏览器只获得短期领取/回报 capability。

## 3. 私有 Tunnel 与 MCP

目标 OpenAI workspace 必须允许自定义 MCP/私有插件与 Secure MCP Tunnel，并将通道限制为该操作者使用。平台账号权限缺失时停在账号侧处理，不使用认证绕过或客户端补丁。

插件托管模式使用设置页提供的 `mcp-managed.mjs --data-dir …` 命令，它从本机私有文件载入 channel token。以下裸 MCP 命令与环境列表仅供原有外部服务模式使用。

使用官方 Tunnel 的受限运行权限和当前 CLI 帮助配置 stdio command：

```text
node /absolute/path/to/dot-dsh-connector/scripts/mcp.mjs
```

启动器明确传递以下环境引用，不假定自动继承：

```text
DOT_DSH_BRIDGE_URL=http://127.0.0.1:31472/rpc
DOT_DSH_HARNESS_BRIDGE_URL=http://127.0.0.1:31472/rpc
DOT_DSH_NATIVE_TASKS_URL=http://127.0.0.1:31472/rpc
DOT_DSH_FIXTURE_TASKS=disabled
DOT_DSH_TOKEN=<安全本地注入，不填写实际值>
```

本机 `/rpc` 是内部桥接协议，不是直接填进 ChatGPT 的 HTTP MCP 地址。将私有 Tunnel 关联到目标 workspace，在官方插件界面完成所需授权并核对工具目录。旧连接可能仍保留旧工具元数据；按平台支持的方式更新或重新建立本人私有连接，确认 12 个工具后再派活。端口只监听 loopback，不开放公网端口，不改系统代理。

## 4. 真实发现与验收

推荐配置应发现六个读取和六个原生任务工具，共 12 个。工具发现不能产生任务副作用；不得仍调用旧 `start_task` 来证明新的 `harness_start_task` 可用。

`harness_status` 返回 `existing_harness_read_only` 是读取服务状态，并非整个连接的总权限声明。原生任务能力须另核对任务工具的发现、worker 状态与真实任务结果。

依次验收并分开记录：

1. 在实际 Dot 中调用 `harness_status`、项目/会话分页和一次有界文件读取。会话翻页使用回包 `next_offset`，不能自行累加 limit。
2. 选本人明确允许的真实测试项目，用 `harness_start_task` 新建会话，完成一个可核验的小任务，包含正常工具调用与文件读回。
3. 保存 job/session/message/turn 关联，用 `harness_get_task` 取得正文和准确 `turn/end completed`。`accepted` 或 Host 空闲不算完成。
4. `harness_followup_task` 使用新 request ID、新 job，验证同一自有会话中的下一次任务及结果。
5. 独立验证运行中 `harness_cancel_task`：先请求，再等准确终态；已执行的写入和命令不回滚。不要操作原已有会话。
6. 用户本人另行判断结果内容是否符合要求，记录内容验收；连接器返回的 `acceptance` 不自动变更为已验收。

模型、工具和审批继承 Harness 正常配置。需要审批/回答时在 Harness 处理，连接器不自动批准。桌面、Host 与 worker 保持运行；管理页可以切走。

## 5. 取消、退出与恢复

取消针对连接器创建并跟踪会话的当前任务。排队消息按 request ID 精确定位；运行取消使用官方 session 级 API。检测到手工接管时拒绝操作；官方接口不提供跨检查/取消 RPC 的原子 expectedTurn 条件，避免同时手工向同一会话派新任务。

超时后复用原 request ID 或查询原 job，不换 ID 重派。不确定的原生写操作在重启后保留 `unknown`，仅核对原会话身份；退出管理器或 HMR 不自动取消已经交给 Host 的任务。停止读取服务只关闭其 listener 和存储适配器，不取消已有会话。

## 旧 fixture 部署

[plugin-config.json](../examples/plugin-config.json)、31470 独立窄宿主和原五个工具仅保留兼容及合成验证。此路径要求显式公开文件、无工具/不改文件，旧 real launcher 使用独立模型密钥引用；这些条件不适用于当前原生任务路径。历史 SDK 组成与模型联调见 [native-host-audit.md](native-host-audit.md) 和 [verification.md](verification.md)。
