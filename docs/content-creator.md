# CreativeRush Content Creator

`/crear/` is the `creator-v1` product. `/estudio/` retains the original continuity/ad prompts; `/anuncios-lab/` retains `ads-sales-v1`. The original baseline is tagged `video-continuity-v1-20260916`.

## Customer flow

1. Describe an idea or paste a script. Choose genre, target duration and aspect ratio.
2. Optionally attach a character image or a reference video. A URL is saved as context; visual analysis requires the video file.
3. Review the draft. Pasted scripts are saved without a writer call.
4. Explicitly approve production. The existing engine plans scenes, synthesizes and measures narration, generates and reviews stills, queues H3 clips, edits, reviews and delivers the MP4.
5. Continue editing through the existing project chat and partial-revision pipeline.

The new project has no brand row or product-photo prerequisite. Identity belongs to its uploaded character references and reviewed generated anchors. Genre, target duration and product profile survive saves and chat edits. Profiles cannot be switched within a project; libraries and links route to their own product.

## Scope

This beta creates narrated videos with one voice and animated scenes. Target duration guides the script; measured narration determines the final timeline, with the shared 120-second engine limit. Multi-speaker voice casting, native lip-synced dialogue, original song generation and arbitrary recordings of software are not implemented by this lane.

All existing credit, budget, ownership, recovery, still-approval and final-review gates remain enabled. Model/provider choices use the existing production configuration. A first still with no references uses the OpenAI generations endpoint; referenced stills use edits.

## Validation

- Creator-specific database tests cover brandless ownership, isolation, profile immutability, reference ownership, script/credit/availability gates and RPC permissions.
- Provider tests cover creator script/director routing, approved-script preservation, initial image generation and later image edits with continuity anchors.
- The production coordinator traverses all stages with simulated providers and replays without repeated generation.
- Frozen original director/script hashes and sales-product tests remain passing.
- Real media quality for entertainment genres requires separate video trials; this implementation test does not claim all genres or full multimodal production have been validated.

## Deployment and rollback

Apply `20260916235303_content_creator_product.sql`, deploy the worker and Pages at the same commit. The migration is additive to the original lanes and preserves all outer production credit/budget/recovery wrappers. If rollback is needed, disable the creator entry while keeping the migration: old projects still require brands, and creator projects retain their data. Do not restore `brand_id NOT NULL` while creator projects exist.
