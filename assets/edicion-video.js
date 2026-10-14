// Lee duración, tamaño, orientación y audio de un MP4/MOV sin cargarlo entero (sirve en celulares con videos grandes):
// recorre solo los encabezados de las cajas de primer nivel y lee completa únicamente la caja 'moov'.
const text = (view, at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

async function findMoov(file) {
  let offset = 0;
  while (offset + 8 <= file.size) {
    const head = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
    let size = head.getUint32(0);
    const type = text(head, 4);
    if (size === 1) size = Number(head.getBigUint64(8));
    else if (size === 0) size = file.size - offset;
    if (size < 8) break;
    if (type === 'moov') {
      if (size > 64 * 1024 * 1024) throw new Error('el video tiene un formato que no podemos leer');
      return new DataView(await file.slice(offset, offset + size).arrayBuffer());
    }
    offset += size;
  }
  throw new Error('no parece un video MP4 o MOV');
}

function* boxes(view, start, end) {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at), header = 8;
    if (size === 1) { size = Number(view.getBigUint64(at + 8)); header = 16; }
    if (size < header || at + size > end) return;
    yield { type: text(view, at + 4), start: at + header, end: at + size };
    at += size;
  }
}

export async function inspectVideo(file) {
  const moov = await findMoov(file);
  const info = { duration: 0, width: 0, height: 0, hasAudio: false };
  for (const box of boxes(moov, 8, moov.byteLength)) {
    if (box.type === 'mvhd') {
      const v1 = moov.getUint8(box.start) === 1;
      const scale = moov.getUint32(box.start + (v1 ? 20 : 12));
      const units = v1 ? Number(moov.getBigUint64(box.start + 24)) : moov.getUint32(box.start + 16);
      if (scale > 0) info.duration = units / scale;
    }
    if (box.type !== 'trak') continue;
    let handler = '', w = 0, h = 0, rotated = false;
    for (const t of boxes(moov, box.start, box.end)) {
      if (t.type === 'tkhd') {
        const v1 = moov.getUint8(t.start) === 1, m = t.start + (v1 ? 52 : 40); // matriz 3x3 de 36 bytes
        rotated = moov.getInt32(m) === 0 && moov.getInt32(m + 4) !== 0;
        w = moov.getUint32(m + 36) / 65536; h = moov.getUint32(m + 40) / 65536;
      }
      if (t.type === 'mdia') for (const d of boxes(moov, t.start, t.end)) if (d.type === 'hdlr') handler = text(moov, d.start + 8);
    }
    if (handler === 'soun') info.hasAudio = true;
    if (handler === 'vide' && w && h && !info.width) Object.assign(info, rotated ? { width: Math.round(h), height: Math.round(w) } : { width: Math.round(w), height: Math.round(h) });
  }
  if (!(info.duration > 0)) throw new Error('no pudimos leer la duración del video');
  return info;
}
