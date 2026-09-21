import {creatorRequest} from './creator-model.js';
export const GIFT_OCCASIONS={anniversary:'Aniversario',birthday:'Cumpleaños',thanks:'Gracias por todo',family:'Un recuerdo en familia',other:'Otra ocasión'};
export const GIFT_TONES={warm:'Cálido y emotivo',playful:'Tierno y divertido',adventure:'Una aventura juntos'};
export const GIFT_SCRIPT_REQUEST='Escribe el guion completo de esta película de regalo a partir de la historia guardada. Respeta nombres, recuerdos, mensaje y referencias. No inventes datos biográficos ni añadas una venta. Propón el guion para mi revisión; no inicies imágenes, voz ni video todavía.';
function field(raw,key,max,required=false){const v=String(raw[key]??'').trim();if(v.length>max)throw Error('El campo es demasiado largo.');if(required&&!v)throw Error('Completa para quién es, los protagonistas y al menos un recuerdo.');return v;}
export function giftRequest(raw,photos=[]){
 const packageCode=raw.package||'gift_60'; if(!['gift_60','gift_120'].includes(packageCode))throw Error('Elige una película de uno o dos minutos.');
 const targetDuration=packageCode==='gift_120'?120:60;
 const recipient=field(raw,'recipient',80,true),names=field(raw,'names',120,true),memory1=field(raw,'memory1',300,true),memory2=field(raw,'memory2',300),memory3=field(raw,'memory3',300),message=field(raw,'message',300),avoid=field(raw,'avoid',160);
 if(!Object.hasOwn(GIFT_OCCASIONS,raw.occasion)||!Object.hasOwn(GIFT_TONES,raw.tone)||!['3d','clay'].includes(raw.look)||!['9:16','16:9'].includes(raw.ratio))throw Error('Revisa las opciones de tu película.');
 if(photos.length>3||photos.some(p=>!p.id||!p.label?.trim()||p.label.length>100))throw Error('Añade hasta tres fotos e indica quién aparece en cada una.');
 const idea=[`PELÍCULA PERSONALIZADA PARA REGALAR. Para: ${recipient}. Protagonistas y pronunciación: ${names}. Ocasión: ${GIFT_OCCASIONS[raw.occasion]}. Tono: ${GIFT_TONES[raw.tone]}.`,
 `Recuerdo 1: ${memory1}`,memory2&&`Recuerdo 2: ${memory2}`,memory3&&`Recuerdo 3: ${memory3}`,message&&`Mensaje que quiero dedicar: ${message}`,avoid&&`No incluir ni cambiar: ${avoid}`,
 `Cuenta una historia narrada de aproximadamente ${targetDuration===120?'dos minutos':'un minuto'}, con un comienzo, recuerdos conectados y una dedicatoria final. Prepara un momento de reconocimiento con un detalle concreto del recuerdo. Conserva los nombres, relaciones, hechos y rasgos de las fotos. No inventes bodas, hijos, fechas, pérdidas ni otros datos personales. Puedes enriquecer la puesta en escena sin alterar lo sucedido. No es un anuncio: no añadas oferta, marca, beneficios comerciales ni CTA. Primero propone el guion; el cliente debe aprobarlo antes de producir.`,
 photos.length?`Referencias de identidad: ${photos.map(p=>`${p.label.trim()} (asset ${p.id})`).join('; ')}.`:'Sin fotografías todavía: no afirmes conocer el aspecto real de los protagonistas.'
 ].filter(Boolean).join('\n');
 const data=creatorRequest(idea,{kind:'story',targetDuration,aspectRatio:raw.ratio,creative:{format:'auto',look:raw.look},characterAssetIds:photos.map(p=>p.id)});
 return {...data,productProfile:'creator-v1',title:`Regalo para ${recipient} · ${GIFT_OCCASIONS[raw.occasion]}`.slice(0,120),referenceNotes:photos.map(p=>`${p.id}: ${p.label.trim()}`).join('\n')};
}
