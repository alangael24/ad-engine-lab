const $ = (selector) => document.querySelector(selector);
const gate = $("#auth-gate");
const dashboard = $("#dashboard");
const form = $("#auth-form");
const emailInput = $("#auth-email");
const submit = $("#auth-submit");
const message = $("#auth-message");
const signout = $("#signout");
const planNames = { esencial: "Primer Video Incluido", pro: "Plan Pro" };

let supabase = null;
let session = null;
let accessRequest = 0;

function setMessage(copy, tone = "neutral") {
  message.textContent = copy;
  message.dataset.tone = tone;
}

function showGate(copy = "No necesitas crear ni recordar una contraseña.", tone = "neutral") {
  dashboard.hidden = true;
  gate.hidden = false;
  signout.hidden = true;
  setMessage(copy, tone);
}

async function openCampus(nextSession) {
  const requestId = ++accessRequest;
  session = nextSession;
  if (!session) {
    showGate();
    return;
  }

  setMessage("Comprobando tu compra…");
  try {
    const [accessResponse, balanceResult] = await Promise.all([
      fetch("/api/course", { headers: { authorization: `Bearer ${session.access_token}`, accept: "application/json" } }),
      supabase.from("credit_balances").select("video_credits,image_credits").eq("user_id", session.user.id).single(),
    ]);
    const access = await accessResponse.json();
    if (requestId !== accessRequest) return;
    if (!accessResponse.ok) {
      showGate(access.error || "Esta cuenta todavía no tiene acceso.", "error");
      signout.hidden = false;
      return;
    }
    if (balanceResult.error) throw balanceResult.error;

    $("#student-email").textContent = session.user.email || "";
    $("#plan-name").textContent = planNames[access.plan] || "CreativeRush AI";
    $("#video-credits").textContent = balanceResult.data.video_credits;
    $("#image-credits").textContent = balanceResult.data.image_credits;
    gate.hidden = true;
    dashboard.hidden = false;
    signout.hidden = false;
  } catch (error) {
    console.error("campus_boot_failed", error?.message || error);
    showGate("No pudimos comprobar tu acceso. Recarga la página o inténtalo de nuevo.", "error");
  }
}

async function boot() {
  if (window.location.protocol === "file:") {
    showGate("El campus protegido funciona en la versión publicada del sitio.");
    return;
  }
  try {
    const response = await fetch("/api/public-config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok || !config.enabled) throw new Error("El acceso todavía no está configurado.");
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm");
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { detectSessionInUrl: true, persistSession: true, flowType: "pkce" },
    });
    const { data: { session: initialSession }, error } = await supabase.auth.getSession();
    if (error) throw error;
    await openCampus(initialSession);
    supabase.auth.onAuthStateChange((_event, nextSession) => window.setTimeout(() => openCampus(nextSession), 0));
  } catch (error) {
    console.error("campus_config_failed", error?.message || error);
    showGate("El acceso automático no está disponible en este momento.", "error");
    emailInput.disabled = true;
    submit.disabled = true;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const email = emailInput.value.trim().toLowerCase();
  if (!email) return;
  submit.disabled = true;
  setMessage("Enviando tu enlace seguro…");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/campus/` },
  });
  submit.disabled = false;
  setMessage(
    error ? "No encontramos una compra con ese correo. Usa exactamente el correo de Stripe." : "Listo. Revisa tu correo y abre el enlace para entrar.",
    error ? "error" : "success",
  );
});

signout.addEventListener("click", async () => {
  if (!supabase) return;
  signout.disabled = true;
  await supabase.auth.signOut();
  signout.disabled = false;
});

boot();
