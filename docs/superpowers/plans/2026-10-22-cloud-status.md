# Automatic cloud connection status implementation plan

**Goal:** Replace the fixed unverified label with fresh, independently observed official Tunnel health, while keeping local readiness and task outcomes separate.

**Architecture:** An owner-configured private official health URL file identifies this connector's Tunnel. A bounded loopback probe checks a fresh schema-1 snapshot, successful control-plane polling, accepting dispatcher and the initialized same-child connector MCP identity. It returns online/offline/unknown/not_configured plus recent cloud response delivery time. No new tool, cloud authorization, credential, audit migration or caller identity claim is required.

**Boundaries:** Admin/worker traffic cannot create cloud evidence. Old MCP interaction timestamps can coexist with a healthy idle connection. Missing/refused registered endpoints mean unavailable; timeout, malformed/stale snapshots and wrong MCP identity mean unknown. A failed/stale UI refresh cannot keep a current-online label. Connection health does not assert Dot identity, account authorization or task success.

1. Add `test/cloud-status.test.mjs`, observe failures, then implement `src/cloud-status.js`. Test private reference validation, real loopback health snapshots, idle periods, interruption, recovery, cache/concurrency, bounded IO, cancellation and clock anomalies with `node --test test/cloud-status.test.mjs`.
2. Add management/HTTP regression tests, observe failures, then wire the optional observer through `scripts/management.mjs` and `src/management.js` without changing protocol2's four strict features. Run cloud, management and host tests.
3. In parallel, update `management-plugin/src/client.js` and React tests for fresh online/offline/unknown states, shared header/settings copy and stale/error downgrade. Add optional managed `cloudHealthFile` plumbing and documented CLI configuration with focused regression tests.
4. Review and run the full suite, checks, build and archive verification. Freeze a new preview version only after fixes pass.
5. Read active task ownership before maintenance. Update only this connector's configuration/services and own native entry using the existing supported deployment path. Verify real Dot traffic advances official cloud interaction time; verify this connector's controlled disconnect/recovery without touching networking or other runtimes. Save native readback and update the verification ledger.
