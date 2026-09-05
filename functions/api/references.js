import { json } from '../../src/backend.js';
import { apiError, authContext, readBounded, MAX_REFERENCE_BYTES, REFERENCE_BUCKET, imageType, ApiError } from '../../src/generations.js';

export async function onRequestPost(context) {
  try {
    const { db, user } = await authContext(context);
    const { data: balance, error: balanceError } = await db.from('credit_balances').select('video_credits').eq('user_id', user.id).single();
    if (balanceError) throw balanceError;
    if (balance.video_credits < 1) throw new ApiError('INSUFFICIENT_CREDITS');
    const { count, error } = await db.from('generation_references').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gt('created_at', new Date(Date.now() - 86400000).toISOString());
    if (error) throw error; if (count >= 30) throw new ApiError('UPLOAD_LIMIT');
    const bytes = await readBounded(context.request, MAX_REFERENCE_BYTES);
    const [mime, extension] = imageType(bytes);
    if (context.request.headers.get('content-type') !== mime) throw new ApiError('INVALID_REFERENCE');
    const id = crypto.randomUUID(), storagePath = `${user.id}/${id}.${extension}`;
    const upload = await db.storage.from(REFERENCE_BUCKET).upload(storagePath, bytes, { contentType: mime, upsert: false });
    if (upload.error) throw upload.error;
    const insert = await db.rpc('register_generation_reference', { p_id:id, p_user_id:user.id, p_storage_path:storagePath, p_mime_type:mime, p_size_bytes:bytes.length });
    if (insert.error) { await db.storage.from(REFERENCE_BUCKET).remove([storagePath]); throw insert.error; }
    return json({ referenceId: id }, 201);
  } catch (error) { return apiError(error); }
}
export function onRequest() { return json({ error: 'Método no permitido.' }, 405); }
