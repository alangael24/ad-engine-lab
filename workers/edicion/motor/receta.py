"""Receta JSON: validación con mensajes claros (para que el modelo la corrija) y línea de tiempo con cortes."""
from __future__ import annotations
import json
import os
import re

ESTILOS = ('subtitulos_esteticos', 'cineticos', 'collage', 'anuncio')
POSICIONES = ('arriba', 'medio', 'abajo')
MOVIMIENTOS = ('acercar', 'alejar', 'paneo')
HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
# Campos obligatorios por tipo de evento (además de los tiempos).
EVENTOS = {
    'zoom': ('t0', 't1'),
    'titulo': ('t0', 't1', 'texto'),
    'tarjeta': ('t0', 't1'),
    'broll': ('t0', 't1', 'imagen'),
    'flash': ('t',),
    'collage': ('t0', 't1'),
}


class RecetaInvalida(ValueError):
    pass


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def cargar(ruta: str) -> dict:
    with open(ruta, encoding='utf-8') as fh:
        r = json.load(fh)
    base = os.path.dirname(os.path.abspath(ruta))
    validar(r, base)
    r['_base'] = base
    return r


def ruta(r: dict, p: str) -> str:
    return p if os.path.isabs(p) else os.path.join(r.get('_base', '.'), p)


def validar(r: dict, base: str = '.') -> None:
    e = []
    if r.get('version') != 1:
        e.append('version debe ser 1')
    if r.get('estilo') not in ESTILOS:
        e.append(f'estilo debe ser uno de {ESTILOS}')
    fuente = r.get('fuente')
    if not isinstance(fuente, str) or not os.path.exists(fuente if os.path.isabs(fuente) else os.path.join(base, fuente)):
        e.append('fuente: ruta del video del cliente que no existe')
    pals = r.get('palabras')
    if not isinstance(pals, list) or not pals:
        e.append('palabras: lista de {"t","s","e"} requerida')
    else:
        for i, p in enumerate(pals):
            if not isinstance(p, dict) or not isinstance(p.get('t'), str) or not _num(p.get('s')) or not _num(p.get('e')) or p['e'] < p['s']:
                e.append(f'palabras[{i}]: requiere t (texto), s y e (segundos, e >= s)')
                break
    sub = r.get('subtitulos', {})
    if sub.get('posicion', 'arriba') not in POSICIONES:
        e.append(f'subtitulos.posicion debe ser {POSICIONES}')
    for k in ('color', 'color_acento', 'color_activo'):
        if k in sub and not HEX.match(str(sub[k])):
            e.append(f'subtitulos.{k} debe ser #RRGGBB')
    cortes = r.get('cortes', {})
    if 'tramos' in cortes and (not isinstance(cortes['tramos'], list) or any(not (isinstance(t, list) and len(t) == 2 and _num(t[0]) and _num(t[1]) and t[1] > t[0]) for t in cortes['tramos'])):
        e.append('cortes.tramos: lista de [inicio, fin] en segundos')
    for i, ev in enumerate(r.get('eventos', [])):
        tipo = ev.get('tipo')
        if tipo not in EVENTOS:
            e.append(f'eventos[{i}].tipo debe ser uno de {tuple(EVENTOS)}')
            continue
        for campo in EVENTOS[tipo]:
            if campo not in ev:
                e.append(f'eventos[{i}] ({tipo}): falta {campo}')
        if 't0' in ev and 't1' in ev and not (_num(ev['t0']) and _num(ev['t1']) and ev['t1'] > ev['t0']):
            e.append(f'eventos[{i}] ({tipo}): t1 debe ser mayor que t0')
        for k in ('imagen',):
            if k in ev and not os.path.exists(ev[k] if os.path.isabs(ev[k]) else os.path.join(base, ev[k])):
                e.append(f'eventos[{i}].{k}: no existe {ev[k]}')
        for j, rc in enumerate(ev.get('recortes', [])):
            if not os.path.exists(rc.get('imagen', '') if os.path.isabs(rc.get('imagen', '')) else os.path.join(base, rc.get('imagen', ''))):
                e.append(f'eventos[{i}].recortes[{j}].imagen no existe')
        if ev.get('movimiento', 'acercar') not in MOVIMIENTOS:
            e.append(f'eventos[{i}].movimiento debe ser {MOVIMIENTOS}')
        for k in ('fondo', 'color'):
            if k in ev and not (HEX.match(str(ev[k])) or (k == 'fondo' and ev[k] == 'cuadricula_verde')):
                e.append(f'eventos[{i}].{k} debe ser #RRGGBB' + (" o 'cuadricula_verde'" if k == 'fondo' else ''))
    if e:
        raise RecetaInvalida('Receta inválida:\n- ' + '\n- '.join(e))


def tramos(r: dict, duracion: float) -> list:
    """Tramos del video fuente que se conservan (en segundos del video fuente)."""
    c = r.get('cortes', {})
    if c.get('tramos'):
        return [(max(0.0, a), min(duracion, b)) for a, b in c['tramos'] if min(duracion, b) > max(0.0, a)]
    if not c.get('quitar_silencios'):
        return [(0.0, duracion)]
    pausa, margen = float(c.get('pausa_min', 0.25)), float(c.get('margen', 0.08))
    pals = sorted(r['palabras'], key=lambda p: p['s'])
    if c.get('modo') == 'limpio':  # además de silencios: quita repeticiones y muletillas
        tipos = clasificar(pals)
        pals = [p for p, tp in zip(pals, tipos) if tp == 'VALIDA'] or pals
    out, a, b = [], max(0.0, pals[0]['s'] - margen), pals[0]['e']
    for p in pals[1:]:
        if p['s'] - b > pausa:
            out.append((a, min(duracion, b + margen)))
            a = max(0.0, p['s'] - margen)
        b = max(b, p['e'])
    out.append((a, min(duracion, b + margen)))
    return out


MULETILLAS = {'um', 'umm', 'uh', 'uhh', 'uhm', 'eh', 'ehh', 'em', 'emm', 'mm', 'mmm', 'hmm', 'ah', 'ahh', 'erm', 'er', 'este', 'esteee', 'pues'}


def _norm(t: str) -> str:
    return re.sub(r"[^\w']", '', t.lower())


def clasificar(pals: list) -> list:
    """Tipo de cada palabra: VALIDA, REPETIDA (tartamudeo o frase de 1-3 palabras repetida enseguida) o MULETILLA."""
    n = [_norm(p['t']) for p in pals]
    tipos = ['MULETILLA' if w in MULETILLAS else 'VALIDA' for w in n]
    for largo in (3, 2, 1):  # la primera aparición de una frase repetida inmediatamente se quita
        for i in range(len(n) - 2 * largo + 1):
            a, b = n[i:i + largo], n[i + largo:i + 2 * largo]
            if a == b and all(a) and all(tipos[i + j] == 'VALIDA' for j in range(largo)) \
                    and pals[i + largo]['s'] - pals[i + largo - 1]['e'] < 1.0:
                for j in range(largo):
                    tipos[i + j] = 'REPETIDA'
    # arranque en falso: "yo creo, a ver, yo creo que" -> se quita "yo creo, a ver,"
    for largo in (3, 2):
        for hueco in (1, 2, 3):
            for i in range(len(n) - 2 * largo - hueco + 1):
                j = i + largo + hueco
                # la frase se corta con coma justo antes de repetirse y no cierra oración (eso sería repetición retórica)
                corte = pals[j - 1]['t'].rstrip().endswith((',', '-', '—', '...', '…'))
                cierra = any(p['t'].rstrip().endswith(('.', '?', '!')) and not p['t'].rstrip().endswith('...') for p in pals[i:j])
                if n[i:i + largo] == n[j:j + largo] and all(n[i:i + largo]) and corte and not cierra \
                        and all(tp == 'VALIDA' for tp in tipos[i:j]) and pals[j]['s'] - pals[i]['s'] < 2.5:
                    for x in range(i, j):
                        tipos[x] = 'REPETIDA'
    return tipos


def ajustar_por_energia(segs: list, energia, paso: float, antes: float = 0.12, despues: float = 0.06) -> list:
    """Mueve cada borde al punto más silencioso cercano (evita cortar el final o el inicio de una palabra).
    Inicio: busca entre [a-antes, a+despues]; final: entre [b-despues, b+antes] (el margen ya protege la palabra)."""
    def mas_bajo(i0, i1):
        i0, i1 = max(0, i0), min(len(energia) - 1, i1)
        return i0 + int(energia[i0:i1 + 1].argmin()) if i1 >= i0 else i0
    out = []
    for a, b in segs:
        ia = mas_bajo(int((a - antes) / paso), int((a + despues) / paso))
        ib = mas_bajo(int((b - despues) / paso), int((b + antes) / paso))
        out.append((ia * paso, max(ib, ia + 1) * paso))
    fusion = [out[0]]
    for a, b in out[1:]:
        if a <= fusion[-1][1]:
            fusion[-1] = (fusion[-1][0], max(fusion[-1][1], b))
        else:
            fusion.append((a, b))
    return fusion


class Linea:
    """Convierte tiempos del video fuente a tiempos del video final (tras quitar tramos)."""

    def __init__(self, segs: list):
        self.segs = segs
        self.ini, acc = [], 0.0
        for a, b in segs:
            self.ini.append(acc)
            acc += b - a
        self.duracion = acc

    def __call__(self, t: float) -> float:
        for (a, b), o in zip(self.segs, self.ini):
            if t < a:
                return o  # cae en un silencio quitado: pasa al inicio del siguiente tramo
            if t <= b:
                return o + (t - a)
        return self.duracion
