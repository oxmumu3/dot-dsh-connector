# Harness 0.2.2-rc.1 compatibility candidate

This repair branch adds an unpublished compatibility candidate. It does not update the public 0.6.0-preview.23 archive, merge the branch or publish a new package.

The audited official registry has `latest=0.2.1-rc.5` and `next=0.2.2-rc.1`. The new CLI requires Node 24.9 or newer and Cordis 4.1.0. Each SDK has an exact CI runtime profile; rc.2 through rc.5 keep Node 22.22.0 / Cordis 4.0.5, while rc.1 uses Node 24.22.2 / Cordis 4.1.0. Managed setup rejects rc.1 on Node 22 or Node 24.8 without removing legacy Node 22 support.

The new Tools service requires a separate official native executor. Its tool descriptions are now executor-owned and can be regenerated after the prompt waterfall. The connector selects an empty description only in its owned agent scope, while every actual call still goes through the official executor and the existing monotonic deny guards. Real SDK regressions continue to assert zero visible tools, zero executed scoped tools, a single model step, bounded tokens and an unchanged selected model/reasoning route.

The native protocol package is now a required exact SDK peer instead of a hard dependency on rc.2. The official Host supplies that peer through its profile module hooks. Fresh Host proofs resolve the installed plugin's protocol and Cordis, check their exact versions, verify protocol/plugin Cordis paths match, and compare the imported Cordis Context with the running Host Context before owner Remote validation.

Discovery keeps `actualLatest` distinct from `mostRecentVerified`. The historical manifest field `latestOfficial` records the highest reviewed SDK; the returned `latestOfficial` remains the actual npm latest tag for compatibility with existing tooling. Public contracts run on all five exact profiles, and actual Host jobs run on both the registry latest and the most recent verified SDK, deduplicated when they match.

`observedOfficialVersions` is a registry metadata snapshot, not an admission list. A newly published version fails discovery even if its SemVer sorts below an already reviewed RC. Only `verifiedSdks` admits runtimes; reviewed alpha.2/alpha.3 remain unsupported and cannot be promoted to `latest` without failing the gate. Unknown/mixed top-level or nested SDK graphs remain rejected by real codec tests.

Local validation on the candidate:

- Five SDK public-contract suites: 158/158 each, 790/790 total; zero failures, skips or cancellations, with original memory/deadline and hard network restrictions.
- Fresh official rc.5 and rc.1 Host installs: 58/58 installed files match each built archive; active bundle, exact runtime identity, owner checks and error round-trip pass.
- SDK/Node profile and fail-closed regressions: 13/13. Unknown future RC/stable versions and lower-sorting unreviewed alpha versions still fail.

These use synthetic state and deterministic model fixtures. They do not establish real account authorization, cloud transport, private history access, real model use or Dot/phone acceptance. Hosted CI must independently pass for the exact source commit before the candidate is accepted.

Sources: [official release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1), [official npm metadata](https://registry.npmjs.org/@deepseek-ai%2fdsh).
