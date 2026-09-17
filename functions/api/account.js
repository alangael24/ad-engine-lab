import { json } from '../../src/backend.js';
import { apiError, authContext } from '../../src/generations.js';
import { secondsBalance } from '../../src/video-packages.js';

export async function onRequestGet(context) {
  try {
    const { db, user } = await authContext(context);
    const [balance, purchases] = await Promise.all([
      db.from('credit_balances').select('video_credits,image_credits').eq('user_id', user.id).maybeSingle(),
      db.from('purchases').select('checkout_session_id').eq('user_id', user.id).limit(1),
    ]);
    if (balance.error) throw balance.error;
    if (purchases.error) throw purchases.error;
    return json({ email: user.email, hasPack: Boolean(purchases.data?.length), seconds:await secondsBalance(db,user.id),
      balance: balance.data || { video_credits: 0, image_credits: 0 } });
  } catch (error) { return apiError(error); }
}
export function onRequest() { return json({ error: 'Método no permitido.' }, 405); }
