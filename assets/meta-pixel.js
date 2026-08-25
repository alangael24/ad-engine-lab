(function loadMetaPixel(window, document, tagName, source, fbq, script, firstScript) {
  if (window.fbq) return;
  fbq = window.fbq = function metaPixelQueue() {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
    else fbq.queue.push(arguments);
  };
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  script = document.createElement(tagName);
  script.async = true;
  script.src = source;
  firstScript = document.getElementsByTagName(tagName)[0];
  firstScript.parentNode.insertBefore(script, firstScript);
})(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

window.fbq("init", "2843277659378048");
window.fbq("track", "PageView");

document.addEventListener("click", (event) => {
  const checkout = event.target.closest?.('a[href*="buy.stripe.com"]');
  if (!checkout) return;

  const isEssential = checkout.href.includes("8x2fZh5B591h4y4eFObwk01");
  window.fbq("track", "InitiateCheckout", {
    content_name: isEssential ? "CreativeRush AI — Esencial" : "CreativeRush AI — Pro",
    currency: "MXN",
    value: isEssential ? 1499 : 1999,
  });
});
