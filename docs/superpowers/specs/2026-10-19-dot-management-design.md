# Dot 接入管理 design

Owner approved the four-part design in chat: connection/permissions, access history, task detail, and pause/cancel. This extends the existing connector; it does not expand task authority or merge the unrelated DSH companion.

## Runtime and authority

Keep existing task31470 and persisted-read31471 processes intact. Add an owned management gateway31472 serving the exact existing11 MCP tools and an independent admin-only bridge31473 serving six fixed manager tools. MCP routes both existing tool groups through31472. Gateway forwards each tool to its existing backend without fallback. Admin bridge uses a newly generated separate token, never the MCP channel token. Neither token reaches client JavaScript.

A separate thin native DSH package `dot-dsh-management` in `management-plugin/` injects Typert registry only and proxies fixed manager tools to the admin bridge. A native Remote contribution and shared React client register one root sidebar/main panel through the documented native slots. It does not load AgentLoop or broad prompt providers. Default plugin config is disabled. No mutation of sibling plugins, old sessions, network, WeChat or credentials. Installation must use official package management and verified HMR; do not force an original-host restart.

## Records and controls

Persist bounded private state under an operator-selected canonical directory, with0700 directory/0600 files, no-follow ordinary single-link files, atomic replacement and an exclusive owned lock. Retain500 events and100 task snapshots; disclose retention limits and recording start. Save the attempted event before forwarding. Unknown outcomes remain unknown after timeout/restart; never replay. Record only selected target IDs/relative paths, tool, timestamps, outcome/error code and aggregate/hash response metadata. Do not retain session/file bodies or arbitrary raw errors. Redact task text/results before storing job detail. Actor is the single owner connector channel, not an invented verified Dot/Codex identity.

Import only known existing connector task snapshots from an explicitly configured owned `state.json`, read-only, filtered to the fixed principal. No scanning other Harness histories. Past read calls have no durable ledger and cannot be reconstructed.

Pause blocks new reads/new task submissions; get_task and cancel_task remain available. It does not cancel ongoing work or terminate any host. Resume restores the same scope. Cancellation accepts only imported/observed connector-owned job IDs and records requested versus actual terminal state separately. No re-run button.

## Admin contract

`manager_overview({})` returns connector acceptance state, task/read backend health, granted scope, recording/retention summary.
`manager_events({offset?,limit?,category?,outcome?})` returns newest-first bounded event pages.
`manager_jobs({offset?,limit?,status?})` returns connector-owned job summaries.
`manager_job({job_id})` returns redacted detail and refreshes via the existing get_task tool.
`manager_set_paused({paused:boolean})` persistently changes admission only.
`manager_cancel({job_id})` invokes only the existing cancel_task for an owned job.

No manager tool is exposed through MCP. Admin request bodies reject extra roots/URLs/headers/methods. All network addresses are canonical numeric loopback with fixed /rpc and no redirects.

## UI

Direction: restrained developer console matching the host theme, white/near-black and host dark mode; system UI font plus monospace identifiers. Header shows connection/admission status and refresh/pause action. Tabs: 总览、访问记录、任务. Dense readable tables with filters, clear empty/error/partial states, task detail drawer or side column, and explicit result truncation/cancellation labels. Four small status cells rather than nested large cards. No decorative graphics, gradients or remote fonts. Small screens collapse detail below the list. UI text explains that these are connector records rather than complete Dot/Codex conversations.

## Validation and delivery

TDD storage, gateway admission/routing/audit privacy, separate admin authorization, imported-job ownership and cancel semantics. Native wrapper tests exercise fixed method mapping and teardown. Browser QA runs the actual panel component with a synthetic adapter, including empty/failure/pause/detail/pagination states; native host install/readback remains a separate acceptance step. Run existing full suite, check, demo, build/package, archive private/secret scan and unpacked smoke. Upgrade only owned connector processes, preserving live existing task/read backends. Verify actual Dot read generates a new event and pause/resume behaves as labelled. No claim of native installation until the DSH sidebar and page are observed.
