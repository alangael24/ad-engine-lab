"""Transcripción local en Mac (mlx-whisper en el chip de Apple). La usa el proxy del worker, no el agente.
Uso: python3 transcribir_local.py <audio.wav>  ->  {"language", "text", "words": [{"word", "start", "end"}]}"""
import json
import os
import sys

os.environ.setdefault('HF_HUB_OFFLINE', '1')  # el modelo ya está en la caché; no descargar en cada pedido
import mlx_whisper  # noqa: E402

MODELO = os.environ.get('EDICION_WHISPER_MODEL', 'mlx-community/whisper-large-v3-turbo')
r = mlx_whisper.transcribe(sys.argv[1], path_or_hf_repo=MODELO, word_timestamps=True)
words = [{'word': w['word'].strip(), 'start': round(w['start'], 3), 'end': round(w['end'], 3)}
         for s in r['segments'] for w in s.get('words', []) if w['word'].strip()]
sys.stdout.write(json.dumps({'language': r.get('language'), 'text': r.get('text', '').strip(), 'words': words}, ensure_ascii=False))
