// Arma los archivos estáticos del Worker de /edicion/ (solo su página y sus 3 assets).
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-edicion');
await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'assets'), { recursive: true });
await cp(resolve(root, 'edicion'), resolve(out, 'edicion'), { recursive: true });
for (const f of ['edicion.js', 'edicion.css', 'edicion-plans.js']) await cp(resolve(root, 'assets', f), resolve(out, 'assets', f));
