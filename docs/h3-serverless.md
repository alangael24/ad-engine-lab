# MiniMax H3 on Runpod Serverless

CreativeRush's CPU host runs `h3-worker.mjs` when `H3_SERVERLESS_ENDPOINT_ID` is configured. It advertises endpoint availability even with zero GPU workers, claims the existing database queue, obtains a signed private upload URL, submits one job and maintains its lease while polling Runpod. H3 runs the same server-owned turbo8 Comfy graph as the Pod adapter. The GPU uploads the MP4 directly to private storage; the backend verifies it before completing the generation.

## Deployment settings

- Image: build `.github/workflows/h3-serverless.yml`; deploy its immutable commit tag/digest from `ghcr.io/alangael24/creativerush-h3`.
- Queue endpoint; one RTX 5090 (`ADA_32_PRO`), CUDA 13.0 or newer.
- Minimum workers **0**, maximum **1**, idle timeout **60 seconds**, execution timeout **1200 seconds**, queue-delay scaling 4 seconds, FlashBoot enabled. New lifecycle limits: pending application queue **120 minutes**, provider preparation **45 minutes**, execution **20 minutes**, provider TTL **70 minutes**, reconciliation grace **2 minutes**. Preparation and execution are distinct. Restarting the coordinator does not reset these clocks. These are ceilings, not expected durations or a price guarantee.
- Cached model: `Comfy-Org/MiniMax-H3` by default. The compact-cache handler checks the four files in `workers/serverless/model-manifest.json` and links one complete snapshot from Runpod's host cache into Comfy. It fails fast if missing instead of downloading weights on paid GPU time. Containers from before the compact-cache change require eight files.
- Container disk 30 GB; no persistent network volume needed. The current upstream repository includes multiple quantizations (~477 GB total). The production graph only requires four weights (~43.82 GB); the former eight-file startup requirement was ~69 GB. Runpod currently caches the whole selected repository, so removing files from our startup checks alone does not reduce the upstream download. Configure a separate compact model cache as described below. Do not substitute a paid, in-container download as a workaround.
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

No GPU was started and no media/model API was used for these simulations. A controlled real cold-start/second-clip/shutdown run remains required before claiming production autonomy or a measured cost per delivered ad.

### Release status (2026-09-13)

- Recovery implementation `d56d5a4` is on `main`. The targeted release check passed **47/47** again.
- The production database migration was applied as `20260913154839_h3_serverless_recovery` (the migration service assigned this timestamp; the source filename remains `20260913151441_h3_serverless_recovery.sql`). No generation jobs were queued or running at verification.
- Pages deployment `350bb581-ace4-4fb5-b14c-bac6736924e3` serves the recovery API from `d56d5a4`. `GENERATION_ENABLED=false` was saved before this deployment to keep admission paused.
- Render still serves `2b7240c`. Its automatic deploy is off. Do not deploy the new CPU bridge until `RUNPOD_CONTROL_API_KEY` has been configured: the startup check intentionally rejects a missing control credential.
- The existing inference key successfully reads endpoint health, but the v2 endpoint control read returns **403 Forbidden**. That key is not sufficient for verified shutdown. A control credential for the same endpoint is still required; do not substitute another account or create another endpoint.
- The dedicated endpoint remains at min/max zero, with no workers and no queued/running provider jobs. No live generation was started during this release attempt.

After configuring the control credential, deploy the CPU bridge, verify its heartbeat and the deployed commit, and run the controlled production-queue smoke checks above. Record both artifact metadata and final endpoint/worker/job state. These deployment checks do not yet establish autonomous video delivery.

### Reducing customer startup delay (cache published, 2026-09-14)

The published upstream metadata reports **477,493,273,893 bytes**. The unchanged production graph uses only **43,821,523,663 bytes** across FL2V int8, the Qwen text encoder, video VAE and turbo8 LoRA. It does not use REF2V, turbo4 or the audio VAE: MiniMax narration is assembled separately. `model-manifest.json` records the four paths, sizes, SHA-256 hashes and source commit `a98869194787969724c7425d95d0ed73ce9202af`.

The handler now supports `H3_MODEL_REPO=owner/compact-repository` and optional immutable `H3_MODEL_REVISION`. The selected repository must also be set as the endpoint's cached model. Stage the exact four files in the same relative paths, verify their hashes during packaging and preserve the upstream license/attribution. Use the compact repository's own snapshot commit for `H3_MODEL_REVISION`, not the upstream source commit. The worker follows the cached `refs/main` when no explicit revision is set; it never combines incomplete snapshots. Changing models, quantization, steps or resolution is not part of this optimization.

The compact repository is now **published and hash-verified on Hugging Face; not yet selected or preloaded on Runpod**. Its private repository is `alan2410/creativerush-h3-fl2v-turbo8`, pinned at `aa560098737677b0862278c8c99f75edf218288c`. The four weights total **43,821,523,663 bytes**; all ten files including licenses and metadata total **43,821,555,887 bytes**. Publication used server-side LFS copies, with no local weight transfer or GPU start. A separate read-only key successfully retrieved the private repository metadata; its sole repository permission is `repo.content.read` for this repository. Both scoped credentials were saved to the operator's macOS keychain, never the repository or endpoint environment.

The updated container was built successfully from `f709eeb03d1493abdd0af805b1b3535d9df062e8` in [build 34810863201](https://github.com/alangael24/ad-engine-lab/actions/runs/34810863201), published as `ghcr.io/alangael24/creativerush-h3@sha256:f8e3d5c64fded6d75a8b477525cbd67007823bb79a962f9e97df457f7ac53a6c`, and configured on `0kkj6hcrybk9xi`. The fresh endpoint read confirmed the digest, 5090 pool/CUDA settings and min/max zero. No worker was started to execute this image. Local tests verify cache loading with only these weights and compare the manifest with both actual T2V/I2V production graphs. Together with the publisher tests, the combined H3 run passed **60/60**. This does not measure cold-start latency or prove a CUDA run.

`scripts/publish-h3-cache.py` prepares a private repository using Hugging Face's server-side LFS copy operation, so the 44 GB do not pass through the Mac or a GPU. It audits pinned source hashes, requires the destination to belong to the authenticated account, refuses to overwrite unrelated files and verifies the committed destination. It preserves MiniMax and Qwen licenses and attribution. The account's rights under those licenses remain a separate requirement from successful technical copying.

```sh
python3 -m venv .venv-h3-cache
.venv-h3-cache/bin/python -m pip install -r scripts/h3-cache-requirements.txt
# Read-only: source metadata verification, no login/weights/GPU needed.
.venv-h3-cache/bin/python scripts/publish-h3-cache.py --report /tmp/h3-cache-audit.json
# After authenticating with an existing write token; never paste tokens into logs.
.venv-h3-cache/bin/hf auth login
.venv-h3-cache/bin/python scripts/publish-h3-cache.py --apply --report /tmp/h3-cache-published.json
```

The publication command completed on 2026-09-14 after the operator authorized the scoped credentials. It verified the source and committed destination hashes and preserved the source license/attribution. Twelve public mirror candidates had previously been inspected; none contained all four exact hashes. Do not replace weights with a similarly named quantization to bypass authentication.

Pending: in the existing endpoint's **Manage → Edit Endpoint → Model** field, select `alan2410/creativerush-h3-fl2v-turbo8` using the scoped read credential, and merge `H3_MODEL_REPO=alan2410/creativerush-h3-fl2v-turbo8` and `H3_MODEL_REVISION=aa560098737677b0862278c8c99f75edf218288c` into the endpoint environment. Do not use the publishing credential on Runpod. The current MCP endpoint-update schema does not expose the cached-model field; use the authenticated console/configuration path rather than claiming an env change alone selected it. The console currently requires login to the account containing `0kkj6hcrybk9xi`. Endpoint env is deliberately unchanged while model selection is pending, avoiding a mismatch with the currently selected upstream cache. Keep the endpoint at min/max zero until an authorized preparation run with a verified shutdown path. Selecting a repository alone is not proof that Runpod has cached its weights on an available host.

Recommended next orchestration change: after a paid generation is approved, prepare H3 concurrently with image/narration creation, with a per-job warmup deadline and cost reservation. Do not start GPUs just because someone visits the page. Preparation still needs authenticated control access and the existing circuit breaker/shutdown checks. Early preparation only hides the portion overlapping useful work; it cannot guarantee zero wait when capacity or cache is unavailable. This prewarm controller is **not implemented** yet.

A continuously ready worker removes cold start for available baseline capacity but is billed while idle. Extra requests can still queue. At the consulted $1.58/hour rate, 24 hours cost $37.92, or $1,137.60 for 30 days of compute, before storage or any separately negotiated active-worker discount. This is a capacity expense shared across videos, not an extra charge to add to already counted busy GPU time. No always-on worker was enabled.

Measure approval-to-first-preview, approval-to-final-download, cache preparation, container/model initialization, queue delay and inference separately. Until measured on the deployed compact cache, do not promise instant video delivery or infer a tenfold speedup from the reduction in model bytes.

Sources: [Runpod cached-model limitations](https://docs.runpod.io/serverless/endpoints/model-caching), [active workers and FlashBoot](https://docs.runpod.io/serverless/endpoints/endpoint-configurations), [billing](https://docs.runpod.io/serverless/pricing), [upstream model metadata](https://huggingface.co/api/models/Comfy-Org/MiniMax-H3?blobs=true).

### Recorded smoke test (2026-09-11, America/Denver)

Both real production-queue jobs succeeded with zero provider retries: a 5-second 480p text-to-video clip (37.972 s handler execution) and a 5-second 720p image-to-video clip (117.912 s). They used the same RTX 5090; the second provider queue delay was 0.131 s. The GPU uploaded both private MP4s and the backend verified their metadata before completion. No client API image or narration generation was used. The test's two internal app credits were restored with idempotent ledger entries.

Initial model-cache preparation took 1,850 seconds (~31 minutes), preceding container initialization. These execution timings exclude that preparation, container startup, inter-job idle time and the final idle timeout. After both jobs, the authenticated inference health API reported `running=0`, `inQueue=0`, `inProgress=0`; the console displayed a spend rate of `$0.00000/s`. FlashBoot may retain `ready`/`idle` cached records, and the control-plane worker list may show pre-caching records. Such records are not evidence of a billable GPU running. Do not equate a cached worker record with active GPU rental. Billing reconciliation can lag; do not report an empty billing response as a free generation.
