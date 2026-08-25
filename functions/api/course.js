import { COURSE_CATALOG } from "../../src/course-catalog.js";
import { getAuthenticatedUser, getSupabaseAdmin, json } from "../../src/backend.js";

export async function onRequestGet({ request, env }) {
  try {
    const supabase = getSupabaseAdmin(env);
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) return json({ error: "Inicia sesión para abrir el curso." }, 401);

    const { data: purchase, error } = await supabase
      .from("purchases")
      .select("plan_code,granted_at")
      .eq("user_id", user.id)
      .not("granted_at", "is", null)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!purchase) return json({ error: "Esta cuenta todavía no tiene una compra activa." }, 403);

    return json({
      access: true,
      student: { email: user.email || "" },
      plan: purchase.plan_code,
      course: COURSE_CATALOG,
    });
  } catch (error) {
    console.error("course_access_failed", error?.message || error);
    return json({ error: "No pudimos comprobar el acceso al curso." }, 503);
  }
}

export function onRequest() {
  return json({ error: "Método no permitido." }, 405);
}
