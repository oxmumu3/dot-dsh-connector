# Review of the 0.2.2-alpha.3 discovery alert

The scheduled compatibility run stopped on the newly published `0.2.2-alpha.3`. The official npm registry still points both `latest` and `next` to the supported `0.2.1-rc.5`; `alpha` points to `0.2.2-alpha.3`. This is a new release on the existing unsupported alpha channel, not a change to the supported latest channel.

Record only this exact alpha version in `compatibility.json`'s `knownUnsupported` map. Keep `verifiedSdks`, package engines/peers, runtime preflight, persisted-codec admission and the CI matrix limited to rc.2 through rc.5. No discovery or runtime gate implementation changes are needed. An unknown alpha.4 must still fail discovery; either reviewed alpha becoming `latest` must also fail.

The [official alpha.3 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.3) includes loader/configuration and session/history changes. Static comparison of integrity-checked public alpha.2/alpha.3 packages found API Gateway Remote event helper and Cordis context/event changes. The alpha CLI declares Node `>=24.9.0` and Cordis `~4.0.6-alpha.2`, while the supported compatibility workflow uses Node 22.22.0 and its public carrier pins Cordis 4.0.5. These facts justify keeping alpha support outside this repair; they do not prove an actual alpha runtime failure.

Sources: [official npm package metadata](https://registry.npmjs.org/@deepseek-ai%2fdsh), [official source comparison](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.2-alpha.2...dsh-v0.2.2-alpha.3). The source comparison reports 462 commits and returns a capped 300-file list, so it is not treated as an exhaustive file audit. The bounded package review covered eight package pairs, with all 16 downloads matching published SHA-512 integrity values.

Regression coverage proves that recorded alphas remain outside the verified matrix and runtime, the unknown next alpha blocks discovery, and promoting a recorded unsupported version to `latest` blocks discovery.

Locally verified on macOS on 2026-11-03, based on main `9f7a94839b923206c41ccd32a149b01c43f61bfe` plus this uncommitted repair:

- The new alpha-review regression reproduced the failure before the manifest change. The focused gate/CI/runtime suite then passed 11/11, with no failures or skips.
- Live official npm discovery passed and retained the exact rc.2–rc.5 matrix. Syntax, Python descriptor IO, license, version and default-disabled checks passed.
- Each supported SDK passed all 157 public-contract tests: 628/628 total, with no failures, skips or cancellations. Each synthetic HOME run proved OS-enforced loopback-only networking, including non-Node child denial.
- The official rc.5 CLI freshly installed the local native tarball into a synthetic web profile. All 58 installed files matched the tarball/source. The bundle became active, owner Remote access and protocol error round-trip passed, and non-owner access was denied. Runtime networking remained loopback-only; no compatibility override or production profile was used. Only the test's own Host was stopped.

Node 22.22.0 matched the workflow; the rc.5 contract and Host commands used local npm 11.15.0. Earlier carrier acquisition used npm 10.9.4 without lifecycle hooks. Local macOS contract results do not replace the workflow's Ubuntu jobs. At that local checkpoint, no commit, push, workflow dispatch or publication had been performed. A local result does not establish hosted Actions success, account authorization, real model/tunnel use or live Dot acceptance. Alpha runtime compatibility remains unverified and unsupported.

## Release 0.6.0-preview.23

The publication candidate increments root/native package metadata and both locks together, updates the version assertion, and points the current installation instructions to the scoped preview.23 tarball. The release workflow reruns all public SDK and official Host gates against the exact committed source before packing and publishing. The GitHub release asset must be the same tarball returned by that workflow, not a local rebuild.
