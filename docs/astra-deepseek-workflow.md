# Production workflow: Astra direction, DeepSeek execution

Local integration, 2026-09-11. The default `PRODUCTION_WORKFLOW_PROFILE` is now
`astra-deepseek-v1`. These are reusable product changes extracted from the
Furbedz / BEA / CreativeRush experiment, not the experiment's private files.

## Execution

1. The existing script approval remains the input gate. Script-writing and the
   general-purpose editor/chat retain their separate routing; this change does
   not silently rewrite approved copy.
2. Astra (`gpt-6-astra`, low reasoning, OpenAI Responses) directs shots using the
   actual product, character references and reference evidence. It supplies the
   image direction and continuity contracts.
3. GPT Image 2 API produces medium stills. MiniMax `speech-2.8-hd` supplies voice
   and word alignment. Product inputs and all image tokens are counted.
4. Astra checks actual stills before H3. A contextual pass is bound to immutable
   asset IDs and reused, instead of charging twice for the same still review.
5. Astra writes image-aware H3 motion prompts from the approved still, measured
   duration and neighboring scene context. H3 remains in the existing GPU queue.
6. Astra inspects the numbered clips and directs a simple edit. DeepSeek
   (`deepseek-flash` through OpenCode Go, low reasoning) executes a structured
   EDL, with no vision or shell access. FFmpeg renders cuts, captions and the
   requested static hook. Narration stays continuous; no transition sounds.
7. Astra reviews the actual export. Only viewer-visible, material defects block
   delivery. Image geometry wrong in the opening needs a new image, not another
   attempt to hide it with motion. Corrections preserve script, timing and order.
8. The reviewed file's hash, duration, full scene coverage and model/profile pair
   must match before its approval can be reused. Private repair candidates do
   not become approved customer exports.

## Corrections incorporated from the experiment

- DeepSeek gets 12,000 completion tokens including reasoning; one known/metered
  truncation or JSON failure may retry at 16,000. Network ambiguity, missing usage,
  unexpected models and provider failures never trigger an automatic paid retry.
- Model requests have a bounded 15-minute default deadline (operator configurable
  30 seconds–30 minutes), avoiding the old 1–3 minute cutoffs. A deadline remains
  necessary for a failed provider; a timeout is not evidence of model incapacity.
- Every internal edit correction receives the executed previous EDL. Subsequent
  generative repair renders can recover the latest private repair EDL from the
  same production. Unchanged EDL is valid when the underlying clip changed.
- Floating-point tolerance is 1e-9 around speed bounds; material invalid speeds,
  overlap, wrong source order, lost words and frame-count changes are rejected.
- `captionHighlight`, `captionFadeMs` and `sourceCaptionScenes` are persisted in
  the EDL. Embedded captions can replace overlays only in named source scenes;
  caption groups may not cross those scene boundaries. Subtitles and hooks have
  independent styles, so changing subtitle color does not recolor the hook.
- Alleged caption faults receive exact interior CFR samples at 20%, 50%, 80% of
  the caption interval, with a bounded focused Astra audit. An absence outside
  that interval is not a missing-caption defect. That audit cannot waive other
  product/identity defects. If evidence exceeds the audit limit, the issue stays
  unresolved rather than being silently approved.
- MiniMax alignment accepts punctuation/word segmentation variations while
  preserving the original script; missing or changed spoken words still block.
- The default enabled exclusive-pod idle action is DELETE, followed by a GET
  confirming 404. `GPU_IDLE_ACTION=stop` preserves the old explicit stop option.
  The controller never starts or rents a GPU. It stays disabled unless configured.

## Configuration and accounting

CPU runtime and Pages need the same profile. Required existing secrets are
`OPENAI_API_KEY` (or `EDITORIAL_ASTRA_API_KEY` for direction), and
`OPENCODE_API_KEY` or `REFERENCE_FLASH_KEY` for OpenCode. Images still require
`OPENAI_API_KEY`; narration uses `MINIMAX_API_KEY`. No keys belong in this repo.
`PRODUCTION_IMAGE_MODEL` and `PRODUCTION_IMAGE_QUALITY` remain explicit overrides.

The alternative profile `sol-luna-v1` retains Sol/Luna. The stable EDL schema is
also named `sol-luna-v1` for compatibility with stored projects; the new
`workflowProfile` field identifies the actual model combination. `/health`
reports the selected profile and model names.

Each model call records requested/returned model, usage including cache reads
and writes, failed-call costs, reservation, status and request identity. The
OpenCode price is a peak API equivalent, not the subscription's cash debit.
Image costs include reference inputs. MiniMax usage is valued at HD list price.
Unknown costs retain their reservation. GPU runtime/disk and CPU rendering are
separate costs, never implied to be free by missing model tokens.

`PRODUCTION_AUDIT_DIR` holds per-render/lease usage files, updated after every
call, including failures, outside disposable render directories. Its in-flight
reservation is written before dispatch. Set it to
persistent storage in production. Without it the fallback is local temp storage
and can be lost when the host is replaced; keep structured platform logs too.
Successful candidates additionally retain usage in their immutable manifest.

The existing database spending reservations and operator-funded policy still
apply across production retries. `EDITORIAL_MAX_COST_USD` defaults to $2 per
editorial attempt and is NOT a $6 whole-ad invoice guarantee. Set conservative
production allowances for image inputs, direction, editing, QA, retries, GPU
idle/setup and rendering before a funded rollout. The $5 target / $6 ceiling
from the experiment is not automatically configured on an external database by
this local change. Subscription equivalents, allowances and actual API charges
must remain distinguished in a cost report.

The GPU controller waits for the queue/production drain and configured grace
period, then confirms deletion. It runs on the CPU host; it is not an independent
watchdog if that entire host dies. No server/GPU was activated for this change.

## Freeze and verification

`node scripts/freeze-production-workflow.mjs` writes the code/prompt SHA-256
manifest. `node scripts/freeze-production-workflow.mjs --check` must pass before
an untouched benchmark; changing a listed file invalidates the freeze.

`node --test tests/*.test.mjs` checks orchestration, API leases, reservations,
partial edits, captions, identity-bound approvals, model routing and failures.
`TEST_MEDIA=1 node --test tests/astra-deepseek-workflow.test.mjs tests/sol-luna-edit.test.mjs tests/caption-layer-isolation.test.mjs`
uses real FFmpeg rendering and frame extraction with simulated paid providers.
Those tests prove wiring and validation, not the quality of a new paid ad.

Local verification completed on 2026-09-11:
- General suite: 215 tests, 207 passed, 8 optional integration tests skipped,
  no failures.
- Targeted suite with `TEST_MEDIA=1`: 28 passed, no skips or failures. Includes
  real rendering, exact caption frame extraction, and a hash-bound approval.
- Static build and Pages Functions compilation passed.
- Paid provider requests were simulated; there was no paid generation or GPU
  activation. This is not an autonomous-quality or whole-ad-cost benchmark.

Still required after local integration: deploy matching Pages/CPU code, configure
secrets/spending/persistent audit storage, and run a frozen full-ad test without
coordinator rescue. No live deployment or new paid media was performed here.

Pricing snapshots: [OpenAI](https://developers.openai.com/api/docs/pricing) and
[OpenCode Go](https://dev.opencode.ai/docs/go/). The measured experiment remains
separate evidence; its average is not a guarantee for this production adapter.
