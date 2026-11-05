# Dot remote questions and single-operation approvals

The owner approved the source-review recommendation and end-to-end implementation on 2026-11-05. Deliver the first priority: a task dispatched by Dot can ask a question or request one operation's approval, receive the user's specific response through Dot, and continue under Harness's normal policy. Existing desktop-session adoption and unsolicited notifications remain separate follow-on work.

## Native integration

Use the official Client `uiSession.sessionStatus` pending-interaction carrier. Borrow its `answer()` method with its original receiver; do not replace the Host waterfall, create an Agent, close/delegate the official card, simulate a response with `session.prompt`, or change the configured question timeout. Exact public carrier contracts are verified on SDK rc.2/rc.3/rc.4/rc.5 and 0.2.2-rc.1. Client background sessions are represented by the official session-controller retention and pending-domain aggregation; opening their main view is not required.

For every inspection or decision, retain the existing workspace, session, prompt-message and turn checks. A pending carrier must belong to that session and its exact owned native tool call. For legacy questions with no carrier call ID, require a unique unanswered question call in the owned turn and matching question contents; ambiguity is unavailable, never an arbitrary choice. Before `answer()`, re-read native history and the official carrier, and require the same live object, key, kind and call identity. Teardown clears only connector handles.

## Public protocol

`harness_get_task` returns a bounded `interactions` list and bounded `interaction_operations` receipts. Each interaction has `interaction_id`, `kind` (`question` or `approval`), `call_id`, `turn`, `message_id`, plus exact bounded questions or a tool name/reason. Unavailable/truncated or foreign requests are not actionable.

Add two effectful tools:

- `harness_answer_question({job_id, interaction_id, request_id, answers:[{id, selected:[label], custom?}]})` submits the official structured question answer. Question IDs, option labels, cardinality and free text are validated against the complete request.
- `harness_decide_approval({job_id, interaction_id, request_id, decision:'allow_once'|'deny'})` settles precisely that approval. No persistent or allow-all outcome exists.

Responses initially acknowledge a durable control operation, not task completion. Inspection returns its `accepted`, `applied`, `failed` or `unknown` receipt. Identical request IDs and input return the same operation; conflicts reject. A control response never creates a follow-up job or changes the original prompt identity. It bypasses ordinary prompt FIFO and uses the existing authenticated claim/lease/report transport. Cancellation supersedes unclaimed controls. Pausing blocks answers/allow-once, while an explicit denial remains available.

Question continuation is real native continuation: keep an unanswered timed question visible after the original foreground turn ends. A late official answer can create a `user-question-reply` turn. Only a previously verified call ID with an applied connector answer can establish that continuation; unrelated messages cannot. The original task waits for the correlated continuation's terminal event. A disappearing question or idle Agent is not completion evidence.

## Confirmation and failure boundaries

Dot must show the concrete question or operation and obtain the user's specific response before using these tools. The server enforces request identity and allowed-once semantics; it does not claim that a model-supplied boolean proves a human click. Current client elicitation capability is unverified. No new account, browser or authorization ceremony is added merely to create such a claim.

Persist control intent before dispatch. Expired leases, process restart or ambiguous reporting become unknown and are not replayed. Re-read the official request before any new decision. Do not log answer text, raw tool arguments, credentials or private failure strings in the audit trail. Existing authentication, origin and byte limits remain.

## Acceptance

Tests must fail before implementation, then cover normal structured/free-text/multi-select replies, allow-once and deny, legacy and timed questions, exact identity, manual takeover, replacement/expired requests, duplicate/conflicting controls, report loss and restart, pause/cancel races, and control-lane progress while the Agent waits. A real public-SDK component/Host test must suspend a deterministic turn, use the production worker control path and observe its correlated completion. Mock-only tests are insufficient.

Release only after current official Desktop/SDK discovery, all declared SDK risk regression, isolated official Host install/enable/restart/uninstall, immutable Trusted publication, npm exact/latest and installed-byte readback, and canonical repository/assets/market checks. Distinguish those receipts from a fresh real-Dot read/response and from human acceptance. Preserve production profiles, connection identities and other plugins.
