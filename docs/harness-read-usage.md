# Harness 普通内容只读入口

当前本地预览：`0.4.0-preview.1`。本文仅说明六个持久化读取工具；正常项目任务另见 [native-execution-usage.md](native-execution-usage.md)。历史读取协议基线为 `0.2.0-preview.1`。owner已明确授权Dot读取其全部Harness普通项目、会话历史和正常上下文材料；凭据文件不在范围内。主会话已读回新增入口的实际Dot最小联调结果，独立于此前fixture任务证明；具体覆盖范围见 [verification.md](verification.md)。

## 读取与任务分别运行

| 通道 | 默认地址 | 作用 |
| --- | --- | --- |
| 原生任务/管理网关 | `http://127.0.0.1:31472/rpc` | 四个正常项目任务工具，由当前 Harness owner renderer 执行 |
| 旧 fixture 宿主（可选兼容） | `http://127.0.0.1:31470/rpc` | 原五工具、独立无工具模型会话、显式公开材料 |
| Harness 持久化读取服务 | `http://127.0.0.1:31471/rpc` | 新六工具、已有落盘资料、无模型执行 |

共同使用原 owner-only 私有 Tunnel、私有 MCP 插件及独立 `DOT_DSH_TOKEN`。新增读取服务不启动、恢复、修复、取消或唤醒已有 Harness agent，不调用 `skills/list` 或实时提示词拼装。Dot 读到的历史不会自动进入31470任务模型；如 owner 明确交办分析，应另行明确交给任务工具的材料和任务文字。

会话结果是 `persisted_snapshot`：已落盘 source log 的用户/助手文本及审定元数据投影，不回放任意事件或工具原始载荷，也不是当前agent的实时内存或完整有效模型上下文。新写入且未落盘的数据可能尚不可见；返回的 `read_at`、`through_seq`、`live_memory_included:false`、继承事件信息及 `torn_tail_omitted` 应一并保留。尾部半写记录被省略不等于数据已修复；本服务不会写回迁移或修复。

## 私有本地配置

将下列 JSON 放在操作者自己的私有文件中；替换占位路径为实际 `realpath` 规范绝对路径。`dshHome` 指向已有 Harness 的数据根，不是31470独立任务宿主的 home。token 值只通过安全本地环境注入，配置中仅保存环境变量名称。

```json
{
  "enabled": true,
  "scope": "owner-harness-read-only",
  "dshHome": "/absolute/canonical/home/.dsh",
  "principal": "dot-owner",
  "tokenEnv": "DOT_DSH_TOKEN",
  "port": 31471,
  "extraWorkspaces": []
}
```

`extraWorkspaces` 默认空数组、最多100项，由可信本地操作者配置，不能由 Dot 工具参数临时追加。每项严格采用：

```json
{
  "workspaceId": "owner-context-unique-id",
  "path": "/absolute/canonical/path/to/context-directory",
  "title": "Owner context directory",
  "contextKind": "skill",
  "sessionIds": []
}
```

`contextKind` 仅允许 `skill`、`instructions`、`skill_catalog`；`path` 必须是真实规范目录，`workspaceId` 应唯一且不与已有项目冲突。目录存在及配置通过只证明路径已注册，不证明技能已启用或 Dot 已读到。

正常上下文根的配置方法：

- 已登记项目及可用的 Harness `memory`、`skills` 根通过 workspace 列表发现。不要把任意 home、profile、配置目录当作普通文件根。
- 共享技能默认在 `~/.agents/skills`；还可能有项目 `.dsh/skills`、`.agents/skills`、`customSkillDirs`、环境或显式配置的覆盖根。`DSH_AGENTS_HOME` 独立于 `DSH_HOME`。单个空目录不能证明所有技能为空。
- 技能目录的符号链接由操作者在本地预解析为规范真实目录，再以 `contextKind:"skill"` 单独注册。读取阶段不允许符号链接跳转，也不递归发现任意树中的技能；目录可见不代表 registry 最终可用技能数。
- 若需共享技能根的普通目录列表，可使用 `skill_catalog`；符号链接条目不会被动态跟随，目标仍需独立注册。
- 全局 instructions 最多允许两个根，以 `contextKind:"instructions"` 注册路径末尾为 `/.dsh` 或 `/.agents` 的规范根，helper仅列出和读取准确的 `AGENTS.md`，该根内其他文件一律拒绝。项目中的普通 `AGENTS.md`、`CLAUDE.md` 及local变体通过项目目录读取。

安全注入 token 后，读取服务只接受环境配置引用，不接受命令行参数：

```sh
DOT_DSH_HARNESS_CONFIG=/absolute/path/to/private-harness-read-config.json \
  node /absolute/path/to/dot-dsh-connector/scripts/harness-read.mjs
```

该命令不读取旧模型/微信凭据；端口占用会失败，不自动关闭其他服务或开放公网。固定 ready 输出的 `mode:existing_harness_persisted_read_only` 仅证明本机服务就绪。SIGINT/SIGTERM 仅关闭这个读取进程拥有的 listener 和 storage adapter。

## MCP 与私有 Tunnel 配置

给同一个 MCP stdio 进程安全传递：

```text
DOT_DSH_BRIDGE_URL=http://127.0.0.1:31472/rpc
DOT_DSH_HARNESS_BRIDGE_URL=http://127.0.0.1:31472/rpc
DOT_DSH_NATIVE_TASKS_URL=http://127.0.0.1:31472/rpc
DOT_DSH_FIXTURE_TASKS=disabled
DOT_DSH_TOKEN=<安全注入；不在命令、文档或聊天填写实际值>
```

启动命令仍为 `node /absolute/path/to/dot-dsh-connector/scripts/mcp.mjs`，无命令行参数。三个 URL 必须是规范数字 loopback `/rpc` 地址，不含凭据、query 或 fragment；配置非法时进程拒绝启动。推荐配置共 10 个工具，由管理网关将六个确切读取名字转到 31471；读取失败不回退任务。仅需读取时可省略 native URL，关闭 fixture 后为六个工具。旧兼容配置未关闭 fixture、只加 Harness URL 时仍为原五工具加六读取工具，共 11 个。

由现有 managed Tunnel 的安全启动配置传递这些环境引用，按官方支持方式刷新同一个私有插件的工具目录。不要假定环境自动继承。Tunnel、MCP、管理器及 31471 读取进程必须在线；原生任务还需当前 Harness Desktop/Host 与 renderer worker。仅旧 fixture 工具依赖 31470 宿主。身份仍是单人通道加固定本地 principal，不是多用户 OAuth；不得扩大插件/Tunnel 的使用者范围。

## 工具和分页

| 工具 | 参数与含义 |
| --- | --- |
| `harness_status` | `{}`；读取模式、可用范围等状态，不激活技能或 agent |
| `harness_list_workspaces` | 可选 `offset>=0`、`limit:1..100`；含项目及注册上下文目录 |
| `harness_list_sessions` | 可选 `workspace_id`、`query`、`offset`、`limit`；query 最多200字符，仅检索会话元数据，不是全文搜索 |
| `harness_read_session` | 必填 `session_id`，可选 `offset`、`limit`；省略offset或0读最新页，下一页必须使用回包 `next_offset` |
| `harness_list_directory` | 必填 `workspace_id`，可选相对 `path`、`offset`、`limit`；空path表示该根 |
| `harness_read_file` | 必填 `workspace_id`、非空相对 `path`，可选字节 `offset`、`max_bytes:1..32768` |

`harness_status` 中的 `mode:existing_harness_read_only` 仅描述本页的六个持久化读取工具。当前推荐连接还可暴露四个原生任务工具；其任务权限与执行结果需单独核对，不能将读取模式当作整个连接只读的证明。

workspace标识最多512字符，session标识最多256字符，path最多2000字符。所有工具拒绝额外字段，不接受任意 RPC、URL、headers、method 或调用者身份。路径不能是绝对路径或包含 `..`；workspace必须先从列表取得。

项目、会话列表及目录使用普通数组offset；文件offset是**脱敏后 UTF-8 文本的字节位置**，应原样续用 `next_offset`，不能按字符数计算。会话offset是**seq游标**：内部使用 `beforeSeq=offset-1`，不是项目列表offset，不能自己加limit。页内没有展示文本也不代表历史结束，应看 `has_more/next_offset`。

文件会先完整脱敏再切页，单个原文件上限4MiB；只读普通单链接UTF-8文件，不跟随符号链接或读取二进制。`sha256_redacted` 对应完整脱敏文本；`source_bytes` 与脱敏后的 `size` 可能不同。目录中的凭据名称会被省略，敏感名称或配置路径可能被保守拒绝。响应超限返回 `HARNESS_RESPONSE_LIMIT`，缩小limit或max_bytes再读；`HARNESS_DENIED` 表示该读取被拒绝，`HARNESS_UNAVAILABLE` 表示持久化读取服务不可用。脱敏是已知secret模式的尽力处理，不能证明任意自由文本绝无秘密。

## 实际 Dot 验证与证据

先确认推荐配置的 10 个工具（或仅只读配置的六个）发现，再让现有 Dot 调用 `harness_status`、列表和一次有界读取。所有外部读回均保持私人，不把历史正文、项目名、文件内容或账号信息复制进公共日志。公开结果只记录模式、成功/失败、分页和脱敏边界；具体证据保存在操作者私有位置。

本机ready、synthetic测试、Tunnel online、插件刷新和实际Dot tools/call是独立证明。本轮主会话已确认实际Dot的工作区/会话分页、已保存会话文本、instructions/skill/项目文件样本读取通过，且文件校验值匹配本机读回。分层证据已更新至 [verification.md](verification.md)；该样本闭环不意味着每个历史项目/文件均已读取或验收，也不代表重启后持续可用。
