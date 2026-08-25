import Stripe from "stripe";
import {
  PLAN_BY_PAYMENT_LINK,
  getPaymentLinkId,
  getSupabaseAdmin,
  isExistingUserError,
  json,
  normalizeEmail,
} from "../../../src/backend.js";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
]);

function validateEnvironment(env) {
  const missing = [
    "STRIPE_WEBHOOK_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((key) => !env[key]);

  if (missing.length) throw new Error(`Faltan variables del servidor: ${missing.join(", ")}`);
}

async function ensureAccount(supabase, email, redirectTo) {
  const { error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error || isExistingUserError(error)) return;

  // If email delivery failed after creating the row, or the invite endpoint is
  // temporarily rate-limited, keep the paid account recoverable by Magic Link.
  const { error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError && !isExistingUserError(createError)) throw error;
}

async function grantPurchase(supabase, event, session, plan, paymentLinkId, env) {
  const email = normalizeEmail(session.customer_details?.email || session.customer_email);
  if (!email) throw new Error("La sesión pagada no contiene un correo de cliente.");

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
  const appUrl = String(env.APP_URL || "https://ad-engine-lab.pages.dev").replace(/\/$/, "");
  await ensureAccount(supabase, email, `${appUrl}/campus/`);

  const { data, error } = await supabase.rpc("apply_stripe_purchase", {
    p_event_id: event.id,
    p_checkout_session_id: session.id,
    p_payment_link_id: paymentLinkId,
    p_email: email,
    p_stripe_customer_id: customerId,
    p_plan_code: plan.code,
    p_amount_total: session.amount_total || 0,
    p_currency: String(session.currency || "mxn").toLowerCase(),
    p_payment_status: String(session.payment_status || "paid"),
    p_video_credits: plan.videoCredits,
    p_image_credits: plan.imageCredits,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function onRequestPost({ request, env }) {
  try {
    validateEnvironment(env);
    const signature = request.headers.get("stripe-signature");
    if (!signature) return json({ error: "Firma de Stripe ausente." }, 400);

    // Signature verification is completely local; no Stripe API key is needed.
    const stripe = new Stripe("not_used_for_webhook_verification", {
      apiVersion: "2026-07-29.dahlia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );

    if (!HANDLED_EVENTS.has(event.type)) return json({ received: true, ignored: true });

    const session = event.data.object;
    if (event.type === "checkout.session.async_payment_failed") {
      return json({ received: true, payment: "failed" });
    }
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      return json({ received: true, payment: "pending" });
    }

    const paymentLinkId = getPaymentLinkId(session.payment_link);
    const plan = PLAN_BY_PAYMENT_LINK[paymentLinkId];
    if (!plan) return json({ received: true, ignored: true, reason: "unknown_payment_link" });

    const result = await grantPurchase(getSupabaseAdmin(env), event, session, plan, paymentLinkId, env);
    return json({ received: true, applied: Boolean(result?.applied) });
  } catch (error) {
    const signatureError = /signature|payload/i.test(error?.message || "");
    console.error("stripe_webhook_failed", error?.message || error);
    return json(
      { error: signatureError ? "Firma de Stripe inválida." : "No pudimos procesar el evento." },
      signatureError ? 400 : 500,
    );
  }
}

export function onRequest() {
  return json({ error: "Método no permitido." }, 405);
}
