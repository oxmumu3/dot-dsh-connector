# Dot → Harness 插件

`0.6.0-preview.25` 已发布到 npm `latest`，新增在 Dot 回答原生追问和逐次批准／拒绝操作的工具。旧连接需实际发现两个新工具才可使用；本轮已验证真实 Harness 问答和本机完整 MCP 链路，旧 Dot 工具目录刷新仍待验收。[新能力说明](docs/remote-interactions.md)。

设计思考与生态复盘：[《DeepSeek Harness 要走向极客玩具还是大众普惠？》](https://mp.weixin.qq.com/s/RIAYNqo8OsUVx2JpR8MPyA)

当前版本 `0.6.0-preview.25` 已发布到 npm `latest`，兼容官方 Harness Desktop `0.2.2-rc.1`，并保留 `0.2.1-rc.2` / `rc.3` / `rc.4` / `rc.5`。此前的连接、任务与持久会话读取修复继续保留；实测范围见[验收记录](docs/verification.md)。

让你的 Dot 读取 DeepSeek Harness 项目、查看已保存的会话，并给 Harness 派任务、继续任务、查看结果。任务使用你当前 Harness 的模型、工具和审批设置，可以修改项目文件、运行命令。

这是一个独立开发的 DeepSeek Harness 原生插件。安装在自己的电脑上，连接自己的 OpenAI 账号；不需要作者替你配置，也不需要把密钥发给任何人。

## 安装并连接

在 Harness 会话中发送下面这句话：

> 请使用 Harness 的官方插件管理工具，先查询 npm 上 @oxmumu3/dot-dsh-management 的 latest 标签对应版本，再安装并启用该精确版本，保留已有连接、配置和任务；安装后打开侧栏「Dot 连接」，首次使用按提示登录自己的账号并确认授权。

安装先解析 `latest` 再固定精确版本，避免包管理器的发布冷却选到旧版；本次默认安装路径已实测通过。使用严格冷却策略的客户端仍按其策略等待，说明见[安装说明](docs/install-and-connect.md)。

如 Harness 提示安装审批，核对内容后确认。安装后打开「Dot 连接」，点击「连接我的 Dot」：

1. **登录并选择账号范围。** 插件打开官方页面，你登录自己的账号，并确认组织和 ChatGPT 工作区。
2. **确认授权。** 插件填写连接配置，你在官方页面确认。看到「Save your key／保存密钥」窗口时先保持打开，回到 Harness 点「继续连接」；插件会保存密钥，无需复制。
3. **等连接验证完成。** 插件通过真实 Dot 读取项目并派发一个验证任务。需要 Harness 审批或回答时，按提示打开对应会话处理；完成后就能向 Dot 派任务。

本机没有 Ego 时，插件会提供「安装 Ego 并继续」；下载、签名检查和安装自动完成，首次浏览器设置由你完成。每次官方确认后，按提示回到 Harness 继续。[完整连接说明](docs/install-and-connect.md)。

试着对 Dot 说：

> 找到我在 Harness 里的目标项目。先看看有哪些文件，再读项目说明，然后给 Harness 派一个任务：完成这项修改并运行验证。把任务编号和结果告诉我。

选择自己允许操作的项目即可，不要求项目公开。首次验证完成与具体任务结果是否合格分别判断。

## 能做什么

- **读取上下文：** 查找项目、已保存会话和普通文件，按需要分页读取。
- **派发和跟进：** 新建任务、查看进度和结果，沿用同一会话继续；运行中也可排队补充或发送新要求。
- **管理任务：** 找回连接创建的任务、请求取消、归档或恢复已结束的记录。
- **查看连接：** 「Dot 连接」显示本机和云端状态、最近访问与任务，需要处理的问题会在这里出现。

## 日常使用

Harness 需要保持运行，关闭「Dot 连接」页面不会停止后台连接。升级并刷新连接能力后，任务需要回答时可在 Dot 回复原始问题；需要操作审批时可明确本次允许或拒绝。Harness 仍保留原会话处理入口，插件不会自行批准。

要接着做，告诉 Dot 找到原任务并继续；超时或状态待核实时查询原任务，不要重新派发相同写操作。取消不会撤销已经执行的命令和文件修改；归档也不会删除项目文件。

连接授权临近到期时，在「Dot 连接」点击「更新连接授权」，按提示确认新的授权。插件沿用原通道、个人插件和任务记录，验证新密钥后才切换；验证失败时保留原密钥。原窗口已被删除时，使用「重新打开连接窗口」继续。具体操作见[安装与连接](docs/install-and-connect.md)。

## 使用条件

- 当前支持 macOS 的 DeepSeek Harness Desktop，已验证 `0.2.1-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.4`、`0.2.1-rc.5` 和 `0.2.2-rc.1`；实际验收范围见版本记录。标准原生安装复用 Harness 自带运行时，无需另装全局 Node 或 Python。
- 使用自己的、具备 Dot、Tunnel 与自定义工具权限的 OpenAI 账号。账号资格由官方决定，插件不能替账号开通这些能力。
- Harness 至少有一个已登记的真实项目，并有可用的模型与工具。没有项目时按插件提示选择文件夹。
- 每个连接只服务其所有者。普通文件和已保存会话可以读取；凭据文件排除在读取范围外。文本脱敏尽力处理，不承诺识别全部敏感内容。
- 项目任务能修改文件、运行命令；额外登记的 memory、skills、instructions 目录只用于读取，不是可执行项目。取消只针对连接器创建的会话。

当前版本与实测范围见[验收记录](docs/verification.md)。空白机器、不同账号资格和长期无人值守可靠性，不能由单次安装或验证成功推定。

## 开发与接口

用户只需要安装 `@oxmumu3/dot-dsh-management` 这一个原生插件。仓库根包 `dot-dsh-connector` 是开发与 MCP 配套源码，不作为第二个原生插件安装。当前版本提供六个读取工具和八个原生任务工具（共 14 项，须包含 `harness_answer_question` 与 `harness_decide_approval`）；原生任务沿用 Harness 已登记的真实项目与会话归属检查。

[工具与原生任务](docs/native-execution-usage.md) · [读取与分页](docs/harness-read-usage.md) · [管理界面](docs/management-usage.md) · [旧部署维护](docs/operator-runbook.md)

开发运行需满足目标官方 SDK 的 Node 要求；`0.2.2-rc.1` 需要 Node.js 24.9.0+，读取辅助程序需要 Python 3.10+：

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run demo
npm run build:management
```

合成测试不能代替真实 Harness 或 Dot 验收。升级仅处理本插件，不重启正在运行任务的 Host 或全局重载其他插件。

维护者：牛村木木山。正式仓库：[oxmumu3/dot-dsh-connector](https://github.com/oxmumu3/dot-dsh-connector)。本插件与 Harness 自带的 DSH Dot、微信项目助理分别运行。

MIT。依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
