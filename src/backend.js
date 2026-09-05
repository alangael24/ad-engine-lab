import { createClient } from "@supabase/supabase-js";

export const PLAN_BY_PAYMENT_LINK = Object.freeze({
  plink_1U8z8uEudyi7fxH7OsFRKvC9: Object.freeze({
    code: "esencial",
    videoCredits: 12,
    imageCredits: 20,
    courseAccess: false,
  }),
  plink_1U8OYPEudyi7fxH7JgMyocZY: Object.freeze({
    code: "esencial",
    videoCredits: 25,
    imageCredits: 50,
    courseAccess: true,
  }),
  plink_1U8OYOEudyi7fxH7YMCWb1rc: Object.freeze({
    code: "pro",
    videoCredits: 60,
    imageCredits: 100,
    courseAccess: true,
  }),
});

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

export function getSupabaseAdmin(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase no está configurado en Cloudflare.");
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getBearerToken(request) {
  const authorization = String(request.headers.get("authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function getAuthenticatedUser(supabase, request) {
  const token = getBearerToken(request);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function getPaymentLinkId(paymentLink) {
  if (typeof paymentLink === "string") return paymentLink;
  if (paymentLink && typeof paymentLink.id === "string") return paymentLink.id;
  return "";
}

export function isExistingUserError(error) {
  const text = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  return text.includes("already") || text.includes("registered") || text.includes("exists");
}
