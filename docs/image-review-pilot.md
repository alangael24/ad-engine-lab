# Material image-review pilot

Status: local opt-in orchestration module; **not connected to the production worker or deployed**. Existing production reviewers and final-video review are unchanged.

The goal is to conserve usable stills and stop material defects before paying for animation. This is not a search for aesthetic improvements.

## Frozen acceptance contract

The planner approves `sceneId`, revision, criteria and any unresolved contradictions **before inspecting the generated image**. Every criterion has an ID, kind, requirement, blocking flag, consequence for the scene and a predeclared risk class. Both reviewers receive the same standard. The inspector cannot rewrite it.

Observing a difference, judging a requirement and authorizing repair are separate:

- `met`, `violated`, `unverifiable`: result for each criterion.
- `none`, `present`, `unverifiable`: whether a difference was observed.
- `approve`, `consult`, `repair`: controller decision.

A detected difference may coexist with `met`. A violated nonblocking criterion is recorded as tolerable. An unverifiable blocking criterion needs evidence, not automatic regeneration. No subtitle space, exact crop, human-only character, tiny label spelling, or product-face requirement is added implicitly.

Product controls require special attention only when their physical arrangement is mandatory for this scene. An ambient shot can tolerate a small layout difference; a demonstration of which button to press may not. The planner decides this before inspection. Explicit photographic/cartoon/clay distinctions remain binding. Vague “3D” does not by itself prohibit photorealistic rendering. Contradictory styles stay in `unresolved` and stop before paid inspection.

## Routing

`runImageReviewPilot` in `workers/image-review-pilot.mjs`:

1. DeepSeek inspects every criterion with actual references and target still.
2. Astra independently checks proposed blocking violations, missing evidence and predefined mandatory weaknesses—even when DeepSeek approved them.
3. A deterministic configurable audit sample also checks approvals. Audit rate is explicit experiment configuration, not a promised production escalation rate or cost target.
4. All Astra scopes from steps 2–3 and mandatory style criteria are combined into one bounded collection request, against each scene's own approved contract. This avoids paying separate general inspections and then another style call. The request does not assume every scene/product must match unrelated scenes.
5. The controller merges confirmations. Every criterion must be covered. Only a confirmed visible blocking violation with a concrete consequence can produce `repair`.

Neither module generates images, rewrites prompts or starts H3. `animationReady` is a pilot result only. The existing worker must not consume it without a production integration and gate test. In particular, the worker currently skips its collection review when individual stills are already approved: a future integration must always run the collection-style gate before the first H3 submission, including resumes and image replacements.

## Persistence and cost

`load`/`save` adapters persist checkpoints keyed by policy version, model, scope, exact contract, asset digest and reference digests. The orchestrator clones/freezes inputs. A changed image, reference, contract or model invalidates that review. Raw malformed responses and reported usage are retained; they are not silently converted into passes. Missing usage is unknown cost, never known zero.

The `review` adapter must verify supplied files against digests, persist every provider attempt before returning and use deterministic request keys to recover a paid response if checkpoint saving fails. Its retry limit must be explicit. The local calibration runner implements per-call raw persistence and one bounded technical retry, with no retry of 4xx rejections. A failed primary assessment becomes an explicitly marked controller placeholder with unverifiable criteria and escalates to Astra; it is never counted as DeepSeek's visual judgment. Failed confirmation leaves `consult`, while other scenes can finish.

`image-review-json.mjs` can recover missing final JSON object/array delimiters only. It cannot invent missing strings, criteria, decisions or observations. Full scope validation is still mandatory. Raw text, normalization and all already-paid attempts are retained. This formatting recovery is separate from visual quality.

All provider costs, confirmation costs, collection review, sampled audits, invalid outputs and retries belong in the pilot ledger. Cost per delivered ad additionally requires actual regeneration/animation/render costs and intervention accounting; this image-only calibration cannot establish it.

## Evidence and next production gate

The calibration uses prior disagreements and a deterministic sample of prior agreements. It is development/regression evidence, **not unseen validation**. The supervising assistant had seen some cases; hiding model decisions does not make it independent human ground truth. Ambiguous source contracts are excluded from correctness scores and preserved for diagnosis.

Before activation: wire durable production storage and budget accounting, verify collection gate placement before H3, run held-out ads grouped by product/character family, and measure unnecessary regenerations and blocking defects reaching animation under the same acceptance standard. Keep final Astra video review unchanged during the pilot.

Local policy tests: `node --test tests/image-review-policy.test.mjs`.
