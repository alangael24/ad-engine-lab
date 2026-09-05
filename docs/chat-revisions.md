# Conversational revisions

The chat accepts one `edit_project` call containing a single edit or an ordered batch of up to 12 edits. Changes are validated together and saved at one project revision. A stale revision or invalid operation applies nothing. One undo restores the whole edit, including after its production advanced the revision.

The browser samples three frames from each selected clip (or its still when there is no clip), caching immutable media. Up to 24 scenes are packed into at most four labeled JPEG sheets because the Flash endpoint rejects more than four images. Media IDs are checked against the user's current project before inference. Missing visual coverage is explicit. These are sampled frames, not full video/audio inspection. Raw frames are not saved in chat history or session storage.

Removing, moving or selecting existing shots queues one render at the saved revision. Text or visual changes queue production when available; when unavailable, edits remain saved and the UI explains the missing production. Revision production preserves scene IDs, existing images, usable clips and unchanged narration, generating only missing media. New narration is aligned to its real timestamps; clips that are too short are regenerated. Existing job checkpoints and leases prevent duplicate submissions on replay.

## Verification

Run `node --test tests/chat-revisions.test.mjs tests/studio-chat.test.mjs tests/chat-stream.test.mjs tests/production.test.mjs tests/studio.test.mjs tests/studio-api.test.mjs` with the repo's Node runtime. Database tests use isolated PGlite.

For a local browser trial with the existing Nebula assets, set `STUDIO_FIXTURE_ROOT`, `STUDIO_PREVIEW_EXISTING=true`, `STUDIO_PREVIEW_PORT` and `STUDIO_PREVIEW_OUTPUT`, then run `node tests/production-preview.mjs`. This invokes real Flash from the configured keychain entry, uses isolated authentication/storage/database, and assembles existing footage with FFmpeg. It does not generate new images, voice or clips or modify a production account.

On 2026-09-05 the browser submitted 11 scenes in 4 image sheets. Flash applied two removals as a batch, retained the chlorine-reduction benefit, and the CPU worker finished a 33.154-second timeline. The first trial exposed the four-image endpoint limit; another exposed removal of the main benefit, so the editor instructions now prioritize preserving that benefit and sentence dependencies. This is a successful case, not a quality guarantee across all ads.

New image/voice/H3 regeneration is covered by controlled provider tests. Live generation still requires provider credentials, enabled generation and a running worker using the updated revision implementation. Those providers were not activated by this change.
