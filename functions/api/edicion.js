export { getEdicion as onRequestGet, postEdicion as onRequestPost } from '../../src/edicion.js';
export function onRequest() { return new Response(null, { status: 405 }); }
