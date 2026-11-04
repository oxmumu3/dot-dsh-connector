# Harness 0.2.2-rc.1 compatibility repair

## Cause and target

On 2026-11-04, official Harness Desktop began distributing `0.2.2-rc.1` through a staged rollout. The npm `@deepseek-ai/dsh` `next` channel also identifies rc.1; the `latest` channel and some Desktop installations can still remain on `0.2.1-rc.5` during that transition. A channel label alone must not replace the actual Desktop feed and exact installed SDK checks.

Before this repair, the public plugin preview.23 admitted only `0.2.1-rc.2`, rc.3, rc.4 and rc.5. Its failure on rc.1 is therefore an implementation compatibility gap, not an account authorization problem. Do not ask users to reset keys, remove connections or reinstall unrelated plugins to address it.

Primary official sources: [Harness rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1), [official SDK metadata](https://registry.npmjs.org/@deepseek-ai%2fdsh). Desktop feed readback and exact distribution fingerprints are maintained with the private release evidence.

## Scope and publication evidence

Preview.24 admits exact `0.2.2-rc.1` plus the four previously supported `0.2.1-rc.*` SDKs. Package engines, SDK peers and lock graphs, internal runtime checks, persisted-codec versions and official Host interfaces share that exact boundary. Unknown releases and unsupported alpha channels remain rejected. Windows support, new cloud permissions and account migration are outside this repair.

Published source: [`e912afddefc0f7df6fcdc4319822a254c8dc393e`](https://github.com/oxmumu3/dot-dsh-connector/commit/e912afddefc0f7df6fcdc4319822a254c8dc393e). [Publication run 41872138434](https://github.com/oxmumu3/dot-dsh-connector/actions/runs/41872138434), attempt `1`, passed five exact SDK suites at 162/162 each: 810 contracts, zero failures, cancellations or skips. Its serial five-SDK Host job passed fresh official CLI install, enable, disable/re-enable, new-process restart, uninstall and post-uninstall verification for every admitted SDK, including actual installed ABI and 58-file archive identity checks.

The CI configuration pins `macos-26-intel`, Node 24.22.1, npm 11.15.0 and pnpm 11.28.5. Actual Host runtime readback: image `macos-26` / `20260824.0517.1`, OS `26.6.1 (build 25G76)`, architecture `x64`. Network isolation and real denial probes remain required; no compatibility override or skipped Host result substitutes for a passing gate.

The immutable publication archive `oxmumu3-dot-dsh-management-0.6.0-preview.24.tgz` has SHA-256 `65a3579605f1a7ede3f79c852e2f1d539ebc9e641774c14f76647cbfb9b559b8`; npm `dist.integrity` is `sha512-khR6JDR6EiDxKx5yyJcqv2cCsj9Hwtyp1SGkADdEd7buCzuklyzHb2aiaDeM9MNc1tqN1cqnkQU9Uolc8OM7mA==`. Public readback at `2026-11-04T17:59:38.951Z` confirmed the exact version and npm `latest` dist-tag both identify preview.24, and the [GitHub release](https://github.com/oxmumu3/dot-dsh-connector/releases/tag/v0.6.0-preview.24) archive matches the CI artifact and npm download byte for byte. The tag resolves to the publication source. Post-release [tag CI live run](https://github.com/oxmumu3/dot-dsh-connector/actions/runs/41878783363). Formal publication and public readback receipts are summarized in [the verification ledger](verification.md).

These synthetic SDK and actual Host gates do not certify real-account authorization, browser onboarding, a cloud tunnel, real-model tasks, Dot/phone receipt or market-index synchronization. Existing credentials, connections and tasks are retained.

## Supplementary public-npm installation acceptance

The original `@latest` route selected mature preview.22 while the cache already reported npm `latest=0.6.0-preview.24`; it did not pass preview.24 installation acceptance. Pnpm 11's built-in 1440-minute release-age cooling explains this result. A separate official CLI install pinned to `@oxmumu3/dot-dsh-management@0.6.0-preview.24` passed with the public archive's 58 files, matching fingerprint/ABI, original loopback sandbox and full Host enable/disable, restart and uninstall lifecycle. This supplements the formal 810-contract/five-Host publication gate; it does not replace it or establish `@latest` end-to-end acceptance.

In that default non-strict installation, pnpm automatically recorded an age exception only for this package's exact version. No manual policy flags or global settings were changed. Clients using a 1440-minute strict policy should keep it and wait until **2026-11-05 17:31:48 UTC**; longer configured cooling periods still apply. See [pnpm 11 defaults](https://pnpm.io/blog/releases/11.0) and [strict behavior](https://pnpm.io/settings/dependency-resolution#minimumreleaseagestrict).

## User installation

In a Harness conversation, send:

> 请使用 Harness 的官方插件管理工具，从 npm 安装并启用 @oxmumu3/dot-dsh-management@0.6.0-preview.24，保留已有连接、配置和任务；安装后打开侧栏「Dot 连接」，首次使用按提示登录自己的账号并确认授权。

This resolves the supported npm release through Harness's normal package manager. No global npm invocation or manual `.tgz` download is required. An existing connection remains in place; a new user still completes official login, workspace selection and authorization. macOS and eligible owner-account requirements remain unchanged.

Maintainer: 牛村木木山. Canonical repository: [oxmumu3/dot-dsh-connector](https://github.com/oxmumu3/dot-dsh-connector).
