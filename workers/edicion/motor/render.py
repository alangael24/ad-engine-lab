"""Render determinista: corta silencios, reencuadra a 9:16, aplica estilo y eventos, codifica y valida."""
from __future__ import annotations
import json
import os
import subprocess
import sys

import cv2
import numpy as np

from . import estilos
from .efectos import Lienzo, clamp, ease_out
from .receta import Linea, ajustar_por_energia, cargar, clasificar, ruta, tramos

FPS = 30


def ffprobe(path: str) -> dict:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path],
                         capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    v = next(s for s in j['streams'] if s['codec_type'] == 'video')
    return {'duracion': float(j['format']['duration']), 'w': v['width'], 'h': v['height'], 'audio': any(s['codec_type'] == 'audio' for s in j['streams'])}


def codificador() -> list:
    if sys.platform == 'darwin':
        return ['-c:v', 'h264_videotoolbox', '-b:v', '6M']
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-threads', '2']


class Proyecto:
    def __init__(self, receta_path: str):
        self.r = cargar(receta_path)
        self.base = self.r['_base']
        self.trabajo = os.path.join(self.base, '.motor')
        os.makedirs(self.trabajo, exist_ok=True)
        self.cfg = estilos.config(self.r)
        self.fuente = ruta(self.r, self.r['fuente'])
        meta = ffprobe(self.fuente)
        cortes = self.r.get('cortes', {})
        self.segs = tramos(self.r, meta['duracion'])
        if cortes.get('quitar_silencios') and cortes.get('ajustar_energia', cortes.get('modo') == 'limpio') and meta['audio']:
            energia, paso = self.energia()
            self.segs = ajustar_por_energia(self.segs, energia, paso)
        self.linea = Linea(self.segs)
        self.ruta = lambda p: ruta(self.r, p)
        m = self.linea
        pals = sorted(self.r['palabras'], key=lambda p: p['s'])
        if cortes.get('quitar_silencios') and cortes.get('modo') == 'limpio':  # repeticiones y muletillas fuera de los subtítulos
            self.quitadas = [p['t'] for p, tp in zip(pals, clasificar(pals)) if tp != 'VALIDA']
            pals = [p for p, tp in zip(pals, clasificar(pals)) if tp == 'VALIDA']
        else:
            self.quitadas = []
        self.pals = [{**p, 's': m(p['s']), 'e': max(m(p['s']), m(p['e']))} for p in pals]
        self.eventos = []
        for ev in self.r.get('eventos', []):
            e = dict(ev)
            for k in ('t0', 't1', 't'):
                if k in e:
                    e[k] = m(e[k])
            for rc in e.get('recortes', []):
                if 'entra' in rc:
                    rc['entra'] = m(rc['entra'])
            for tx in e.get('texto', []) if isinstance(e.get('texto'), list) else []:
                if 't' in tx:
                    tx['t'] = m(tx['t'])
            self.eventos.append(e)
        self.puntos = sorted(self.r.get('encuadre', {}).get('puntos', []), key=lambda p: p.get('t', 0))
        for p in self.puntos:
            p['t'] = m(p.get('t', 0))
        self.qa = {'textos_fuera_de_cuadro': 0, 'cuadros': 0}

    def energia(self, paso: float = 0.01):
        """Energía RMS del audio en ventanas de 10 ms (para ajustar los bordes de los cortes)."""
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', self.fuente, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
                             capture_output=True, check=True).stdout
        a = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
        n = int(16000 * paso)
        a = a[:len(a) // n * n].reshape(-1, n)
        return np.sqrt((a ** 2).mean(1)), paso

    # ---- fuente cortada ----
    def cortada(self) -> str:
        if len(self.segs) == 1 and self.segs[0][0] < 0.05:
            return self.fuente
        out = os.path.join(self.trabajo, 'fuente_cortada.mp4')
        sel = '+'.join(f'between(t,{a:.3f},{b:.3f})' for a, b in self.segs)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', self.fuente,
                        '-vf', f"select='{sel}',setpts=N/FRAME_RATE/TB,fps={FPS}", '-af', f"aselect='{sel}',asetpts=N/SR/TB",
                        *codificador(), '-c:a', 'aac', '-b:a', '192k', out], check=True)
        return out

    # ---- reencuadre ----
    def encuadre(self, t: float):
        x, y, z = 0.5, 0.42, 1.0
        if self.puntos:
            prev = self.puntos[0]
            nxt = prev
            for p in self.puntos:
                if p['t'] <= t:
                    prev = p
                if p['t'] >= t:
                    nxt = p
                    break
            u = 0 if nxt is prev or nxt['t'] == prev['t'] else clamp((t - prev['t']) / (nxt['t'] - prev['t']))
            x = prev.get('x', 0.5) + (nxt.get('x', 0.5) - prev.get('x', 0.5)) * u
            y = prev.get('y', 0.42) + (nxt.get('y', 0.42) - prev.get('y', 0.42)) * u
            z = prev.get('zoom', 1.0) + (nxt.get('zoom', 1.0) - prev.get('zoom', 1.0)) * u
        for ev in self.eventos:
            if ev['tipo'] == 'zoom' and ev['t0'] <= t < ev['t1']:
                entra, sale = ease_out((t - ev['t0']) / 0.12), ease_out((ev['t1'] - t) / 0.12)
                z *= 1 + (min(float(ev.get('escala', 1.15)), 1.3) - 1) * min(entra, sale)
        return x, y, max(1.0, z)

    def reencuadrar(self, src: np.ndarray, t: float, W: int, H: int) -> np.ndarray:
        h, w = src.shape[:2]
        cx, cy, z = self.encuadre(t)
        if w / h > 9 / 16:
            cw, ch = h * 9 / 16, h
        else:
            cw, ch = w, w * 16 / 9
        cw, ch = cw / z, ch / z
        x0 = int(np.clip(cx * w - cw / 2, 0, w - cw))
        y0 = int(np.clip(cy * h - ch / 2, 0, h - ch)) if ch < h else 0
        crop = src[y0:y0 + int(ch), x0:x0 + int(cw)]
        up = W / max(crop.shape[1], 1) > 1.2
        out = cv2.resize(crop, (W, H), interpolation=cv2.INTER_LANCZOS4 if up else cv2.INTER_AREA)
        if up:  # enfoque leve al escalar fuentes de baja resolución
            out = cv2.addWeighted(out, 1.45, cv2.GaussianBlur(out, (0, 0), 1.2), -0.45, 0)
        return out

    # ---- color ----
    def lut(self) -> np.ndarray:
        c = self.cfg['color']
        x = np.arange(256, dtype=np.float32) / 255
        x = np.clip((x - 0.5) * float(c.get('contraste', 1.0)) + 0.5, 0, 1)
        cal = float(c.get('calido', 0.0))
        return np.stack([np.clip(x * (1 + 0.07 * cal), 0, 1), x, np.clip(x * (1 - 0.07 * cal), 0, 1)], -1)

    def vineta(self, W: int, H: int) -> np.ndarray:
        v = float(self.cfg['color'].get('vineta', 0))
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        return (1 - v * (((xx - W / 2) / (W / 1.3)) ** 2 + ((yy - H / 2) / (H / 1.3)) ** 2)).clip(0.4, 1)[..., None]

    # ---- cuadro ----
    def cuadro(self, src_rgb: np.ndarray, t: float, W: int, H: int, lut: np.ndarray, vin: np.ndarray) -> np.ndarray:
        base = self.reencuadrar(src_rgb, t, W, H)
        f = np.empty((H, W, 3), np.float32)
        for ch in range(3):
            f[..., ch] = lut[base[..., ch], ch]
        L = Lienzo(f)
        k = W / 1080
        activos = [e for e in self.eventos if (e.get('t0', e.get('t', 0) - 0.11) <= t < e.get('t1', e.get('t', 0) + 0.11))]
        completos = [e for e in activos if estilos.pantalla_completa(e)]
        for ev in completos:
            video = L.f.copy()
            estilos.evento(L, ev, t, k, self.ruta)
            a = ease_out((t - ev['t0']) / 0.1)  # entrada rápida desde el video
            if a < 1:
                L.f[:] = L.f * a + video * (1 - a)
        ocultar = any(e.get('ocultar_subtitulos', e['tipo'] in ('tarjeta', 'collage')) for e in completos)
        for ev in activos:
            if not estilos.pantalla_completa(ev):
                estilos.evento(L, ev, t, k, self.ruta)
        if not ocultar and self.r.get('subtitulos', {}).get('activo', True):
            estilos.SUBTITULOS[self.r['estilo']](L, self.pals, t, self.cfg['sub'], k)
        L.f *= vin
        self.qa['textos_fuera_de_cuadro'] += L.recortes
        self.qa['cuadros'] += 1
        subs = [c for c in L.cajas if c[0] == 'sub']
        for c in L.cajas:  # un título que se encima con los subtítulos
            if c[0] == 'titulo' and any(min(c[3], s_[3]) - max(c[1], s_[1]) > 0 and min(c[4], s_[4]) - max(c[2], s_[2]) > 0 for s_ in subs):
                self.qa['choques'] = self.qa.get('choques', 0) + 1
                self.qa.setdefault('choques_t', []).append(round(t, 2))
                break
        return (np.clip(L.f, 0, 1) * 255).astype(np.uint8)

    # ---- salida ----
    def leer_cuadros(self, path: str, w: int, h: int):
        p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'fps={FPS}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
        n = w * h * 3
        while True:
            buf = p.stdout.read(n)
            if len(buf) < n:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        p.wait()

    def render(self, salida: str | None = None, escala: float = 1.0) -> dict:
        W, H = int(1080 * escala) // 2 * 2, int(1920 * escala) // 2 * 2
        src = self.cortada()
        meta = ffprobe(src)
        lut, vin = self.lut(), self.vineta(W, H)
        out = salida or ruta(self.r, self.r.get('salida', 'video_final.mp4'))
        enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                '-i', src, '-map', '0:v', '-map', '1:a?', *codificador(), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
                                '-shortest', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
        for i, fr in enumerate(self.leer_cuadros(src, meta['w'], meta['h'])):
            try:
                enc.stdin.write(self.cuadro(fr, i / FPS, W, H, lut, vin).tobytes())
            except BrokenPipeError:  # -shortest: el audio terminó unas centésimas antes; ffmpeg ya cerró bien
                break
        try:
            enc.stdin.close()
        except BrokenPipeError:
            pass
        if enc.wait() != 0:
            raise RuntimeError('ffmpeg falló al codificar')
        return self.validar(out, meta['duracion'])

    def preview(self, tiempos: list, escala: float = 0.5) -> list:
        """Cuadros de prueba. Los tiempos son del video ORIGINAL (como en la receta)."""
        W, H = int(1080 * escala) // 2 * 2, int(1920 * escala) // 2 * 2
        src = self.cortada()
        meta = ffprobe(src)
        lut, vin = self.lut(), self.vineta(W, H)
        rutas = []
        for t_src in tiempos:
            t = self.linea(t_src)
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', src, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                 capture_output=True, check=True).stdout
            fr = np.frombuffer(raw[:meta['w'] * meta['h'] * 3], np.uint8).reshape(meta['h'], meta['w'], 3)
            img = self.cuadro(fr, t, W, H, lut, vin)
            p = os.path.join(self.trabajo, f'preview_{t_src:06.2f}.png')
            cv2.imwrite(p, cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
            rutas.append(p)
        return rutas

    def validar(self, out: str, esperado: float) -> dict:
        m = ffprobe(out)
        problemas = []
        if abs(m['duracion'] - esperado) > 0.25:
            problemas.append(f'duración {m["duracion"]:.2f}s distinta a la esperada {esperado:.2f}s')
        if (m['w'], m['h']) != (1080, 1920) and self.qa['cuadros'] and m['w'] >= 1000:
            problemas.append(f'resolución {m["w"]}x{m["h"]}')
        if not m['audio']:
            problemas.append('sin audio')
        avisos = []
        if self.qa['textos_fuera_de_cuadro']:
            avisos.append(f'{self.qa["textos_fuera_de_cuadro"]} textos salen parcialmente del cuadro (revisa tamaños o posiciones)')
        if self.qa.get('choques'):
            ts = self.qa['choques_t']
            avisos.append(f"títulos encimados con subtítulos en {self.qa['choques']} cuadros (video final, desde {ts[0]}s hasta {ts[-1]}s): mueve el título (y) o la posición de los subtítulos")
        largas = [p['t'] for p in self.pals if len(p['t']) > 14]
        if largas:
            avisos.append(f'palabras muy largas para una sola línea: {largas[:5]}')
        res = {'salida': out, 'duracion': round(m['duracion'], 3), 'tramos': len(self.segs), 'problemas': problemas, 'avisos': avisos, 'ok': not problemas}
        with open(os.path.join(self.base, 'motor_qa.json'), 'w', encoding='utf-8') as fh:
            json.dump(res, fh, ensure_ascii=False, indent=2)
        return res
