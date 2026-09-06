(function prepareMetaPixel(window, document, tagName, source, fbq) {
  // Local development must never send real ad-account events.
  if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) || window.location.protocol === 'file:') {
    window.fbq = function localPixelNoop() {};
    return;
  }
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
  const loadRemotePixel = () => {
    if (document.querySelector(`script[src="${source}"]`)) return;
    const script = document.createElement(tagName);
    script.async = true;
    script.src = source;
    document.head.appendChild(script);
  };

  const scheduleRemotePixel = () => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadRemotePixel, { timeout: 2500 });
    } else {
      window.setTimeout(loadRemotePixel, 1000);
    }
  };

  if (document.readyState === "complete") scheduleRemotePixel();
  else window.addEventListener("load", scheduleRemotePixel, { once: true });
})(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

window.fbq("init", "2843277659378048");
window.fbq("track", "PageView");

document.addEventListener("click", (event) => {
  const checkout = event.target.closest?.('a[href*="buy.stripe.com"]');
  if (!checkout) return;

  const offers = [
    {
      id: "3cI7sL7JdelBaWs8hqbwk02",
      name: "CreativeRush Launch",
      value: 999,
    },
    {
      id: "8x2fZh5B591h4y4eFObwk01",
      name: "CreativeRush AI — Esencial",
      value: 1499,
    },
    {
      id: "14AbJ1aVp6T9c0wfJSbwk00",
      name: "CreativeRush AI — Pro",
      value: 1999,
    },
  ];
  const offer = offers.find(({ id }) => checkout.href.includes(id));
  if (!offer) return;

  window.fbq("track", "InitiateCheckout", {
    content_name: offer.name,
    currency: "MXN",
    value: offer.value,
  });
});
