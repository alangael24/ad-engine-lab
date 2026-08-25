const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session_id") || "";
const status = document.querySelector("#access-status");
const statusDetail = document.querySelector("#access-detail");
const campusButton = document.querySelector("#open-campus");
const courseButton = document.querySelector("#open-course");
const planName = document.querySelector("#plan-name");
const planIncludes = document.querySelector("#plan-includes");

const planNames = { esencial: "Ad Engine Lab — Esencial", pro: "Ad Engine Lab — Pro" };

function setStatus(title, detail, ready = false) {
  if (status) status.textContent = title;
  if (statusDetail) statusDetail.textContent = detail;
  if (ready) {
    campusButton?.removeAttribute("aria-disabled");
    courseButton?.removeAttribute("aria-disabled");
  }
}

async function checkPurchase(attempt = 0) {
  if (!sessionId) {
    setStatus(
      "Revisa tu correo",
      "Tu recibo y el enlace seguro de acceso llegarán al correo usado en Stripe.",
    );
    return;
  }

  try {
    const response = await fetch(`/api/purchase-status?session_id=${encodeURIComponent(sessionId)}`, {
      headers: { accept: "application/json" },
    });
    const data = await response.json();
    if (response.ok && data.ready) {
      if (planNames[data.plan]) planName.textContent = planNames[data.plan];
      planIncludes.textContent = `${data.videoCredits} clips de video + ${data.imageCredits} generaciones de imágenes.`;
      setStatus(
        "Tu cuenta y tu saldo están listos",
        "Te enviamos un enlace seguro al correo usado en Stripe. Ábrelo para entrar al curso y a la herramienta.",
        true,
      );
      return;
    }
  } catch (error) {
    console.error("purchase_poll_failed", error?.message || error);
  }

  if (attempt < 7) {
    setStatus("Estamos creando tu cuenta…", "Normalmente tarda solo unos segundos. No cierres esta página.");
    window.setTimeout(() => checkPurchase(attempt + 1), Math.min(1800 + attempt * 700, 5000));
    return;
  }

  setStatus(
    "El pago está confirmado",
    "La activación sigue procesándose. Revisa tu correo; no necesitas volver a pagar.",
  );
}

checkPurchase();
