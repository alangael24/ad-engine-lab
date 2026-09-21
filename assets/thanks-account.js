const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session_id") || "";
const status = document.querySelector("#access-status");
const statusDetail = document.querySelector("#access-detail");
const toolButton = document.querySelector("#open-tool");
const planName = document.querySelector("#plan-name");
const planIncludes = document.querySelector("#plan-includes");

const planNames = {
  gift_60:'CreativeRush Regalos — Película de 1 minuto', gift_120:'CreativeRush Regalos — Película de 2 minutos',
  esencial: "CreativeRush AI — Launch",
  pro: "CreativeRush AI — Pro",
  minute_1:"CreativeRush — 1 anuncio completo", minute_3:"CreativeRush — 3 anuncios completos", minute_8:"CreativeRush — 8 anuncios completos",
};

function trackPurchase(data) {
  if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
  if (typeof window.fbq !== "function" || !Number.isFinite(data.amountTotal) || !sessionId) return;

  const storageKey = `meta_purchase_${sessionId}`;
  if (window.localStorage.getItem(storageKey)) return;

  window.fbq("track", "Purchase", {
    content_name: planNames[data.plan] || 'CreativeRush AI',
    currency: String(data.currency || 'mxn').toUpperCase(),
    value: data.amountTotal / 100,
  });
  window.localStorage.setItem(storageKey, "1");
}

function setStatus(title, detail, ready = false) {
  if (status) status.textContent = title;
  if (statusDetail) statusDetail.textContent = detail;
  if (ready) {
    toolButton?.removeAttribute("aria-disabled");
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
      const gift=['gift_60','gift_120'].includes(data.plan);
      planIncludes.textContent = gift?`Tu película personalizada de ${data.videoSeconds===120?'2 minutos':'1 minuto'}, con guion, animación, narración, subtítulos, dedicatoria y descarga.`:data.videoSeconds?`Hasta 1 minuto por anuncio, con imágenes, voz, animación, edición y subtítulos. También puedes repartir la duración incluida en videos más cortos.`:`${data.videoCredits} clips de video + ${data.imageCredits} generaciones de imágenes.`;
      if(toolButton){toolButton.href=gift?"/regalos/?package="+data.plan:data.videoSeconds?"/anuncios-lab/":"/herramienta/";if(gift)toolButton.textContent="Preparar mi película →";}
      if (data.paymentStatus === "paid") {
        document.querySelector('#payment-title').textContent = 'Pago confirmado.';
        document.querySelector('#plan-price').textContent = new Intl.NumberFormat('es-MX', { style:'currency', currency:data.currency || 'MXN' }).format(data.amountTotal / 100);
        trackPurchase(data);
      }
      setStatus(
        "Tu cuenta y tu saldo están listos",
        "Entra con el mismo correo de tu cuenta. Tu saldo ya está acreditado en CreativeRush.",
        true,
      );
      return;
    }
  } catch (error) {
    console.error("purchase_poll_failed", error?.message || error);
  }

  if (attempt < 7) {
    setStatus("Estamos acreditando tu pack…", "Esperamos la confirmación de Stripe. No cierres esta página ni vuelvas a pagar.");
    window.setTimeout(() => checkPurchase(attempt + 1), Math.min(1800 + attempt * 700, 5000));
    return;
  }

  setStatus(
    "Todavía no pudimos confirmar la activación",
    "Revisa el recibo de Stripe y tu correo antes de volver a pagar. Puedes intentar acceder a la herramienta con el correo de tu compra.",
  );
}

checkPurchase();
