import { getSupabaseAdmin, json } from "../../src/backend.js";

const SESSION_ID = /^cs_(?:test_|live_)?[A-Za-z0-9_]{12,}$/;

export async function onRequestGet({ request, env }) {
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!SESSION_ID.test(sessionId)) {
    return json({ ready: false, error: "Sesión inválida." }, 400);
  }

  try {
    const supabase = getSupabaseAdmin(env);
    const { data, error } = await supabase
      .from("purchases")
      .select("plan_code,payment_status,video_credits,image_credits,granted_at")
      .eq("checkout_session_id", sessionId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return json({ ready: false });

    return json({
      ready: Boolean(data.granted_at),
      plan: data.plan_code,
      paymentStatus: data.payment_status,
      videoCredits: data.video_credits,
      imageCredits: data.image_credits,
    });
  } catch (error) {
    console.error("purchase_status_failed", error?.message || error);
    return json({ ready: false, error: "No pudimos comprobar el acceso todavía." }, 503);
  }
}

export function onRequest() {
  return json({ error: "Método no permitido." }, 405);
}
