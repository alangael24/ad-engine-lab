import { giftEventData } from './gift-tracking.js';

const preview = document.querySelector('.offer-hero-preview video');
if (preview && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  preview.pause();
  preview.removeAttribute('autoplay');
}

const countdownStrip = document.querySelector('.gift-timer-strip');
const countdownEnd = Date.parse(countdownStrip?.dataset.countdownEnd || '');
const countdownDisplay = countdownStrip?.querySelector('[role="timer"]');
if (countdownDisplay && Number.isFinite(countdownEnd)) {
  let countdownInterval;
  const updateCountdown = () => {
    const remaining = Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000));
    if (!remaining) {
      countdownStrip.hidden = true;
      clearInterval(countdownInterval);
      return false;
    }
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor(remaining / 60) % 60;
    const seconds = remaining % 60;
    countdownDisplay.textContent = [hours, minutes, seconds]
      .map(value => String(value).padStart(2, '0')).join(':');
    countdownDisplay.setAttribute('aria-label', `${hours} horas, ${minutes} minutos y ${seconds} segundos restantes`);
    countdownStrip.hidden = false;
    return true;
  };
  if (updateCountdown()) countdownInterval = setInterval(updateCountdown, 1000);
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
