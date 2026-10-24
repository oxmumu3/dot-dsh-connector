# Dot → Harness 插件

**发行状态：** `0.6.0-preview.17` 当前为发行候选，已通过恢复与续期相关回归、构建和安装包核验；公开发布、官方安装和真实 Dot 复测尚待完成。该版本尚未公开发布，下面是发布后使用的预定安装指令，当前不作为已可下载的入口。实际验证范围见[验收记录](docs/verification.md)。

让你的 Dot 读取 DeepSeek Harness 项目、查看已保存的会话，并给 Harness 派任务、继续任务、查看结果。任务使用你当前 Harness 的模型、工具和审批设置，可以修改项目文件、运行命令。

这是一个独立开发的 DeepSeek Harness 原生插件。安装在自己的电脑上，连接自己的 OpenAI 账号；不需要作者替你配置，也不需要把密钥发给任何人。

## 发布后安装并连接

在 Harness 新建会话，选择「创造模式」，复制下面这句话：

> 请使用插件管理工具安装并启用这个 Dot → Harness 插件：https://github.com/oxmumu3/dot-dsh-connector/releases/download/v0.6.0-preview.17/dot-dsh-management-0.6.0-preview.17.tgz 。保留已有连接、配置和任务。安装成功后告诉我打开侧栏「Dot 连接」；首次使用点击「连接我的 Dot」，按提示登录自己的账号并确认授权，原有连接继续沿用。

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

Harness 需要保持运行，关闭「Dot 连接」页面不会停止后台连接。任务需要回答或审批时，打开对应 Harness 会话处理。插件沿用现有审批设置，不会自动替你批准。

要接着做，告诉 Dot 找到原任务并继续；超时或状态待核实时查询原任务，不要重新派发相同写操作。取消不会撤销已经执行的命令和文件修改；归档也不会删除项目文件。

连接授权临近到期时，在「Dot 连接」点击「更新连接授权」，按提示确认新的授权。插件沿用原通道、个人插件和任务记录，验证新密钥后才切换；验证失败时保留原密钥。原窗口已被删除时，使用「重新打开连接窗口」继续。具体操作见[安装与连接](docs/install-and-connect.md)。

## 使用条件

- 当前支持 macOS 的 DeepSeek Harness Desktop，已核对的宿主基线为 `0.2.1-rc.2`。标准原生安装复用 Harness 自带运行时，无需另装全局 Node 或 Python。
- 使用自己的、具备 Dot、Tunnel 与自定义工具权限的 OpenAI 账号。账号资格由官方决定，插件不能替账号开通这些能力。
- Harness 至少有一个已登记的真实项目，并有可用的模型与工具。没有项目时按插件提示选择文件夹。
- 每个连接只服务其所有者。普通文件和已保存会话可以读取；凭据文件排除在读取范围外。文本脱敏尽力处理，不承诺识别全部敏感内容。
- 项目任务能修改文件、运行命令；额外登记的 memory、skills、instructions 目录只用于读取，不是可执行项目。取消只针对连接器创建的会话。

当前版本与实测范围见[验收记录](docs/verification.md)。空白机器、不同账号资格和长期无人值守可靠性，不能由单次安装或验证成功推定。

## 开发与接口

用户只需要安装 `dot-dsh-management` 这一个原生插件。仓库根包 `dot-dsh-connector` 是开发与 MCP 配套源码，不作为第二个原生插件安装。当前连接提供六个读取工具和六个原生任务工具；原生任务沿用 Harness 已登记的真实项目与会话归属检查。

[工具与原生任务](docs/native-execution-usage.md) · [读取与分页](docs/harness-read-usage.md) · [管理界面](docs/management-usage.md) · [旧部署维护](docs/operator-runbook.md)

开发运行要求 Node.js 22.15+、Python 3.10+：

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run demo
npm run build:management
```

合成测试不能代替真实 Harness 或 Dot 验收。升级仅处理本插件，不重启正在运行任务的 Host 或全局重载其他插件。

维护者：奥克斯木木山。正式仓库：[oxmumu3/dot-dsh-connector](https://github.com/oxmumu3/dot-dsh-connector)。本插件与 Harness 自带的 DSH Dot、微信项目助理分别运行。

MIT。依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
