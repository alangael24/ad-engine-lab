# Image continuity v4 integration

Implemented in the current CreativeRush workflow checkout (`codex/luna-workflow`). This is a local source change, not a deployment or a new paid creative run. Render remains suspended; no GPU or paid media/model calls were made during implementation.

## Runtime behavior

- New director responses must contain a validated `shotContract` per scene: visible product/character, transition type, camera, desired state, preserved/changed properties, and selected original product views. Missing contracts fail rather than silently reverting new productions to global prompts. The approved narration remains unchanged.
- Image requests receive relevant shot facts and labelled reference roles instead of the complete project conversation/brand/catalog and neighboring shot descriptions. A face-only shot omits the original product photo and product description. A new location omits the old world reference and filmstrip.
- Original character IDs and original product-face IDs can be retained in `creativeMemory.characterAssetIds` and `creativeMemory.productViews`. View selections must belong to that registered list; the normal authenticated asset endpoint still controls access. The director is instructed to select a supported view when the needed geometry is absent, not invent a hidden mechanism. This does not create missing reference photos or add a new upload UI.
- Only assets present in the accepted set can be inherited as generated anchors. Production's real provider reviews each still before the next is generated. Rejected images are removed from approval/state memory. Original identity photographs are separate from generated anchors.
- Review summaries explicitly describe the actual visible state, including holder, placement, open/closed and detached parts. The worker binds each summary to scene ID and immutable asset ID. These are model observations, not geometric ground truth; stale asset observations are not passed to generation.
- A final still-sequence review remains before H3. The pre-animation repair allowance is at most two replacements per scene across focused and sequence review; unchanged corrections and unchanged asset IDs stop. Existing final-video review/repair remains independently bounded.
- Minor cosmetic differences do not trigger repairs unless they harm identity, action or a required seam. Ordinary cuts and continuous camera transitions use different tolerances. Still review cannot certify motion/lipsync.
- Completed steps replay without another provider call. `still-check-N-attempt` is a metered quality step with one review unit; full still reviews retain per-scene reservations. The monetary ceiling still applies. The extra focused review can increase review cost/latency; no exact live cost was measured here.
- The project aspect ratio is validated before submitting images. Existing provider raster sizes and final renderer framing remain: for example a 9:16 project still requests the configured 1024×1536 working raster. This change does not claim that raster is natively 9:16.

## Compatibility

Old projects/plan steps without `shotContract` continue through a legacy direction fallback. They receive approval gating and reference-role controls but do not magically acquire per-shot visibility flags. Existing contracts survive alignment and project serialization. Newly directed productions require the contract. No database schema migration is needed because these fields use the existing validated project JSON.

The script-writing model and the selected image/voice/video providers have not been changed. The creative UI does not gain another form or approval dialog; the worker performs these steps.

## Validation

Tests exercise actual multipart reference selection, contract persistence, missing/invalid metadata, approved-asset filtering, original product-view selection, focused review output binding, sequential repair before the next image, H3 blocking, replay, and existing production/spending/chat paths. Providers are mocked; local database fixtures test orchestration and authorization. Static build and Pages function compilation are local checks, not publishing.

The source recipe comes from the continuity labs (37 additional stills across camera/state/physical-face/second-product trials) and the seven-image UGC pilot. These trials support the method but do not establish a universal success rate or prove that the production model will match the director's aesthetic judgment. A live complete creative run remains the next quality check after deployment is intentionally resumed.

Validation result: 65 selected tests, 64 passed, 0 failed, 1 existing opt-in creative-render integration test skipped. Static build, Pages function compilation, JavaScript syntax checks and diff whitespace checks passed. No live aesthetic/paid-provider result is claimed.
