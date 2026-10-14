import { getEdicion, postEdicion } from '../src/edicion.js';
import { onRequestPost as edicionWorker } from '../functions/api/edicion-worker.js';

// Worker propio de /edicion/ (rutas: /edicion*, /api/edicion*, /assets/edicion*), igual que regalos:
// se despliega sin volver a desplegar Pages. El resto del sitio sigue en Pages.
export const EDICION_ASSETS = ['edicion.js', 'edicion.css', 'edicion-plans.js', 'edicion-pedido.js', 'edicion-pedidos.js', 'edicion-video.js'];
const ASSETS = new Set(EDICION_ASSETS.map(f => `/assets/${f}`));
// Página de inicio y página privada del pedido.
const PAGES = { '/edicion': '/edicion/', '/edicion/': '/edicion/', '/edicion/index.html': '/edicion/',
  '/edicion/p': '/edicion/p/', '/edicion/p/': '/edicion/p/', '/edicion/p/index.html': '/edicion/p/' };

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
    const page = PAGES[url.pathname];
    if (!page && !ASSETS.has(url.pathname)) return new Response('No encontrado.', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    if (page && !url.pathname.endsWith('/') && !url.pathname.endsWith('.html')) return Response.redirect(new URL(page + url.search, url), 308);
    const res = await env.ASSETS.fetch(page ? new Request(new URL(page, url), request) : request);
    const headers = new Headers(res.headers);
    headers.set('x-content-type-options', 'nosniff');
    // La página del pedido es privada: sin indexar y sin mandar la URL a otros sitios.
    headers.set('referrer-policy', page === '/edicion/p/' ? 'no-referrer' : 'strict-origin-when-cross-origin');
    if (page === '/edicion/p/') headers.set('x-robots-tag', 'noindex, nofollow');
    // Páginas y scripts siempre se revalidan: tras un despliegue nunca se mezclan versiones.
    headers.set('cache-control', 'public, max-age=0, must-revalidate');
    return new Response(res.body, { status: res.status, headers });
  },
};
