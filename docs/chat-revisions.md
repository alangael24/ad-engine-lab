# Conversational revisions

The chat accepts one `edit_project` call containing a single edit or an ordered batch of up to 12 edits. Changes are validated together and saved at one project revision. A stale revision or invalid operation applies nothing. One undo restores the whole edit, including after its production advanced the revision.

The browser samples three frames from each selected clip (or its still when there is no clip), caching immutable media. Up to 24 scenes are packed into at most four labeled JPEG sheets because the Flash endpoint rejects more than four images. Media IDs are checked against the user's current project before inference. Missing visual coverage is explicit. These are sampled frames, not full video/audio inspection. Raw frames are not saved in chat history or session storage.

Removing, moving or selecting existing shots queues one render at the saved revision. Text or visual changes queue production when available; when unavailable, edits remain saved and the UI explains the missing production. Revision production preserves scene IDs, existing images, usable clips and unchanged narration, generating only missing media. New narration is aligned to its real timestamps; clips that are too short are regenerated. Existing job checkpoints and leases prevent duplicate submissions on replay.

## Verification

Run `node --test tests/chat-revisions.test.mjs tests/studio-chat.test.mjs tests/chat-stream.test.mjs tests/production.test.mjs tests/studio.test.mjs tests/studio-api.test.mjs` with the repo's Node runtime. Database tests use isolated PGlite.

For a local browser trial with the existing Nebula assets, set `STUDIO_FIXTURE_ROOT`, `STUDIO_PREVIEW_EXISTING=true`, `STUDIO_PREVIEW_PORT` and `STUDIO_PREVIEW_OUTPUT`, then run `node tests/production-preview.mjs`. This invokes real Flash from the configured keychain entry, uses isolated authentication/storage/database, and assembles existing footage with FFmpeg. It does not generate new images, voice or clips or modify a production account.

On 2026-09-05 the browser submitted 11 scenes in 4 image sheets. Flash applied two removals as a batch, retained the chlorine-reduction benefit, and the CPU worker finished a 33.154-second timeline. The first trial exposed the four-image endpoint limit; another exposed removal of the main benefit, so the editor instructions now prioritize preserving that benefit and sentence dependencies. This is a successful case, not a quality guarantee across all ads.

New image/voice/H3 regeneration is covered by controlled provider tests. Live generation still requires provider credentials, enabled generation and a running worker using the updated revision implementation. Those providers were not activated by this change.

## Local changes to an approved export

The simple editor now saves its complete edit decision list, caption groups/settings, aligned words, exact output hash and a fingerprint of the source project in the render manifest. A small change uses that approved version as its base. Scene IDs stay stable even when scenes move. Undo matches the restored project to its own approved export; two exports with the same footage but different subtitles are distinct versions.

Supported chat operations:

| Request | Work performed |
| --- | --- |
| Change captions to white/yellow, show/hide captions | Change the caption layer, reuse all approved picture intervals and voice. |
| Add/remove an opening hook | Fixed text from 0 to 3 seconds; no spoken-script change. |
| Trim/retime one scene's picture | Use only that source clip, retaining the scene's speech duration. Speed is bounded to 0.75–1.6 and crop to 1–1.12. |
| Another local picture edit | `finish_edit` with a scene ID. At most two editor attempts; changes to other scenes or caption settings are rejected. |
| Replace one spoken phrase | Check original alignment before TTS; synthesize changed phrases under individual checkpoints, splice in the untouched voice ranges, and shift subsequent timings. Reuse stills and clips that remain long enough. |
| Replace a visual scene | Generate only the requested scene's media; out-of-scope generative repairs stop instead of expanding the request. |

An explicit `finish_edit` without a scene ID can still request a complete editorial pass. Previously completed local instructions are not applied a second time. Multiple pending changes retain their combined scope until an export succeeds.

The CPU renderer caches encoded picture intervals by source content, tenant/project namespace, trim, crop, frame count and encoding settings. The shared cache is disposable and pruned at render start to 512 MiB and seven days of inactivity. Changing subtitles does not invalidate the picture cache. A new final MP4 still needs encoding/muxing; this avoids new image/H3/voice generation, not all compute. Render hosts without a retained cache encode existing footage again, without regenerating it.

Every local export receives sampled output review covering all scenes, with the requested area and its neighbors identified. It cannot overwrite the old export. A blocked review stops delivery, and browser roles cannot bypass the review gate. This is sampled visual review plus deterministic media/timing checks, not continuous human audiovisual inspection. Small deterministic edits skip source planning and editor inference, but still incur chat interpretation, review and CPU export work.

Legacy exports without a complete approved edit blueprint cannot be safely reconstructed as an exact small edit. The chat stops with `EDITORIAL_BASE_REQUIRED` rather than silently creating a new montage. Phrase replacement also requires stored original narration alignment; missing or unsafe boundaries stop before TTS. An integration test uses real PostgreSQL, mocked authenticated transports and provider responses; media tests perform real FFmpeg rendering and voice splicing. They do not call paid generators or start a GPU.

Run `TEST_MEDIA=1 node --test --test-concurrency=2 tests/partial-edit.test.mjs tests/partial-edit-api.test.mjs` with FFmpeg/FFprobe on PATH. Apply migration `20260910132024_partial_video_revisions.sql` before releasing the updated Pages functions and CPU/production workers. This migration only extends private editorial handling to existing-media revisions; it does not enable generation, provision infrastructure or change spending limits.
