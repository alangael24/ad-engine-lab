# Bounded clip preparation

After the existing still-image acceptance gate, production now follows:

1. Prepare and persist the scene's H3 prompt (`prepare_clip`).
2. Enqueue the immutable scene version with its existing stable request ID.
3. Refill up to three outstanding versions while the GPU processes earlier work.
4. Select successful versions in script order; render only after every required selection.

The same bounded scheduler handles initial clips and approved repair batches. Reused
versions do not enter the initial queue. GPU execution concurrency, H3 settings,
scene durations, models, image review and final review are unchanged. The buffer
matches the existing per-user limit of three queued/running generation jobs.

Preparation and submission are separate API operations. A prompt checkpoint named
`<clip-key>-prompt` records the request binding and frozen prompt **before** enqueue.
The existing prompt spend reservation is settled with actual provider usage; neither
enqueue nor replay performs another prompt call. Uncertain started checkpoints stop
for reconciliation rather than silently repeating a paid request. Existing callers
that submit `version` directly still prepare via this checkpoint path.

All coordinator operations remain awaited and serialized. No concurrent project
writes, shared cost-context races or detached provider requests are introduced.
Known failed/canceled buffered versions stop further preparation/submission.
Already accepted jobs retain their durable identities/results for recovery.

## Idle control and limits

Queued/running jobs already prevent the managed pod's 90-second idle shutdown. The
buffer reduces gaps by providing real queued work, without disabling shutdown or
extending GPU budgets. It cannot guarantee zero GPU waiting if prompt preparation
is slower than the entire available backlog; there is no indefinite warm hold.
Other jobs belonging to the same user still count toward the existing admission
limit. Deadline, budget, lease and image/final review checks continue to apply.

## Validation

- Scheduler: overlap, bounded queue, ordered selection, failed/canceled jobs,
  lease loss and replay after a lost selection acknowledgement.
- Coordinator: image gate precedes preparation, seven scenes fill the buffer,
  assembly waits for every selected version.
- Real local database/HTTP route: preparation creates no generation job; lost
  enqueue replies and transient enqueue failure reuse one paid prompt and one
  generation request; conflicting request bindings and stale leases are rejected.
- Pod controller: pending/running work prevents idle stop after 90 seconds;
  the existing empty-queue shutdown tests still apply.

These checks use simulated providers and local PostgreSQL-compatible tests. They
do not measure production wall-clock savings or authorize a GPU benchmark.
