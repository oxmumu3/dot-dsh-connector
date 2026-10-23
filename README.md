# Dot → Harness 插件

让 Dot 读取你的 DeepSeek Harness 项目、已保存会话和普通文件，并向 Harness 已登记的真实项目派任务、继续任务、查询结果和请求取消。原生任务使用当前 Harness 的模型、工具和审批设置，可以按任务修改项目文件、运行命令。

维护者：奥克斯木木山，发布命名空间 `oxmumu3`。这是独立开发的 DeepSeek Harness 原生插件，与 Harness 自带的 DSH Dot、微信项目助理分别运行。

当前预览版为 `0.6.0-preview.12`：新增插件内首次连接向导，并重新设计任务工作区。已通过 Harness 官方界面安装并启用，54 个安装文件与源码及归档一致；安装后的实际 Dot 成功读取项目并完成一个关联验证任务，管理页自动显示云端在线。验收范围详见 [verification.md](docs/verification.md)。

首次连接在 Ego 官方页面完成登录和确认，插件自动填写连接配置、保存专用密钥并验证真实读取和派任务。本机缺少 Ego 时，可从插件点击「安装 Ego 并继续」；下载、官方签名校验和安装由插件处理，首次浏览器设置仍由本人完成。Google 交互登录已由本人完成并实时回读已登录的 ChatGPT 页面；这不代表每个新账号都具备 Dot、Tunnel 或自定义工具权限。

## 一句话安装说明

在 [v0.6.0-preview.12 发行页](https://github.com/oxmumu3/dot-dsh-connector/releases/tag/v0.6.0-preview.12) 下载 **`dot-dsh-management-0.6.0-preview.12.tgz`**，交给 DeepSeek Harness，对它说：

> 请安装这个 Dot → Harness 插件，打开「Dot 连接」并点击「连接我的 Dot」，自动准备本机与账号侧配置；需要时让我登录自己的账号并确认授权。沿用我的模型、工具和审批设置，最后实际验证读取和派任务。已有连接和任务请保留。

普通用户只安装这一个 Harness 插件，见[安装与连接](docs/install-and-connect.md)。本仓库根包 `dot-dsh-connector` 用于开发和 MCP 配套，不作为第二个原生插件安装。首次连接从插件内发起，官方连接窗口自动填好支持的配置；本人完成登录、目标账号范围和最终授权，随后自动验证。[首次连接说明](docs/first-connection.md)。不要求另建 DeepSeek 模型 API key。正式源码仓库为 [oxmumu3/dot-dsh-connector](https://github.com/oxmumu3/dot-dsh-connector)；源码快照不等于发布回执，下载资产可用性以固定版本发行页为准。外部服务旧部署的维护说明见 [operator-runbook.md](docs/operator-runbook.md)。

## 工具

新版推荐配置暴露六个读取工具和六个原生任务工具，共 **12 个**，并使用 `DOT_DSH_FIXTURE_TASKS=disabled` 关闭旧五工具。账号侧旧工具目录需要按平台支持的流程更新后才能发现新增工具。

| 工具 | 用法 |
| --- | --- |
| `harness_status` | 检查读取能力、原生任务配置、worker 活动与暂停状态 |
| `harness_list_workspaces` | 分页列出已有项目与注册的普通上下文目录 |
| `harness_list_sessions` | 按项目或元数据查找已保存会话 |
| `harness_read_session` | 分页读取已保存会话，使用返回的 `next_offset` 续读 |
| `harness_list_directory` | 浏览指定 workspace 的普通目录 |
| `harness_read_file` | 分页读取普通 UTF-8 文件，排除凭据文件并脱敏 |
| `harness_start_task` | 在已登记的真实项目中新建连接器会话并派任务 |
| `harness_get_task` | 查询自有任务、阶段、结果及等待处理的问题 |
| `harness_list_tasks` | 按项目、状态、请求编号或归档状态找回任务 |
| `harness_followup_task` | 沿用会话继续，或明确选择运行中排队/补充要求，返回新 job |
| `harness_cancel_task` | 请求取消自有任务，已执行的命令和文件修改不会撤销 |
| `harness_archive_task` | 归档或恢复已结束的自有任务，保留请求身份与记录 |

`harness_status` 保留读取服务的兼容字段，并另外返回 `capabilities.native_tasks` 与 `admission`。管理页分别显示本机就绪与官方 Tunnel 的实时通道状态，自动跟随断开和恢复；最近云端交互时间单独显示。通道在线不等于账号已授权或任务成功。

例如：先让 Dot 找到目标项目，再说「在这个项目中新建一个 Harness 任务，完成这项修改并运行验证，把任务编号和结果给我」。提交与继续均使用稳定 `request_id`；超时后查询原 job 或复用原请求，不能换 ID 重派。

执行只接受 Host 当前 registry 中的真实项目 ID，不能提供任意绝对路径或外部 session ID。读取列表中的 memory、skills、instructions 等额外目录可以用于阅读，但不是可执行项目。普通项目无需声明 `public:true`；派活意味着当前 Harness 可以按其正常权限处理该项目材料。

## 使用条件与状态

- Harness Desktop 必须保持打开，并加载 `dot-dsh-management`。worker 随插件运行，可以离开「Dot 连接」页面。
- 模型、工具和审批沿用 Harness 的正常配置。等待审批或回答时，从任务详情打开对应原生会话处理；插件不会自动批准。
- `accepted` 只表示意图已持久化；运行中、空闲或收到正文都不等于成功。`succeeded` 需要精确用户消息、turn、有效正文及 `turn/end completed` 的关联证据。
- 每次继续产生新的 job，保留父任务关联。默认 `after_complete` 继续已结束任务；`queue` 排到当前轮之后，`steer` 在运行中补充要求。可用状态及会话归属会在执行前再次核对。结果的内容是否合格仍由用户判断。
- 归档只整理已结束任务，保留重复请求识别。原生任务不再受累计 100 项限制；最多 100 项未结束/待核实任务和账本 16 MiB 的存储保护仍存在，不宣称无限保留。
- 取消采用 Harness 的 session 级 API。只操作连接器自己创建并跟踪的会话，检测到手工接管则拒绝。官方 API 不提供检查与取消之间的原子条件，避免同时手工向同一连接器会话派新任务。
- 退出、重启或回包丢失可能留下 `unknown`；不自动重放不确定的写操作，保留原 job 与会话身份继续核对。

## 本地连接与管理

正常使用入口是 Harness 的「Dot 连接」。插件托管本机读取与管理服务，renderer worker 调用 Harness 正常 Host API；首次连接向导负责准备官方连接组件、填好账号侧设置，并用真实读取与任务回执验证。旧版独立服务部署保持兼容，端口与配置细节留在运维文档。

「Dot 连接」显示本机状态、权限、调用元数据和自有任务，支持自动刷新、查看问题、打开原生会话、接续、归档、暂停新调用与取消。暂停后运行中的任务继续，状态查询和取消仍可使用。流水从启用时开始，不代表同步 Dot/Codex 全部聊天；同一 owner 通道不能可靠区分两者身份。

配置见 [native-execution-usage.md](docs/native-execution-usage.md) 和 [management-usage.md](docs/management-usage.md)；读取与分页见 [harness-read-usage.md](docs/harness-read-usage.md)。开发运行要求 Node.js 22.15+、Python 3.10+；标准原生安装复用 Harness 自带运行时，无需用户另装全局 Node 或 Python。当前宿主基线为 macOS `/Applications/DeepSeek Harness.app`、Harness `0.2.1-rc.2`。

通道固定绑定单一 owner，私有插件/Tunnel 也必须仅此人可用。凭据文件不在读取范围；文本脱敏是尽力处理。原生任务通过已登录的本机 owner 正常调用 Host，不读取或复制现有 cookie、模型密钥或微信凭据。

## 旧 fixture 兼容路径

`list_projects`、`read_project_context`、`start_task`、`get_task`、`cancel_task` 保留用于旧部署和合成验证。它们运行独立窄宿主，只接收显式公开 fixture 材料，无工具、不改项目文件，与新的 `harness_*_task` 属于不同执行通路。[plugin-config.json](examples/plugin-config.json) 仅供这条旧路径，默认禁用；旧 launcher 的独立模型密钥要求不适用于原生任务。

## 本地开发验证

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run demo
npm run build:management
```

`demo` 和合成测试不能代替真实 Harness 或 Dot 验收。安装仅加载自有插件，不重启正在执行任务的 Host，不触发其他插件的全局重载。

MIT。依赖及完整许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
