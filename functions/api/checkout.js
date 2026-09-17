import { json, normalizeEmail } from '../../src/backend.js';
import { apiError, authContext, readJson } from '../../src/generations.js';
import { VIDEO_PACKAGES } from '../../src/video-packages.js';

export async function onRequestPost(context) {
  try {
    const { user } = await authContext(context);
    if (!user.email_confirmed_at || !user.email) return json({ error: 'Confirma tu correo antes de elegir el plan.', code: 'EMAIL_NOT_CONFIRMED' }, 403);
    const body = await readJson(context.request, 1000);
    const plan = Object.hasOwn(VIDEO_PACKAGES, body?.plan||'') ? VIDEO_PACKAGES[body.plan] : null;
    if (!plan) return json({ error: 'Este plan no está disponible.', code: 'INVALID_PLAN' }, 400);
    const url = new URL(plan.url);
    url.searchParams.set('locked_prefilled_email', normalizeEmail(user.email));
    url.searchParams.set('client_reference_id', user.id);
    url.searchParams.set('locale', 'es');
    // Reference ID is reconciliation only. The signed webhook still grants to
    // the paid email, never to a client-supplied user ID or credit amount.
    return json({ url: url.href, amount: plan.amount, currency: plan.currency, name: plan.name, videoSeconds:plan.videoSeconds });
  } catch (error) { return apiError(error); }
}
export function onRequest() { return json({ error: 'Método no permitido.' }, 405); }
