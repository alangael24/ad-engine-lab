"""Los 4 estilos probados en el benchmark: subtítulos y eventos visuales. Todo en tiempos del video final."""
from __future__ import annotations
from functools import lru_cache

import cv2
import numpy as np

from .efectos import Lienzo, anillos, ease_out, ease_out_back, imagen, ken_burns
from .texto import hex_rgb, sprite

Y_POS = {'arriba': 0.15, 'medio': 0.5, 'abajo': 0.73}

# Valores por estilo; la receta puede sobrescribir subtitulos.* y color.*
ESTILO = {
    'subtitulos_esteticos': {'sub': {'posicion': 'arriba', 'color': '#FCF7B4', 'color_acento': '#FFFFFF', 'tamano': 96},
                             'color': {'calido': 0.35, 'contraste': 1.04, 'vineta': 0.0}},
    'cineticos': {'sub': {'posicion': 'abajo', 'color': '#FFFFFF', 'color_acento': '#FF3030', 'color_acento_2': '#FFD640', 'tamano': 92},
                  'color': {'calido': 0.1, 'contraste': 1.1, 'vineta': 0.35}},
    'collage': {'sub': {'posicion': 'abajo', 'color': '#FFFFFF', 'color_acento': '#FFFFFF', 'tamano': 88},
                'color': {'calido': 0.0, 'contraste': 1.05, 'vineta': 0.3}},
    'anuncio': {'sub': {'posicion': 'abajo', 'color': '#FFFFFF', 'color_activo': '#FFD640', 'tamano': 64},
                'color': {'calido': 0.1, 'contraste': 1.06, 'vineta': 0.2}},
}


def config(r: dict) -> dict:
    base = ESTILO[r['estilo']]
    return {'sub': {**base['sub'], **r.get('subtitulos', {})}, 'color': {**base['color'], **r.get('color', {})}}


def bloques(pals: list, max_palabras: int, pausa: float = 0.35) -> list:
    out, cur = [], []
    for p in pals:
        if cur and (len(cur) >= max_palabras or p['s'] - cur[-1]['e'] > pausa):
            out.append(cur)
            cur = []
        cur.append(p)
    if cur:
        out.append(cur)
    return out


def _activo(blqs: list, t: float):
    for i, b in enumerate(blqs):
        fin = blqs[i + 1][0]['s'] if i + 1 < len(blqs) else b[-1]['e'] + 0.6
        if b[0]['s'] - 0.03 <= t < min(fin, b[-1]['e'] + 1.2):
            return b
    return None


# ---------------- subtítulos ----------------
def sub_esteticos(L: Lienzo, pals: list, t: float, c: dict, k: float):
    """Una palabra a la vez, redonda y cálida, con rebote; acentos en serif cursiva."""
    for i, p in enumerate(pals):
        fin = pals[i + 1]['s'] if i + 1 < len(pals) else p['e'] + 0.4
        if p['s'] - 0.02 <= t < min(fin, p['e'] + 0.45):
            ac = p.get('acento')
            tam = int(c['tamano'] * (1.18 if ac else 1.0) * k)
            spr = sprite(p['t'], 'serif_cursiva' if ac else 'redonda', tam, c['color_acento'] if ac else c['color'], -0.035 if not ac else 0.0, 0.5)
            q = (t - p['s']) / 0.18
            L.poner(spr, L.w / 2, L.h * Y_POS[c['posicion']], 0.55 + 0.45 * ease_out_back(q), ease_out(q * 2), etiqueta='sub')
            return


def sub_cineticos(L: Lienzo, pals: list, t: float, c: dict, k: float):
    """Bloques de 1-3 palabras apiladas: la palabra clave enorme, en color y con brillo; las demás pequeñas."""
    blqs = bloques(pals, 3)
    b = _activo(blqs, t)
    if not b:
        return
    color_ac = c['color_acento'] if blqs.index(b) % 2 == 0 else c.get('color_acento_2', c['color_acento'])
    sprs = []
    for p in b:
        if p.get('acento'):
            sprs.append((p, sprite(p['t'].upper(), 'gruesa', int(c['tamano'] * 1.9 * k), color_ac, -0.03, 0.4, color_ac), True))
        else:
            sprs.append((p, sprite(p['t'], 'gruesa', int(c['tamano'] * 0.8 * k), c['color'], -0.02, 0.6), False))
    alto = sum(s.shape[0] * 0.82 for _, s, _ in sprs)
    y = L.h * Y_POS[c['posicion']] - alto / 2
    for p, s, grande in sprs:
        y += s.shape[0] * 0.41
        q = (t - p['s']) / 0.22
        if q >= 0:
            if grande:
                esc = min(1.0, L.w * 0.9 / s.shape[1])
                L.poner(s, L.w / 2, y, esc * (1 + 0.45 * (1 - ease_out(q))), ease_out(q * 1.6), blur=18 * (1 - ease_out(q)), etiqueta='sub')
            else:
                L.poner(s, L.w / 2, y + 50 * k * (1 - ease_out(q)), 1.0, ease_out(q * 1.6), blur=14 * (1 - ease_out(q)), etiqueta='sub')
        y += s.shape[0] * 0.41


def sub_escalera(L: Lienzo, pals: list, t: float, c: dict, k: float):
    """Collage: la frase se arma en escalera; los conectores seguidos van en un renglón pequeño y cada
    palabra con acento en su propio renglón grande. Cada renglón aparece cuando se dice su primera palabra."""
    b = _activo(bloques(pals, 6, 0.4), t)
    if not b:
        return
    renglones, chicos = [], []
    for p in b:
        if p.get('acento'):
            if chicos:
                renglones.append((False, chicos))
                chicos = []
            renglones.append((True, [p]))
        else:
            chicos.append(p)
    if chicos:
        renglones.append((False, chicos))
    sprs = [(g, ws, sprite(' '.join(w['t'] for w in ws), 'gruesa' if g else 'normal', int(c['tamano'] * (1.6 if g else 0.62) * k),
                          c['color_acento'] if g else c['color'], -0.02, 0.6)) for g, ws in renglones]
    alto = sum(s.shape[0] * 0.9 for _, _, s in sprs)
    y = L.h * Y_POS[c['posicion']] - alto / 2
    for i, (g, ws, s) in enumerate(sprs):
        y += s.shape[0] * 0.45
        q = (t - ws[0]['s']) / 0.2
        esc = min(1.0, L.w * 0.86 / s.shape[1])
        if q >= 0:
            x = min(L.w * 0.08 + i * L.w * 0.04 + s.shape[1] * esc / 2, L.w - s.shape[1] * esc / 2 - L.w * 0.04)
            L.poner(s, x, y, esc * (0.8 + 0.2 * ease_out_back(q)), ease_out(q * 2), blur=10 * (1 - ease_out(q)), etiqueta='sub')
        y += s.shape[0] * 0.45


def sub_anuncio(L: Lienzo, pals: list, t: float, c: dict, k: float):
    """Frases cortas abajo; la palabra que se dice se pinta de color."""
    b = _activo(bloques(pals, 4), t)
    if not b:
        return
    tam = int(c['tamano'] * k)
    sprs = [sprite(p['t'], 'gruesa', tam, c['color_activo'] if p['s'] <= t < p['e'] + 0.05 else c['color'], -0.01, 0.75) for p in b]
    gap = tam * 0.28
    total = sum(s.shape[1] for s in sprs) + gap * (len(sprs) - 1)
    escala = min(1.0, L.w * 0.9 / max(total, 1))
    x = L.w / 2 - total * escala / 2
    q = (t - b[0]['s']) / 0.16
    y = L.h * Y_POS[c['posicion']] + 20 * k * (1 - ease_out(q))
    for s in sprs:
        L.poner(s, x + s.shape[1] * escala / 2, y, escala, ease_out(q * 2), etiqueta='sub')
        x += (s.shape[1] + gap) * escala


SUBTITULOS = {'subtitulos_esteticos': sub_esteticos, 'cineticos': sub_cineticos, 'collage': sub_escalera, 'anuncio': sub_anuncio}


# ---------------- eventos ----------------
@lru_cache(maxsize=4)
def cuadricula_verde(w: int, h: int) -> np.ndarray:
    f = np.ones((h, w, 3), np.float32) * hex_rgb('#2E7D5B')
    paso = max(8, w // 18)
    for x in range(0, w, paso):
        cv2.line(f, (x, 0), (x, h), (0.45, 0.62, 0.52), max(1, w // 540), cv2.LINE_AA)
    for y in range(0, h, paso):
        cv2.line(f, (0, y), (w, y), (0.45, 0.62, 0.52), max(1, w // 540), cv2.LINE_AA)
    ruido = np.random.default_rng(3).normal(0, 0.018, (h, w, 1)).astype(np.float32)
    return np.clip(f + ruido, 0, 1)


def pantalla_completa(ev: dict) -> bool:
    return ev['tipo'] in ('tarjeta', 'broll', 'collage')


def evento(L: Lienzo, ev: dict, t: float, k: float, ruta):
    tipo = ev['tipo']
    p = (t - ev['t0']) / max(0.01, ev['t1'] - ev['t0']) if 't0' in ev else 0.0
    if tipo == 'broll':
        img = imagen(ruta(ev['imagen']), int(1200 * k))
        L.f[:] = ken_burns(img[..., :3], p, L.w, L.h, ev.get('movimiento', 'acercar'))
        if ev.get('texto'):
            L.poner(sprite(ev['texto'], 'gruesa', int(110 * k), ev.get('color', '#FFFFFF'), -0.02, 0.75), L.w / 2, L.h * ev.get('y', 0.26), min(1.0, L.w * 0.9 / max(1, int(110 * k) * len(ev['texto']) * 0.6)), ease_out((t - ev['t0']) / 0.2), etiqueta='titulo')
    elif tipo == 'tarjeta':
        fondo = hex_rgb(ev.get('fondo', '#C8102E'))
        L.f[:] = fondo
        if ev.get('anillos', True):
            anillos(L, np.minimum(fondo * 1.6 + 0.15, 1), t)
        if ev.get('imagen'):
            q = (t - ev['t0']) / 0.3
            L.poner(imagen(ruta(ev['imagen']), int(L.w * 0.6), 0, True), L.w / 2, L.h * 0.43, 0.7 + 0.3 * ease_out_back(q), ease_out(q * 2))
        _titulos(L, ev, t, k, 0.72 if ev.get('imagen') else 0.45)
    elif tipo == 'collage':
        L.f[:] = cuadricula_verde(L.w, L.h) if ev.get('fondo', 'cuadricula_verde') == 'cuadricula_verde' else hex_rgb(ev['fondo'])
        for rc in ev.get('recortes', []):
            q = (t - rc.get('entra', ev['t0'])) / 0.28
            if q >= 0:
                spr = imagen(ruta(rc['imagen']), int(L.w * rc.get('ancho', 0.5)), max(4, int(12 * k)), True)
                L.poner(spr, L.w * rc.get('x', 0.5), L.h * rc.get('y', 0.5), 0.6 + 0.4 * ease_out_back(q), ease_out(q * 2), giro=rc.get('giro', 0))
        for tx in ev.get('texto', []):
            q = (t - tx.get('t', ev['t0'])) / 0.2
            if q >= 0:
                tam = {'chico': 54, 'grande': 130, 'enorme': 300}.get(tx.get('tamano', 'grande'), 130)
                rol = 'normal' if tx.get('tamano') == 'chico' else 'gruesa'
                L.poner(sprite(tx['texto'], rol, int(tam * k), tx.get('color', '#FFFFFF'), -0.03, 0.6), L.w * tx.get('x', 0.5), L.h * tx.get('y', 0.5),
                        0.8 + 0.2 * ease_out_back(q), ease_out(q * 2), blur=10 * (1 - ease_out(q)), etiqueta='titulo')
    elif tipo == 'titulo':
        _titulos(L, ev, t, k, ev.get('y', 0.3))
    elif tipo == 'flash':
        a = max(0.0, 1 - abs(t - ev['t']) / 0.1)
        if a > 0:
            L.f[:] = L.f * (1 - a * 0.85) + hex_rgb(ev.get('color', '#FFFFFF')) * a * 0.85


def _titulos(L: Lienzo, ev: dict, t: float, k: float, y: float):
    q = (t - ev['t0']) / 0.22
    if ev.get('titulo') or ev.get('texto'):
        s = sprite(ev.get('titulo') or ev['texto'], 'gruesa', int(ev.get('tamano', 140) * k), ev.get('color', '#FFFFFF'), -0.03, 0.6)
        esc = min(1.0, L.w * 0.9 / s.shape[1])
        L.poner(s, L.w / 2, L.h * y, esc * (0.7 + 0.3 * ease_out_back(q)), ease_out(q * 2), blur=12 * (1 - ease_out(q)), etiqueta='titulo')
        y += s.shape[0] * esc / L.h * 0.62
    linea2 = ev.get('subtitulo') or ev.get('linea2')
    if linea2:
        q2 = (t - ev['t0'] - 0.15) / 0.22
        s = sprite(linea2, 'serif_cursiva', int(ev.get('tamano', 140) * 0.75 * k), ev.get('color_linea2', ev.get('color', '#FFFFFF')), 0.0, 0.75)
        L.poner(s, L.w / 2, L.h * y + s.shape[0] * 0.5, min(1.0, L.w * 0.9 / s.shape[1]), ease_out(q2 * 2), etiqueta='titulo')
