# DSH 内的 Dot 连接管理

> 当前普通安装见 [安装并连接 Dot](install-and-connect.md)。本页保留早期外部管理服务部署方式，已有 tokenFile 配置继续兼容；不代表新版首次安装需要两个原生插件。


本地开发预览 `0.4.0-preview.1`。管理器新增正常 Harness 项目任务账本与 renderer worker，旧 fixture 通路保留兼容。本机创建、工具执行、继续及运行中取消已通过；实际 Dot 已完成建任务、查询结果、同会话继续和运行中取消，用户内容验收另计，见 [verification.md](verification.md)。

## 可以看到和操作什么

- 总览：读取与任务后端是否可达、此接入是否暂停、权限范围、开始记录时间及保留上限。
- 访问记录：经过此网关的读取、任务与控制请求，包含时间、目标、成功/失败/未知、数量或来源指纹。支持类型/结果筛选和分页。
- 任务：本连接器创建的独立任务、原任务要求、关联会话、结果、截断和验收状态，以及等待审批/回答的数量。列表不发送完整结果；详情按需读取。
- 暂停/恢复：只控制新的读取与派单；已有任务可以继续查询和取消。暂停不会停止后台或原 Harness 会话。
- 取消：仅接受已导入或已观测的连接器自有 job。请求取消与实际取消完成分别显示；缓存详情禁止取消，先刷新核对。

同一固定 owner 通道不能可靠区分 Dot 与 Codex。这里管理的是这条连接的工具调用，不会同步双方全部聊天。过去未保存的读取流水无法补齐。保留最近500条调用和100项任务，未完成记录优先保留。旧快照、迟到回包不会将已确认的完成结果回退成运行中。

读取流水不保存会话或文件正文，也不记录任意查询词、原始请求头、环境和错误详情。任务要求和结果按现有边界脱敏后保存在私有本地状态。凭据过滤仍是尽力模式，不能保证任意自然语言中绝无秘密。

## 两个交付包

目标包名 `dot-dsh-connector-0.4.0-preview.1.tgz`：MCP、原生任务账本、持久化读取及管理网关。实际可安装产物须另行核对，包名不表示公开 Release 已发布。

`dot-dsh-management-0.4.0-preview.1.tgz`：薄原生DSH插件，提供左侧“Dot连接”入口。它只注册管理Remote和客户端面板，不挂载AgentLoop或原连接器执行器。React和主题复用DSH本身，不打包第二套客户端运行时。

公开管理包的Cordis行使用 `disabled:true`，内部apply也默认不启用。本人部署时，操作者可在该自有行使用 `disabled:false` 和 `config:{enabled:true,tokenFile:<新专用admin key的绝对路径>}`。tokenFile只在Host读取；值和引用均不进入浏览器构建产物。私人配置不能放入公开分发包。

## 独立管理网关

推荐主路径使用持久化读取 31471、gateway 31472、admin 31473 和原生 worker 31474。gateway 审计读取与四个原生任务工具；admin 仅接受六个管理方法。channel/admin 使用不同 token，前端 worker 使用单次短期 capability。正常任务不依赖旧 fixture 服务 31470。

管理配置示例（值仅为引用/非秘密）：

```json
{
  "enabled": true,
  "principal": "dot-owner",
  "stateDir": "/absolute/private/manager-state",
  "readUrl": "http://127.0.0.1:31471/rpc",
  "gatewayPort": 31472,
  "adminPort": 31473,
  "nativeExecution": true,
  "nativeStateDir": "/absolute/private/native-task-state",
  "workerPort": 31474
}
```

`nativeStateDir` 可省略，默认为 `<stateDir>/native-tasks`，与旧 fixture 账本分离。`workerPort` 保留 31474，客户端已固定此端口。旧部署可另设 `taskUrl` / `taskStateDir` 导入 fixture 任务；后者只读该目录的 `state.json` 并按 principal 筛选。`stateDir`必须是0700规范目录，状态文件0600，管理器独占自己的锁。未知锁不自动清除；审计不可用时停止新操作。

只通过私有启动器向 `scripts/management.mjs` 传入环境引用 `DOT_DSH_MANAGEMENT_CONFIG`、`DOT_DSH_TOKEN` 和新专用 `DOT_DSH_ADMIN_TOKEN`。不要把token值写在shell命令、日志、配置或聊天。MCP 启动器将 `DOT_DSH_BRIDGE_URL`、`DOT_DSH_HARNESS_BRIDGE_URL`、新增 `DOT_DSH_NATIVE_TASKS_URL` 均设为 `http://127.0.0.1:31472/rpc`，并设置 `DOT_DSH_FIXTURE_TASKS=disabled`。该配置共 10 个工具；新增任务工具包含可运行命令、修改文件的写入能力，需在私有插件中核对其发现和授权。未经过该网关的本地直连不属于暂停范围。

配置细节与任务契约见 [native-execution-usage.md](native-execution-usage.md)。正常任务沿用当前 Harness 模型、工具和审批设置，不需要另建模型 key。Desktop 与插件须保持打开，管理页可以离开；审批和回答在 Harness 中处理。取消不撤销已执行副作用，官方 session 级 API 的并发边界见该说明。

## 安装与激活

使用当前官方Desktop的Plugins界面或其自带desktop CLI。当前PATH里的旧Lab `dsh`不适用。新包须检查identity/version/manifest、依赖和许可，然后通过官方安装路径加入desktop profile。官方新bundle安装会登记选择层；HMR是否已实际加载、返回是否restart-required和原生页面是否显示必须分别核对。不能把pnpm成功当作运行成功。

不得为了加载管理插件强行退出或重启有任务的原宿主。若热加载返回restart-required，先保留已准备的包和准确原因，最后由用户选择合适时间重启。不要改动其他bundle、模型配置、WeChat或网络。

客户端先挂载自己的 Remote 定义，再在 `remote.dotDshManagement` 的子注入作用域中注册页面。Cordis 将 Remote namespace 视作独立服务；只注入 `remote` 会使真实插件作用域在发送请求前失败。失败页面只展示固定白名单诊断码，不显示原始错误、响应或凭据。Host 错误必须包含协议要求的空 `details` 对象，才能经过官方 Connection 解析保留错误码。

当前 Desktop 的 `client-hmr` 可以单独重建变化的客户端 entry。排障时只替换自有 `lib/client.js` 并核对原生页面，不应为前端更新触发整个 profile 的 Host reconcile；其他插件有待加载修改时尤其如此。临时诊断探针不得进入分发包。

## 开发验证

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run demo
npm run build:management
npm run preview:management
```

preview只运行真实UI组件和合成adapter，不含token，不连接真实后端。真实React组件测试覆盖读取失败去除旧状态、筛选/分页竞态、缓存详情标识及禁取消。原生测试另经公开SDK完成Host Gateway→Client Remote→adapter，且验证owner限制和严格参数。浏览器合成通过不替代原生安装与真实Dot审计回读。
