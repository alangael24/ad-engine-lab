# Autonomous ad delivery acceptance protocol

Status: prepared, not executed. Spending cap proposed below is not approved.

## Scope and fixed inputs

Three sequential, new 40–45-second ads through the customer web flow:

1. Nebula, skeleton; existing approved skeleton video as reference.
2. Nebula, explanatory 3D; existing approved Zack video as reference.
3. Furbedz, claymation; existing approved claymation direction as reference.

Use product/reference inputs only, generate and approve a script through normal customer actions, then create new media using the deployed providers. Do not reuse finished clips, locally inject generated assets, use Codex image generation as a substitute for the production image API, or replace a failing provider silently. Do not publish these test ads to ad platforms.

Record the exact model IDs, provider routes, reasoning settings, prompts, code commit, workflow manifest, container digest, render configuration and asset hashes before starting. Keep Astra direction and DeepSeek execution if that is the approved production profile. Actual deployed identity must be verified, not inferred from local defaults. A subscription-backed model call may have an API-equivalent estimate but is not an API invoice.

## Entry gates

- Reconcile pending local changes and deploy one reviewed release. Verify Pages, CPU worker, database migrations and GPU container all match it. Freeze only after intentionally selecting the release. The release preflight reviewed the pending H3 recovery and speech-editing changes before intentionally regenerating the lock; verify it again against the deployed commit.
- Confirm image, narration and language-model access without generating media where possible, and read current balances. Historical balances are not approval to spend them.
- Confirm the shutdown controller has working control credentials and independent timeout cleanup. Verify actual per-worker state and billing; an endpoint health rollup alone is insufficient.
- If the current H3 configuration has no artifact-backed successful inference, perform one bounded 5-second clip before full ads. Inspect any existing successful job first to avoid paying for redundant diagnostics. This smoke run is separate from the three ad results but counts toward the validation budget.
- Honor the user's constraint: Serverless RTX 5090 only, no fallback GPU or dedicated pod, minimum workers zero, maximum one during authorized execution. No always-on workers.

## Run conduct

Use a dedicated customer test account and the real UI and queue. Operator actions are limited to normal customer actions: supplying inputs, reviewing the script and downloading results. Record these separately from engineering intervention.

No manual prompt rewriting, asset replacement, database completion updates, timing repairs or source-code edits mid-run. Automatic retries and model reviews count toward cost and time. If engineering intervention is needed, record a failed autonomous run, safely stop it and fix the issue before a new frozen batch. Do not relabel a rescued output as autonomous.

First run observes cold-start behavior. Second observes actual worker reuse or additional cold start, without assuming warmth. Third includes one requested small text change after delivery. Verify it preserves unaffected asset IDs/hashes and does not generate new images, voice or clips unnecessarily.

Test browser reconnect and repeated submit using stable idempotency keys. Verify the same job is recovered and only one customer charge exists. Simulate provider response loss/retry and refund faults offline against the same release; do not deliberately corrupt paid production jobs. Passing offline simulations is distinct from live recovery evidence.

## Ledger per run

Record job/customer request IDs; timings for approval, first preview and downloadable completion; all provider request IDs; input/output/cache tokens; image model, quality, size, attempts and billed usage; narration units and attempts; GPU queue/preparation/inference/idle intervals; render, storage and transfer; refunds; actual charge versus API-equivalent estimate; any operator rescue. Unavailable costs are unknown, never zero. Reconcile delayed GPU billing before declaring a settled total.

Proposed validation ceiling: USD 20 for the whole batch including smoke and retries. Target variable cost: <= USD 6 per delivered 40–45-second ad. This is a proposal, not a measured cost or spending authorization. Enforce reservation before requests, stop admitting further work before the cap, and include in-flight liabilities and shutdown latency. If a hard cap cannot be enforced for a provider, disclose that before starting.

## Pass criteria and exit

- 3/3 delivered through the real customer flow with no engineering rescue, fixed release and provider configuration.
- Each final video downloads and decodes, uses the approved script/product/style, has intelligible synchronized narration and legible captions, and has no material repeated shots, accidental stills or continuity defects. Minor differences without viewer impact are not automatic failures.
- User approves each final result. Passing mechanical checks alone does not prove ad quality or profitability.
- Costs are complete and within the approved cap; the per-ad target is evaluated using all attempts, not just successful provider calls. Show every run, including failures, rather than cherry-picking the average.
- Retry/reconnect and the small edit preserve unaffected work and do not double-charge.
- Stop GPU work after completion, cancellation or failure. Confirm min/max zero, per-worker list, queue status and final billing state; investigate contradictory control/runtime records instead of assuming shutdown.

Three successes qualify only a limited monitored beta for these formats. They are not evidence of universal reliability or profitable advertising performance.

## Initial read-only observations

- Local HEAD: `903a066e689a2e9dbd7b808b5bb67f5a51c92644`; pending changes exist and the production workflow freeze check fails. Deployed CPU/web commit is not yet verified in this protocol.
- Runpod `creativerush-h3` (`0kkj6hcrybk9xi`) and `creativerush-h3-registry-test` (`21qymzqesukalm`) both read min/max 0/0. Both per-worker lists were empty, and the pod list was empty. Queue/in-progress counts were zero.
- Registry-test's health rollup still reported one running worker while its control-plane list was empty. Shutdown/billing evidence needs reconciliation; do not treat that discrepancy as either proven billable compute or proven zero spend.
- Endpoint cumulative completed counts are not evidence that the current configuration produced valid H3 video: inspect job output and artifact provenance before using them as a readiness gate.
- No GPU mutation or generation request was issued during this preparation.
