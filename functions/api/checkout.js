import { json, normalizeEmail } from '../../src/backend.js';
import { apiError, authContext, readJson } from '../../src/generations.js';

export async function onRequestPost(context) {
  try {
    const { user } = await authContext(context);
    if (!user.email_confirmed_at || !user.email) return json({ error: 'Confirma tu correo antes de elegir el plan.', code: 'EMAIL_NOT_CONFIRMED' }, 403);
    const body = await readJson(context.request, 1000);
    if (body?.plan !== 'launch') return json({ error: 'Este plan no está disponible.', code: 'INVALID_PLAN' }, 400);
    // Fixed existing offer: no client-controlled amount, email or redirect.
    const url = new URL('https://buy.stripe.com/3cI7sL7JdelBaWs8hqbwk02');
    url.searchParams.set('locked_prefilled_email', normalizeEmail(user.email));
    url.searchParams.set('client_reference_id', user.id);
    url.searchParams.set('locale', 'es');
    // Reference ID is reconciliation only. The signed webhook still grants to
    // the paid email, never to a client-supplied user ID or credit amount.
    return json({ url: url.href, amount: 999, currency: 'MXN', name: 'CreativeRush Launch' });
  } catch (error) { return apiError(error); }
}
export function onRequest() { return json({ error: 'Método no permitido.' }, 405); }
