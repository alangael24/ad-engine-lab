import { getEdicion, postEdicion } from '../src/edicion.js';
import { onRequestPost as edicionWorker } from '../functions/api/edicion-worker.js';

// Worker propio de /edicion/ (rutas: /edicion*, /api/edicion*, /assets/edicion*), igual que regalos:
// se despliega sin volver a desplegar Pages. El resto del sitio sigue en Pages.
const ASSETS = new Set(['/assets/edicion.js', '/assets/edicion.css', '/assets/edicion-plans.js']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), context = { request, env, waitUntil: p => ctx.waitUntil(p) };
    if (url.pathname === '/api/edicion') {
      if (request.method === 'GET') return getEdicion(context);
      if (request.method === 'POST') return postEdicion(context);
      return new Response(null, { status: 405 });
    }
    if (url.pathname === '/api/edicion-worker') {
      return request.method === 'POST' ? edicionWorker(context) : new Response(null, { status: 405 });
    }
    const page = url.pathname === '/edicion' || url.pathname === '/edicion/' || url.pathname === '/edicion/index.html';
    if (!page && !ASSETS.has(url.pathname)) return new Response('No encontrado.', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    if (url.pathname === '/edicion') return Response.redirect(new URL('/edicion/' + url.search, url), 308);
    const res = await env.ASSETS.fetch(page ? new Request(new URL('/edicion/', url), request) : request);
    const headers = new Headers(res.headers);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    if (page) headers.set('cache-control', 'public, max-age=0, must-revalidate');
    return new Response(res.body, { status: res.status, headers });
  },
};
