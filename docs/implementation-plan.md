# Implementation plan

Historical plan for the original isolated fixture connector. Its evidence boundaries describe that development stage; current native workspace execution and actual Dot results are recorded in [verification.md](verification.md).

- [x] Write failing core tests for explicit scope, context boundaries, idempotent job creation and correlated terminal result.
- [x] Implement project access, atomic bounded job store and serialized lifecycle; no automatic replay.
- [x] Write failing transport tests. Implement authenticated loopback bridge, official MCP stdio tools and offline behavior.
- [x] Implement DSH public-SDK host adapter with fresh session and tool-free execution, event claims and cancellation.
- [x] Exercise real Cordis/SystemPrompt/ToolRuntime with a synthetic factory; real model/driver remains explicitly untested, without mounting live user data.
- [x] Run independent code/security review, repair material issues and run release validation.
- [x] Package operator config, tunnel/account runbook and evidence ledger. Stop at any real account/project authorization blocker, with a concrete ready package.
