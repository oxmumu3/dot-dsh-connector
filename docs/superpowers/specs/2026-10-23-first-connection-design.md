# 2026-10-23 Ego routing amendment — preview.5 candidate

The owner explicitly requires Ego for all browser work. This supersedes the isolated-Chromium choice below. The current candidate uses a bounded Ego v2 CLI provider, one persisted TaskSpace, the existing official-page state machine and real manager verification. It must never silently fall back to Chrome. The installer currently requires Ego to be installed; automatically provisioning Ego and signed-out Google login are not accepted capabilities. Existing Ego login reuse is tracked separately from fresh-account login.

Human takeover pauses browser work. Explicit Continue resumes the same delegated space. Existing user pages and drafts remain intact. No raw page output, account credential, cookie or secret crosses the CLI receipt boundary; only a newly created restricted key may be saved directly to the exact private runtime.key. Remote Tunnel/plugin IDs require observed matching official-page evidence; verification requires actual Dot and Harness receipts.

The historical design below records the earlier choice and its proof boundary.

# Personal Dot onboarding and workspace redesign — 2026-10-23

User authorization: implement first connection inside the existing native plugin; automate feasible setup and leave only official account login/authorization to the user. Later steering explicitly extends the whole product UI, grounded in the supplied family-assistant reference. Preserve the existing owner connection, tasks, profiles, approvals, sibling plugins and network. This is authorized implementation; no further style or routine implementation approval is needed.

## Outcome and selected approach

One “连接我的 Dot” entry in the native workspace prepares local services, obtains an isolated browser component and official Tunnel binary, opens official account pages, fills setup, waits for the user to log in and confirm grants, supervises the owned runtime, creates a personal private ChatGPT connection and verifies a real Dot read and native self-test task. Never substitute a green local health check for actual Dot success.

Alternatives examined: a native OAuth/device-code bootstrap does not exist for Tunnel v0.0.16; its OAuth help concerns upstream MCP only. Codex assistant requires a separate Codex install and is not a standalone Tunnel authorization UI. Ego is used for agent browser work, but requiring its separate first-run onboarding for every new user defeats the stated experience. Product implementation therefore uses a privately managed Chromium component through pinned official Playwright, without opening or copying daily Chrome profiles. The wizard is visible DOM automation of official pages, not browser-cookie/token extraction or private endpoint calls.

## Browser contract (root-owned implementation)

`createOnboardingBrowser({directory, runtimeKeyFile, tunnelName, pluginName, installationId, launch?, install?})` returns:
- `prepare({signal,onProgress})`: acquire isolated browser, launch headed persistent context inside own0700 profile.
- `provision({signal,onProgress})`: open Platform and ChatGPT; wait for official login and explicit user grant; autofill a uniquely named Tunnel associated with user-confirmed organization/workspace; let user confirm Create; prepare the restricted API-key form and let the user confirm creation. Store only that just-created key to runtimeKeyFile0600. Return `{tunnel_id,organization_id?,workspace_id?,tunnel_name}`. No literal credential, browser body or arbitrary URL enters state or logs.
- `connectPlugin({tunnel_id,signal,onProgress})`: fill the official Add custom MCP dialog (Tunnel, matching ID, None auth) and wait for the user to approve creation/connection. Return safe `{plugin_id?,plugin_name,connected:true}` only after actual UI evidence.
- `verifyDot({requestId,signal,onProgress})`: send one visible bounded self-test prompt on the user's actual Dot page, explicitly selecting this personal plugin. It lists one workspace and creates an owned task that only replies a self-test marker (no file reads/writes/commands/network). Stable requestId correlates manager job. Return `{sent:true}`; this does not itself establish completion.
- `focus()`, `close()`: only owned browser context; close never deletes credentials, records, remote resources, or foreign profiles.
`onProgress` accepts sanitized `{phase,step,message,waiting_for?}`; phases are `installing|login|authorize|connecting|verifying`. No navigation/secret/debug values are accepted from the renderer.

Login, CAPTCHA, terms and consequential grants are human operations. The wizard may prepare fields but never checks consent or presses the consequential confirmation on the user's behalf. It resumes by observing official DOM evidence; no artificial “I logged in” check is trusted. Unknown page shapes fail closed with a useful message. UI retries reuse stored resource IDs and unique names, never blindly re-create resources. Network interception, cookie enumeration, local credential scraping and private API calls are excluded.

## Host contract (core agent)

Files: onboarding-store.js (private atomic metadata/lock), onboarding-tunnel.js (official verified binary download/argv/owned lifecycle), onboarding-runtime.js (serial asynchronous state machine), setup-runtime.js/index.js integration. Browser contract above is injected; dynamic default import may load it only on user start.

Owner-only setup RPCs: `manager_setup_connect_status`, `manager_setup_connect_start`, `manager_setup_connect_resume`, `manager_setup_connect_cancel`, `manager_setup_connect_open`. Their method names are setupConnectStatus/Start/Resume/Cancel/Open and empty strict input objects. They are never exposed as MCP tools. Existing setup status adds a `connection_setup` safe view if managed; external mode has `{phase:'external',actions:{start:false,...},message:'保留已有连接'}` and no account mutation.

`createOnboardingRuntime({local, browserFactory, tunnelFactory, store?, now?, verify?, directory?})` exposes status/start/resume/cancel/open/close and returns immediately from mutating UI calls while one owned background workflow runs. The local provider is the current createManagedRuntime plus a trusted MCP command/runtime directory reference, a `setCloudHealthFile` operation legal within same owned generation, and own admin reference. Do not modify new cloudHealthFile by stopping an unknown instance.

Safe view: `{phase,step,message,waiting_for?,actions:{start,resume,cancel,open},verification:{tunnel_online,chatgpt_connected,dot_read,task_complete},error?:{code,message}}`; phases `idle|preparing|installing|login|authorize|connecting|verifying|ready|cancelled|blocked|external`. Initial completion requires fresh health and a matching newly completed request. Normal restart retains the dated historical verification receipt and restores current transport only; saved receipt fields never imply a new test ran. Explicit re-verification starts a new attempt. Persist names/IDs/references; never raw secrets or browser output. Key values live in0600 files and never cross native RPC.

Download official Tunnel v0.0.16 only from verified release URLs with pinned archive SHA and size, bounded HTTPS redirects/download, symlink/path/member rejection, atomic extraction and license preservation. arm64: a160820d45089b5253d8d671fe2a689bde0f73d78c135d1497a7b33f28a3ac62,27041422bytes. amd64:57b3dd73f2d042c7aeb5664681f7538078359f55538b9e048640f1df71a0c83f,28886485bytes. Use existing provisioned tunnel + runtime key; no Admin key needed. Names/alias/profile are installation-unique. Execute argv arrays with a restricted environment and no shell. Runtime key passed only via file reference. Poll actual ready/healthy health file; register it with own manager. UI abort/HMR closes only acquired browser/owned runtime resources; preserve restart intent and existing remote resource IDs. An ambiguous lock or foreign alias is never adopted.

Verification checks own manager events after attempt start (successful harness_list_workspaces) and matching harness job requestId. Require succeeded/completed self-test and fresh official cloud health before ready; accepted/running/idle never complete. Existing external deployment is not silently migrated; it remains fully usable.

## Visual brief and screen architecture (UI agent)

Direction: precise task orchestration, designed for Dot→Harness itself. User corrected the screenshot's role: it demonstrates quality, not a visual direction to copy. Canvas mist-white/white; graphite ink and a restrained solid signal-blue action; system sans hierarchy focused on task titles/status. Fine separators, a deliberate grid and purposeful whitespace replace giant metrics/card walls. No family-assistant greens/serif styling, blue-purple gradients, decorative glow, emoji or simulated host sidebar. Plugin gets one host sidebar entry; tabs/navigation stay inside its workspace.

Fresh native capture `[local private evidence omitted]` confirms current shortcomings: large blank header, three oversized equal-weight metric cards, technical status outweighing work and weak primary action. User-provided reference demonstrates that polished interfaces are possible; its subject matter and styling are explicitly not the visual target. This is a design reference, not evidence the other prototype's backend exists.

New first-use surface: “把任务交给 Harness。” plus plain benefit, three-step progress (本机准备/登录与授权/验证连接), one “连接我的 Dot” button; wait states say exactly what the browser needs and expose reopen/resume/cancel. When connected, overview shows work/recent tasks, small truthful status capsule, restrained next-step/example panel and recent activity secondary. Preserve actual tabs/filters/details/archive/followup/session navigation/pause semantics. No fake native task composer when no native-start RPC exists. Technical diagnostics live in expandable details. External compatible installs retain existing controls and cannot trigger replacement setup. Responsive 390px, keyboard focus, semantic labels, reduced motion, light/dark host themes.

## Proof states and delivery

Use TDD for meaningful workflow/security behavior. Local fixtures exercise official-like DOM login/approval/page changes and real Chromium without account secrets, and exact argv/server simulations exercise lifecycle. UI tests exercise full wizard states and preserve existing task flows. Full suite/check/demo/build/package scan and independent challenge review precede installation. New source version0.6.0-preview.1. No public URL/repository invented; author remains 牛村木木山 / oxmumu3. Real account grants happen only after the native feature is concrete and reviewable, with the human completing approval; if an official page blocks automation, report that actual checkpoint rather than pretending universal login-only success.
