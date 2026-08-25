const $ = (selector) => document.querySelector(selector);
const gate = $("#auth-gate");
const form = $("#auth-form");
const emailInput = $("#auth-email");
const message = $("#auth-message");
const submit = $("#auth-submit");
const accountButton = $("#account-button");
const desktopCredit = $("#desktop-credit-copy");
const mobileCredit = $("#mobile-credit-copy");

let supabase = null;
let currentSession = null;

function emitAuth(authenticated, backendEnabled = true) {
  window.dispatchEvent(new CustomEvent("ad-engine:auth-state", {
    detail: { authenticated, backendEnabled },
  }));
}

function setCredits(video = null, images = null, copy = "Saldo pendiente") {
  const desktop = video === null ? copy : `${video} clips · ${images} imágenes`;
  const mobile = video === null ? copy : `${video} clips · ${images} imgs`;
  if (desktopCredit) desktopCredit.textContent = desktop;
  if (mobileCredit) mobileCredit.textContent = mobile;
}

function setMessage(copy, tone = "neutral") {
  if (!message) return;
  message.textContent = copy;
  message.dataset.tone = tone;
}

function showGate() {
  gate?.removeAttribute("hidden");
  accountButton?.setAttribute("hidden", "");
  emitAuth(false);
  window.setTimeout(() => emailInput?.focus(), 50);
}

function hideGate() {
  gate?.setAttribute("hidden", "");
  accountButton?.removeAttribute("hidden");
  emitAuth(true);
}

async function loadBalance(session) {
  const { data, error } = await supabase
    .from("credit_balances")
    .select("video_credits,image_credits")
    .eq("user_id", session.user.id)
    .single();

  if (error) {
    console.error("credit_balance_failed", error.message);
    setCredits(null, null, "Activando saldo…");
    return;
  }

  setCredits(data.video_credits, data.image_credits);
}

async function applySession(session) {
  currentSession = session;
  if (!session) {
    setCredits(null, null, "Inicia sesión");
    showGate();
    return;
  }

  accountButton.textContent = session.user.email || "Mi cuenta";
  hideGate();
  await loadBalance(session);
}

async function boot() {
  if (window.location.protocol === "file:") {
    setCredits(null, null, "Vista previa");
    gate?.setAttribute("hidden", "");
    emitAuth(true, false);
    return;
  }

  try {
    const response = await fetch("/api/public-config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok || !config.enabled) throw new Error("La activación del acceso está pendiente.");

    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm");
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { detectSessionInUrl: true, persistSession: true, flowType: "pkce" },
    });

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    await applySession(session);

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => applySession(nextSession), 0);
    });
  } catch (error) {
    console.warn("account_boot_failed", error?.message || error);
    setCredits(null, null, "Activación pendiente");
    setMessage("El acceso automático todavía no está disponible. Inténtalo de nuevo en unos minutos.", "error");
    showGate();
    emailInput?.setAttribute("disabled", "");
    submit?.setAttribute("disabled", "");
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const email = emailInput.value.trim().toLowerCase();
  if (!email) return;

  submit.disabled = true;
  setMessage("Enviando tu enlace seguro…");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/herramienta/`,
    },
  });

  if (error) {
    setMessage("No encontramos una compra con ese correo. Usa exactamente el correo de Stripe.", "error");
    submit.disabled = false;
    return;
  }

  setMessage("Listo. Revisa tu correo y abre el enlace para entrar.", "success");
});

accountButton?.addEventListener("click", async () => {
  if (!supabase || !currentSession) return;
  accountButton.disabled = true;
  await supabase.auth.signOut();
  accountButton.disabled = false;
});

boot();
