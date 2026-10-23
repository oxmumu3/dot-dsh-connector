# Native host audit

This is the historical isolated fixture-host audit. Its public-only profile and separate model-key requirements apply to that compatibility path. The current0.4.0-preview.1 normal workspace implementation uses the existing Harness owner Remote and current model/tools/approvals; see [native-execution-usage.md](native-execution-usage.md). New native-task acceptance remains separate from the evidence below.

Date: 2026-10-19. SDK: public installed DeepSeek Harness `0.2.1-rc.2` npm distribution. Scope: static public-code audit and a separate temporary synthetic driver test. No existing Desktop/companion/WeChat/Lab process, configuration, session, credential, browser, or network setting was used or changed.

## Result

The connector now has a passing test through the **actual official AgentLoop**, not a synthetic replacement factory. The provider response remains deterministic synthetic data. This closes the local driver/API compatibility gap; it does not prove a real provider account, installed profile, Tunnel, ChatGPT plugin discovery, Dot invocation, or user acceptance.

`test/native-loop.test.mjs` mounts real Cordis, Llm, Sessions, SessionProjections, SystemPrompt, Tools, Agents, and AgentLoop in a new Context. It registers one local `LlmAdapter`, starts the production connector executor, observes the exact claimed message, assistant reply, and completed turn, checks the output cap and absent tool schemas, then disposes only its owned session. `fetch` is trapped and the observed network call count is zero. It does not mount credentials, accounts, filesystem tools, private memory providers, or persistence backends.

Public SDK packages are resolved from `DSH_TEST_NATIVE_SDK_ROOT` when supplied. Otherwise the test copies only public npm packages and their nonoptional dependency closure from the installed application's ASAR into a newly created temporary directory, deletes that directory afterward, and never extracts app configuration/user data. An unavailable public runtime produces an explicit skip, not a pass. The older compatibility fixture lacks AgentLoop and SessionProjections, so it cannot by itself run this test.

Fresh command: `node --max-old-space-size=128 --test test/native-loop.test.mjs` — **1 passed, 0 failed, 0 skipped**. The first run reached completed but rejected the assertion that an empty tool list must be `[]`; the SDK canonically omits that optional field. The repaired assertion accepts only absent or empty tools.

## Supported launcher and profile format

These are supported forms from the public `@deepseek-ai/dsh` README and parser, not commands executed during this audit:

- `dsh --profile NAME` / `dsh NAME`: boot `$DSH_HOME/profiles/NAME`.
- `dsh --profile NAME --dump-config`: compose and print the tree without booting plugin services. Profile initialization/normalization can still write inside the selected home; it is not a zero-write command.
- `dsh --profile NAME --dump-default-config`: print bundle layers without user overlays.
- `dsh --profile NAME --patch /absolute/overlay.yml`: apply an invocation overlay after bundle/profile/home layers.
- `dsh plugin --profile NAME add /absolute/plugin.tgz`: forward the package operation to the profile's pnpm environment. This is an installation/configuration mutation.
- `dsh --profile web --port PORT`: launch the shipped Web profile; `--no-open` suppresses automatic browser opening.
- `--from-default-profile TEMPLATE` **replaces the target custom profile and then boots it**. It is not a harmless initialization-only switch.

`desktop` is reserved for Electron; it is not the custom-profile launch target. The current shell's `dsh` resolves to an older Lab launcher and must not be used for this integration. The installed application's public CLI wrapper is:

```text
/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh
```

That shell wrapper invokes the packaged executable with `ELECTRON_RUN_AS_NODE=1` and the public `dsh-desktop-host/lib/cli.js`, which delegates to the ordinary `runCli`. It is a new CLI process, not a command to restart or operate the existing Desktop UI. This audit read the wrapper and implementation; it did not run them.

A custom profile's supported `package.json` shape is:

```json
{
  "name": "dsh-profile-dot-dsh-snapshot",
  "private": true,
  "dependencies": {},
  "dsh": { "profile": { "bundles": [] } }
}
```

The profile also has its own `cordis.patch.yml`. Bundles compose over an empty root, followed by the profile patch, the selected home's patch, and invocation patches. Empty bundles plus a profile patch containing the explicit kernel are supported by the loader. The connector can be installed as a dependency and included as a bundle; its current bundle only adds the connector row and does not supply a full DSH kernel.

For a new non-shipped profile, `dsh plugin` initialization defaults to `dsh-base`. Review/edit that fresh profile's manifest before the first boot; do not mistake package installation for a private-context-free runtime. The source-confirmed shape above can instead be prepared explicitly in the new isolated home. Neither preparation nor a real CLI boot was performed by this subtask.

## Narrow composition required

Neither `web` nor the shipped `sdk-minimal` is the narrowly scoped host by default:

- `web` layers over `dsh-base`. Base mounts credentials-local, account, prompt, and numerous other producers. The base credential comment explicitly includes managed credentials, environment, project `.env`, and user `.env` fallbacks.
- `sdk-minimal` is independent of base, but still includes local filesystem, sandbox, terminals, persistent shell, compaction, and SDK server rows. Its name alone does not establish the connector's required boundary.

The tested kernel is exactly:

```text
@deepseek-ai/dsh-system-prompt
@deepseek-ai/dsh-llm
@deepseek-ai/dsh-session
@deepseek-ai/dsh-session-projection
@deepseek-ai/dsh-tools           mode: native
@deepseek-ai/dsh-agent
@deepseek-ai/dsh-agent-loop      agents: []
agentDefaultModel provider/model service
dot-dsh-connector
one explicitly selected provider adapter
```

No UI or general-purpose tool plugins are needed for the connector's loopback service. A real profile should use the public `@deepseek-ai/dsh-agent-default-model` service with explicit provider/model configuration. SystemPrompt should be constant, with `includeHarnessIdentity:false` and `includeRuntimeContext:false`; all unrelated context producers must be absent. A per-agent final assembly filter cannot prevent a previously mounted global provider callback from reading data.

The connector still requires canonical matching `DSH_HOME`/`isolatedHostHome`, a state child directory, and the trusted local `publicOnlyHost:true` attestation. These do not programmatically sandbox a shared host. A separate home and explicitly narrow plugin tree must exist before opting in. `DSH_AGENTS_HOME` is a separate public environment setting for shared agent configuration; the narrow tree avoids agent-instruction/skill consumers altogether rather than relying on the default user's shared root.

## Real model setup requirement

The provider route must have a registered adapter, and `agentDefaultModel.currentSelection()` must provide a nonempty provider and exact model id. Creating an AgentRegistry or choosing a model name does not configure authentication.

The public API-key adapter `@deepseek-ai/dsh-llm-deepseek-api-key` registers the route `deepseek-official`; its `apiKeyEnv` option defaults to `DEEPSEEK_API_KEY`. Without a credentials service it resolves that specific reference from the launch environment. With a credentials service it consults that service instead. Therefore an isolated host can use a newly supplied key via its explicitly named environment reference without mounting `dsh-credentials-local` or copying old account/session files. No key was requested, read, copied, printed, or validated in this audit. The exact model id must come from that provider/account's current supported models; this document does not invent one or claim availability.

Web UI setup is a supported general product route but brings the broader Web/base composition. Do not start it under the connector attestation merely to obtain a model setting. Select either a separately reviewed broader setup with its actual boundaries or a narrow explicit adapter/default-model configuration.

## Exact public source evidence

Archive source root: `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar!/dsh/node_modules/@deepseek-ai/`.

| Source | Evidence |
| --- | --- |
| `dsh/README.md:5–20,35–48` | Sole supported CLI, profiles, package-management mode, defaults, layering and dumps |
| `dsh/lib/bin.js:104–121` | Parsed launcher flags and plugin-mode forwarding |
| `dsh-app-boot/lib/index.js:551–570` | Shipped profiles; non-shipped package initialization defaults to base |
| `dsh-app-boot/lib/index.js:611–626` | Manifest, profile patch and pnpm workspace creation shapes |
| `dsh-app-boot/lib/index.js:1015–1074` | Empty bundle list allowed; profile patch loading and custom profile discovery |
| `dsh-sdk-minimal/cordis.patch.yml` | Independent composition still contains FS, sandbox and persistent shell rows |
| `dsh-base/cordis.patch.yml` | Broad base tree, default model, credential sources and account providers |
| `dsh-agent-loop/README.md:28–75` | Driver mount, programmatic create, actual streamed turn behavior |
| `dsh-agent-loop/lib/index.js:1544–1550` | Hard injections: agents, sessions, llm, tools, systemPrompt, sessionProjections |
| `dsh-agent-default-model/lib/index.js:21–43` | Explicit provider/model config and currentSelection |
| `dsh-llm/lib/index.js:1664–1753,1842–1854` | Public LlmAdapter/prepareCall/registerAdapter API used by deterministic test |
| `dsh-llm-deepseek-api-key/lib/index.js:36–58` | `deepseek-official`, credential-service branch and exact environment-reference fallback |
| `dsh-desktop-host/lib/cli.js:86–104` | Installed public CLI delegates to ordinary runCli with its bundled package manager |
| `dsh-home-paths/lib/index.js:10–21` | Separate DSH_HOME and DSH_AGENTS_HOME controls |

## Remaining checkpoints

At the initial native-driver audit checkpoint, dedicated host activation, a securely configured real model, real connector HTTP deployment, Tunnel runtime/discovery, actual Dot tools/call, cancellation through that same external path, and user acceptance remained separate follow-up checkpoints. The successful local native driver test must not be reported as any of these. Later main-thread integration states are recorded in the central verification ledger.

## Standalone narrow launcher

`scripts/isolated-host.mjs` now supplies a reviewable alternative to a CLI/Web profile. It directly composes the public kernel and the existing production core/store/bridge/executor in its own Node process. It does not boot any DSH profile, load a profile/home patch, mount credentials-local, look up an old account, register general-purpose tools, or load shared instructions/skills. `src/` was not changed for this launcher.

Modes:

| Mode | Behavior |
| --- | --- |
| default `dry` | Validate explicit single-owner/public configuration and canonical isolated home; print the planned module list. No SDK imports, model-key read, state directory, or listener. This does not validate account/model availability. |
| `synthetic` | Start the actual kernel and connector bridge with a local deterministic adapter. Replies are explicitly labelled SYNTHETIC. |
| `real` | Register the official API-key adapter for `deepseek-official`, using the exact requested model and a dedicated new `DOT_DSH_MODEL_*` environment reference. No task/model request runs until an explicit start_task call. |

Real mode has no model default. The current main-thread first-party check selected `deepseek-flash`; an invocation example is:

```sh
node /absolute/path/to/dot-dsh-connector/scripts/isolated-host.mjs \
  --config /absolute/path/to/private-enabled-config.json \
  --mode real \
  --api-key-env DOT_DSH_MODEL_NEW_KEY \
  --model deepseek-flash
```

Before that command, a trusted launcher must safely inject canonical `DSH_HOME`, the configured independent bridge-token environment reference, and the newly issued model-key reference. The command contains references only. Never put key/token values in command arguments, configuration literals, chat, or startup summaries. The main thread uses a restricted child environment containing only PATH, DSH_HOME, DOT_DSH_TOKEN and DOT_DSH_MODEL_NEW_KEY; the script does not require inherited account credentials.

The official adapter endpoint is explicitly fixed to `https://api.deepseek.com/anthropic`, the Messages-compatible public endpoint in this SDK. There is no custom endpoint option, so inherited `DEEPSEEK_BASE_URL` cannot redirect the request. The module exports `apply/inject/Config` rather than a default export; the launcher passes its module namespace to Cordis. That public option/export contract was tested without mounting a real adapter or resolving a real key.

An explicit official `createLaunchEnvironmentSnapshot` is provided **before** adapter activation. It contains only `{[apiKeyEnv]: newly supplied key}` in real mode and an empty map in synthetic mode. This prevents the adapter helper's fallback from copying all of `process.env`. No managed/project/user credential source is mounted. The only model-key value read by launcher code is the explicitly selected new reference.

The adapter route and fixed endpoint do not bypass the executor's existing limits: 4096 output tokens/request, one admitted model step and 120-second cancellation remain in force. SIGINT/SIGTERM and failed/aborted setup clean up only this process's bridge, core, exact owned handles, state lock, Context and temporary public SDK copy. No existing DSH/Desktop/companion/Lab process is stopped. The launcher's own structured output contains ready/dry metadata, and top-level startup failures expose fixed codes. SDK components may emit additional diagnostics, so a real deployment must capture stdout/stderr in a private 0600 log and expose only the ready metadata and existing core's fixed error codes to the external caller.

`--sdk-root /explicit/verified/public/runtime` can replace ASAR extraction. The launcher checks the selected public packages' exact versions before importing them. Default ASAR extraction is temporary and reads public package distribution files only; it does not copy an application profile or credential file.

Launcher verification uses `test/isolated-host.test.mjs`: dry/no-write behavior; rejection of unsafe scope and non-dedicated credential references; abort rollback; public adapter option shape and narrow environment snapshot; a full synthetic production core/bridge/store/executor/actual-AgentLoop cycle; idempotent cleanup and preserved job state after a fresh synthetic restart. This subtask has not started real mode or read the main thread's new key/private logs. Any subsequent real model/Tunnel/Dot evidence belongs in the main verification ledger.
