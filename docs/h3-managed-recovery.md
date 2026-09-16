# Managed H3 recovery and conditional GPU fallback

Implementation status: deployed to production on 2026-09-16, release `d5b01db7d93af5df814ebaad4191564ba2390da5`. See the deployment receipt below. This is NOT a live RTX4090 compatibility test. The 4090 profile remains disabled, with no approved clip matrix. No GPU was rented for the local tests or this deployment.

## Customer order and physical attempts

A generation job retains its prompt, reference, duration, resolution, aspect ratio, random seed and original credit reservation. `h3_generation_attempts` records each execution with an immutable, private output path. A restarted worker adopts that same attempt and reconciles Comfy history/Storage. It does not send a second inference request because a response was lost.

On a host failure, the independent controller drains, stops, verifies no runtime, terminates, and confirms provider absence. The API checks private Storage for every unfinished attempt before closing the run. An existing MP4 is selected; otherwise only unresolved clips are requeued. Storage outages retain the reconciliation state. A late old attempt cannot overwrite the next attempt's output or finalize with its old lease.

Upload failures retry the same bytes up to three times. Subsequent worker polls retry retrieval/transfer from the same Comfy output while the original deadline permits it. Infrastructure retries do not call `reserve_generation` and do not refund between attempts. Terminal exhaustion/deadline refunds each unresolved clip once. Previously completed clips remain selected and charged normally. This does not refund already incurred provider spend or implement a new full-order cash-refund policy.

## Admission and bounded recovery

- Initial reservation remains $0.50 per rental; existing operator total-budget guard remains authoritative.
- Maximum three rentals per clip and three distinct rentals per production. Order admission uses a $1.50 infrastructure ceiling. These are protective defaults, not measured per-ad COGS.
- Clip admission uses profile-specific duration estimates plus upload time, remaining run budget and absolute deadlines. Estimates are conservative policy inputs, not a latency SLA.
- Physical rental costs are recorded once in `h3_pod_runs`. `h3_pod_run_jobs` attributes shared rentals without multiplying their bill by the clip count. Per-clip reserved totals are conservative admission bounds; never sum them as actual COGS.
- Production deadline: creation +120 minutes; clips belonging to that production stop admission ten minutes before that deadline to leave time for assembly/review. A new lease or GPU does not restart these clocks.
- Waiting for GPU capacity releases the production lease after 30 seconds, with a persisted next-attempt time. Completed plan, prompts, narration and image steps are reused on resume.
- One GPU processes one clip at a time. It continues admitting clips after the initial three-job buffer; it is not restarted every three clips.

## Failure policy

| Evidence | Action |
|---|---|
| Catalog confirms primary unavailable | Try next enabled, validated, compatible execution profile before creating a resource |
| Lost create response | Reconcile the durable pod name; never repeat creation blindly |
| Startup advances stages or completes another model file | Extend the stall clock within the hard startup/run/budget bounds |
| Same stage repeatedly reports alive | Not evidence of progress; does not renew the stall clock |
| Failed host / stalled startup / exited worker | Verified cleanup, then bounded retry of unfinished work |
| OOM | Suspend that execution profile; terminalize affected cohort, do not retry its jobs on the smaller GPU |
| Model/import/configuration error | Suspend the profile; no blind hardware cycling for affected jobs |
| Credentials, unexpected GPU/rate, duplicate or unaccounted resources | Keep global safety breaker / reconciliation block |
| Output upload/acknowledgement error | Check Storage and retry transfer, preserving the physical attempt |

Bootstrap stages and completed-file byte counts are durable. Comfy observation currently distinguishes queue-running, finished result and upload; it does **not** expose a verified sampler-step percentage or ETA. A worker heartbeat is never presented as such. Hard deadlines still bound a stalled generation.

Only absence established before creation permits immediate fallback. A rejected/uncertain POST remains in creation reconciliation until ownership is established; we do not infer non-allocation from an arbitrary provider error message.

## Execution profile and 4090 acceptance gate

The registry records GPU, CUDA, minimum memory, cloud, maximum tariff, conservative billing rate, startup/stall windows, upload allowance, clip-time estimates, immutable container digest and allowed `resolution:duration:aspectRatio` combinations. The current 5090 profile is primary. The 4090 cannot be enabled without validation evidence, a validation timestamp and pinned image; its supported matrix initially contains no combinations.

Before enabling 4090, run actual reference-image H3 cases for **each combination to be offered**. Store:

1. Image digest, model manifest revision/checksums and exact graph fingerprint. Keep turbo8, Euler, dimensions, frames, weights and LoRA unchanged.
2. Input job, reference, seed, actual GPU/CUDA/memory and output hashes.
3. Preparation, inference, transfer, peak VRAM and total billable lifecycle observations.
4. Full-decode result and visual acceptance against the same product/identity/motion criteria.
5. Provider deletion confirmation and measured/estimated cost basis.

Populate only combinations that pass, then explicitly enable the profile. The simulation's approved 4090 is a fixture, not approval evidence. No new cloud class, region, persistent volume or storage subscription is enabled by this change.

## Rollout order

1. Pause new production admission; complete/reconcile existing jobs and confirm no managed GPU remains. Keep existing Serverless workers off.
2. Build/publish the updated pod container and record its immutable digest. It must include the new worker/API protocol and `src/h3-pod-policy.js`.
3. Apply `20260916221655_managed_h3_attempt_recovery.sql`. It refuses any non-closed existing managed run and sets paid managed admission to **disabled**, preventing an old container from receiving the new output-path protocol.
4. Deploy Pages API/UI, production worker and independent controller together. Pin the new pod digest. Re-enable funded admission only after all components are updated.
5. Run one live 5090 queue acceptance test, then the 4090 validation matrix under an explicit test budget. Keep 4090 disabled until actual results are approved.
6. Verify customer waiting/progress states, one charge, private download, physical cleanup, and recovery on a simulated interrupt before opening general traffic.

If rollback is needed, disable admission and reconcile all active attempts first. Do not run old worker/API binaries against the new attempt-specific outputs. The independent controller still depends on the application/database and provider control API; a provider outage cannot guarantee termination at an exact second.

## Local verification

`node --test --test-concurrency=2 tests/*.test.mjs`

`node node_modules/wrangler/bin/wrangler.js pages functions build --outdir /tmp/cr-recovery-functions-build`

Tests cover actual PostgreSQL RPCs, worker/API/Storage transport, stale leases, no duplicate credit charges, isolated failed-boot cohorts, persistent order limits, admission including upload, capacity fallback, lost creation acknowledgement, output recovery, and resumed coordinator checkpoints. Live GPU and FFmpeg suites that require external prerequisites remain separate.

Validation receipt (local, 2026-09-16): 386 tests discovered, 377 passed, zero failures, nine prerequisite-dependent tests skipped. Cloudflare Pages Functions compiled successfully; Python bootstrap syntax and `git diff --check` passed. This run used mocked GPU/provider transport and isolated PostgreSQL/Storage simulation, with no GPU rental, migration application to production, container publication or deployment.

## Production deployment receipt — 2026-09-16

- Source release: `d5b01db7d93af5df814ebaad4191564ba2390da5`, pushed to `main` and `codex/sol-luna-production`.
- Pages production deployment: `ec60e78f-751b-4729-b5dc-36caa74ec4c9`, https://ec60e78f.ad-engine-lab.pages.dev, serving https://creativerushai.com. Deployment metadata matches the release; the public production panel matches the built file byte for byte.
- Render production deployment: `dep-dalhol2d0e5s73fev96g`, service `srv-daedg0gu01pc73e20q50`, status `live`. `/health` reports the same release, DeepSeek H3 prompt writer, material image review and three-clip buffer. No post-start error logs were returned.
- Supabase project: `ozkewphfxaohtihxmgoo`. Migration `managed_h3_attempt_recovery` applied successfully; the management API recorded version `20260916224632` for local source migration `20260916221655_managed_h3_attempt_recovery.sql`.
- Controller: `creativerush-generation-sweeper`, version `4ec9d850-7466-474a-8974-0ddc79a533b1`, minute cron. All six existing secret bindings were preserved.
- Published GPU image: `ghcr.io/alangael24/creativerush-h3-pod@sha256:d488620a3f3a898c04999c4483ca0d8d1d4be541bff7cae42ac39ef5f71d55c0`. Built by GitHub Actions run `35159127136`; anonymous manifest pull returned HTTP 200. Both the controller secret and primary profile pin this digest.
- No queued/running generations, active productions or provider pods existed during rollout. Admission was enabled only after deployment, keeping the existing global limit of 2,084,046 microusd and per-rental reservation of 750,000 microusd unchanged. Previously accounted infrastructure usage was 1,002,868 microusd; these internal estimates are not the provider wallet balance.
- Authenticated live controller acquire/release succeeded. New internal tables have RLS enabled and no browser-role grants. Supabase's security advisor reported informational no-policy notices for deliberately private tables and the pre-existing leaked-password-protection warning.
- This rollout verifies deployment and control-plane compatibility. It does not claim a newly generated acceptance clip, live failure injection or 4090 validation. The 4090 remains disabled pending its measured acceptance matrix.
