> Current integration: [Astra + DeepSeek](astra-deepseek-workflow.md). Enabled exclusive-pod idle control now defaults to verified deletion; `GPU_IDLE_ACTION=stop` explicitly retains the historical stop-only behavior described below. No external spending policy was enabled by this code change.

# Production spending controls

Implemented on 2026-09-05 and deployed for the authorized Medium trial on 2026-09-06. The production admission ledger was enabled with a bounded allowance; see [the trial report](medium-e2e-2026-09-06.md) for results and shutdown status. GPU idle shutdown remains optional and was not enabled in that trial.

## Audit of the last OpenAI test

The production asset ledger contains five generated PNGs, all from production `71881316-2255-4612-a0f2-18c52c01c628`, saved 2026-09-06 03:35–03:38 UTC. Configuration was `gpt-image-1.5`, high quality, 1024×1536, one output per request, with product and continuity references. The published output price is $0.20 each: $1.00 for five outputs, plus billed inputs. Reference transcription also used OpenAI.

The authenticated billing dashboard showed $1.59 monthly spend on the configured key and −$0.89 account balance. Monthly key spend is **not** an invoice for these five images. Historical requests did not persist token usage, so exact per-image charges cannot be reconstructed from our database. Two subsequent revision attempts failed with `credit_balance_exhausted` and produced no new saved images. Internal credit refunds are not provider cash refunds.

Pricing source: https://developers.openai.com/api/docs/models/gpt-image-1.5

## Admission budget

Migration `20260906044611_production_spending_limits.sql` was applied before deploying the updated Pages API. The operator-only `production_spend_policy` starts at **zero**, blocking paid production until explicitly funded. Do not enable while the user's services are paused.

- All values are integer millionths of USD, not customer credits.
- `project_limit` is cumulative per project across retries, revisions and repairs.
- `total_limit` is cumulative across all production reservations. It is not reset monthly.
- `rates` must contain positive estimates for `planning`, `image`, `narration`, `clip`, `quality`, and `assembly`. Clip units are five-second blocks; the other rates are per operation.
- Include conservative input-token, voice-length, QA, CPU/GPU runtime and prompt-writing allowances in those rates. No real rates or spending authorization are seeded by this change.
- A database lock serializes global and project reservations. A repeated step key does not reserve twice. Completed media reuse avoids a new reservation.
- Failed/uncertain provider calls keep their reservation because they may have incurred a cost. Customer credit refunds remain separate.
- Before each paid production step, the worker API reserves its estimate. A rejected reservation prevents admission of that step, preserving prior assets.
- Successful OpenAI image step results now retain `usage`, model, size, quality, reference count and request ID for later reconciliation.

These are **estimate-based admission limits**, not a guarantee that a supplier's final invoice cannot exceed the estimate. They cover the automatic production pipeline; standalone chat/reference analysis and unrelated API consumers are not covered. External API billing limits and reconciliation remain necessary before a public paid rollout. Do not advertise an absolute invoice cap.

## GPU idle shutdown

The optional stop-only controller runs alongside the CPU workers when explicitly enabled. Configure on the controller host:

- `GPU_IDLE_ENABLED=true`
- `GPU_MANAGED_EXCLUSIVE=true` (the designated pod must be used only by this job queue)
- `GPU_MANAGED_POD_ID` (one existing, explicitly authorized pod)
- `RUNPOD_API_KEY` (secret, never browser-side)
- Existing `CREATIVE_RUSH_URL` and `PRODUCTION_WORKER_TOKEN`

On Pages, configure `GPU_IDLE_ENABLED=true` and optional `GPU_IDLE_SECONDS` (default 600, minimum 300). The authenticated `/api/gpu-idle` endpoint starts the idle timer only when no queued/running production or GPU job exists. Its database lock serializes with GPU claims; after draining begins, late claims cannot start. Running jobs with stale leases also prevent shutdown until their outcome is resolved. The controller calls only GET pod and POST stop, never create/start/delete. A 404 never causes replacement rental. A failed stop leaves draining active and is retried; it never reports success merely because a request was accepted. A later GET observes the stopped state.

This first version **does not auto-wake**. To resume later: disable the controller, explicitly resume the existing pod, then reset `gpu_idle_control` to `draining=false,idle_since=null` before accepting work and re-enabling monitoring. Do not run manually submitted or other applications' jobs on this managed pod. Storage may still be billed on a stopped pod.

With the CPU host suspended, its controller cannot run. This code is not an active watchdog until configured and enabled. The Medium trial used manual infrastructure shutdown, so it does not validate this controller against a live pod. A later independent scheduled controller would avoid depending on the renderer's uptime.

## Validation

Twenty targeted tests passed, including provider usage retention, route-level budget rejection, concurrent reservations, retry accounting, GPU draining and mocked RunPod failures. Pages Functions compiled successfully. The broad suite completed with 141 passes, one skip, and one unrelated existing onboarding failure because this isolated checkout lacks `ecom-index.html`; the subsequent added usage test also passed. No live provider calls were used for validation.
