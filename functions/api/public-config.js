import { json } from "../../src/backend.js";

export function onRequestGet({ env }) {
  const enabled = Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);

  return json({
    enabled,
    supabaseUrl: enabled ? env.SUPABASE_URL : null,
    supabasePublishableKey: enabled ? env.SUPABASE_PUBLISHABLE_KEY : null,
  });
}

export function onRequest() {
  return json({ error: "Método no permitido." }, 405);
}
