import { giftEventData } from './gift-tracking.js';

const preview = document.querySelector('.offer-hero-preview video');
if (preview && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  preview.pause();
  preview.removeAttribute('autoplay');
}

document.addEventListener('click', event => {
  const link = event.target.closest?.('a[data-gift-event]');
  if (!link) return;
  const name = link.dataset.giftEvent;
  const data = name === 'GiftPlanSelected'
    ? giftEventData(link.dataset.giftPlan)
    : { content_category: 'regalos', currency: 'MXN' };
  if (!data) return;
  try { window.fbq?.('trackCustom', name, data); } catch { /* Analytics must not interrupt navigation. */ }
});
