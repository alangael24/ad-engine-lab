# Personalized gift packages

Live offers: `gift_60` is MXN299 / 60 seconds; `gift_120` is MXN499 / 120 seconds. One-time payments, fixed quantity one, no automatic tax, no discount codes. Stripe IDs and public URLs are in `src/video-packages.js`; the original ad packages are unchanged.

`/regalos/` saves the duration choice with the story draft. Checkout opens separately so selected photos and story fields stay on the original page. Signed-in buyers have their verified account email prefilled and locked. Anonymous buyers must use their account email, or an account invitation is sent to their paid email by the existing webhook. Never treat the return URL or selected package as proof of payment.

The signed webhook checks the link, payment status, exact amount and currency. The purchase function grants 60/120 seconds once per checkout session. Both packages use the existing delivered-seconds balance. `/gracias/` polls the server-confirmed purchase before showing success, then returns gift buyers to `/regalos/` with the paid duration selected. Drafting a story does not start media generation; the customer still approves the script in the creator studio.

The migration freezes a 60/120-second ceiling on each reservation. Creator projects requesting more than 60 seconds can reserve up to 120; ad projects and existing reservations remain capped at 60. Available balance is still required, timing is checked before images/clips, completion settles measured duration, and failure releases held seconds once. Existing production budget and quality gates are unchanged.

Validation: 47 tests covering gifts, creator production, production panel, signed payment events, exact entitlements, duplicate events, checkout price tampering, access control, 120-second settlement, insufficient balance, refunds, and the unchanged 60-second ad ceiling. Static build and Pages Functions compile passed. Local browser confirmed duration switching and draft restoration. No real card charge or GPU/media generation was performed for this release.

Supabase security advisor baseline has server-only tables with RLS/no browser policies (intentional) and an existing leaked-password-protection warning, unrelated to this migration: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
