# Landing-driven sales copy

Applies only to `/anuncios-lab/` (`ads-sales-v1`). Original continuity and general
content creator prompts remain unchanged.

## One input for ideas and finished scripts

Before a sales project has scenes, the existing chat coordinator classifies the
client's input. Ready-to-speak copy uses the transient `accept_script` tool;
ideas and explicit rewrite requests retain the sales writer route. Mixed notes
and narration with unclear intent use one clarification. There is no separate
classification call and no obligatory mode switch in the UI.

`accept_script` must identify the current message or original project idea and
quote the complete narration literally. The server copies from that source,
rejecting changed words and missing beginnings/endings (except recognized short
introductory labels). It maps the result to the existing `draft_script` operation
for persistence, undo and idempotency. No new database operation or migration is
needed. Usage records `inputMode: provided_script` and `scriptSource`; the writer
is skipped. Existing scenes do not expose this intake operation.

The sales composer and chat accept up to 3,000 characters without the previous
2,000-character truncation. A domain inside a multi-line or long sales script
does not automatically replace the selected product. URL-only and short product
import requests still use the storefront importer. Literal intake never queues
media: the user reviews and approves before production. The existing director
and narrator preserve the approved script.

`scripts/benchmark-script-intake.mjs OUTPUT` runs text-only real-provider cases
using `REFERENCE_FLASH_KEY`. The initial six cases passed: bare script, explicit
literal script, idea, requested rewrite, ambiguous mixed notes, and a short
complete script. The three supplied scripts used one coordinator call and no
writer; ideas/rewrites used both. This is a routing smoke test, not proof that
all future natural-language inputs will be classified correctly. Automated
tests also verify literal preservation, safe failure, replay and no media jobs.

## Source and persistence

The sales import keeps up to 12,000 characters of landing text, including body
copy, FAQs and offer, under `brand.data.salesSource`. Navigation, scripts,
hidden subtrees and recognized related-product sections are excluded. Large
pages keep beginning/end excerpts with an explicit `truncated` flag. This is
HTML extraction, not a browser render; script-only copy may be unavailable.

Product catalogues require selecting the product; a sibling product does not
inherit the selected landing's copy. Service landings work without Product
JSON-LD. Brand normalization preserves the bounded source; existing JSONB
snapshotting retains it without a database migration. A new sales project can
enrich an older brand from its saved URL once, preserving client-edited fields
and checking brand revision. Already-created projects keep their snapshots.

## Writing

New ideas and requests for alternative scripts produce three complete drafts
in one writer call, each with its own angle, hook and source-linked sales plan.
The client sees all three and chooses using a button or a numbered chat reply.
An explicit correction to the selected script uses `scriptMode: revision` and
keeps the single-script writer. Provided scripts still bypass the writer.

Pending choices are persisted as `data.scriptVariants`; `scriptDraft` is empty
until selection, so media production cannot start on an arbitrary option.
Button selection copies the exact stored script without a model call. Choices
carry a set ID, revision fencing and the existing request idempotency; stale
buttons cannot select a replacement set. Selection clears the pending choices.
History retains the proposals after reload. Original/creator routes are unchanged.

The existing OpenCode DeepSeek writer extracts available insights and selects
an angle per draft inside the same `write_script` call that returns narration. The
tool's `salesPlan` contains short source-linked insights; absent categories are
omitted. Hypotheses are permitted for audience, pain, desire and objection, not
for mechanisms, differentiators, proof or offers. These are client statements,
not independent research verification. Source-ID validation checks provenance
references and structure; it cannot prove semantic entailment of every claim.

Default tone is direct/aggressive/conversational, unless the client requests a
different tone. Hooks express a concrete frustration/desire/contrast; the body
connects mechanism and benefit; the CTA uses the actual offer. The writer is
instructed to audit figures, promises, compatibility and colloquial absolutes.
Approved scripts still require an explicit request before any rewrite or media
production. The visual director is unchanged.

Sales uses `reasoning_effort: low` with `tool_choice: auto`; the tested provider
rejects thinking combined with a forced named tool. The response must still
contain exactly one `write_script` tool call with valid arguments. SSE transport
is capped at 2.5 MB for sales (reasoning chunks have significant envelope
overhead); other profiles retain their 500 KB limit. Reasoning is never shown.
Single-script revisions retain the 4,500 output-token cap. Three-option calls
allow 8,000 output tokens with the same 120-second timeout and usage accounting.
Invalid counts, duplicate scripts/hooks, invalid sources or truncated tool
responses fail without replacing the current project state.

`salesPlan`, source coverage and provider token usage are stored in the existing
chat result usage record. The UI exposes an optional argument summary, and the
saved landing is inspectable under product context. No extra research model,
images, voice, clips or GPU jobs are needed to draft the copy.

## Verification

`scripts/benchmark-script-variants.mjs` runs a text-only real-provider smoke.
The first run returned three complete LumaClip scripts with distinct openings,
one coordinator call and one writer call. This verifies delivery and selection
structure, not sales performance or exact spoken duration. Automated tests cover
literal selection, persistence, idempotency, stale/foreign access rejection,
unchanged provided-script routing and absence of media jobs before approval.

`scripts/benchmark-sales-landing.mjs OUTPUT` runs three fictional LPs through
the real writer. `REFERENCE_FLASH_KEY` is supplied securely; optionally set
`SALES_BASELINE_WRITER` to a previous module for paired comparison. Artifacts
include exact requests, output, model usage and failures. No output is manually
rewritten. This measures source use and usable copy, not conversion uplift.

The first non-thinking run recovered offers but added unsupported details. The
refined prompt plus low reasoning produced three complete drafts (102, 98 and
99 words) using the supplied mechanisms/offers, without the specific invented
time-saving and guaranteed-sleep claims seen initially. Sample size is small.
Total writer tokens: 4,523 / 4,388 / 5,292, including reasoning. This is token
usage, not a measured API invoice or a guarantee of future copy quality.
