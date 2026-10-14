"""CLI del motor:  motor estilos | motor transcribir <video> | motor validar <receta> | motor preview <receta> <t...> | motor render <receta>"""
from __future__ import annotations
import json
import os
import shutil
import subprocess
import sys
import tempfile

CATALOGO = """Estilos (campo "estilo"):
  subtitulos_esteticos  Una palabra a la vez, sans redonda color crema con rebote; palabras con "acento": true en serif cursiva. Look cálido.
  cineticos             Bloques de 1-3 palabras apiladas; la palabra con acento ENORME, en color (rojo/amarillo alternados) y con brillo.
  collage               Frases en escalera (conectores chicos, acentos grandes) + eventos "collage" a pantalla completa con recortes de papel.
  anuncio               Frases cortas abajo con la palabra dicha en color + títulos, tarjetas de color, B-roll, zooms y flashes.

Receta (receta.json, tiempos SIEMPRE en segundos del video original; el motor los ajusta si se quitan silencios):
{
  "version": 1, "estilo": "anuncio", "fuente": "material/fuente.mp4", "salida": "video_final.mp4",
  "palabras": [{"t": "Have", "s": 0.0, "e": 0.62}, {"t": "strategy?", "s": 1.68, "e": 2.3, "acento": true}],
  "cortes": {"quitar_silencios": true, "pausa_min": 0.25, "modo": "limpio"},  // o {"tramos": [[0.0, 12.4], [13.1, 59.9]]}
      // modo "limpio": además quita muletillas (eh, um) y arranques en falso, y pone cada corte en el punto más silencioso.
      // Transcribe con `motor transcribir video.mp4 --literal` para que Whisper conserve las muletillas.
  "encuadre": {"puntos": [{"t": 0, "x": 0.5, "y": 0.42, "zoom": 1.0}]},  // centro de la cara en fracción del video original
  "color": {"calido": 0.3, "contraste": 1.05, "vineta": 0.2},
  "subtitulos": {"activo": true, "posicion": "arriba|medio|abajo", "color": "#FCF7B4", "color_acento": "#FFFFFF", "color_activo": "#FFD640", "tamano": 96},
  "eventos": [
    {"tipo": "zoom", "t0": 9.3, "t1": 11.5, "escala": 1.15},
    {"tipo": "titulo", "t0": 9.3, "t1": 11.5, "texto": "REPEATABLE", "linea2": "& profitable", "y": 0.3, "color": "#FFFFFF"},
    {"tipo": "tarjeta", "t0": 1.5, "t1": 3.7, "fondo": "#C8102E", "titulo": "STRATEGY", "subtitulo": "to strategy?", "imagen": "work/personaje.png", "anillos": true},
    {"tipo": "broll", "t0": 5.1, "t1": 7.6, "imagen": "work/indicadores.png", "movimiento": "acercar|alejar|paneo", "texto": "ANOTHER indicator?"},
    {"tipo": "flash", "t": 7.6},
    {"tipo": "collage", "t0": 4.0, "t1": 8.3, "fondo": "cuadricula_verde",
     "recortes": [{"imagen": "work/medallas.png", "x": 0.7, "y": 0.25, "ancho": 0.45, "giro": -6, "entra": 4.2}],
     "texto": [{"t": 4.9, "texto": "4", "tamano": "enorme", "x": 0.3, "y": 0.55}, {"t": 5.4, "texto": "años", "tamano": "grande", "x": 0.6, "y": 0.55}]}
  ]
}
Imágenes: PNG/JPG; si tienen fondo verde croma (#00FF00) se recortan solas. Las tarjetas y collages ocultan los subtítulos.
"""


def transcribir(video: str, literal: bool = False) -> list:
    """Palabras con tiempos: mlx-whisper (Mac), el proxy del worker (servidor) o faster-whisper."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'a.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', wav], check=True)
        if sys.platform == 'darwin':
            try:
                os.environ.setdefault('HF_HUB_OFFLINE', '1')
                import mlx_whisper
                # literal: un ejemplo con muletillas hace que Whisper las conserve en lugar de limpiarlas
                extra = {'initial_prompt': 'Umm, so, uh... I I mean, like, you know. Eh, este, pues...'} if literal else {}
                r = mlx_whisper.transcribe(wav, path_or_hf_repo='mlx-community/whisper-large-v3-turbo', word_timestamps=True, **extra)
                return [{'t': w['word'].strip(), 's': round(w['start'], 3), 'e': round(w['end'], 3)} for s in r['segments'] for w in s.get('words', [])]
            except Exception:
                pass
        if shutil.which('transcribir') and os.environ.get('EDICION_PROXY_URL'):
            j = json.loads(subprocess.run(['transcribir', wav], capture_output=True, text=True, check=True).stdout)
            return [{'t': w['word'].strip(), 's': round(w['start'], 3), 'e': round(w['end'], 3)} for w in j['words']]
        from faster_whisper import WhisperModel
        segs, _ = WhisperModel('small', device='cpu', compute_type='int8').transcribe(wav, word_timestamps=True)
        return [{'t': w.word.strip(), 's': round(w.start, 3), 'e': round(w.end, 3)} for s in segs for w in s.words]


def main(argv: list) -> int:
    if not argv or argv[0] in ('-h', '--help', 'ayuda'):
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    if cmd == 'estilos':
        print(CATALOGO)
        return 0
    if cmd == 'transcribir':
        print(json.dumps(transcribir(args[0], '--literal' in args), ensure_ascii=False))
        return 0
    from .receta import RecetaInvalida
    from .render import Proyecto
    try:
        if cmd == 'validar':
            Proyecto(args[0])
            print('receta válida')
            return 0
        if cmd == 'preview':
            print('\n'.join(Proyecto(args[0]).preview([float(x) for x in args[1:]] or [1.0])))
            return 0
        if cmd == 'render':
            res = Proyecto(args[0]).render()
            print(json.dumps(res, ensure_ascii=False, indent=2))
            return 0 if res['ok'] else 2
    except RecetaInvalida as e:
        print(e, file=sys.stderr)
        return 3
    print(__doc__, file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
