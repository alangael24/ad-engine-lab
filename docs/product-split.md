# Continuity baseline and sales-copy lab

The existing video workflow is preserved at Git tag `video-continuity-v1-20260916` (`a06ce8c88a818dc3019f45132f1cfc19f07c625a`). `/estudio/` keeps its original copy and visual-direction instructions. Projects without `data.productProfile` remain in this baseline. This is a behavior/version snapshot, not a second independently hosted infrastructure stack or a claim that the current UI is already a general entertainment product.

The new opt-in entry is `/anuncios-lab/`, with `data.productProfile = "ads-sales-v1"`. It has its own project listing. Opening a project from the wrong entry redirects to the matching entry. Normalization, saves and chat edits preserve the profile; the save API rejects attempts to change an existing project's product. Account, brand assets, credits, queue and media providers are shared. Existing projects are not migrated or rewritten.

## Experimental changes

- The script writer uses a separate commercial instruction: buyer situation, a primary angle, relevant benefit and mechanism, available evidence, a supported objection when useful, and a specific next action. It uses existing product/idea/reference context; no new mandatory form or extra model call.
- The writer model remains `deepseek-v4-flash-vision-exp` via the existing OpenCode endpoint. `draft_script`, `set_hook` and `edit_text` retain the same tool schema. In the lab, `set_hook` is instructed to return all the first scene's narration, because the edit replaces that whole field.
- The visual director receives an appended instruction to communicate the commercial function of each scene while preserving every word of the approved script, its style and continuity.
- Image generation, H3, narration, prompt prefetch, recovery and quality gates retain their existing settings.
- Customer-supplied scripts remain supported; commercial instructions do not authorize rewriting them during visual production.

The original writer and director system messages have frozen hashes in `tests/fixtures/continuity-script-baseline.json`. Tests compare actual outgoing messages against those hashes and verify that only sales projects receive the additions.

## Initial paired comparison

`scripts/compare-sales-copy.mjs` ran the original and commercial writer on three identical fictional-product requests, twice: 12 completed text calls in total. Same provider/model/settings, one script call per sample, no GPU, images, narration or rendering. Full unedited text, provider usage, latency and prompt hashes are in `docs/benchmarks/sales-copy-split-20260916/round-{1,2}.json`. The review page is `/anuncios-lab/comparacion/`.

Round 1 produced more concrete buyer situations in the sales condition, but also unsupported details (time lost looking for a cable, a one-touch control, no waking a partner, wipes in a diaper pocket, and generalized hygiene claims). Those failures informed the round-2 prompt. Round 2 improved some details but still inferred non-disturbance, compactness and generalizations. This is calibration on the same cases, not an independent holdout and not proof of a winner. Neither condition is approved automatically on the basis of this small sample.

The experiment records raw token usage, not a made-up per-video price. Longer instructions can increase input tokens; adding this profile does not add a second writer or a compulsory review call. Commercial performance requires controlled ad results, not just a more appealing script. Review the script before spending on media.

## Next isolated experiments

1. Evaluate the frozen sales prompt on unseen products; compare specificity, factual fidelity, naturalness and CTA clarity before video production.
2. Separately add a persisted commercial brief (buyer, situation, reason to choose, evidence, objection, offer/action) if the current free-text inputs are insufficient.
3. Separately enrich the existing reference analysis with its argument sequence, without borrowing another product's claims.
4. Test approved script variants with otherwise comparable video and campaign conditions before claiming higher conversion.

## Rollback

Keep `/estudio/` as the stable entry. The sales lab remains explicitly opt-in. If disabling it, preserve sales projects and stop new lab creation rather than silently switching their scripts to the legacy writer. The Git tag retains the pre-experiment code for a full rollback; do not force an existing project's profile to another value.
