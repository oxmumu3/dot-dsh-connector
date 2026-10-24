# Self-service connection completion plan

User authorization: implement the three audited gaps end to end, preserve existing work, do not repeat design approvals. Required official login and account-grant confirmations remain with the person.

Goal: one public installation instruction reaches a working Dot connection; interrupted and expired connections recover without maintainer file edits.

Architecture: protect onboarding ownership using a fixed OS-backed guard on supported macOS; preserve existing account and task identity. Capture a replacement restricted runtime key into a separate candidate, validate its official transport authentication, then promote atomically with recovery metadata. Use existing Host APIs for status and user actions; show plain connection-expiry/remediation messages, never credential values.

1. Lock recovery (`onboarding-store.js`, `onboarding-store.test.mjs`): reproduce dead-owner restart failure; add kernel guard and strict dead-owner-only recovery. Reject live/unknown/corrupt owners. Test actual child exit, concurrent contenders and unchanged installation state. No production locks touched.
2. Credential lifecycle (`onboarding-ego*.js`, `onboarding-runtime.js`, new focused key lifecycle module, Host/Remote/UI and tests): store expiry provenance; seven-day warning; explicit renewal action with official confirmation; keep old key until candidate accepted; preserve tunnel/plugin/task state; recover cancellation and restart without duplicate keys. Unknown old expiry stays unknown.
3. Installation entry: verify official Harness `plugin_manager` contract; make the shareable instruction refer to the canonical fixed public asset and verify applied install. Add only the missing authorized native action/navigation bridge if required; no hidden DOM execution.
4. Integrate and review: targeted suites, relevant full regression, check/build/package, independent ownership/security review. Publish a new immutable prerelease under oxmumu3 and independently download/hash it.
5. Actual acceptance: issue the installation instruction to Harness; observe official installation and enablement; complete native renew flow and official confirmation with the owner; real Dot reads a project and completes a bounded file task. Separately exercise actual isolated crash recovery and clean installation prerequisites without stopping unrelated work. Record any untestable clean-machine/account prerequisites precisely.

Current execution: recovery and renewal implementation is frozen after focused regression and independent review. The shipped executable also passed an isolated Electron Host SIGKILL lifecycle test; the live Desktop was not stopped. Full serial regression, official installation and actual Dot acceptance remain in progress. Existing preview.12 source and assets remain available for rollback. Work continues in the current uncommitted project checkout to retain prior completed changes; no reset or blanket staging.
