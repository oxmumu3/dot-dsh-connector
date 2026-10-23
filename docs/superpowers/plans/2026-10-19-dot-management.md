# Dot 接入管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Deliver an owner-only DSH native panel for the existing Dot connector, with durable metadata audit, owned task detail and admission/cancellation controls.

**Architecture:** Existing task/read services remain unchanged. A new gateway records and forwards their11 tools. A separate-token admin bridge exposes a fixed six-method management API to an RPC-only native plugin and its UI.

**Tech Stack:** Node ESM, zod, native HTTP, descriptor-safe private JSON state, public DSH RPC/sidebar/main extensions and the host client framework.

## Task1: Durable management state (agent-owned)
Files: src/audit-store.js, test/audit-store.test.mjs.
- [x] Write and run failing behavior tests for createAuditStore, restart unknown, durable pause, private files, retention and redaction.
- [x] Implement `createAuditStore({directory,principal})` returning `begin({tool,selectors,category,request_id?,job_id?})`, `finish(id,{outcome,error_code?,summary?,job?})`, `setPaused(boolean)`, `overview()`, `listEvents(filters)`, `listJobs(filters)`, `job(id)`, `importJobs(rows)`, `close()`.
- [x] Persist before dispatch; copy all public results; bounded fixed schemas; no raw read bodies. Outcomes: pending/succeeded/failed/unknown/denied. Jobs keep the existing public job fields plus optional redacted task/request_id.
- [x] Verify concurrency/lock/restart and inspect no-follow safety; freeze files for root integration.
Example test: `const id=await store.begin({tool:'harness_read_file',category:'read',selectors:{workspace_id:'w',path:'README.md'}}); await store.finish(id,{outcome:'succeeded',summary:{source_bytes:12}}); assert.equal(store.listEvents({limit:1}).items[0].summary.source_bytes,12)`.

## Task2: Native panel and wrapper (agent-owned)
Files: management entry/server/client, panel styles, build helper and focused tests only; coordinate package exports/build metadata with root.
- [x] Verify public RPC handler/query and native sidebar/main registration in installed public SDK, without reading profiles or loading original host.
- [x] Write failing wrapper/mapping tests for exact six manager tools and token confidentiality.
- [x] Implement RPC-only server proxy with canonical admin endpoint and private token-file loading, effect-owned teardown, disabled inert default.
- [x] Build the native client panel using host-provided framework imports; fixed manager contract from spec. Component accepts a synthetic adapter for browser QA without a credential or live host.
- [x] Cover filters, pagination, empty/error/detail and pause/cancel state; freeze and provide exact manifest/build requirements.

## Task3: Gateway/admin integration (root-owned)
Files: src/management.js, scripts/management.mjs, src/bridge.js, scripts/mcp.mjs and management tests.
- [x] Write failing admission/audit/routing/admin-separation tests; use synthetic existing backends only.
- [x] Add closed-scope admin tool allowlist to createBridge; default existing bridge remains exactly11 tools.
- [x] Implement fixed backend forwarding with time/byte limits, no redirects or arbitrary endpoints. Start event precedes forwarding; response projection includes only counts/hash/provenance. Import exact owned task snapshot read-only; cancel unknown jobs denied before backend call.
- [x] Export `launchManagement({config,channelToken,adminToken,...})` with independent gateway/admin ports and orderly owned shutdown. MCP opt-in routes both existing tool groups through gateway; no fallback when configured.
- [x] Verify pause leaves existing get/cancel working and does not stop original hosts; admin credentials cannot be used on channel and vice versa.
Example test: pause through admin; `harness_status` is denied and backend call count unchanged; existing `get_task` still forwards. An event contains no synthetic body/key passed by a read response.

## Task4: Integration, review and delivery
- [x] Root spec review then independent security/code review; repair concrete gaps before deployment.
- [x] Full existing+new tests, check/demo and native client build. Inspect original baseline failures separately.
- [x] Preview actual component using synthetic data, browser behavior and visual QA; keep all preview evidence separate from native host proof.
- [x] Produce0.3.0-preview.1 archive, scan membership and owned secret values, unpacked install/check/demo smoke.
- [x] Inspect original host HMR without disturbance, use official package install only when its effects are verified safe. Never restart original host while user work may be active.
- [x] Start only new owned manager, restart only own MCP runtime with gateway URLs; actual Dot read must add an audit event. Verify authenticated pause/resume and owned job readback.
- [ ] Native DSH sidebar/page readback or precise install blocker; no false completion claim. Refresh project checkpoint and commit source on isolated branch, then integrate safely.
