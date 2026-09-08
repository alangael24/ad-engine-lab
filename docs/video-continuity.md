# Video continuity: production integration

Based on local video-continuity-05 (six connected claymation clips) and video-continuity-06 (wide, close, rear and exterior). The latter used three newly selected Codex images and one existing anchor, four H3 generations with zero video retries, and a local trim of the first clip. These experiments support this procedure in one claymation character/prop case, not universal reliability.

## Runtime behavior

- New director plans require `shotContract.endState` alongside the existing opening `state`, camera, transition and preserved entities. Existing saved plans without endState remain readable.
- Different angles/locations receive their own approved still. Image instructions explicitly draw the opening, not the future ending. H3 receives current and neighboring shot contracts and the actual current first-frame image.
- Anatomical holding hand, contact and grounded/carried state are explicit. Intentional rear/location cuts may change screen side or background; they are not continuous camera moves.
- Editor source metadata includes the contract. The editor is instructed to inspect cut endpoints and prefer a feasible source-range correction to regeneration, preserving every spoken word. This is guidance plus existing narration validation, not a guarantee that every defect can be trimmed away.
- Final review receives contracts from scene manifests and samples near each start/end as well as the middle. Overview grids have 12-pixel gutters/margins. Alleged defects are confirmed with separate 720px actual frames, the alleged timestamp, and the preceding scene for continuity issues. A rejected allegation does not request media regeneration.
- Timing-only issues use the existing editorial correction path. Invalid media still fails closed. Regeneration bounds and immutable review/asset semantics are unchanged.

## Limits

This change does not implement automatic previous-video-last-frame extraction/chaining. The production clip path still uses each scene's approved image. No continuous orbit or exact 3D room geometry is promised. No paid model/GPU calls were made to validate this code integration; the local test uses synthetic video and mock model responses to verify routing/evidence, not model judgment quality. Shipping this revision requires deploying the application/worker code; paused paid servers were not reactivated.

## Validation

`tests/video-continuity.test.mjs` checks old/new contract persistence, H3 context, real FFmpeg frame extraction and gutters, separate allegation evidence including prior scene, and rejection of a false alarm. The existing provider fixture now includes the required ending state. Full-suite and build results are recorded in video-continuity-validation.json.
