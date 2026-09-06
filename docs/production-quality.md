# Automatic editorial quality review

The production worker now renders a private candidate, reviews the actual exported
MP4 with DeepSeek Flash, performs bounded selective repairs and reviews each new
candidate before marking production complete. This implements the workflow learned
from the English Nebula Zack revision: an edit can decode correctly yet be poor
because it repeats the same smile/comb, shower and installation shots.

## Review evidence and decisions

`workers/production-quality.mjs` downloads only the render authorized by the active
production lease. The review uses the immutable render manifest, not a newly edited
project timeline. FFmpeg verifies decoding, audio/video streams and duration, then
extracts three timestamped frames from every scene. At most four numbered contact
sheets are sent to `deepseek-v4-flash-vision-exp` through the existing OpenCode key.
The reviewer receives each scene's spoken text, product context and continuity.

An independent source-interval audit finds actual reused media even when different
scene-version IDs point to it. Perceptual hashes suggest similar compositions;
they do not automatically reject shots of the same product or character. Flash
reviews semantic repetition, wrong visuals for narration, product/character
artifacts, visible captions and sequencing. Every proposed defect receives a
second focused review of the enlarged target/related scenes (maximum six checks).
This step matters: the first live trial confused neighboring rows in a full sheet.
A model pass cannot waive mechanically verified overlapping reuse.

The stored report includes render ID, file SHA-256, sampled timestamps, confirmed
issues, repair instructions, model and token usage. Claims about full listening,
exact lip sync or every transient frame are explicitly forbidden: this is sampled
visual review against declared narration/timing, not audio transcription or a
continuous audiovisual quality guarantee.

## Repair limits

Only `replace_clip` and `replace_image` are executable. The latter generates a new
still and clip; both preserve the original narration asset, every script word,
scene order, duration and untouched media. A maximum of three flagged scenes is
repaired per round, with two rounds and three reviews total. The existing H3 queue
and image provider own generation; no GPU is rented by this feature.

Caption/timing issues and ambiguous defects stop delivery for further review.
There is no claim that arbitrary editing instructions are supported. Regenerations
use existing billing/reservation behavior; this is not an unlimited free-retry
policy. Reports and repair decisions use durable step keys; completed images,
clips and reviews are reused on resume. Uncertain provider submissions stop rather
than blindly charging again. All prior render versions remain retained.

## Delivery gate

Migration `20260906002544_production_quality_gate.sql` associates automatic renders
with their production and a pending/passed/rejected quality state in the same
transaction that creates them. Completion requires the exact current render to
pass. A report for another production or project revision cannot approve it.
The authenticated media route refuses pending/rejected automatic render downloads;
the UI shows review/adjustment progress instead of a completed video. Existing
manually requested renders are unchanged and do not acquire this automatic review
status retroactively. The current feature applies to `/estudio/` automatic
production, not the separate `/editor/` video-use agent.

## Deployment

Implemented and tested locally. Not enabled on the public service by this change.
Apply the migration before deploying the worker and API/UI changes together. The
permanent production host needs FFmpeg (drawtext/libass), FFprobe, a DejaVuSans font
on Linux, the existing Flash credential and configured image/voice/H3 providers.
No new public environment key or client-side credential is introduced. The current
production host/provider activation prerequisites still apply.

## Verification

`tests/production-quality.test.mjs` covers source duplication, semantic-candidate
handling, invalid review output, unchanged narration/unaffected scenes, selective
regeneration, durable replay, bounded failures, delivery blocking, owner checks,
privileged-function access and atomic candidate creation. Existing production,
chat revision, studio API/database and H3 prompt tests are run alongside it.

Live evaluation uses both existing 74-second English Zack exports. With focused
confirmation, Flash identified four repeated-scene placements in v4 (shower,
combing twice, installation), produced scene-specific replacement directions and
removed the false product-artifact allegation from its initial overview. These
are two related examples, not a broad benchmark or an unattended API-generation
success. Raw media and private reports remain in the local task output directory.

### Final local validation results (2026-09-05)

- 45 targeted tests passed; Pages Functions compiled successfully.
- v4: focused checks confirmed four reused placements and returned `repair`.
  Review consumed 14,506 total tokens including focused checks.
- v5: final before/after-aware review returned `pass`, zero issues, 4,109 tokens.
- Intermediate trials included one invalid structured response (delivery blocked)
  and a false positive on deliberate before/after brushing. Review instructions now
  require unchanged narrative state as well as repeated action for semantic reuse,
  and focused context follows the same row order as its images. These trial results
  are retained, not treated as successes.
- Selective regeneration/recovery was tested with controlled providers; real image
  and H3 regeneration was not started in this change. A live unattended repair and
  delivery test remains required when those providers and workers are activated.
