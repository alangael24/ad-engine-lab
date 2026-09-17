# Paid video seconds

Live one-time packages are 60 seconds for MXN 500, 180 seconds for MXN 1,000,
and 480 seconds for MXN 2,000. Their fixed Stripe Payment Link IDs and prices
are defined in `src/video-packages.js`. Legacy links and credit balances remain
supported for existing purchases.

The customer-facing offer is 1, 3 or 8 complete ads, each up to one minute,
including script, images, voice, animation, subtitles and editing. Shorter
videos and unused duration are presented as flexibility below the packages.
Stripe product names and purchase confirmation use the same wording. This is
presentation only: package codes, prices, payment links and seconds accounting
are unchanged. Savings compare each bundle with buying MXN 500 ads separately.

## Checkout and crediting

The authenticated checkout route accepts only a package code, locks the verified
account email, and returns a fixed link. It never accepts a price, entitlement,
or payment destination from the browser. Signed, paid Stripe events must match
the package's exact currency and amount. The database transaction resolves the
paid email, credits seconds, and records the unique Checkout Session. Replayed
or conflicting events cannot grant a second entitlement. `/gracias/` waits for
that transaction rather than inferring payment success from the redirect.

## Production accounting

`video_seconds_reservations` and `video_seconds_ledger` are service-only tables.
A start reserves up to 60 available seconds under account/balance locks. Measured
voice timing resizes the reservation before image generation. Voice or delivery
longer than 60 seconds stops the run. A quality-passed render settles its validated
final timeline duration, rounded up to whole seconds, in the same transaction as
production completion. Its download stays unavailable until settlement succeeds.

A failed or uncertain production releases its held seconds once, including
coordinator expiry. A retry makes a new hold and keeps the existing recovery
checkpoints. Only successful deliveries consume seconds; internal clip duration,
image count, and technical retries do not debit legacy credits. Standalone clip
creation still uses legacy credits. Caption/trim edits can reuse a paid render's
duration only when the same project, script and source clips are retained; newly
generated material or a new script requires a new delivery allowance.

The old five-production daily pilot limit and identity allowlist do not block
paid, funded deliveries. The global production switch, worker availability,
per-project spend ceiling, and total provider spend ceiling still apply. This
migration does not raise an operating budget or start a GPU. Those limits are
operator controls, separate from the customer's purchased seconds.

## Verification and rollout

`tests/video-seconds.test.mjs` exercises signed purchases, fixed prices, replay,
account identity, four 15-second deliveries, eight short deliveries, reservation
conflicts, voice limits, actual delivery settlement, failed GPU credit behavior,
service/browser permissions, paid access, spend ceilings and scoped edit reuse.
It includes the production GPU/recovery migration chain before the new billing
migration. Other tests retain legacy package and generation behavior.

Deploy the database migration first, then the Pages functions and UI. No Render
worker code change is required. Do not remove the migration while rolling back
frontend code; ledger and paid entitlements must be preserved. A test-mode webhook
replay validates payment accounting without a real purchase. A live card charge
and a real generated ad were not part of the billing integration verification.
