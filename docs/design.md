# Dot → DSH Connector design

Historical read/fixture design: 2026-10-19, version0.2.0-preview.1. Current local native-task preview:0.4.0-preview.1; see the next section. Independent from DSH's own Dot/WeChat companion. The owner has authorized the existing private integration plus broad read-only access to ordinary existing Harness content, with credential files excluded.

## Current native execution path (local live and actual Dot verified)

The current task path uses the existing owner-authenticated Harness renderer and its official workspace/session Remote APIs. A durable v2 ledger preassigns session/request identities, offers one-time claims through the existing management overview, and accepts capability-authenticated reports on fixed loopback31474. The renderer resolves only registered real workspaces, creates connector-owned sessions, and submits normal tasks with the existing model, tools and approval policy. No extra model key, cookie access or original Host restart is required for this path.

Native create/prompt/inspect/cancel commands are separate durable operations. Unknown mutations are never blindly replayed; prompts use the Host's stable requestId deduplication. Exact user/message + turn + valid assistant text + completed turn/end establish success. The official cancel API is session-scoped without an atomic expected-turn condition; detected manual takeover is denied, and already executed side effects are not undone. Local live create/tool execution/follow-up/cancel and actual Dot create/get/follow-up/cancel have passed; user content acceptance is separate. Setup: [native-execution-usage.md](native-execution-usage.md).

The remaining sections describe the retained legacy fixture and persisted-read architecture; their isolated-host/public-only restrictions do not constrain the new normal workspace path.

## Choice and boundary

Use official MCP over stdio, suitable for Secure MCP Tunnel, forwarding to a bearer-authenticated loopback DSH plugin. A direct public HTTP service would add inbound exposure; a Codex registry modification has no verified supported extension point. Neither is needed.

The retained fixture task surface exposes list_projects, read_project_context, start_task, get_task, cancel_task. Start returns a persisted job ID immediately. That model surface still has no full-history discovery, automatic jobs, WeChat identity, shell, filesystem writes, external tools, or native Codex executor claims.

Local operator config grants named principals access to an explicit public-project list. The private stdio process binds one configured principal; arguments never carry identity. This is a single-owner channel binding, not verified Dot/OpenAI user identity or multi-user OAuth. Tunnel/workspace access must be scoped to that owner before enabling it.

Only explicit project context files are read, with realpath checks and byte caps. A fresh connector-owned DSH session receives the bounded context snapshot and task. The model has no tools. The connector never resumes a user's existing conversation. The approved isolated host model route is selected through public services; credentials are never copied. The ordinary live host is blocked: AgentLoop assembles factory-level prompt providers before per-agent filters, so no per-agent sanitization can prove no unrelated context reads. A trusted operator must create a separate clean profile with explicit DSH_HOME and no private providers; configuration attests that precondition rather than creating a sandbox.

## Evidence and lifecycle

The optional existing-Harness surface adds six exact-name harness_* read tools. A separate31471 service reads persisted projects/sessions and scoped ordinary files/context directories. Its trusted operator configuration can register canonical skill/instructions roots; Dot cannot supply arbitrary roots or RPC methods. Existing agents are not activated, and private history is not automatically sent to the fixture model. Persisted source logs and current live effective model context remain distinct. See [harness-read-design.md](harness-read-design.md) and [harness-read-usage.md](harness-read-usage.md). The owner-only private Tunnel/principal binding applies to both surfaces.

request_id deduplication is scoped to principal; changed content under the same ID conflicts. Persist before dispatch; never replay uncertain work after restart. Correlate sessionId + user messageId + claimed turn. Only completed turn with correlated assistant text is a result; idle and followup acceptance are not success. Foreign/mixed input fails closed. Cancellation is cancel_requested until a terminal event. Offline bridge gives an explicit offline error.

## Verification

Test authorization, traversal/symlink rejection, output caps, idempotency, restart uncertainty, terminal correlation, failure/cancel/mixed turns. Run a real MCP SDK client against the stdio entrypoint and a synthetic plugin host; label synthetic DSH/model separately. Build and dry-run package. Host installation, real model task, tunnel discovery, actual Dot call and user acceptance remain separate checkpoints.
