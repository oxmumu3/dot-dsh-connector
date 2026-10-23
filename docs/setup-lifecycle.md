# 当前首次连接实现

`0.6.0-preview.12` 默认使用 Ego v2 TaskSpace 接续官方页面。缺少 Ego 时可从插件显式安装；用户完成首次设置与登录，插件自动填配置和保存专用密钥。下文涉及独立 Chromium / Playwright profile 的段落属于旧实现记录，不是当前安装路径。当前用户流程见 [首次连接](first-connection.md)。

# 单包本地安装与生命周期

本次分发入口为 `dot-dsh-management` 原生包。根目录 `dot-dsh-connector` 是开发、MCP 和兼容源码包，已移除其原生 bundle 声明；不要同时登记两条原生入口。升级已有安装时，在官方插件管理中更新同一个 `dot-dsh-management` 包与现有行，保留其 `enabled:true,tokenFile` 配置。

开发者构建：

```sh
npm run build:plugin
npm pack ./management-plugin --pack-destination ./dist
```

安装实际构建出的原生归档；不需要安装根目录包作为额外依赖。构建会复制所需服务源码、只读 Python helper、MCP stdio 入口、许可及原生客户端。包内不含用户 profile、配置、token 或状态。版本和对外归属应在实际交付前核对；本页不提供未经验证的公开下载链接。

首次启用插件显示「连接我的 Dot」；Host 的首次连接向导顺序调用准备和启动，并负责私有浏览器与官方 Tunnel 的生命周期。插件自动填写官方页面中的专用 Tunnel、受限运行密钥及私有插件表单；用户登录、选择自己的 workspace / 项目，并在官方页面确认创建与授权。密钥确认创建后，插件自动读取这次新生成的值并保存到本机私有文件，随后启动 Tunnel、关联插件并让真实 Dot 验证读取和派任务。新用户不需要复制密钥、通道编号或终端命令。

原生「准备」与「启动」操作由 Host 的 owner-only RPC 处理。准备自动发现 `DSH_HOME`，为空时使用 `~/.dsh`；在 `<Harness home>/dot-dsh-connector` 建立 0700 私有目录，以 0600 保存独立 channel/admin token 与配置。也可通过插件配置或 CLI 显式指定规范绝对的 `dshHome`、`dataDir`。不会读取、复制既有模型、微信或其他平台连接的凭据；新创建的 Tunnel 运行密钥只供本安装使用，不进入聊天、前端状态或日志。

当前前置条件为 macOS、已安装于标准 Applications 路径的 Harness Desktop `0.2.1-rc.2`、Node 22.15+ 与支持 nofollow/openat 的 Python 3.10+。状态页分别列出平台、Node、SDK、Python、Desktop profile 检查。当前读取器的应用路径与 SDK 约束是明确限制，不能据此宣称跨平台通用。

启动会在插件 Host 内创建独立读取服务和管理服务。新的 managed 安装默认让操作系统为四个 loopback 监听器分配空闲端口；全部服务启动成功后，才把实际端口和恢复意图一起写入私有配置。MCP 使用实际网关地址，renderer worker 从可信 Host 获取本实例的执行器地址，只接受 `http://127.0.0.1:<port>/native/`。自动模式在重载时重新分配端口，之前的端口被其他程序占用也无需用户处理。开发者显式配置的固定端口仍遵守其约束，占用时拒绝启动；显式的 `0` 保留自动分配语义。

进程管理不依赖 PID 扫描：插件只保存自己创建的资源句柄。未知 `runtime.lock` 会阻止启动，不会结束外部进程、清除旧锁、接管已有服务或更改网络。已有 `enabled:true,tokenFile` 外部部署继续使用固定的旧管理端点 31473 与 worker 端点 31474，读取和网关端口由原外部配置保留。该兼容模式只读专用 admin token，不迁移数据，也不负责启停外部服务。

### 从外部部署切换到插件托管

普通升级应保留已有 external 配置。明确切换或隔离验证时，只更新同一个 `dot-dsh-management` 包及其配置，不增加重复原生入口，也不改其他插件、模型或审批配置。使用新的空白 `dataDir` 可生成独立的凭据、账本与首次连接身份；保留旧目录和外部进程便于回退。默认目录已有资料时会复用，重新安装本身不等于全新连接。

当前一个已加载的原生插件只把 renderer worker 连接到一个管理器。切换到 managed 后，即使旧外部读取、管理器和 Tunnel 进程仍在运行，旧通道也不会由这个 worker 同时领取任务或回报结果；已经交给 Harness 的任务不会自动取消。切换前应确认旧通道没有待处理或运行中的任务，切换后分别核对新 Host、客户端和新执行器响应。保留旧进程不能作为两个任务通道同时可用的证据。

首次明确启动成功后保存恢复意图；更新、HMR 或正常卸载时关闭自己的 listener、存储和锁，下次加载可恢复本人已启用的本地服务。明确点击「停止」会取消恢复意图。关闭服务不会自动取消已交给 Harness 的任务；任务保留其准确状态及重启后的不确定性。停用、卸载与更新默认保留 token、审计和任务记录。强制进程崩溃留下的未知锁需要操作者先核对，插件不会自行清除。

## 维护与已有外部连接的手动兜底

以下命令面向维护者，以及明确保留既有官方 Tunnel 的部署，不是新用户首次连接的必经步骤。CLI 使用同一安装包代码，只管理本地服务；账号侧自动配置由原生「连接我的 Dot」向导处理。

```sh
node /absolute/installed/dot-dsh-management/scripts/setup.mjs status
node /absolute/installed/dot-dsh-management/scripts/setup.mjs prepare
node /absolute/installed/dot-dsh-management/scripts/setup.mjs start
```

`start` 在当前前台进程运行，Ctrl-C 只停止该实例并清除恢复意图；SIGTERM 执行关闭并保留恢复意图。原生插件已运行时，CLI 不得启动第二实例。可追加 `--dsh-home /canonical/harness-home` 与 `--data-dir /canonical/private-directory`；无须把 token 放进命令行。运行状态无法仅凭旧 PID/锁被另一个实例接管，原生启停使用管理页。

本地服务就绪、云端通道健康与 Dot 账号关联是不同状态。对于已经有 Tunnel、需要手动接线的维护场景，设置页提供 stdio 命令；该命令从自己的私有目录加载 channel token，仅在其 MCP 子进程环境中传递。维护者可使用目标 workspace 支持的官方 Secure MCP Tunnel 流程配置此命令，再在 Dot 官方界面关联本人私有插件并确认工具授权。走原生首次连接向导时，这些配置由插件自动完成，官方最终授权仍由用户确认。

为本机 managed 服务接入一个已经由外部启动器管理的官方 Tunnel 时，可以登记它的健康 URL 文件引用。此操作只添加健康观测，不读取原 Tunnel 的运行密钥，也不枚举、迁移或接管其他 Tunnel。原生首次连接向导会自动登记自有的 `onboarding/health.url`，无需运行本命令：

```sh
node /absolute/installed/dot-dsh-management/scripts/setup.mjs prepare --cloud-health-file /canonical/registered-tunnel.url
```

`cloudHealthFile` 也可以作为 managed 原生插件配置的可选规范绝对路径。省略时保留既有引用；老配置无需迁移。准备时只保存引用，文件可以稍后由官方 Tunnel 生成；实际读取由管理服务检查。已有服务运行时先在本插件停止自己拥有的本机服务，再重新准备和启动。其他实例的运行锁会阻止修改；不会自动停进程、清锁或重启。显式停止、恢复意图写入和插件重载均保留该引用。

外部维护者使用官方 `tunnel-client run` 时，`--health.url-file /canonical/registered-tunnel.url`（官方环境变量 `HEALTH_URL_FILE`）指定健康 URL 文件。使用官方 `runtimes connect` 管理 alias 时，`runtimes status <自己的 alias> --json` 返回该实例的 `process.health_url_file`，登记那个已存在的文件即可。引用文件会在 Tunnel 重启后自动更新端口，无须把临时端口写死。单独登记已有健康引用不会创建平台资源、增加工具或要求重新授权；它与首次连接向导创建新资料的流程不同。

## 连接状态与验证边界

云端状态来自官方 `/health?details=true` 中当前控制面轮询、分发器与 MCP 通道的健康信号。历史任务、管理页刷新和本机执行器轮询不算云端连通证据；没有新任务时，健康通道也可以保持在线。无法读取、过期或不匹配的信号不能显示在线。最近云端交互只说明响应传递情况，不等于工具或任务执行成功，也不能区分调用来自 Dot 还是 Codex。Dot 账号是否授权和用户是否验收仍须分别确认；本地设置中的账号关联状态可以保持 `unverified`，与动态云端通道状态并列显示。

本地验证使用临时私有目录、临时端口与抽取后的单包进行。它证明本地安装结构、访问边界和生命周期；不能替代实际原生加载、官方 Tunnel 关联或 Dot 读取/派发验收。


## 插件内首次连接（0.6）

`manager_setup_connect_{status,start,resume,cancel,open}` 只属于 Host owner 管理通路，不暴露为 Dot 的 MCP 工具。start/resume 立即返回安全状态，后台顺序执行；取消只关闭本次取得的浏览器与子进程，不删除远端 Tunnel、私有插件、任务或密钥。外部部署只显示保留原连接，不启动替换向导。

连接资料位于本插件数据目录下的独立 `onboarding` 目录（0700）。安全状态只记录资源 ID、唯一名称和请求身份；运行密钥在用户确认创建后由插件捕获，单独保存为0600文件，浏览器profile单独0700目录。向导将新密钥权限设为 Tunnels Read / Use，有效期30天；当前不会自动续期，过期或撤销后的更换仍需维护者处理。固定health.url在自有本机服务启动前登记。未知锁、未知进程或已运行服务的不同health引用不会被接管。

Playwright-core 1.64.1 提供独立可见浏览器；Tunnel v0.0.16 从官方发布下载并按固定大小和SHA256核验。插件不导入日常Chrome资料、不读取cookie、不改系统代理、不移除Gatekeeper隔离。账号登录与官方最终授权在官方页面发生。源码/合成页面测试不等于真实空白用户登录路径已验收。

最后完成状态依赖新鲜官方健康、实际读取成功记录、固定request ID对应的native任务结束回执与唯一验证标记，不能由浏览器页面标题、已提交或本机就绪推导。当前完整验证阶段见verification.md。

### Restoring a completed connection

Normal Host startup restores only this installation's owned transport and current health check. It does not launch a browser or send another verification task. The view labels the saved full verification with its timestamp, separately from fresh transport health. Explicit “重新验证连接” starts a new verification attempt. Cancellation is checked again at resource-acquisition boundaries, including the last boundary before child spawn.

The pinned Tunnel archive is cached privately. Reuse rechecks the fixed archive size/SHA and every required extracted file against archive bytes and executable permissions. A broken cache is downloaded again; unknown symlinks are rejected. Node and Python use the official Harness runtimes where available; no global PATH or network settings are changed.
