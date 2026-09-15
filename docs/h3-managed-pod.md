# H3 dedicated RTX5090 controller

The minute cron in `workers/sweeper.js` can manage a single Community RTX5090 when `H3_BACKEND=pod`. The model, FL2V turbo8 graph and four exact weight files are unchanged. No SSH or public ComfyUI ports are exposed in production. The GPU polls the authenticated generation queue and uploads completed MP4s to private storage before acknowledging completion.

## Lifecycle

1. The CPU/cron controller advertises admission while funded, even with no GPU. Only queued clips trigger rental; image and speech preparation do not.
2. A database lease serializes controller ticks. A unique durable creation intent and its full run budget are committed before calling RunPod.
3. Create one CUDA13 Community RTX5090, using an immutable public `creativerush-h3-pod` image digest. Refuse catalog rates over $0.71/h; check the allocated GPU and tariff again.
4. Bootstrap the four files with Xet into `/workspace`, validate sizes, start ComfyUI and run a CUDA test. Only then permit generation claims.
5. Keep using the pod while clips are queued/running. After 90 seconds without clips, atomically drain, stop, verify EXITED/no runtime, terminate, and verify absence. A subsequent order creates a new pod.
6. Failed preparation after ten minutes, unexpected GPU/tariff, policy disable or budget/deadline triggers cleanup and disables further rentals. Missing acknowledgements are reconciled by the durable pod name, never by another POST. An uncertain absence remains blocked for investigation.

This implementation deliberately deletes the temporary 100GB volume when idle: no recurring stopped-disk bill. It **does not retain weights across separate orders**. The lifecycle experiment proved stop/resume with retained weights, but keeping that production cache would incur storage charges. A new ephemeral pod will download the four files again. Neither capacity nor a zero-wait start is guaranteed.

## Deployment

- Apply `20260915073916_managed_h3_pod_lifecycle.sql`; default is disabled with zero budget.
- Build `workers/pod/Dockerfile` via the Build H3 Pod action; pin its published digest.
- Pages API gets `H3_BACKEND=pod`. Render runtime also gets `H3_BACKEND=pod`, disabling its Serverless dispatcher.
- The independent minute cron gets `H3_BACKEND=pod`, `H3_POD_IMAGE`, `CREATIVE_RUSH_URL`, `GENERATION_WORKER_TOKEN`, `PRODUCTION_WORKER_TOKEN`, `RUNPOD_CONTROL_API_KEY`. GPU receives only the generation credential, never the RunPod control key.
- Existing Serverless endpoints must remain min/max zero before switching. Verify no queued/running old jobs.
- Fund and enable `h3_pod_control` with an explicit total budget. Defaults reserve $0.50/run; the controller stops before the reserve is consumed, including conservative setup/idle/storage allowance. The $0.73/hour accounting estimate is intentionally above the accepted compute rate; it is not a settled invoice. Existing per-project production budgets remain separate and unchanged.

The controller persists after deploy/restart and does not depend on an LLM. The shutdown guarantee depends on Cloudflare, the application/database and RunPod control API being reachable; uncertain shutdown retains the run and blocks new rental. A provider/API outage cannot be guaranteed to stop billing at the exact deadline.

## Validation

`node --test tests/h3-pod-lifecycle.test.mjs` exercises PostgreSQL locking/admission, budget reservations, permission boundaries, lost-create recovery, tariff refusal, startup failure, busy-budget cutoff and verified cleanup with simulated RunPod responses. The previous live two-clip lifecycle run validated the base GPU image and four weights; the new production entrypoint needs its own live queued-clip acceptance test. Keep these distinct from full-ad autonomy or aesthetic QA.

## Live production queue attempt — 2026-09-15

The credentials and minute cron were connected and a five-second, 480p reference-image job was reserved through the existing queue RPC using an internal test account. Cloudflare automatically created pod `4p610upqwt1vt0` at $0.69/hour. H3 never reached readiness; RunPod returned null runtime and the log service failed, so this does not establish whether image pulling or bootstrap was responsible. No clip was produced.

At the preparation deadline, the scheduled controller stopped and terminated the pod, verified absence, closed the durable run and disabled further rentals. The unstarted job was failed and its one credit refunded exactly once. The conservative ledger estimate was $0.122279, not a provider invoice. No pods or active queue jobs remained. This validates automatic rental and failed-start cleanup, **not successful automatic video delivery**.

Compatibility fixes were required before rental: manual redirect handling on Cloudflare, explicit service User-Agent, synchronization of the generation credential, and handling a PostgreSQL empty composite as an absent run. Failed-start credit compensation was added during the attempt before closure; this was not a frozen-code acceptance run. The focused lifecycle suite now has ten passing tests.
