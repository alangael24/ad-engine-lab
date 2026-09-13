# MiniMax H3 on Runpod Serverless

CreativeRush's CPU host runs `h3-worker.mjs` when `H3_SERVERLESS_ENDPOINT_ID` is configured. It advertises endpoint availability even with zero GPU workers, claims the existing database queue, obtains a signed private upload URL, submits one job and maintains its lease while polling Runpod. H3 runs the same server-owned turbo8 Comfy graph as the Pod adapter. The GPU uploads the MP4 directly to private storage; the backend verifies it before completing the generation.

## Deployment settings

- Image: build `.github/workflows/h3-serverless.yml`; deploy its immutable commit tag/digest from `ghcr.io/alangael24/creativerush-h3`.
- Queue endpoint; one RTX 5090 (`ADA_32_PRO`), CUDA 13.0 or newer.
- Minimum workers **0**, maximum **1**, idle timeout **60 seconds**, execution timeout **1200 seconds**, queue-delay scaling 4 seconds, FlashBoot enabled. New lifecycle limits: pending application queue **120 minutes**, provider preparation **45 minutes**, execution **20 minutes**, provider TTL **70 minutes**, reconciliation grace **2 minutes**. Preparation and execution are distinct. Restarting the coordinator does not reset these clocks. These are ceilings, not expected durations or a price guarantee.
- Cached model: `Comfy-Org/MiniMax-H3`. The handler checks all eight known files and links Runpod's host cache into Comfy. It fails fast if missing instead of downloading weights on paid GPU time.
- Container disk 30 GB; no persistent network volume needed. The current upstream repository includes multiple quantizations (~477 GB total), although this worker links only the eight required files (~69 GB). Runpod currently caches the whole repository; the first uncached provisioning can therefore be slow. Do not substitute a paid, in-container download as a workaround.
- Endpoint environment: `H3_STORAGE_ORIGIN=https://<project>.supabase.co`. Do not expose the app worker token, Runpod key, or Supabase service role to GPU jobs.
- Temporary test-only `H3_ALLOW_SMOKE_OUTPUT=true` permits a small base64 MP4 without signed storage. Remove after validation.

CPU host environment: `H3_SERVERLESS_ENDPOINT_ID`, `RUNPOD_SERVERLESS_API_KEY`, `RUNPOD_CONTROL_API_KEY`, `GENERATION_WORKER_TOKEN`, `H3_WORKER_ID=h3-serverless-main`, `CREATIVE_RUSH_URL`. `GPU_IDLE_ENABLED` must be false (the old Pod controller is a separate mechanism). The new bridge refuses to start without the control credential, because inference-only access cannot enforce endpoint shutdown after a failed startup. Keep both Runpod credentials on the CPU host, never in GPU jobs, browser bundles, model context or logs.

The inference credential needs inference read/write. The separate control credential needs read/update access to the configured dedicated endpoint through the v2 REST API. The code only patches `workers.min=0, workers.max=0`; it never changes GPU type, image or environment, or scales upward. A 5090 Serverless rate of $1.58/active-worker-hour was returned by the GPU catalog on 2026-09-11. Initialization, execution, and the brief idle timeout are billable; model-cache download time is not. Execution-time logs alone are not a full invoice. Use endpoint billing to reconcile startup and idle overhead.

## Recovery and limitations

Persist `rp:<endpoint>:<job-id>` in the existing provider ID field. A coordinator restart resumes that ID, never calls `/run` again. An expired CPU lease is reclaimed with a new token, preserving the submission and absolute deadline. The former owner cannot finish, refund or cancel the new owner's work. Only one serverless generation is dispatched globally in the current single-endpoint deployment.

`H3_WORKER_ID` is the human-readable prefix; each CPU process appends a UUID. Overlapping deployments therefore cannot accidentally share one lease identity. Recovery-only claims bypass GPU readiness and remain permitted while admission is paused.

Before declaring failure, check the generation's private storage path. An uploaded result can finish the application job even if the submit or completion response was lost, or Runpod expired its result record. A storage outage is not treated as an absent file. An unknown submit acknowledgement stays pending until its original TTL plus grace; it is never blindly submitted again. Signed references last two hours and are not re-signed when resuming an already submitted job. Known cancellation is checked with provider status; an accepted cancellation alone is insufficient. Completed scenes remain available if a later scene fails; refunds stay idempotent.

Preparation timeout or provider failure before execution trips a persistent circuit breaker. The bridge cancels the known job, scales the dedicated endpoint to min/max zero and reads back endpoint configuration, worker list and job health. It only records verified shutdown with max/min zero, an explicitly empty worker list and no queued/running provider jobs. Missing responses, cached/stale worker records or a request acknowledgement are not proof of shutdown; cleanup remains pending. On restart, shutdown intent is recovered before further work. The breaker blocks subsequent scene dispatch, preventing repeated failed cold starts. It never re-enables itself.

Apply `20260913151441_h3_serverless_recovery.sql` before deploying the new API and CPU bridge. The migration upgrades known in-flight `rp:` IDs; legacy submissions without any provider ID cannot be classified automatically. To reset a tripped breaker, first fix the deployment, reconcile its pending job, verify shutdown and explicitly authorize reactivation. Then an operator can clear `generation_serverless_state.tripped_at/shutdown_verified_at` and restore max=1 with min=0. There is no browser or model-controlled reset.

Only one clip is submitted at a time by the bridge. The 60-second idle window can reuse a worker for the next ready clip. Long planning pauses can still cause another cold start; this is not a promise of a permanently warm GPU or fixed total ad cost. No worker stays permanently active. Cached models still require loading into memory at worker startup.

Validate with a real H3 generation, a second queued job, the private upload/completion path, and endpoint worker count returning to zero. Unit/DB tests cover recovery and duplicate-submission handling; they do not prove CUDA execution.

## Release verification

Keep customer generation paused during release validation. Temporarily enable `GENERATION_ENABLED` in Pages and deploy the updated environment snapshot to dispatch controlled smoke jobs through the real queue; pausing again stops new claims without interrupting an already assigned job. Enable it permanently after the smoke checks pass. Verify that `h3-serverless-main` records a recent heartbeat before accepting generation requests. Test one text-to-video and one image-to-video job through the deployed database queue, keeping their request IDs stable across retries. Check the stored provider IDs, completed private MP4 metadata, endpoint job results and endpoint billing. Finally verify that billable workers return to zero after the idle timeout.

If initialization fails, leave generation paused and investigate container/system logs. A healthy CPU server or passing unit tests does not establish that CUDA inference is working. If the CPU host is unavailable, no application watchdog can make control-plane calls; provider TTL and scale-to-zero still apply, but forced-shutdown verification requires the CPU service to resume. A prolonged Runpod control-plane outage cannot be proven stopped by local code. Cached-model packaging/startup speed and the complete production coordinator's overall deadline are separate concerns from per-clip recovery.

### Local fault-injection validation (2026-09-13)

Run `node --test tests/h3-recovery*.test.mjs` for the virtual-clock and PGlite/API simulations. They make no external provider requests. Scenarios include 35 minutes queued followed by 12 minutes executing, status outages, lost submit/checkpoint/completion replies, worker restarts and fencing, stored-result recovery, separate deadlines, verified cancellation, failed startup shutdown, lost scale-down acknowledgement, nonempty/unknown worker lists, one-time refunds and preservation of prior scenes.

Recorded results: **33 new recovery tests passed**. The final targeted H3 run (including the existing worker/adapter tests) passed **47/47**. The broader repository suite before the final two concurrency checks passed **247 tests, 0 failed, 8 skipped**; those skipped tests are not evidence of working media generation. Static build and Pages Functions compilation both passed. The final concurrency changes were rechecked in the targeted H3 run. No live/CUDA tests were invoked.

This change has only been validated locally. No GPU was started and no media/model API was used for these simulations. Deployment of the migration/API/worker, control-key configuration and a controlled real cold-start/second-clip/shutdown run remain required before claiming production autonomy or a measured cost per delivered ad.

### Recorded smoke test (2026-09-11, America/Denver)

Both real production-queue jobs succeeded with zero provider retries: a 5-second 480p text-to-video clip (37.972 s handler execution) and a 5-second 720p image-to-video clip (117.912 s). They used the same RTX 5090; the second provider queue delay was 0.131 s. The GPU uploaded both private MP4s and the backend verified their metadata before completion. No client API image or narration generation was used. The test's two internal app credits were restored with idempotent ledger entries.

Initial model-cache preparation took 1,850 seconds (~31 minutes), preceding container initialization. These execution timings exclude that preparation, container startup, inter-job idle time and the final idle timeout. After both jobs, the authenticated inference health API reported `running=0`, `inQueue=0`, `inProgress=0`; the console displayed a spend rate of `$0.00000/s`. FlashBoot may retain `ready`/`idle` cached records, and the control-plane worker list may show pre-caching records. Such records are not evidence of a billable GPU running. Do not equate a cached worker record with active GPU rental. Billing reconciliation can lag; do not report an empty billing response as a free generation.
