# Material image-review pilot

Status: production integration in `workers/material-image-review.mjs`, enabled by default for `astra-deepseek-v1`. Set `PRODUCTION_IMAGE_REVIEW_MODE=legacy` to roll back. Final-video Astra review is unchanged. Deployment status is recorded separately; this document is not deployment evidence.

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
4. All Astra scopes from steps 2–3 and mandatory style criteria are combined into bounded collection requests of at most six scenes, against each scene's own approved contract. This avoids paying separate general inspections and then another style call. The request does not assume every scene/product must match unrelated scenes.
5. The controller merges confirmations. Every criterion must be covered. Only a confirmed visible blocking violation with a concrete consequence can produce `repair`.

The policy modules do not start H3. The production adapter checks each still with DeepSeek before allowing it to anchor another scene. Only during this provisional anchor check, mandatory style approvals are deferred; proposed style defects still escalate. The worker ALWAYS runs the full collection-style gate before H3, even with recovered individual approvals or reused images. Confirmed defects get a separately checkpointed DeepSeek repair prompt. Unknown evidence blocks animation.

Contracts are derived deterministically from Astra’s approved opening shot, visible identities, preserve list and visual style before generating stills, then persisted as `material-contracts-v1`. Repairs cannot relax them. Motion/end-state requirements are not judged from a still. Original references and immutable target bytes are loaded server-side, hashed and mapped explicitly to numbered visual inputs. Only the dedicated DeepSeek `inspector` role accepts images; the editing role remains text-only.

## Persistence and cost

`load`/`save` adapters persist checkpoints keyed by policy version, model, scope, exact contract, asset digest and reference digests. The orchestrator clones/freezes inputs. A changed image, reference, contract or model invalidates that review. Raw malformed responses and reported usage are retained; they are not silently converted into passes. Missing usage is unknown cost, never known zero.

The `review` adapter must verify supplied files against digests, persist every provider attempt before returning and use deterministic request keys to recover a paid response if checkpoint saving fails. Its retry limit must be explicit. The local calibration runner implements per-call raw persistence and one bounded technical retry, with no retry of 4xx rejections. A failed primary assessment becomes an explicitly marked controller placeholder with unverifiable criteria and escalates to Astra; it is never counted as DeepSeek's visual judgment. Failed confirmation leaves `consult`, while other scenes can finish.

`image-review-json.mjs` can recover missing final JSON object/array delimiters only. It cannot invent missing strings, criteria, decisions or observations. Full scope validation is still mandatory. Raw text, normalization and all already-paid attempts are retained. This formatting recovery is separate from visual quality.

All provider costs, confirmation costs, collection review, sampled audits, invalid outputs and retries belong in the pilot ledger. Cost per delivered ad additionally requires actual regeneration/animation/render costs and intervention accounting; this image-only calibration cannot establish it.

## Evidence and next production gate

The calibration uses prior disagreements and a deterministic sample of prior agreements. It is development/regression evidence, **not unseen validation**. The supervising assistant had seen some cases; hiding model decisions does not make it independent human ground truth. Ambiguous source contracts are excluded from correctness scores and preserved for diagnosis.

Production checkpoints use lease-fenced `material-call-<sha256>` keys in the existing job steps and spending ledger. Responses are saved before policy validation; uncertain started calls fail closed without resubmission. Outer review steps do not double-reserve costs already held by individual calls. Rollout tests cover visual transport, cache invalidation, scoped repairs, uncertainty and mandatory gate placement. Still pending after deployment: a real client delivery, held-out ads grouped by product/character family, and observed regeneration/escape rates. A successful deployment is not evidence of those outcomes.

Local policy tests: `node --test tests/image-review-policy.test.mjs`.
