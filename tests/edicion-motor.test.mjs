import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// El motor es Python: estas pruebas corren sus funciones puras (sin ffmpeg ni video).
const motor = fileURLToPath(new URL('../workers/edicion', import.meta.url));
const py = code => JSON.parse(execFileSync('python3', ['-c', code], { env: { ...process.env, PYTHONPATH: motor } }).toString());
const palabras = texto => JSON.stringify(texto.split(' ').map((t, i) => ({ t, s: i * 0.3, e: i * 0.3 + 0.25 })));

test('motor: quita arranques en falso y muletillas, respeta repeticiones retóricas', () => {
  const quitadas = t => py(`import json; from motor.receta import clasificar
p = json.loads('''${palabras(t)}''')
print(json.dumps([w['t'] for w, k in zip(p, clasificar(p)) if k != 'VALIDA']))`);
  assert.deepEqual(quitadas('No, yo creo, a ver, yo creo que hay algo'), ['yo', 'creo,', 'a', 'ver,']);
  assert.deepEqual(quitadas('pagaste de, eh, 10 horas'), ['eh,']);
  assert.deepEqual(quitadas('This is not a Discord. This is not a signals chat'), []);
  assert.deepEqual(quitadas('ese peaje, que es un peaje que yo pagué'), []);
  assert.deepEqual(quitadas('the the plan works'), ['the']);
});

test('motor: tramos sin silencios y línea de tiempo', () => {
  const r = py(`import json; from motor.receta import tramos, Linea
pal = [{'t':'a','s':0.5,'e':1.0},{'t':'b','s':1.1,'e':1.5},{'t':'c','s':3.0,'e':3.5}]
seg = tramos({'palabras': pal, 'cortes': {'quitar_silencios': True, 'pausa_min': 0.25, 'margen': 0.1}}, 5.0)
L = Linea(seg)
print(json.dumps({'seg': seg, 'dur': L.duracion, 'c': L(3.0), 'hueco': L(2.0)}))`);
  assert.deepEqual(r.seg.map(s => s.map(x => Math.round(x * 100) / 100)), [[0.4, 1.6], [2.9, 3.6]]);
  assert.ok(Math.abs(r.dur - 1.9) < 1e-6);
  assert.ok(Math.abs(r.c - 1.3) < 1e-6);
  assert.ok(Math.abs(r.hueco - 1.2) < 1e-6); // un tiempo dentro de un silencio quitado salta al siguiente tramo
});

test('motor: el ajuste por energía mueve el corte al punto más silencioso', () => {
  const r = py(`import json, numpy as np; from motor.receta import ajustar_por_energia
e = np.ones(500) * 0.5; e[95] = 0.0; e[212] = 0.0
print(json.dumps(ajustar_por_energia([(1.0, 2.1)], e, 0.01)))`);
  assert.deepEqual(r.map(s => s.map(x => Math.round(x * 100) / 100)), [[0.95, 2.12]]);
});

test('motor: la receta inválida explica qué corregir', () => {
  const r = py(`import json; from motor.receta import validar, RecetaInvalida
try:
    validar({'version': 1, 'estilo': 'otro', 'fuente': 'no.mp4', 'palabras': [], 'eventos': [{'tipo': 'zoom', 't0': 2, 't1': 1}]})
    print(json.dumps('ok'))
except RecetaInvalida as e:
    print(json.dumps(str(e)))`);
  for (const parte of ['estilo debe ser', 'fuente', 'palabras', 't1 debe ser mayor']) assert.match(r, new RegExp(parte));
});
