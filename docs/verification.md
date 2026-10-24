# 0.6.0-preview.17 — regression, build and archive accepted; public installation and live release acceptance pending

Preview.17 is the next publication target. Final runtime and renewal regression passed 60/60, with zero failures or skips; independent read-only review found no additional blocker. It addresses a live status-recovery defect found after preview.16 credential renewal: the new canonical Tunnel process could be healthy enough for actual Dot work while the settings UI remained failed. The source candidate gives canonical restart a bounded cold-start health allowance, then continues read-only health probing after transient failures. Only a fresh online receipt for the current process may restore ready; stale task evidence or an earlier online state cannot do so.

| Evidence layer | Current result |
| --- | --- |
| Canonical restart recovery | Implemented and covered by the passing runtime/renewal regression: wait for initial health after restarting with the promoted canonical key instead of immediately applying ordinary five-second supervision. Archive/source equality is verified; native installation and live UI acceptance remain pending. |
| Transient health recovery | Implemented and covered by the passing runtime/renewal regression: continue bounded read-only health probes while the connection is temporarily unverified, allowing automatic recovery when fresh online evidence returns. No extra browser, new grant or task replay is part of recovery. Live acceptance remains pending. |
| Readiness boundary | A restored waiting channel remains distinct from ready. Fresh online evidence is required to mark the channel ready again; historical read/task proof stays dated. |
| Regression and package | Final preview.17 runtime/renewal suite: 60/60 passed, zero failures/skips. Independent review covered cancellation and late replies, timer registration, read-only recovery and strict online evidence. Syntax/version/license checks passed (54 files), management build passed (27 copied runtime files), and independent archive inspection passed: all 56 archive files equal the source; private-value and old-namespace checks passed. This focused result is not a fresh full-suite run; preview.13's 740-pass / 3-fail / 20-skip run and subsequent 3-pass correction remain recorded separately below. |
| Native archive | 188639 bytes, 56 files, SHA-256 `6268e8bcb8855da22a8278cac5e8e5a091cde17d8d84e220bd53f4ce9e6df88b`. This package is built and audited, not yet publicly downloaded or installed for preview.17. |
| Public release and download | Not yet published or verified. The preview.17 fixed URL in README/install copy is a planned post-publication address, explicitly not an available download at this checkpoint. |
| Final live acceptance | Pending: install the final public package through the official Harness flow, verify truthful recovery status, then obtain fresh real Dot read/task completion evidence. |

The accepted preview.16 local installation, credential replacement and real Dot task below remain useful historical evidence. They do not substitute for preview.17 state-recovery acceptance. A blank Mac, an empty browser profile, a new account's eligibility and generic unattended reliability remain outside the established proof scope.

# Historical 0.6.0-preview.16 — local installation, renewal and real Dot accepted; settings-state recovery defect found

Preview.16 is installed from the local package through Harness's official plugin interface. It includes the Ego start-page navigation repair and keeps the generated renewal key name within the official 64-character limit. Actual renewal completed through the installed provider, followed by a fresh real Dot project/README read and one completed native task. The connection settings UI nevertheless remained failed after the canonical Tunnel restart, so full status-recovery acceptance was not complete. This version was installed locally and was not publicly released; preview.17 supersedes its earlier planned publication.

| Evidence layer | Current result |
| --- | --- |
| Native installation | All 56 installed files match archive and source. Nine other plugins / 463 files, dependency specifications, complete bundle order, three stable Harness configuration files and the original Host identity remain unchanged. This is official local-package installation, not a public one-sentence preview.16 installation. |
| Native archive | 188470 bytes, SHA-256 `63f06ec31dc1156117e9c243cbd3ba9039b823c67f01d1eb80f107c7c7500c7a`. |
| Actual renewal | Seventeen required preservation checks passed: the canonical runtime key changed; creation was observed during the renewal; its configured expiry is 30 days later and is not expired; the renewal committed; the saved candidate was cleaned; installation/account resources and saved verification identities were preserved; the replacement Ego-window binding completed. The expiry is derived from observed creation and selected duration, not an independently queried account expiry. |
| Runtime configuration limitation | The original aggregate preservation receipt remains `passed:false` because its extra whole-file managed-runtime-configuration hash check differed. Follow-up analysis found the file modification preceded key creation and the preview.16 installation readback. The baseline kept only a digest, so the exact field delta cannot be reconstructed and is not claimed to be only ports. This does not erase the passing 17 renewal-specific checks or establish that the entire plugin-owned runtime configuration stayed unchanged. |
| Final real Dot check | Accepted after renewal through installed preview.16: fresh successful project-list and exact project README reads; exactly one matching job across complete archived/unarchived lookups; uncached native succeeded/completed turn 1, finished at 2026-10-24 02:18:00.922 UTC; exact 35-byte marker file verified independently; fresh official Tunnel health online. This is bounded real read/task acceptance, not a general reliability or content-quality claim. |
| Settings-state recovery | A real follow-up showed `CONNECTION_FAILED` despite successful key promotion and subsequent real Dot work. Canonical restart entered five-second supervision before allowing its first health poll to settle; one transient failure then stopped state recovery. This live defect is addressed by the preview.17 candidate and is not hidden by the passing read/task evidence. |
| Public release | Not released. Earlier preview.14 public-download and preview.13/14 installation records below remain historical. Preview.17 is the next publication target. |

The existing-owner fresh resource setup was accepted in preview.9, and real Google sign-in in Ego was accepted in a later run. These are separate observations, not a completely empty browser/new OpenAI account test. The isolated Ego installer accepted verified download/copy/signature/Gatekeeper with the final open intercepted; a completely blank Mac and first browser GUI setup are still outside the accepted scope.

# Historical 0.6.0-preview.14 — public and installed preview; live first-screen defect found

Preview.14 is publicly available and installed through Harness's official one-sentence installation flow. It repairs the prior Ego execution compatibility failure and supports exact `.` as a workspace-root alias. A subsequent live first-connection run exposed another defect: a new Ego Space starts at `chrome://new-tab-page/`, but the Platform phase recognized only `about:blank`. The plugin could therefore ask the person to log in without navigating to the official login page. This checkpoint accepts publication and installation, not full first-connection or renewal completion.

| Evidence layer | Current result |
| --- | --- |
| Public release | Canonical repository: `oxmumu3/dot-dsh-connector`. Published [v0.6.0-preview.14](https://github.com/oxmumu3/dot-dsh-connector/releases/tag/v0.6.0-preview.14), fixed source commit `1909e5613336b80006d5a6f74a6cafab0d375449`. All three assets passed anonymous HTTP 200, byte-length and SHA-256 checks. |
| Official installation | Actual `plugin_manager.install_bundle` returned applied, version 0.6.0-preview.14, zero warnings, exit 0 and no restart requirement. All 56 installed files match the archive and source. Nine other plugins / 463 files, dependency references, bundle order, stable configuration and original Host identity remain unchanged. |
| Native archive | 188293 bytes, SHA-256 `ad25c17de79fc7273eef8cae6a61c834043614efa9cae5d97605d75a2debf96b`. |
| Source archive | 925223 bytes, SHA-256 `fd26ade0baa4459673d1a84dbc5ac37b628ab1041abc4365076371d869466ee2`. The fixed source archive preserves its pre-publication checkpoint; this ledger records subsequent acceptance. |
| Live renewal | Pending. The previous Ego execution repair is installed, but the subsequent official-page navigation defect blocks completion of the live path. New-key validation and promotion and continued operation on the existing channel are not yet accepted. |
| Final Dot read/task | Pending for the repaired path. Preview.13's completed real project read and native task below are accepted historical results, not a substitute for a new first-connection or renewal check. |
| Preview.15 candidate | In progress: recognize Ego's actual new-tab start page and navigate to the official account entry before asking for login. Publication, native installation and actual first-connection/renewal/Dot acceptance are not yet claimed. No preview.15 public installation link is recommended at this checkpoint. |

# Historical 0.6.0-preview.13 — public installation and real Dot read/task accepted

Preview.13 passed public download and official installation checks, then completed a fresh real Dot project read and one correlated native task. Its live renewal attempt exposed the Ego execution issue addressed in preview.14. These results remain version-specific.

| Evidence layer | Current result |
| --- | --- |
| Preview.13 public distribution | Canonical ownership is `oxmumu3/dot-dsh-connector`. The published [v0.6.0-preview.13](https://github.com/oxmumu3/dot-dsh-connector/releases/tag/v0.6.0-preview.13) source commit is `6c132ca034446dea328f4ecc89d8e2c1304e35e8`; all 157 source files match the frozen export. All three release assets passed unauthenticated HTTP 200, byte-length and SHA-256 checks. |
| Preview.13 official installation | The actual Harness `plugin_manager.install_bundle` returned applied, version 0.6.0-preview.13, zero warnings and exit 0. All 56 installed files match archive and source. Nine other plugins / 463 files, stable configuration and the original Host identity remained unchanged. |
| Preview.13 native package | 188225 bytes, SHA-256 `110498c4f4cdd3e18b10db0eb749318ad4764b4857fd6c283292926785c643eb`. The source ZIP is 923232 bytes, SHA-256 `7932334f22726661567483e9103a34090c3c6f79781de7a120e56d1c484a39d1`. |
| Preview.13 regression | The full run reported 740 passed, 3 failed and 20 skipped. The three stale Ego-runtime fixtures were corrected and their targeted rerun passed 3/3. This is not a claim of an all-green full rerun; the 20 optional browser tests remain skipped. |
| Crash and renewal checks | Supervisor tests passed 24/24; an isolated Host SIGKILL test using the actual Harness Electron executable stopped only the owned fixture child and preserved an unrelated child. The final package's JavaScript is unchanged from that tested package. Expanded renewal tests passed 12/12. These isolated checks do not establish production crash or official-account renewal acceptance. |
| Actual connection renewal | Preview.13 reached a live Ego execution compatibility error before replacing the runtime key. The old key and original channel were retained. Preview.14 contains the repair; its separate installation and live-renewal status are recorded above. |
| Actual Dot follow-up | Accepted through the installed preview.13 connection: a fresh successful project-list event, exactly one request-correlated native job across complete archived/unarchived lookups, uncached succeeded/completed turn 1, and the exact requested marker. Independent file readback matched the 35-byte marker plus newline, and fresh official Tunnel health was online. |
| Root-directory compatibility finding | A real request using exact `.` exposed a root-alias compatibility issue; an empty root request worked. Preview.14 normalizes that exact alias without widening access to arbitrary paths. |

The public package contains no account credentials or private acceptance identifiers. Existing-account Google login, the isolated Ego installer, fresh-connection acceptance and cold restore retain the version-specific limits recorded below. Completely fresh browser/machine setup, every new account's eligibility and generic unattended reliability are not established by these checks.

# Historical 0.6.0-preview.12 — installed, real Dot accepted, public Release downloads verified (2026-10-23)

## Preview.12 live verification

Preview.12 was installed and immediately enabled through the official Harness UI. All 54 installed files match the archive and source. The provider loaded from the installation directory and the actual preview.12 worker then passed a fresh real Dot verification. Independent manager readback confirmed one fresh successful project-list event and exactly one native task: turn 1, succeeded/completed, uncached, with the exact request marker and matching session/message identity. The native UI automatically moved from waiting for first call to cloud online and showed five retained tasks. Existing account and task state was preserved. This supersedes the earlier source-provider check against the preview.11 worker.

The installed preview adds explicit Ego installation when the browser is missing, keeps first-run browser setup with the person, and resumes the existing connection afterward. Installation uses the official download and signature checks, preserves existing applications, and starts only after the person's install/continue action. Cancellation and delayed replies cannot resume the cancelled workflow. A rejected official login returns to the official entry only after explicit Continue; ordinary polling never retries it automatically. Login redirects during verification hand control back, and Open connection window focuses the current step.

The final production installer passed an isolated real installation run with verified official cached DMG bytes. Image verification and mounting, copying, removal of only FinderInfo/ResourceFork from the new copy, recursive strict signature verification, separate fixed publisher/app identity verification, Gatekeeper and detachment all ran for real. Only the final application-open command was intercepted; the result was `ready:false, needsOnboarding:true`. The existing Ego installation was unchanged. This accepts the isolated installation path, not GUI first-run setup, a completely fresh machine or a new Google/OpenAI account.

The owner completed a real Google login through ChatGPT's official Add account → Continue with Google → Use another account flow in Ego. The live readback then showed an authenticated ChatGPT page; the earlier standalone Chromium rejection was not observed in this run. This verifies that interaction for this account. It did not clear the browser profile or create a new Google/OpenAI account, and does not establish every account's Dot, Tunnel or custom-tool eligibility. The earlier real Dot read/task and cold-restore results remain the version-specific checkpoints below.

| Evidence layer | Current result |
| --- | --- |
| Combined candidate regression | 284 tests: 283 passed and one UI fixture failed because it omitted the runtime's top-level message. The fixture was corrected; its focused rerun passed, and the full native UI suite passed 56/56. A fresh all-green combined run is not claimed here. |
| Installer regression | 31/31 passed, including targeted metadata preservation, signature/Gatekeeper rejection, cancellation and owned-copy rollback. |
| Native package and installation audit | Final archive: 54 files, 177193 bytes, SHA-256 `bddb4e6e8123778c35dd8350f67c0fb27200e08740d3b6512d2b2368e173a313`. All 54 installed files match archive and source; secret, old-namespace and private-identifier scans passed. Eight other plugins are unchanged; the Finder plugin and Cordis patch differences predate this Dot update. No claim is made that all nine sibling snapshots are unchanged. |
| Isolated real Ego installation | Accepted through verified installation and image detachment; only application opening was intercepted. GUI first-run setup and a completely fresh machine remain unverified. |
| Preview.12 native installation and live acceptance | Accepted through the installed provider and worker: fresh project read, exactly one successful correlated task, and automatic native UI transition to cloud online. |
| Public source repository | Canonical ownership confirmed as [oxmumu3/dot-dsh-connector](https://github.com/oxmumu3/dot-dsh-connector). The uploaded 148-file source snapshot was checked through GitHub API readback: every Git blob SHA matched. |
| Versioned Release | [v0.6.0-preview.12](https://github.com/oxmumu3/dot-dsh-connector/releases/tag/v0.6.0-preview.12) was published as a prerelease at 2026-10-23 22:16:12 UTC, with `draft=false`; its fixed tag points to `39063aa9beab822df39ef6b8268e8b84b913ba2a`. All three assets passed independent unauthenticated download checks: HTTP 200, byte lengths and SHA-256 values match the accepted local artifacts and API digests. The native plugin is 177193 bytes, SHA-256 `bddb4e6e8123778c35dd8350f67c0fb27200e08740d3b6512d2b2368e173a313`. |

The fixed release tag and source ZIP preserve the frozen pre-publication snapshot; they are not themselves publication receipts. This ledger on `main` includes the subsequent publication and public-download receipt above. Private account, page, request and credential identifiers remain outside this public ledger. Historical sections retain what was known at each checkpoint; earlier statements about untested Google login, preinstalled Ego or unavailable public distribution do not override the current table.

# Historical 0.6.0-preview.11 — installed; first connection and cold restore accepted (2026-10-23)

The owner-authorized fresh connection completed through Ego using its existing authenticated session: the provider saved the newly created restricted runtime key without manual copying, recognized the new private plugin, and real Dot read the project list and completed a request-correlated native task. Preview.10 additionally passed successful browser finalization and an explicit reverify that reclaimed the same Ego space, preserved earlier user/result tabs, and created dedicated new pages. Each verification created exactly one task and independently matched session/message/turn1, succeeded/completed and its exact marker.

Preview.11 repairs a real cold-restore defect: the official Tunnel can be live and polling before its first stdio discovery. The old 30-second restore deadline shut that healthy idle child down. The precise unobserved state now remains `unknown / awaiting_first_call`; strict online still requires the current child's complete connector identity. An already verified installation keeps its channel alive, labels the dated prior proof, and automatically transitions after a real cloud call. First provisioning still requires actual read and task proof. Initial polling has a 45-second allowance; no synthetic initialize, extra browser or verification task is used for ordinary restore.

Final related suite: **237/237 passed**, zero failures/skips; syntax/version/license checks, build and independent review passed. Native package:53files,171410bytes,SHA256 `802e86de94fae70e58c2e1ea9e0af2a6838b147754846b2f53eba006db6e2d69`. Official Harness installation/activation completed; all53installed files match source and archive. Nine sibling plugins/447files, non-own dependency references and three stable configuration files remain unchanged. The official disable/enable test moved only this plugin's bundle to the end; all other bundle ordering remained identical. No Desktop or OS restart was performed.

Live cold-restore acceptance: the same runtime completed its first cloud poll after30.313seconds and stayed alive without MCP discovery through69.212seconds. A single authenticated call through the newly connected private cloud app then listed a bounded project page. The same child acquired complete identity, and the native UI automatically changed from waiting for first call to cloud online, preserving the prior full-verification timestamp, request and finished Ego binding. Independent health sampling recorded42samples with no read errors and21strict healthy samples after the call. The task count did not increase. UI checks distinguish paused admission and unavailable status from a usable waiting channel.

Final acceptance, cold-restore sampling, installed/package audits and the native screenshot are retained privately. This checkpoint proves the owner's new connection and plugin cold-start recovery. At that time it did **not** establish signed-out Google login, a full Desktop/OS restart, or public repository/Release distribution. Historical sections below retain their original proof boundaries.

# 0.6.0-preview.9 — Dot composer compatibility and safe retry (2026-10-23)

The owner completed the new private-plugin creation and connection grant. The installed preview.8 provider independently recorded the plugin ID and connected state. Its real Dot self-test then exposed a DOM compatibility defect: the composer was visible but nested more than 40 ancestors deep, while the full-root selector builder stopped at 32. No verification message or task was sent. The native workflow was paused with its existing grants retained.

Preview.9 uses an exact unique semantic selector, falling back to the shortest uniquely identifying ancestor chain; duplicate visible controls still block. A read-only production-phase probe against the same real Dot page changed from dot_editor_loading to dot_prompt_ready. The candidate also repairs explicit verification retries: only a trustworthy complete empty lookup of both unarchived and archived tasks permits redispatch; existing or uncertain tasks remain observation-only. Interrupted retry intents cannot reuse an old message as acknowledgement.

Relevant frozen regression passed **194/194**, zero failures/skips, including four new deep-DOM/ambiguity/escaping cases. Independent focused review passed68/68, plus nine authoritative absence cases. Syntax/version/license checks and build passed. Native archive:53files,169189bytes,SHA256 `033afba31c2cb5c108a9c98e96bc68afe9f01346a142e32cfe1491743f9c58e0`; independent source/private-value/identity scan passed. Official native installation and activation completed without Desktop restart. All53installed files match the archive and source; nine sibling plugins/447files and stable configuration remain unchanged. The actual provider is now resuming the same authorized connection. Fresh actual Dot acceptance passed at18:24UTC: the new private plugin read the project list, created exactly one native task in a registered task-enabled project, and returned the exact request-specific marker with matching session/message/turn1, succeeded/completed and a fresh uncached manager receipt. The native page automatically changed to cloud online and connection verified. Independent read event, task and health evidence is saved privately. This used an existing authenticated Ego session; signed-out new Google login and public distribution remain unverified.

# 0.6.0-preview.8 — installed; waiting for final runtime-key grant (2026-10-23)

The default onboarding provider now uses only Ego v2, retains one installation-specific TaskSpace and preserves explicit login/grant handoffs. It does not fall back to Chrome, import a profile or export an authentication session. Ego must already be installed.

Actual first-connection testing found and repaired three issues missed by the initial mocks: Ego sends console receipts to stderr; official table cells concatenate without separators; permissions/project/expiry dropdowns are separate dialogs linked to the main form. The repaired transport accepts one strictly typed, uniquely marked receipt from either bounded output stream. The page parser reads exact row cells, permits only precisely linked known popups and checks every permission row including the enabled Model capabilities label.

The production phase code ran against the real Ego form in eight bounded rounds: selected Tunnels Read and Use, closed its popup, selected the sole Default project, selected 30 days and returned an authorization draft. The visible final form independently showed those settings, all other 17 permission rows at None and an enabled Create secret key button. No final Create was clicked by the agent. No synthetic runtime receipt or key was injected.

Preview.8 was installed and activated through official Harness Plugins UI without Desktop restart. The actual Host recognized the new Tunnel/workspace, validated the existing draft, recorded creation intent plus its capture nonce, then handed Ego control to the owner. Native UI explicitly asks the owner to create the key, retain Save your key and return to Continue. After the owner confirmed key creation, the actual native Continue action safely saved the runtime key with mode 0600, started the owned Tunnel and prepared the private-plugin form. At 18:03:56 UTC the provider handed Ego back for the owner to confirm private-plugin creation and connection authorization. No plugin ID or fresh Dot task is recorded yet; this final grant remains pending.

Final relevant regression: **181/181 tests passed**, zero skips, covering Ego provider/transport/platform/plugin composition, runtime/store/tunnel and native UI. Focused popup/scope/transport tests passed **47/47**; independent review passed. Core regression excluding onboarding had previously passed **406/406**. Final preview.8 syntax/version/license checks, package build and exact-source archive/private-value scans passed. These evidence layers do not establish full account provisioning or real Dot acceptance.

Native preview.8 archive: 53 files, 168329 bytes; SHA-256 `6d056dc31813f8321977cba25ded868a9e0b82a6f60b7d828cf0f6f50ff47e2d`. Independent preview.8 post-install checks retained nine sibling plugins and 447 files, non-own dependency references, bundle order and stable Cordis configuration. The installed platform, transport, provider and runtime files exactly match source and archive; private readback is saved with mode 0600.

At this checkpoint the connection's Ego space had an authenticated Platform session and Dot. The owner created the new installation-specific Tunnel and selected the account workspace; the old Tunnel was retained. Reusing an existing Ego login does not prove fresh signed-out Google authentication. Historical existing-connection read/dispatch evidence remains separate. No public repository, Release or complete new-user rollout was claimed at this checkpoint.

# 0.6.0-preview.4 — Google rejection diagnostics, candidate only (2026-10-23)

The actual preview.3 first connection was blocked by Google unsupported-browser rejection. Entering the same account email at OpenAI returned the same rejection; no alternate authentication method is confirmed. No fresh account grants or Dot task receipt exists. Preview.4 source detects the exact official rejection paths promptly, retains owned resources for recovery, and permits cancellation before a Tunnel exists. It does not make Google accept the browser. Browser/runtime targeted regressions passed 70/70; a later cancel-exit correction passed all 26 pure runtime tests. Syntax/version/license checks passed. The candidate has not been installed; the live version remains preview.3. Subsequent browser work follows the owner's ego-only rule, including stopping native control of the plugin's separate Chromium window. The older full-suite and native-install evidence below belongs to preview.3.

# 0.6.0-preview.3 — actual Electron preflight correction (2026-10-23)

A real native first-connection run exposed an Electron ASAR metadata read failure before local services were prepared. The actual bundled Electron reproduced the failing SDK check; direct fixed public metadata reads succeeded for supported Harness 0.2.1-rc.2. The fix preserves ordinary Node raw-archive reads and global ASAR behavior. The targeted setup suite passed 31/31; full suite passed 484/484 with real isolated Chromium enabled, zero failures or skips; syntax/version/licenses, synthetic demo and independent archive checks passed. The public preview.3 archive was installed through native Plugins UI without restarting Desktop. All 49 installed files match the archive; nine sibling plugins and 437 files remain unchanged. A fresh installation identity and four dynamic loopback services are active in the original native Host, and the renderer worker is polling the new endpoint. The product automatically installed its independent browser and reached the actual official OpenAI Platform login page, with no account entered. The native UI correctly asks the owner to log in. Official login, account grants and fresh Dot task verification remain pending; local readiness is not cloud acceptance. Detailed installation and test evidence is retained privately.

# Historical verification ledger — preview.3 checkpoint

Checkpoint date: 2026-10-23, America/Mexico_City. The native candidate and installed version at that time was **0.6.0-preview.3**. A fresh managed installation had reached official login; account grants and a correlated fresh Dot task were pending. Entries below describe historical checkpoints and do not supersede the current evidence above.

## Historical 0.6.0-preview.2 — fresh-connection corrections, before native installation

The new candidate fixes delayed login/MFA, actual OpenAI project selection before key confirmation, English account-page variants, cancellation through reauthentication, managed port collisions and the renderer worker address. First connection checks the real Harness project registry and uses the official directory picker when empty. Read-only memory/skills roots are explicitly marked unavailable for task execution.

Verification now surfaces native approvals and questions with a direct session action, pauses the ordinary verification budget during an observed human decision, and retains the transport after an ordinary verification timeout. A deliberate retry after a confirmed failed/cancelled verification task gets a new request; pending or timed-out requests retain their identity. Host scope replacement during directory selection cannot continue using the old workspace service.

The final full regression passed **482/482**, zero failures or skips (192.64 seconds). Syntax/version/license checks and the synthetic MCP/HTTP demo passed. An independent clean installation added 102 dependencies with no missing/invalid/extraneous entries. All 49 native archive files and 26 copied runtime files matched frozen source; native archive SHA256 is `fd7dab43f1cd8dab9d59db88120e6347928763ba4a776baf8469ebe74e3a7c37`. Browser contracts use isolated synthetic official pages, including English variants; they do not prove today's live account pages. Fresh dependency installation used an empty directory and normal npm installation, without links to existing node_modules. Inert loading registered the plugin without network, listener or subprocess activity.

The old live connection was checked at 2026-10-23 11:46 UTC: cloud online, 23 retained tasks (16 succeeded, 7 cancelled), zero active tasks. Nine sibling plugins and 433 files were snapshotted before the planned update. The default managed data directory was absent, so the next native managed install can exercise a fresh local identity without copying the old credentials. Native control currently reads the window but cannot reliably click it; the owner has been asked only to bring Harness's Plugins page forward. No actual fresh login, grant, new Tunnel, new private plugin or Dot task has yet been accepted in this attempt.

Public distribution and universal new-user availability are not claimed. The documented supported environment and account permissions still apply. The previous installed-connection evidence follows unchanged.

## 0.6.0-preview.1 — first-connection automation and task workspace

The first-use flow prepares local reader/manager services, an isolated browser, the official Tunnel runtime, the private connection form and a correlated Dot verification instruction. Login and final grants stay on the official pages for the account owner. The public plugin has no account state, runtime key or private token. Existing external connections remain external and are not automatically migrated.

The source-frozen full suite passed **448/448**, zero failures or skips (249.61 seconds), including actual Chromium against isolated synthetic account pages. Syntax/license/version checks and the synthetic MCP/HTTP demo passed. Independent review covered ownership, cancellation races, duplicate-resource recovery, official-page selectors, permission/expiry controls, cached executable integrity, bundled Node/Electron/Python operation with empty PATH, and timestamp/correlation checks. These are distinct from real account provisioning. A final native-screen polish then preferred saved session titles in recent tasks and moved external-deployment details into settings diagnostics; the final UI suite passed 48/48.

### Actual first-start and UI checks

- A real default first-start smoke downloaded official Chromium into a dedicated private cache, launched the independent browser, reached the official login stage and cancelled cleanly. No account login or new resource was created in this smoke.
- The real official API-key form was inspected with one temporary restricted Read+Use key and a 30-day expiry. That temporary key was revoked and its Revoked state independently reloaded. The existing runtime key was not changed. This is component-level inspection, not full fresh-account acceptance.
- Ego browser acceptance exercised first-use and connected views in light/dark, desktop and 390px layouts; task selection, focus/scroll restoration, draft preservation, follow-up state, settings and explicit revalidation dispatch passed. Synthetic screenshots are labeled accordingly in [release notes](release-0.6.md).
- Saved verification receipts remain dated history. Automatic restart restores only the owned transport; it does not silently open a login window or dispatch another task. Current cloud health and previous read/task verification are displayed separately.

### Installed native and actual Dot

Harness's own install UI reported **Installed, version 0.6.0-preview.1** and activated the new Host/client without restarting the original Desktop app. The install comparison preserved nine non-own plugins, 433 non-own package files, all non-own dependency references, bundle order, three profile configuration files and this plugin's private patch. The family plugin had independently upgraded before this snapshot; its newer state was retained.

Actual Dot used the existing connection in order to check status, read the first bounded 128 bytes of the project README, create one new native verification task and query completion. Independent get-task and saved-session readbacks confirmed the same request, session, message and turn 1, completed state and exact verification marker. The native page automatically showed local readiness, cloud online and 23 task records (22 retained plus this new task). This verifies the installed existing-account path; it does not establish a new account's first full login/grant/verification chain.

A short local read-health probe briefly displayed partial readiness under load before a subsequent automatic probe recovered. No probe result or old receipt was rewritten into a successful state. The 1.5-second health deadline remains a known source of transient degraded labels; future refinement should distinguish timeout from definite disconnection.

### Distribution and remaining limits

The native archive was extracted into an empty temporary directory; ordinary npm dependency installation, module import and inert disabled loading passed. Root archive dependency installation also passed. npm omits package-lock from published archives, so the check now requires shrinkwrap and validates package-lock only when present. The native package pins direct dependencies but does not claim a separately locked transitive tree.

Public archive scans exclude private state, personal paths, old project identity, live connection IDs and real key material. No public repository or Release has been published or verified; the deliverable is a local preview package under the identity 奥克斯木木山 / oxmumu3.

**Not yet accepted:** a completely new user's end-to-end account setup; automated renewal or self-service replacement of expired/revoked runtime keys; generic unattended reliability; user content/visual acceptance. New keys are created with a 30-day expiry, and this candidate still needs maintainer assistance to replace an invalid saved key. Self-test file/command restrictions are instructions to Harness, not a separate sandbox guarantee.

## 0.5.0-preview.2 automatic cloud status — installed and live transitions verified

Replaced the fixed unverified label with bounded, read-only observation of the linked official Tunnel runtime. Online requires fresh control-plane polling, the initialized same-child connector MCP identity and an accepting dispatcher. Local management/worker traffic does not create cloud evidence. Last successful cloud interaction is displayed separately; idle time does not imply disconnection. Unknown, stale or unreadable evidence cannot retain a current-online label. Header and settings use the same state, including on refresh failure and return from a hidden page. Tunnel health does not by itself assert account authorization or task success.

The source-frozen full suite passed **364/364**, with zero failures or skips; checks, build and package verification passed. The native archive `dot-dsh-management-0.5.0-preview.2.tgz` contains 41 files, 110862 bytes; SHA256 `3dbf6d5af16e66827dc1e1b38fe113e0e1e2d1fd92e8429e990fc62c945f33b8`. Native client SHA256: `6a64de545edef4d8683b139da4850f8d67e962e24d4e001b920fb88394286228`. Exact archive members and private-value exclusion were verified.

Official Desktop CLI installation exited zero. The existing renderer did not activate the new client through HMR, so only the original Desktop app was normally restarted; the independent web profile was retained. Actual native accessibility and screenshot readbacks then showed local readiness and the cloud channel online. Installation comparison preserved all nine non-own plugins, 431 non-own files, profile settings and the existing private patch.

Actual Dot successfully called status and read a bounded 128-byte project README sample through the existing private connection; the official runtime's cloud interaction timestamp advanced. A controlled stop of only this connector's Tunnel caused the visible native page to change automatically to offline without pressing Refresh. After restoring the same Tunnel, its pending new-child MCP identity correctly appeared as unknown; an actual Dot status call was followed by automatic recovery to online and another interaction-time advance. Final management readback reported connected, read/task/worker online and all 22 task records retained.

No tool, cloud connection or permission was added for this fix. These observations verify the bounded live status, interruption and recovery samples; they do not establish unattended reliability or user content acceptance. Detailed private identities and readbacks remain local. No public repository or Release is claimed.

## Historical 0.5.0-preview.1 enhancements — installed; actual Dot task, archive and active-mode chains passed

Implemented in an isolated worktree: one installable native package with explicit local preparation and owned service lifecycle; separate worker polling and bounded management queue; task discovery and terminal archive; queue/steer continuation and exact native identity checks; waiting questions, original session navigation, resilient page refresh and explicit capabilities.

Final source-frozen automated suite: **329/329 passed**, zero failures/cancellations/skips, 220.84 seconds. Syntax/license/version checks, synthetic demo and deterministic native build passed. Native client SHA256: `12dba1c2b7a6caa9e0b0ea62155736bfb7b969212e1dbaa7021f986c872c6f23`.

Independent review found and then verified repairs for old-manager compatibility, a stop/start intent ownership race, incorrect external/unknown service labels, and capability refresh after backend upgrade. A checked-in source fixture from caf1cb1 exercises the real old manager through the new Host adapter, including actual one-use worker capability claim and expiration. The old backend is retained in explicit compatibility mode until upgraded; authentication failures are never interpreted as an old version.

Synthetic ego browser acceptance verified filtering, request lookup, archive/unarchive, continuation/queue/steer dispatch, waiting questions, stale/error handling and action guards, setup controls, event pagination, compatibility capability display, desktop light/dark layouts and a 390px page without whole-page overflow. This synthetic run is separate from the live native and actual Dot checks below. Private UI evidence is saved in the owner's ignored local evidence directory.

The native archive `dot-dsh-management-0.5.0-preview.1.tgz` contains 40 files, 106913 bytes; SHA256 `189c6e6860d5097e84bf6666457526d3665bc6e1578f1864aa7396621006d1bb`. Every archive member matches the frozen package source/build. It excludes private state, source-control directories, node_modules, personal home paths and the retired project identity. The author is 奥克斯木木山. No public repository or Release is claimed.

An extracted native package started and stopped real local reader/manager services on temporary ports and retained its private principal; installed dependency modules were linked for this test. A separate official Desktop CLI call against a fresh empty temporary DSH_HOME returned the expected prerequisite refusal before pnpm: initialize Desktop once, then fully quit before plugin installation. It created no files in that temporary home. The later official installation into the owner's existing initialized Desktop profile exited zero. This verifies an in-place upgrade, not a clean dependency installation into a fresh initialized profile.

The owner explicitly authorized installing the new version and restarting Harness for live validation. After a normal Desktop quit, the parent checkout was fast-forwarded from caf1cb1 to source commit 5b7ba30 and the official Desktop CLI installed the new native package. Harness was then restarted. The existing external-management mode and private token-file reference were preserved; owned management and Tunnel services were restarted and reported ready. The reader and legacy fixture process were retained. Independent installation comparison found all nine non-own plugins, 431 non-own files and the three snapshotted profile configuration files unchanged. The installed client hash matches the frozen build. No model credentials, network configuration or native WeChat UI were changed.

Live native readback showed local readiness and 18 retained/new task records. Request-ID lookup, task details, access records, connection settings and opening the original Harness session were exercised. A terminal acceptance task was archived, found in the archived list with continuation disabled, then unarchived; an independent management read confirmed its final unarchived state. These are native management checks, not claims that Dot called the new cloud tools.

Actual Dot used the existing private connection after the upgrade to read a bounded project README, create a new task, query completion, continue it in the same owned session and query completion again. A clean rerun in an ordinary project output directory produced correlated completed turns 1 and 2 with real file writes, in-memory command assertions and independent MCP file readbacks. The final proof file had the exact requested 19 bytes. A separate running command was cancelled through actual Dot; the ledger and persisted Host event agreed on cancelled/aborted. Its started marker existed, and an independent disk check more than 180 seconds after the original planned completion confirmed that the finished marker remained absent. The follow-up recovered from one FS_STALE_VERSION response by rereading and rewriting the same file before the successful assertion.

The initial sample used a temporary reference outside its requested write directory and was excluded from clean acceptance. A subsequent MCP read of that sample's protected state directory was denied and was not bypassed. The ordinary-directory rerun above is the accepted technical evidence; user content acceptance remains unverified.

The older ChatGPT connection still caches ten tools and its current management UI has no Refresh action. After explicit owner authorization, a parallel owner-only private connection using the same Tunnel was created and connected. Its actual browser tool dialog exposes all twelve tools (four Write, eight Read), including task listing/archive and follow-up mode parameters. Existing private connections remain available.

Actual Dot used the new connection's status, task listing and archive tools to find the clean follow-up by request ID, archive it, find it with archived=true, unarchive it and find it again with archived=false. The complete chain succeeded without a tool error and left the task unarchived.

Actual Dot also exercised queue and steer against two independent connector-owned sessions while each parent task was executing a real bash command. Persisted source logs place both follow-up inbox deliveries between the respective parent tool call and tool result. Queue used next-turn delivery: the parent completed turn 1 and the queued child completed turn 2. Steer used next-step delivery: the parent and child both completed within turn 1. Their output files matched the requested 10 and 11 bytes respectively, and actual Dot read both back completely through the MCP file tool without an error.

These observations verify the current twelve-tool connection's task/list/archive and queue/steer technical chains for the bounded samples, with exact message/turn correlation. They do not establish user content acceptance, generic reliability or unattended operation. Exact private connection/job/session identities, source correlations and browser readbacks remain in the ignored private evidence directory. No public distribution or Release is claimed.

## 0.4.0-preview.1 native workspace tasks — local live and actual Dot passed

The earlier public-fixture executor was deliberately one-step and tool-free; it did not implement ordinary project operation. This release adds a separate native workspace path using the existing Harness model, tools, approval policy and registered project directory. The old fixture path is compatibility-only and is disabled in the current personal MCP configuration.

Actual owner-context acceptance on 2026-10-22 used a normal registered project and two newly created connector-owned sessions:

- Create: the normal write tool created a new acceptance file; actual bash calls read and byte-compared it. The correlated first turn ended completed with a nonempty result. Independent disk read matched the requested content.
- Follow-up: the same session received a new immutable attempt, edited that file and ran another byte comparison. Turn 2 ended completed; independent disk read matched the changed content. Official MCP SDK stdio carried this follow-up request.
- Cancel: another owned session started an actual local command, wrote a started marker and entered a timed wait. Only after observing that marker was cancellation requested through official MCP SDK stdio. Harness emitted turn/end aborted and the ledger reported cancelled.
- Read-back: persisted session history returned both real user prompts, the assistant results and safely labeled injected context. Current native UserMessage content is read from data.content; the older nested format remains compatible.

Fresh final automated suite: 256/256 passed, zero failures or skips; syntax/license/default-disabled checks passed. Independent review and isolated package checks are recorded separately.

Private evidence preserves exact session/message/turn correlation and observed tool-call/turn-end metadata. No pre-existing session was prompted or cancelled. Only the own renderer entry was hot-reloaded; only owned management/read/tunnel services were restarted. No original model key, Host restart, WeChat operation or network setting change was required.

The owner-authorized new private cloud connection discovered all ten tools: six reads and four native task tools. Actual Dot then called native create, queried the result and issued a follow-up. The two distinct jobs share one connector-owned session; both correlated turns ended completed and their results were returned to Dot. This is external Dot execution evidence, separate from the local SDK checks above. Exact identifiers and private project text are retained only in private evidence.

Actual Dot also exercised native cancellation in a separate owned session after a real bash command had started. The cancel call and subsequent get returned cancelled/aborted. Independent Host history recorded turn/end aborted and an aborted tool call, rather than inferring cancellation from idle state or a default task timeout. After the command's original planned completion time, an independent disk check confirmed that its later completion marker had not been written.

User content acceptance and public distribution are separate, unclaimed checkpoints. See [native-execution-usage.md](native-execution-usage.md) for setup and official session-level cancellation concurrency limits.

## Historical 0.3.0-preview.3 native management recovery

The actual Desktop page now reports connected, both read/task backends online and admission open. After the official own-package upgrade, native readback passed for overview, 29 audit events (including the second page, items21–29), and2 owned jobs. Refresh also succeeded. This verifies the management UI; no new model task or content acceptance is claimed.

The primary failure was a missing injected `remote.dotDshManagement` namespace in the real Cordis plugin scope. The complete browser-factory/React regression reproduced a throw before any RPC, then passed after mounting and registering the page from the injected child context. Separate wire tests cover error responses through actual Gateway dispatch, JSON serialization and the official Connection parser; explicit empty RemoteError details preserve error codes.

At the 0.3.0-preview.3 checkpoint,183/183 tests passed, zero failures and skips; syntax/license/default-disabled checks and the synthetic demo passed. Independent review passed. Only the own frontend entry was hot-reloaded for diagnosis; temporary probes were removed. The formal own-package upgrade preserved every non-own manifest field, bundle order, profile patch and all765 snapshotted non-own JavaScript files. Original Desktop/Host and all four owned service process start times were unchanged. No original model, network or WeChat operation was needed.

Earlier layer evidence follows; it is not a new execution or acceptance claim.

| Layer | Observed evidence | Status |
| --- | --- | --- |
| Source/core | Public-project allowlist, fixed descriptor reads, durable idempotent jobs, exact provenance and cancellation | Implemented and tested |
| Native public SDK | Official 0.2.1-rc.2 AgentLoop with deterministic synthetic provider; explicit zero-network assertion | Local API compatibility verified separately |
| Original running DSH/companion/WeChat/Lab | Shared-host prompt providers may read ambient data before per-agent filtering | Blocked by design; not installed, restarted or reconfigured |
| Independent narrow DSH host | Constant SystemPrompt, Llm, Sessions, Projections, Tools, Agents, AgentLoop, DefaultModel and one official adapter; no broad profile inheritance or credentials-local | Real isolated process started; only new model-key reference exposed to SDK snapshot |
| Local MCP loop | Official SDK stdio → authenticated loopback HTTP → core/store → deterministic executor | Synthetic integration passed separately |
| Platform account and transport | Official Tunnel associated with authenticated organization/workspace; restricted Read+Use runtime key; official tunnel-client v0.0.16 managed runtime ready | Live account path verified |
| ChatGPT private plugin | DeepSeek Harness Connector connected through official custom MCP Tunnel UI; five tools discovered | Live discovery and calls verified |
| Actual Dot public read | Existing user Dot called list_projects/read_project_context; README.md 279 bytes with matching SHA256 | Real external read verified |
| Actual Dot model task | Accepted job then same job succeeded/completed, session/message IDs, turn 1, model text, source hash and no truncation | Real model path verified |
| Actual Dot cancellation | Separate job observed running, cancel_requested, then cancelled/aborted for same session/message/turn | Real cancellation verified |
| New Harness read implementation | Six optional exact-name read tools; separate31471 service, persisted storage snapshots, bounded files and operator-registered contexts; no existing-agent activation | Implemented and tested; actual Dot minimum read loop verified |
| New Harness local readback | Main-thread local probe read existing catalog/session metadata and bounded instruction/skill files with source hashes; public logs retain no private bodies | Local probe reported passed; does not prove actual Dot calls |
| New Harness actual Dot read | Existing personal Dot saw six added tools, read workspace/session pages, persisted session text and instruction/skill/project-file samples; file hashes matched local probe | Actual external minimum read loop passed; main-thread evidence read back |
| User acceptance | Both results retain acceptance:unverified | Awaiting user's content judgment |

## Historical fixture external evidence and scope

The earlier fixture integration exposed only connector-fixture/README.md. Source SHA256:

`009ec8ddc667c6e69152285b834d559d66838174c31142645fc448e88b60df25`

The fixture text is synthetic public material. The completed task used the actual official API-key adapter in the separate real-mode DSH process, configured for deepseek-flash; it did not use the deterministic synthetic adapter. The public task response does not carry an independently returned model identifier, so that route is evidenced by the host configuration/composition, not by a claimed model label in the response.

Dot run markers: DSH-PROBE-20261019, DSH-NATIVE-20261019-A, DSH-CANCEL-20261019-B. Model task A completed in about 2.4 seconds with exact turn 1 correlation. Task B ended aborted in about 13.7 seconds; its result is null. Full job/session/message IDs, source readbacks, account resource identities and browser evidence remain only in the operator's ignored private .dsh directory. No account identifiers or secret values are distributed in this package.

An account-side task call during the preliminary probe returned BACKEND_OFFLINE and created no jobs. After switching the same loopback endpoint to the narrow host, the same external tool path submitted and retrieved actual tasks. Probe success and model execution are separate checkpoints.

## Historical 0.2.0-preview.1 authorized Harness read expansion

The owner explicitly authorized all ordinary existing Harness content, including projects, saved sessions, normal files and registered memory/skills/instructions directories. Credential files remain excluded; secret-pattern redaction is best effort. The single-owner private Tunnel/plugin binding remains required. Read results are source material, not instructions, and are not automatically submitted to the independent fixture-task model.

The new service reads persisted storage; it does not invoke live context assembly, skills/list, agent activation, session resume, migration/repair, prompts, or writes. Persisted history may include inherited source events and is not a claim about the current effective model context or unsaved live memory. Global skill roots and canonical operator-resolved skill directories are separate from the empty-or-populated Harness-home skills directory. Instructions roots are limited to AGENTS.md. See [harness-read-usage.md](harness-read-usage.md) for configuration and continuation semantics.

The main thread confirmed and read back actual Dot evidence for the new surface, marker DSH-READ-ACCEPTANCE-20261019-01. This is a separate external checkpoint from local probes and the older fixture task loop. Private workspace/session identifiers, names, bodies and account details are not published.

Observed bounded coverage:

- Workspace catalog returned23 entries; saved session catalog reported87 sessions. A five-item session-list request returned5 entries and a continuation.
- A five-item persisted session read returned5 text items with source existing_harness_persisted, has_more:true and next_offset:2048. The session identifier and title remain private.
- Global instructions sample:9081 bytes, SHA256 `1b0e6b20839a10755b671582499a2f520fa582e52e2f6e101583064e27640ff7`.
- Skill instruction sample:8323 bytes, SHA256 `a80ca9d55744489aa1359397bc0255586f5a079d6af4b28864c026f48dced0f6`.
- An existing project README sample returned9724 bytes. All three file samples returned eof:true and redaction_count:0; available file hashes matched the main-thread local probes. Zero matched redactions is not proof of universally secret-free prose.
- The main thread also successfully called harness_status through the current connector. No existing agent activation, model-history forwarding or write was required.

These observations verify the minimum read loop and continuation contract for the samples, not an exhaustive audit of all87 sessions or every file, live-memory equivalence, reboot persistence or user acceptance of model output. Detailed evidence remains in the ignored private operator directory; no private body is retained here.

## Historical 0.2.0-preview.1 validation

At the source-frozen0.2.0-preview.1 checkpoint,125/125 tests passed, zero failures and zero skips(27.52 seconds); check passed with21 JavaScript syntax files, Python descriptor IO, licenses and default-disabled checks; synthetic demo1/1 passed(2.74 seconds). Commands ran sequentially with a cleared credential environment and public/synthetic fixtures. These counts, like the earlier fixture baseline62/62, are historical. The current release command outputs are test-results.tap (local execution output omitted), check-results.txt (local execution output omitted), and demo-results.tap (local execution output omitted); they do not preserve every earlier run. Synthetic diagnostics cannot substitute for live evidence above. Tests requiring the public installed SDK report an explicit skip if unavailable.

Independent review covered probe identity/read-only boundaries, the official adapter namespace and endpoint, owned cleanup, and secret-safe errors with an intercepted mock 401. The real launcher uses a minimal execve environment and an explicit SDK launchEnvironment snapshot containing only the newly supplied model-key reference. Provider diagnostics remain in private local logs; only ready metadata and sanitized core results are shared.

## Historical fixture/read review repairs

- Fixed Python openat/O_NOFOLLOW directory-descriptor walks prevent pathname replacement and symlink/hardlink reads.
- State is capped at 16 MiB and 100 maximum-size records; retries retain original job identity.
- Any foreign inbox claim fails mixed_input and hides partial text; truncated results are labelled.
- The legacy fixture executor requires an explicitly clean independent host before prompt/model route access. Configuration is an operator attestation, not an OS sandbox. The current native workspace path instead uses the existing owner's normal Harness Host.
- Lifecycle rollback and owned cleanup are checked after asynchronous acquisitions, including startup abort.
- Real adapter uses the official plugin namespace, fixed https://api.deepseek.com/anthropic and redirect refusal; no inherited endpoint override.

## Historical credential handling incident

During the 2026-10-19 fixture trial, the initial Tunnel key was accidentally exposed by a browser snapshot while overlapping scripts operated different pages. It was never used, was immediately revoked, and Revoked status was read back before replacement. Its value is not retained here. At that checkpoint the replacement key had only Tunnels Read+Use and an expiry of 2026-10-26. A separate newly created DeepSeek test key and independent bridge token were privately stored. Subsequent browser work was serialized and secret dialogs closed before other page inspection. No existing model or WeChat token was copied.

## Previous running 0.4.0-preview.1 path and remaining limits

The normal Harness Desktop/Host, native plugin/renderer worker, owned management and read services, and private Tunnel must remain available for their respective calls. Native workspace tasks can edit project files and run commands using the existing model, tools and approval policy. The separate31470 fixture host is needed only for the retained legacy path.

The `existing_harness_read_only` value returned by `harness_status` describes the six persisted-read tools. It is not a statement that the whole ten-tool connection lacks native task permissions. Read responses remain persisted source material, without unsaved live memory; the reader itself does not resume or mutate sessions.

This preview does not claim reboot persistence, unattended operational reliability, arbitrary absolute-root access, credential access, multi-user identity separation or user content acceptance. Cancellation is session-scoped, does not undo completed side effects and has the documented manual-concurrency window. No native WeChat UI, daily Chrome, SSRUN/system proxy or WARP configuration was operated for this implementation.

## Official references checked

- [Dot computers and apps](https://learn.chatgpt.com/docs/dots/computers-and-apps)
- [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Official tunnel-client release](https://github.com/openai/tunnel-client/releases/tag/v0.0.16)
- [DeepSeek current models](https://api-docs.deepseek.com/quick_start/pricing/)

## Historical native management0.3.0-preview.1

A separate thin native package adds the Dot connection sidebar/main page and owner-only Remote; the existing connector adds a metadata gateway and separate-token administration service. The task/read backends are not merged or restarted for this management feature. No new arbitrary execution authority is introduced.

Focused tests and independent review repaired stale job imports/late replies reverting confirmed results, stale UI connection/list display after read failure, late cross-page task details, cached-detail cancellation, and public Cordis disable-field correctness. The public native row uses disabled:true; a private owner deployment may configure only its own row with disabled:false/config enabled/tokenFile reference.

Synthetic browser QA in a dedicated task space verified pause/resume, event filtering and20→5 item pagination, empty state, task detail and exactly one confirmed cancellation. Offline data removed stale rows/online status and disabled pause;390px viewport had390px document width. Local synthetic image inspection found readable text and no overlapping controls in desktop and narrow dark layouts. The optional vision bridge returned model_not_found and was not reconfigured; local image inspection was used. Native-window automation twice timed out without any action, so a native sidebar observation remains a separate checkpoint.

Audit retention boundary fixtures now seed a valid private snapshot from a real begin/finish/close template, then exercise actual read/write/reopen around the boundary. This avoids repeating over1,000 physical fsync operations. This run verifies500 pending records recover to unknown and501-row snapshots fail closed, plus real pending-preservation and job-cap operations; the previous focused run separately exercised500 live pending writes successfully. No production-only test bypass, fsync mock or skip was added.

At this historical checkpoint, full-source validation passed168/168 tests with0 failures,0 cancellations and0 skips(120.2 seconds). check passed, demo1/1 passed, and native UI build/JavaScript syntax passed. The shared command-output files now describe the current release rather than this earlier run. Historical archive checks, actual gateway/Dot ledger and native installation readbacks follow. The earlier125-test and fixture proofs are separate historical layers.

### Actual management deployment readback

Official Desktop CLI installation exited0. The standalone0.3.0-preview.1 package is registered in the desktop dependencies and selected bundles; its own personal deployment row is enabled with only a new dedicated token-file reference. Installed client bytes match the frozen source/build hash. No original-host restart, sibling change, model configuration or network operation was issued. Package/selection/configuration readback does not establish native sidebar display; native-window automation timed out twice without an action. That last visual checkpoint remains for owner confirmation.

The owned management process is running on31472/31473. Original task/read processes retained their observed PIDs; the same managed private Tunnel was restarted only to use the new gateway. Admin adapter readback found both backends online, imported2 connector-owned tasks, and refreshed an existing terminal task without replay. Pause returned CONNECTOR_PAUSED for a new read, resume restored the same read scope, and job-list responses exclude full results.

Actual Dot marker DSH-MANAGEMENT-AUDIT-20261019-01 called harness_list_workspaces once with offset1/limit2. Dot returned2 items,total23,source existing_harness_persisted. The owner admin ledger independently contained one matching successful read event with count2. The source channel remains one fixed owner binding; the observation comes from the sent Dot marker and matched readback, not an invented per-caller identity in the ledger. Admission was left open. Raw evidence and secret references remain under ignored private .dsh.

### Package verification

Both public archives excluded .dsh/.agent/.git/node_modules and all four owned secret values. The connector archive passed unpacked npm ci, check and demo; the standalone native archive passed unpacked dependency install with scripts disabled and an inert-default import/apply check. Private personal deployment data and reference paths are not part of those public archives.


### Native activation fix0.3.0-preview.2 — 2026-10-20

The owner observed a visible native page with a connection-read error. All four owned ports were listening and the direct admin adapter returned both backends online. A complete native module installation into the actual public Cordis runtime reproduced `TypeError: Invalid effect`: the native `apply` returned a status object, but Cordis accepts only an absent return value or a disposer. Cordis withdrew the Host plugin while the independently discoverable frontend remained visible. The prior Gateway tests mounted only the service and bypassed that plugin lifecycle.

The minimal fix makes both disabled and enabled native `apply` branches return undefined, preserving owner checks, six methods, fixed admin route and scope-owned cleanup. Two new tests directly load the complete exported plugin through Cordis. Both failed with Invalid effect before the fix; enabled/inert activation, a real admin adapter with synthetic HTTP transport, service withdrawal and abort cleanup pass after it. Independent review found no blocker. Full suite170/170 passed with0 failures/0 skips; check, demo and deterministic client build passed.

Official Desktop plugin installation of the owner-specific0.3.0-preview.2 archive exited0. Installed source bytes and version match the fix. A separate temporary Context using the original application's public SDK loaded the actual installed complete plugin and successfully invoked overview, event and job reads against the real admin backend: connected, both backends online, accepting,8 events and2 owned jobs. It loaded no agents or sessions and was disposed after the probe. This is a real plugin/SDK/backend proof, not a browser-carrier proof.

Native AX readback now shows the installed management plugin enabled without an abnormal status. The already-open connection page still needs a successful refresh readback: CUA could read the native window but did not reliably dispatch clicks, and one coordinate attempt reported noWindowsAvailable. No original host/task/read/manager process was restarted, no authentication fence was bypassed, and no native WeChat UI, model or network configuration was touched. Detailed installation and live-verification evidence is retained privately.
