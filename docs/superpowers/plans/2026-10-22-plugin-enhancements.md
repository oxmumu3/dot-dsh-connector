# Dot → Harness Plugin Enhancement Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the owned tasks below; independent file ownership permits parallel implementation. Root integrates and independently reviews each result.

**Goal:** Deliver the five enhancements the owner approved: integrated plugin setup, reliable connection state, findable/manageable tasks, actionable continuation/waiting states, and durable archive/lifecycle handling.

**Architecture:** Preserve existing private connection identity, Harness model/tool/approval settings and owned-session boundary. Extend the existing native plugin and manager; single installer entry prepares private local configuration and manages only its own processes. Keep older externally managed installations compatible. Account authentication remains an explicit user action through the platform's supported flow.

**Tech Stack:** Node ES modules, Zod, existing MCP SDK, native Harness Remote/React plugin, node:test.

## Task 1: Native task discovery, archive, and active continuation

Owner: native implementation agent. Files: `src/native-tasks.js`, `src/mcp.js`, native tool names in `src/bridge.js`, `management-plugin/src/native-worker.js`, relevant native tests.

- [x] Add `harness_list_tasks({offset?,limit?,workspace_id?,status?,request_id?,archived?})`, with stable pagination and owner filtering. The list returns summaries and enough session information for the native UI to open the exact owned session.
- [x] Add `harness_archive_task({job_id,archived?})`. Default true; terminal-only; unarchive supported. Preserve request deduplication across archive/restart. Remove the lifetime-100 failure through safe storage/retention changes, not by deleting active/unknown tasks or request identity.
- [x] Extend followup with explicit `mode` and preserve existing default behavior. Offer `after_complete`, `queue`, `steer` only when correct native message/turn association can be proven. In-flight additions must not incorrectly mark the original task completed or cancel an unrelated turn.
- [x] Surface waiting questions/approval metadata safely; never auto-approve. Include workspace names and last activity where official API supplies them.
- [x] Write failing behavior tests first for list/recovery, >100 completed task lifecycle, archive retry/dedup, restart compatibility, and active continuation message correlation; run focused native suites.

## Task 2: Plugin installation and lifecycle

Owner: installer implementation agent. Files: `index.js`, public package/patch metadata, `management-plugin/index.js`, new setup/runtime modules/scripts, installer tests. Do not edit management client UI or native worker.

- [x] Provide a single native-plugin entry instead of routing ordinary installation to the old fixture installer. Preserve fixture tooling as explicit compatibility path.
- [x] Prepare private state/config/tokens automatically, validate current profile/runtime, manage only owned reader/manager processes, and expose setup diagnostics through the plugin. Avoid per-user paths in distributable files.
- [x] Preserve external-managed `enabled:true,tokenFile` installs and their existing connection. New managed installations use their own private state; do not copy unrelated credentials or invent cloud auth APIs.
- [x] Include clear supported account connection instructions/status and a reproducible setup CLI fallback. No claim of cloud linkage until actual platform connection verification.
- [x] Implement idempotent prepare/start/stop/status, compatible updates and explicit cleanup preserving records by default. Never terminate a foreign PID or reuse an unverified service.
- [x] Test fresh temp-profile setup, repeat setup, lifecycle ownership, busy ports, invalid dependencies, teardown and packaged entry.

## Task 3: User-facing connection and tasks

Owner: UI implementation agent. Files: `management-plugin/src/client.js`, `management-plugin/src/remote.js`, UI tests only. Root handles gateway methods; installer agent owns Host adapter/setup.

- [x] Separate overview/list errors; retain last successful state with timestamp and stale label. Add bounded automatic refresh and avoid overlapping own requests. Preserve selected detail during refresh.
- [x] Use project/task names, meaningful waiting/active/finished labels, actionable error copy, first-use copyable task example, and direct native session navigation via verified SDK API.
- [x] Add list filters/search, archive/unarchive, continuation controls and visible waiting details from new native fields. Do not guess API signatures; negotiate with core owner.
- [x] Expose setup/local readiness clearly without interpreting local online as actual cloud connection. Show pause behavior explicitly.
- [x] Write regression tests for partial failure, refresh selection, pending state, native navigation and archive action; use existing shared UI test machinery.

## Task 4: Management reliability and integration

Owner: root. Files: `src/management.js`, manager bridge/server mapping as needed, `test/management*.test.mjs`, final docs/build/version/package artifacts.

- [x] Reproduce three overlapping overview/jobs/worker requests in test; replace the shared two-request rejection with bounded queueing/deduplicated reads and a distinct busy error. Keep authorization checks before queueing; close must release pending work.
- [x] Base execution readiness on recent worker activity, expose capabilities to Dot, preserve paused access to status/task lookup/cancel.
- [x] Add manager archive/followup/setup contracts after child implementations establish exact fields; use separate worker control polling if useful and backward compatible.
- [x] Run full suite/check/demo/build once integration is ready. Independently review spec then correctness/security. Fix identified regressions and rerun affected tests.
- [x] Package one clear user-facing plugin entry, smoke install in isolated environment, scan for private paths/credentials and correct owner identity. Update README/runbook with complete copy-ready installation instructions.
- [ ] Before live activation, inspect active tasks and exact process/plugin ownership. Activate only own components using supported mechanisms; no original Host restart/global reconcile. Verify native UI and real Dot read/task chain where platform access permits. Preserve old connection until updated path works.

## Completion evidence

Tests, source changes, built artifacts, installed runtime, native UI and actual Dot calls are separate states. Record each verified level, any platform prerequisite and remaining blocker. Do not represent local QA as installed/cloud acceptance. No public release is authorized by this change alone.

## Live activation preflight (2026-10-22)

The installed SDK has no verified scoped Host reload entry. Default file watching uses an empty root list; same-bundle CLI updates skip Host reconciliation, while plugin enable/install reload triggers profile-wide module comparison. Current owned jobs are terminal, but global live Harness idleness was not established. Therefore the candidate is built in the isolated worktree; original Host, installed package, parent checkout and running connection services are preserved. Native activation and actual Dot validation of the new features require a confirmed maintenance window.
