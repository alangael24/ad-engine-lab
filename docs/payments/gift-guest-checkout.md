# Regalos: Stripe email and private order links

## Activation status

Activated in production on 2026-09-21. The guest flow requires
`GIFT_GUEST_ENABLED=true`, `RESEND_API_KEY`, `GIFT_EMAIL_FROM` and
`GIFT_EMAIL_VERIFIED=true` on Pages.

- Resend verified `correo.creativerushai.com` with dedicated DKIM and sending
  CNAME records; existing root MX/SPF records were preserved.
- The API key has sending-only access restricted to this subdomain. Credentials
  are Cloudflare secrets, not repository files.
- Sender: `CreativeRush Regalos <pedidos@correo.creativerushai.com>`.
- `creativerush-gift-mail` runs every minute with the existing retryable outbox.
- The authorized operator test was accepted and marked **Delivered** by Resend
  (email ID `01a0c68b-d6bc-7158-a9b2-9f2a0f03b0b1`). This verifies sender delivery,
  not customer payment or a complete real-order lifecycle.
- Guest authorization, payment replay and private-link isolation are covered by
  isolated tests. A separate Stripe test-mode end-to-end payment remains pending.

No live Stripe charge or paid media generation was performed during activation.

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

## Optional WhatsApp delivery after payment

Checkout contains no WhatsApp controls, phone field or contact validation. Stripe
email remains the only required delivery contact before payment. Once the signed
Stripe webhook creates the paid order, its private portal offers “¿También por
WhatsApp?” as a separate optional form. Pending/unpaid orders cannot save a number.
The confirmation page links to this portal and mentions the optional preference.

The customer supplies their own international phone number and explicitly requests
transactional delivery. They can add, change or remove it through the paid order's
private capability or verified account ownership. It does not modify the script,
charge credit or block approval/download. The older prepayment draft cannot change
this preference. The service-only RPC checks ownership and confirmed checkout.

The administrator sees this preference in the order detail. Once script-ready
or delivered, “Abrir WhatsApp con el enlace” prepares a message for that number
with that order's private portal. Only the verified administrator endpoint can
return it. Opening the message does not send it or mark it delivered: the operator
reviews and sends it in WhatsApp. No WhatsApp Business API is configured and no
automatic WhatsApp delivery is claimed. Resend notifications remain enabled.
