# Qwen image batches

Qwen Image 2.1 (pinned research checkpoint with operator-confirmed commercial
license) is an optional image provider. Astra/DeepSeek direction, material
review, H3 settings, narration and editing are unchanged.

One GPU serializes requests. Every production retains its own owned references,
immutable prompt fingerprint and output asset UUID. The approved previous image
is resolved immediately before submission; independent customers can share a
warm process but never share their references. There is no minimum batch size
and no delay to accumulate customers.

The official PE-I2I rewriter runs for reference-conditioned images. Text-only
images use the original direction (we do not run I2I without a reference).
Both checkpoints remain in CPU memory; only the active model occupies the GPU.
This production interleaving differs from the offline benchmark's two phases;
its transfer overhead must be measured, not assumed to cost $0.027 exactly.
The generator retains 40 steps, BF16, CFG 1, KV cache, and the existing sizes.

Durable queue:
- The production step's budget reservation must exist before enqueue.
- `(production_id, step_key)` is unique; changed requests conflict.
- A lost enqueue or claim reply recovers the same job and claim token.
- PNG and rewrite checkpoints survive network retries on the GPU.
- Upload and registration can retry without generating the image again.
- An ambiguous generation after loss of its pod is marked uncertain; no silent
  paid replay or automatic OpenAI substitution.
- Controller intent precedes RunPod creation, preventing double creation after
  an ambiguous response. Only its own stored pod ID and name can be deleted.

Costs: each image records rewriter and inference seconds. Whole-run elapsed
compute, including downloads/loading/idle, is reconciled only after confirmed
pod deletion and allocated across the run's requests. Storage and any commercial
license charges remain separate, explicitly unknown until reconciled. Failed
startup is also charged to its original request. Review charges use existing
production accounting. This is not a provider invoice.

Rollout order: migration (disabled), Pages API, pinned GPU container, independent
minute watchdog, GPU canary, then provider switch in Render. Configuration:
- DB qwen_image_control: enabled=true, commercial_authorized=true.
- Sweeper: QWEN_POD_CONTROLLER=true; QWEN_POD_IMAGE=pinned GHCR digest.
- Render: PRODUCTION_IMAGE_PROVIDER=qwen; optional PRODUCTION_CONCURRENCY=2.
- Existing production and generation worker tokens authenticate outbound jobs.
No public GPU port or RunPod account credential is exposed to the GPU worker.

Controller allows only one Community RTX 5090 at <= $0.71/h, 64GB host RAM,
100GB temporary volume. It deletes after queue drain plus 90s grace, startup
failure, lost heartbeat, budget ceiling or a 60-minute maximum session.
Outstanding image-stage productions hold the warm session within the budget.
The minute watchdog executes independently of the GPU and Render coordinator.

Rollback: switch Render to openai for new work; allow current Qwen work to drain
and verify no pod remains. Keep watchdog active until all owned runs are closed.
Do not delete the durable queue or captured images.

Tests: node --test tests/qwen-images.test.mjs tests/production-providers.test.mjs
 tests/production.test.mjs tests/production-clip-buffer.test.mjs
