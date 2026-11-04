# Harness 0.2.2-rc.1 compatibility repair

## Cause and target

On 2026-11-04, official Harness Desktop began distributing `0.2.2-rc.1` through a staged rollout. The npm `@deepseek-ai/dsh` `next` channel also identifies rc.1; the `latest` channel and some Desktop installations can still remain on `0.2.1-rc.5` during that transition. A channel label alone must not replace the actual Desktop feed and exact installed SDK checks.

The current public plugin preview.23 admits only `0.2.1-rc.2`, rc.3, rc.4 and rc.5. Its failure on rc.1 is therefore an implementation compatibility gap, not an account authorization problem. Do not ask users to reset keys, remove connections or reinstall unrelated plugins to address it.

Primary official sources: [Harness rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1), [official SDK metadata](https://registry.npmjs.org/@deepseek-ai%2fdsh). Desktop feed readback and exact distribution fingerprints are maintained with the private release evidence.

## Candidate scope and gate

The preview.24 candidate targets exact `0.2.2-rc.1` plus the four previously supported `0.2.1-rc.*` SDKs. It must reconcile actual package engines, all SDK peers and dependencies, internal version checks, persisted-codec versions and official Host interfaces. Windows support, experimental alpha support, new cloud permissions and account migration are outside this compatibility repair.

Before publication, verify each supported SDK with risk-matched regression and verify the exact final package in the official isolated Host through install, enable, stop/restart and uninstall. A source edit or an admitted engine range is not a passing Host run. Record the final package fingerprint and carry that exact artifact into the established trusted publishing workflow.

Status: implementation and verification in progress; no preview.24 publication or complete acceptance is claimed by this candidate document. A successful local gate is distinct from hosted CI, npm exact/latest readback, canonical GitHub assets and actual market-index synchronization.

## User installation

In a Harness conversation, send:

> 请使用 Harness 的官方插件管理工具，从 npm 安装并启用 @oxmumu3/dot-dsh-management@latest，保留已有连接、配置和任务；安装后打开侧栏「Dot 连接」，首次使用按提示登录自己的账号并确认授权。

This resolves the supported npm release through Harness's normal package manager. No global npm invocation or manual `.tgz` download is required. An existing connection remains in place; a new user still completes official login, workspace selection and authorization. macOS and eligible owner-account requirements remain unchanged.

Maintainer: 牛村木木山. Canonical repository: [oxmumu3/dot-dsh-connector](https://github.com/oxmumu3/dot-dsh-connector).
