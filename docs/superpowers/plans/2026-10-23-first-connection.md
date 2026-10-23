# First connection and workspace upgrade implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement independent tasks and review integration.

**Goal:** Make first-time personal Dot connection a guided native workflow and replace the crude management layout with a usable, polished workspace.

**Architecture:** Existing owner-only setup Remote supervises private browser/store/Tunnel adapters. Browser automation fills official UI and pauses for real login/approvals; bounded fresh runtime/job evidence governs completion. Existing external deployment stays separate.

**Tech Stack:** Node22, Zod, React host factory, pinned Playwright-core1.64.1/Chromium isolated profile, official Tunnel0.0.16.

## Tasks

- [ ] Core agent: write failing onboarding store/tunnel/runtime tests (ownership, coalescing, cancellation, secrets, downloaded integrity, fresh verification); run node --test --test-concurrency=1 test/onboarding-*.test.mjs and see new missing behavior fail; implement the small private modules and setup/index integration from the exact spec contracts; run new tests plus setup-runtime/native-host regressions. Do not touch client.js/remote.js or browser module.
- [ ] UI agent: write failing full React tests for owner RPC wizard states; add empty strict connect descriptors and redesign client.js around the task orchestration visual direction with all current actions preserved; update the synthetic preview only with clearly labeled synthetic data; run node --test --test-concurrency=1 test/management-ui.test.mjs and affected frontend/remote tests. Do not change index.js/setup-runtime/browser.
- [ ] Browser agent: write failing browser tests using explicit supported DOM fixtures; implement isolated browser download/launch and deterministic official page automation with no cookie/private API access, no automated consent, private secret write and cleanup; install pinned dependency via npm and update license/build checks. Verify fixtures, install failure and changed-page fail-closed behavior.
- [ ] Integrate and review exact contracts; run focused new tests, then full npm test, npm run check, npm run demo, npm run build:plugin sequentially. Inspect generated assets and extracted package. Review source and security independently; repair with new failure tests.
- [ ] Render the actual shared React component in the synthetic preview; use original EgoSpace110 for screenshot/interaction checks at desktop/light/dark/narrow and meaningful wizard states. Compare against the plugin-specific DESIGN.md direction; repair layout and regressions.
- [ ] Save native before/after proof. Install own candidate only after source/package checks; preserve all non-own plugin files/settings, account connections and jobs. Respect current unrelated Harness work; do not restart it while other tasks are active.
- [ ] Prepare real first-login/authorization flow only once feature is concrete; user handles actual official approvals, never hidden grant. Verify with actual Dot and independent manager/job readback; only then call full new-user path verified. Retain exact completed/unverified stages in receipt/docs/checkpoint.
