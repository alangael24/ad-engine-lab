# Regalos: Stripe email and private order links

## Activation status

The guest flow is implemented behind `GIFT_GUEST_ENABLED=true`. It also requires
`RESEND_API_KEY`, `GIFT_EMAIL_FROM` and `GIFT_EMAIL_VERIFIED=true` on Pages.
Until a real sender has been verified and a transactional test delivered, keep
these flags off. Existing authenticated checkout remains available.

No paid media generation, Stripe charge or real email is part of the automated
tests. No provider account or sender was created by this change.

## Flow

1. Guest story and a maximum of three hash-locked image slots are saved privately.
   Uploads are limited to 6 MiB each and checked by signature, size and SHA-256.
   The browser can retry the same upload without creating another slot.
2. Checkout creates a stable attempt for each draft/package. It passes only a
   random reference ID to the existing Stripe Payment Link. The customer enters
   email in Stripe, not on CreativeRush. No guessed email is prefilled or locked.
3. The signed, paid Stripe webhook checks the registered attempt, package, amount
   and MXN currency. It creates an unverified internal Auth record if necessary
   (no invitation, password or login required), copies reference assets and
   atomically commits purchase credit, project, order and received-email event.
4. Private order links carry a 256-bit capability in the URL fragment. The page
   removes the fragment and sends the capability in a header. It authorizes only
   that order's status, script approval/change request and private download.
   It cannot list other orders, change packages, start production or administer.
5. `gift_order_operator` status transitions queue script-ready and movie-ready
   messages. The mail worker runs once per minute and retries through a leased
   outbox. The idempotency key stays the same after a lost provider response.
   It stops uncertain retries after 23 hours, before Resend's 24h retention ends.

Paid webhooks and already-issued private links continue working if new guest
intake is disabled. Mail failures do not roll back or duplicate a purchase.
Different paid sessions from a reused Payment Link become independent orders.
No automatic AI production is started by intake, payment or mail processing.

## Finish configuration

1. Create/sign into Resend and verify a sending subdomain of creativerushai.com.
   Add only the DNS records requested for sending; preserve existing MX records.
2. Add a send-only Resend API key and a verified sender to Pages and the worker
   `creativerush-gift-mail`. Never put credentials in source, logs or screenshots.
3. Give the worker Supabase URL/service role secrets; deploy using
   `wrangler deploy --config wrangler.gift-mail.toml`.
4. Send a specifically authorized test to the operator's own email; confirm it
   arrived, the private link opens the intended order, and a wrong token is denied.
5. Set `GIFT_EMAIL_VERIFIED=true` on worker/Pages, then `GIFT_GUEST_ENABLED=true`
   on Pages. Redeploy Pages. Run one Stripe test-mode integration separately;
   do not use fake signed events against the live database.

## Operations

Inspect `gift_email_outbox` via service-role tooling for pending/failed events.
`provider_id` means Resend accepted the message, not proof of inbox delivery.
Failed deliveries need provider reconciliation before retrying outside 24 hours.
Never print `gift_guest_checkouts.access_token` or share customer photo URLs.

Draft access expires after seven days. Unpaid draft photos currently require an
operator retention cleanup; do not remove drafts referenced by a payment attempt
until delayed payments and reconciliation have been resolved. Paid references
live under a separate order prefix and must be retained with the order.

## Validation

`node --test tests/gift-guest.test.mjs tests/gift-orders.test.mjs tests/gift-checkout.test.mjs`
uses isolated PostgreSQL (PGlite), fake storage and a fake email transport.
It covers price/package mismatch, upload integrity, replayed payments, duplicate
real purchases, private order isolation, approval idempotency, provider failure
and retries. Run the other `gift-*.test.mjs` tests before deployment as well.
