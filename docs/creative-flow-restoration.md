# Creative flow restoration — 2026-09-07

Implemented in the web/API and worker source. Deployment status is recorded below. This change does not start a GPU or call paid media providers.

## What changed

- `creativeMemory` persists the product/style reference asset IDs, preferences, decisions, rejected results and approved still IDs. Studio chat records applied customer instructions. Direction, image generation, H3 prompts and final quality review consume this context.
- Reference analysis retains its actual submitted filmstrips in the private analysis result. The browser receives the analysis without the base64 payload. The production worker retrieves the adopted analysis with owner/project/status checks. Historical analyses without filmstrips require reanalysis rather than pretending their text summary is visual evidence.
- The director receives the actual product photograph and reference images (at most four visual inputs). Shot count follows narrative beats, up to 24; the approved script remains exact. Image generation also receives the original reference evidence.
- Production reviews every still against the actual product/style before any H3 submission. Reports are tied to immutable asset IDs. Rejected work is remembered; repairs get new IDs and must pass another review. Replacing a still invalidates its old clip. Unchanged correction prompts or unchanged returned assets cannot consume more repair rounds. Maximum two still-repair rounds; the existing monetary reservation ceiling still applies, including per-still review reservations.
- `video-use` now loads prior project memory and EDL, samples beginning/middle/end of the reference, and records render observations. Identical effective edits do not rerender; changing only review comments is not a correction. Overlay byte changes, cuts, grade and caption settings do count.
- The editor engine and MIT license are included in `workers/video-use/vendor`, along with its container recipe. They were absent from this worktree. The renderer supports consistent output dimensions/FPS, silence, caption settings, timed overlays and word-boundary cuts.

## Next creative test: actual editing, not the old fixed montage

Use `finishCreativeProject` from `workers/creative-edit.mjs` after image review and H3 generation. Supply a separate output root, project with approved still IDs, generated shot paths keyed by scene ID, narration file and verified word timestamps, original reference video and approved editing strategy. It prepares each shot with its corresponding narration, carries the visual/decision context into the real `runVideoUse` sandbox, and reuses cached timing instead of retranscribing or calling media APIs. It accepts up to 24 shots and does not impose 15 cuts or five-second selections.

The editor can trim pauses, compose effects, grade and rebuild captions. It may only approve after decoding and visually reviewing the rendered file. A deterministic word-coverage check rejects dropped, repeated or reordered approved narration. Regenerating a defective shot belongs to the upstream production stage and must pass the still gate again. The editor cannot invent unavailable replacement footage.

The website production queue now invokes this adapter for production renders. The authenticated render claim supplies the approved project, cached narration alignment and adopted reference filmstrips. `finish_edit` persists a customer's editing request and queues production atomically; ordinary render/remove/move/select requests use the reviewed production path when production is enabled. The editor preserves scene identities and narration order while trimming silence, styling captions and composing effects.

A new lease-fenced RPC stores the actual edited timeline and output hash before upload/completion. The final reviewer uses those new times. Caption/timing defects go back to the editor; visual defects regenerate only affected shots and map review timestamps back to their original source scenes. Delivery still requires the exact final file to pass. An ambiguous editor call is not automatically repeated after a crash. Cancellation stops render heartbeats, and budget reservations precede editing.

The runtime now checks that its isolated editor actually starts before advertising availability. Linux requires the existing Docker-based video-use sandbox; macOS uses sandbox-exec and an absolute Python runtime. The currently suspended Render service is configured as a native Node host and has not been validated for this sandbox. It must not be presented as ready merely by resuming it.

## Validation and remaining evidence

- Local tests cover shared memory, script coverage, effective-edit hashes, reference retention, pre-H3 blocking, corrected-asset approval, invalidating old clips and durable replay.
- The isolated integration test executes a real FFmpeg render, word-aligned captions, silent footage and output verification with a fake model endpoint; no paid API calls.
- The creative adapter integration test uses real local video/audio and cached words, checks reference/context handoff and prohibits network/provider calls.
- Worker compilation and static build pass. Missing already-published static pages and the landing build entry were restored from the canonical checkout to prevent deployment regressions.
- No claim of improved aesthetic quality yet. Compare the new complete result against the earlier Nebula reference, with the same script and resources, before selecting a model or declaring production readiness.

## Hosting status

The database migration has been applied to ad-engine-lab and its permissions checked: browser roles cannot execute either editorial RPC. The Render service remains suspended per the user’s cost-control instruction. Its native Node configuration is not yet a verified Docker sandbox host; production readiness requires a compatible active CPU worker. The local integrated test runs the real renderer with a fake model endpoint, so it proves orchestration, media/timing and delivery gates rather than model aesthetic quality.
