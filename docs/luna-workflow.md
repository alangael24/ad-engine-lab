# Luna workflow routing

The coordinator model is `gpt-5.6-luna` through OpenCode Go Responses, with high reasoning. The independent script model retains the previous `deepseek-v4-flash-vision-exp` configuration. Both are declared in `assets/model-routing.js`; changing the writer does not change the coordinator.

Luna handles reference analysis, chat coordination and visual edits, storyboard/continuity and image prompts, first-frame-aware H3 motion prompts, production quality review, and video-use planning/editing/overlay tools. Store import remains deterministic; its extracted product context is supplied to Luna.

`draft_script`, `set_hook`, and `edit_text` are delegated to the writer before edit validation/persistence. Luna provides editorial instructions; only writer output reaches narration previews and saved copy. Script provider errors fail closed instead of using Luna's instructions as copy. Usage includes both calls; missing usage stays marked in per-call records.

The transport adapter preserves streaming, actual model identity, tool-call IDs/results, image evidence and usage. Incomplete Responses fail rather than becoming accepted edits. Existing authorization, retry/idempotency, spending limits and review gates stay in force. Reference cache version is now `luna-reference-v2`.

The existing `REFERENCE_FLASH_KEY` secret is the OpenCode credential despite its legacy name. No new secret is required. Image generation, MiniMax speech and H3 rendering retain their providers; Luna coordinates them rather than replacing them.

Validation: real Responses tool and vision probes passed. Tests cover script separation, vision/tool transport, truncation and upstream model checks. The existing onboarding test references missing `ecom-index.html`; this failure also reproduces on baseline 7571648.

These changes are in the `codex/luna-workflow` working branch based on production-rollout 7571648. They have not been deployed to Pages or the Render workers. No GPU or paid worker was started by this change. Deploy the backend and production/video-use workers together to activate consistent routing. This migration does not establish autonomous creative quality or implement new regeneration gates.
