# Landing-driven sales copy

Applies only to `/anuncios-lab/` (`ads-sales-v1`). Original continuity and general
content creator prompts remain unchanged.

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

The existing OpenCode DeepSeek writer extracts available insights and selects
one angle inside the same `write_script` call that returns narration. The
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
The 4,500 output-token cap, timeout and accounting remain in place.

`salesPlan`, source coverage and provider token usage are stored in the existing
chat result usage record. The UI exposes an optional argument summary, and the
saved landing is inspectable under product context. No extra research model,
images, voice, clips or GPU jobs are needed to draft the copy.

## Verification

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
