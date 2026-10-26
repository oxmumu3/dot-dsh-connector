# 手动连接参考（旧版 / 诊断）

新版首选插件内「连接我的 Dot」，见 [首次连接](first-connection.md)。下列五步仅为旧版 0.5.0-preview.2 与诊断保留，不是新版主流程。2026-10-23 核对了 OpenAI 官方说明、本机 tunnel-client v0.0.16 帮助和当前 Platform / ChatGPT 表单；对表单进行了实际核对；临时 QA 密钥仅用于检查创建结果，已撤销并回读确认，未修改原有连接。每位安装者使用自己的账号、通道与凭据，不复用开发者的个人连接。

## 1. 先准备 Harness 这一头

在已安装插件的 Harness 打开「Dot 连接」→「连接设置」，点击「准备本机连接」和「启动本机服务」。从页面复制它生成的完整 stdio 启动命令。命令形如：

```text
node '/实际安装路径/dot-dsh-management/scripts/mcp-managed.mjs' --data-dir '/本人Harness目录/dot-dsh-connector'
```

必须使用自己页面上的实际值。这不是开发者机器上的 launcher 路径；保持 Harness 运行。当前原生包支持 macOS、标准 Applications 路径下的 Harness Desktop 0.2.1-rc.2、Node 22.15+、Python 3.10+。

## 2. 在自己的账号创建通道

打开 https://platform.openai.com/settings/organization/tunnels ，登录自己的账号，确认自己的 Platform Organization，点击「Create tunnel」。填写名称（例如 My Harness）和描述；Organizations 选择本人组织，ChatGPT workspaces 选择本人实际使用 Dot 的 workspace。保存后复制这条新通道的 tunnel_... ID。

创建/编辑通道需要 Tunnels Read + Manage；日常运行与在 ChatGPT 选择通道需要 Tunnels Read + Use。这是组织权限，与 ChatGPT workspace 是否允许添加自定义 MCP 是两项不同条件。缺少入口或权限时，由该组织/workspace 的管理员处理，安装插件不能补出账号权限。个人用户按官方说明使用自己的个人 Platform Organization，并关联实际 ChatGPT workspace。

## 3. 让电脑接上这条通道

从 Tunnels 页面「Download tunnel-client」下载官方客户端。在 Platform「API keys」创建供通道运行的受限 API key，principal 具备 Tunnels Read + Use，并将密钥通过本机安全输入保存在本人私有文件中（目录0700、文件0600）。不要把密钥贴进聊天、发给别人或写成命令参数字面量；不要给日常运行进程使用 Admin key。此处是 OpenAI 通道运行凭据，不是 DeepSeek 模型密钥。

下面是模板，所有中文占位值必须替换；可让有本机命令能力的 Harness/Codex 帮助完成。先单独执行下面一行，随后粘贴第1步页面生成的完整一行命令并按回车。它只保存命令文本，不执行：

```sh
IFS= read -r dsh_mcp_command
```

然后运行以下连接模板。`"$dsh_mcp_command"` 将整行作为一个参数传入，保留路径的空格和引号，不要改成把页面命令直接嵌套进另一层引号：

```sh
tunnel-client runtimes connect \
  --alias my-harness \
  --tunnel-id 'tunnel_自己的通道ID' \
  --profile my-harness \
  --runtime-api-key 'file:/本人私有目录/runtime.key' \
  --mcp-command "$dsh_mcp_command" \
  --json

tunnel-client runtimes status my-harness --json
```

如果下载的二进制没有加入 PATH，使用其实际绝对路径调用。此模板核对的是v0.0.16；官方客户端更新后先看 `tunnel-client help quickstart` 和当前帮助。连接器发现和日常调用期间，通道客户端必须持续运行。

如还要在 Harness 管理页自动看到云端状态，读取官方 `runtimes status my-harness --json` 返回的 `process.health_url_file`，将这个文件路径登记为本插件可选 `cloudHealthFile` 引用。不要复制文件里的动态端口、不要把账号密钥交给插件。已有 managed 本机服务运行时，先在本插件停止它自己拥有的服务；以安装路径下 setup.mjs prepare --cloud-health-file '/实际健康URL文件路径' 保存引用，再回页面启动。若第1步使用自定义目录，必须追加与页面命令相同的 --data-dir；自定义 Harness home 也需传相同的 --dsh-home，不能无意准备到另一个默认目录。旧 external 部署有独立配置，请沿用其管理方式，不套用此步骤。本机就绪、云端通道健康和真实 Dot 调用成功分别核对。

## 4. 在 ChatGPT / Dot 账号里添加这台 Harness

打开 https://chatgpt.com/plugins ，确认当前是第2步关联的账号和 workspace。点击「添加」→「添加自定义 MCP 服务器」，填写：

- 名称：例如「我的 DeepSeek Harness」。
- 连接：选择「隧道」。
- 隧道ID：选择或粘贴第2步自己的 tunnel_... ID。
- 身份验证：本插件选择「无需身份验证」。它未实现额外OAuth；这不等于公开访问，通道与私有连接的账号权限仍然适用。

本人阅读风险提示并决定是否继续，然后点击「创建为插件」，按页面完成连接、安装及权限确认。保持个人私有使用，不把自己的通道/运行密钥转发给其他安装者。创建后应发现读取与原生任务工具；当前包是12项工具。

如果通道不在列表，先核对它已关联目标 ChatGPT workspace，以及操作者具备 Tunnels Read + Use。不要用别人的通道代替。UI字段来自当前已核对表单，后续平台更新时以官方页面为准。

## 5. 实际验证读取和派任务

在自己的 Dot 发：

> 请使用「我的 DeepSeek Harness」检查连接并列出项目，让我选一个测试项目；选好后先读 README，再给 Harness 新建任务，在该项目的临时验证目录创建 dot-hello.txt，写入 DOT_HARNESS_OK 和一个换行，再实际读回核对。返回项目名、任务编号、执行结果和文件内容。

回 Harness「任务」页确认有对应原生任务和结果，并独立核对文件。审批或提问在 Harness 原生会话中处理。工具被发现、任务被接受、任务完成和用户内容验收不是同一个状态。当前插件仅控制此连接创建的任务，不自动接管原有会话。

首次配置完成后，日常直接对 Dot 派任务即可；Harness 与通道客户端保持运行。

官方说明：https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

维护者：牛村木木山。正式对外 namespace 为 oxmumu3；本说明不提供尚未核验的公开仓库或 Release 下载地址。
