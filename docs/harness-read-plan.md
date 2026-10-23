# Harness read access implementation plan

Goal: enable the existing personal Dot to browse/read the owner's actual Desktop Harness without enabling mutation.

1. [x] Audit public Desktop read paths and persisted storage formats. Select cold persisted snapshots rather than activation-capable live RPC. Exclude resume/load/prompt/configuration/repair paths.
2. [x] Add failing synthetic storage/temporary-file tests, then implement bounded storage/reader/launcher, credential exclusions, canonical context roots and secret-pattern redaction without touching existing agents.
3. [x] Add strict optional harness_* MCP schemas and exact-name routing with failing transport tests first. Preserve the original five tools and use the dedicated31471 endpoint without fallback.
4. [x] Main thread reports existing-data local catalog/session/file/hash probes passed with private configuration. Public evidence retains no private bodies.
5. [x] Refresh the existing owner-only private Tunnel/plugin and execute actual Dot reads. Main thread confirmed workspace/session pagination, persisted session text and instruction/skill/project-file samples with matching local hashes. Preserve sample/snapshot limits without publishing private names, identifiers or bodies.
6. [x] Run source-frozen full checks/demo:125/125 tests, check and synthetic demo1/1 passed. Refresh public command outputs and verification without private data/credentials. Configuration and use are documented in [harness-read-usage.md](harness-read-usage.md).
7. [ ] Main thread creates the final package. Actual Dot read receipts are recorded in the private operator evidence and summarized in verification; local tests and tool discovery remain separate proof states.
