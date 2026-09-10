# Sol + Luna production editing

This adapter finishes an approved ad from its own numbered clips, scene context,
approved narration and word alignment. Sol (`gpt-5.6-sol`, OpenAI Responses)
inspects source strips and directs the edit. Luna (`gpt-5.6-luna`, OpenCode Go
Responses) returns a structured edit decision list. Trusted FFmpeg code renders
it, then Sol reviews sampled frames of the actual export.

The production render worker selects `sol-luna-v1` by default. Set
`STUDIO_EDITORIAL_ENGINE=legacy` to restore the previous adapter; that adapter
requires its original sandbox runtime. This does not change the separate
general-purpose `/editor` video-use worker or the script/image/voice/H3 providers.

## Scope and delivery gates

- Every scene keeps its approved narration slot, order and spoken words.
- Picture cuts can select non-overlapping intervals, crop up to 1.12x and retime
  within 0.75–1.6x. A scene cannot borrow footage from another scene/ad.
- Narration is continuous across picture cuts. This version does not shorten
  narration silences. It adds no music or transition sounds.
- Subtitles use the supplied word timestamps; a requested hook is static for
  at most the first three seconds. Client caption preferences override defaults.
- Luna receives text/context, not images or executable tools. No generated code,
  shell access, media generation or GPU rental is available to either editor.
- Sol reviews every scene using early/middle/late rendered frames. This is sampled
  visual review, not full audiovisual perception or proof of flawless motion.
- One EDL validation retry and one edit correction round are allowed. Unchanged
  corrections, unresolved edit defects and missing review coverage stop delivery.
- Generative repair findings return a private candidate to the existing
  production coordinator. That coordinator retains its spending, repair and
  final-delivery gates. A `repair` verdict is not a customer-approved export.
- The authenticated worker persists the EDL and Sol review in the existing
  immutable render manifest. The coordinator reuses that review only when the
  downloaded candidate hash, coverage and duration match. It does not pay for a
  second review of the same unchanged export.

## Configuration and costs

The CPU runtime needs `EDITORIAL_SOL_API_KEY` (or `OPENAI_API_KEY`),
`REFERENCE_FLASH_KEY` for OpenCode, FFmpeg/ffprobe and the existing worker tokens.
No new database migration is required.

`EDITORIAL_MAX_COST_USD` defaults to 2 (allowed 0.10–5). It is an estimate-based
model admission ceiling **per editorial attempt**, not an entire-ad invoice
limit. It reserves conservatively before calls, includes reported failed-call
usage, caps the call count at seven and stops after unmetered ambiguous responses.
Provider invoices, media generation and infrastructure remain separate. The
existing production spending policy still applies to new media and repair jobs.

`usage.json` and compact runtime logs record model, role, usage and API-equivalent
cost; successful candidates also retain usage in their private manifest. Local
temporary files are removed after upload or failure, so preserve platform logs
for failed-attempt reconciliation.

## Validation

The shared EDL validator rejects reused intervals, out-of-order sources, changed
scene frame counts, out-of-bounds speeds/crops and missing/duplicated caption
words. Provider tests cover routing, failure accounting and budget admission.
An actual FFmpeg test checks rendering and hash-bound review reuse. Run it with
`TEST_MEDIA=1 node --test tests/sol-luna-edit.test.mjs`.

The first real local integration used the existing 15-scene Nebula Zack assets:
46.54 seconds, three provider calls, $0.26567435 API equivalent excluding media
and infrastructure. It returned a generative repair finding about the product
cutaway, so it proves the integrated execution and gate, not a fully approved ad
or a new full-ad COGS estimate. Earlier reconstruction benchmark costs are
historical measurements of a different harness, not guaranteed production cost.

Deployment verification should confirm `/health` reports the deployed commit,
`editorial: sol-luna-v1` and both expected model names. Deploy the Pages API before
activating the matching CPU runtime. GPU activation is a separate operation.
