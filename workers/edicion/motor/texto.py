"""Textos como sprites RGBA premultiplicados (con caché). Fuentes por rol, válidas en macOS y en Linux (Docker)."""
from __future__ import annotations
import glob
import os
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Por rol: primero macOS, luego paquetes de Debian del Dockerfile; DejaVu siempre existe en Linux.
FUENTES = {
    'redonda': [('/System/Library/Fonts/SFNSRounded.ttf', 0), ('/usr/share/fonts/truetype/lato/Lato-Black.ttf', 0)],
    'gruesa': [('/System/Library/Fonts/Avenir Next.ttc', 8), ('/System/Library/Fonts/HelveticaNeue.ttc', 1),
               ('/usr/share/fonts/truetype/lato/Lato-Black.ttf', 0)],
    'condensada': [('/System/Library/Fonts/HelveticaNeue.ttc', 9), ('/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf', 0)],
    'serif_cursiva': [('/System/Library/Fonts/Supplemental/Didot.ttc', 1), ('/System/Library/Fonts/Supplemental/Baskerville.ttc', 3),
                      ('/usr/share/fonts/opentype/urw-base35/C059-BdIta.otf', 0), ('/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf', 0)],
    'normal': [('/System/Library/Fonts/HelveticaNeue.ttc', 10), ('/usr/share/fonts/truetype/lato/Lato-Bold.ttf', 0)],
}
RESPALDO = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Helvetica.ttc']
PATRONES = {'redonda': '*Rounded*', 'gruesa': '*Black*', 'condensada': '*Condensed*Bold*', 'serif_cursiva': '*Serif*Italic*', 'normal': '*Sans*'}


@lru_cache(maxsize=None)
def fuente(rol: str, tam: int) -> ImageFont.FreeTypeFont:
    for ruta, idx in FUENTES.get(rol, []):
        if os.path.exists(ruta):
            f = ImageFont.truetype(ruta, tam, index=idx)
            try:  # fuentes variables (p. ej. SF Rounded): pedir el grosor gordo
                nombres = [n.decode() if isinstance(n, bytes) else n for n in f.get_variation_names()]
                for peso in ('Heavy', 'Bold', 'Semibold'):
                    if peso in nombres:
                        f.set_variation_by_name(peso)
                        break
            except Exception:
                pass
            return f
    for ruta in sorted(glob.glob('/usr/share/fonts/**/' + PATRONES.get(rol, '*'), recursive=True)):
        if ruta.endswith(('.ttf', '.otf')):
            return ImageFont.truetype(ruta, tam)
    for ruta in RESPALDO:
        if os.path.exists(ruta):
            return ImageFont.truetype(ruta, tam)
    raise RuntimeError('No hay fuentes disponibles')


def hex_rgb(c: str) -> np.ndarray:
    c = c.lstrip('#')
    return np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255


def premul(rgb: np.ndarray, a: np.ndarray) -> np.ndarray:
    return np.dstack([rgb * a[..., None], a]).astype(np.float32)


@lru_cache(maxsize=4096)
def sprite(texto: str, rol: str = 'gruesa', tam: int = 90, color: str = '#FFFFFF', espaciado: float = 0.0,
           sombra: float = 0.55, brillo: str | None = None, contorno: str | None = None, contorno_px: int = 0,
           degradado: tuple | None = None, fondo: str | None = None) -> np.ndarray:
    """Devuelve el texto como RGBA premultiplicado float32, recortado a su contenido con margen para efectos."""
    f = fuente(rol, tam)
    avances = [f.getlength(ch) + espaciado * tam for ch in texto]
    asc, desc = f.getmetrics()
    pad = int(tam * 0.6) + contorno_px
    ancho = int(sum(avances) - espaciado * tam) + 2 * pad + 4
    alto = asc + desc + 2 * pad
    mask = Image.new('L', (max(ancho, 8), alto), 0)
    d = ImageDraw.Draw(mask)
    x = pad
    for ch, av in zip(texto, avances):
        d.text((x, pad), ch, font=f, fill=255)
        x += av
    a = np.asarray(mask, np.float32) / 255
    h, w = a.shape
    rgb = np.zeros((h, w, 3), np.float32)
    alpha = np.zeros((h, w), np.float32)
    if fondo:  # píldora detrás del texto
        ys, xs = np.nonzero(a > 0.05)
        if len(ys):
            pill = Image.new('L', (w, h), 0)
            r = int(tam * 0.32)
            ImageDraw.Draw(pill).rounded_rectangle((xs.min() - r, ys.min() - r // 2, xs.max() + r, ys.max() + r // 2), radius=r, fill=255)
            pa = np.asarray(pill, np.float32) / 255
            rgb, alpha = rgb * (1 - pa[..., None]) + hex_rgb(fondo) * pa[..., None], np.maximum(alpha, pa)
    if sombra and not fondo:
        s = np.asarray(mask.filter(ImageFilter.GaussianBlur(max(2, tam // 9))), np.float32) / 255 * sombra
        s = np.roll(s, max(1, tam // 22), axis=0)
        alpha = np.maximum(alpha, s)
    if brillo:  # halo de color (neón)
        for radio, k in ((tam // 5, 1.0), (tam // 2, 0.7)):
            g = np.clip(np.asarray(mask.filter(ImageFilter.GaussianBlur(max(2, radio))), np.float32) / 255 * 1.7 * k, 0, 1)
            rgb = rgb * (1 - g[..., None]) + hex_rgb(brillo) * g[..., None]
            alpha = np.maximum(alpha, g)
    if contorno and contorno_px:
        c = np.asarray(mask.filter(ImageFilter.MaxFilter(contorno_px * 2 + 1)), np.float32) / 255
        rgb = rgb * (1 - c[..., None]) + hex_rgb(contorno) * c[..., None]
        alpha = np.maximum(alpha, c)
    if degradado:  # relleno con degradado vertical entre varios colores
        cols = [hex_rgb(c) for c in degradado]
        ys = np.linspace(0, 1, h)[:, None]
        seg = np.clip(ys * (len(cols) - 1), 0, len(cols) - 1 - 1e-6)
        i = seg.astype(int)
        t = (seg - i)[..., None]
        fill = np.stack([cols[k] for k in range(len(cols))])
        relleno = (fill[i] * (1 - t) + fill[np.minimum(i + 1, len(cols) - 1)] * t).repeat(w, axis=1)
    else:
        relleno = np.broadcast_to(hex_rgb(color), (h, w, 3))
    rgb = rgb * (1 - a[..., None]) + relleno * a[..., None]
    alpha = np.maximum(alpha, a)
    ys, xs = np.nonzero(alpha > 0.01)
    if len(ys):
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgb, alpha = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
    return premul(rgb, alpha)
