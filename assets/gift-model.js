import {creatorRequest} from './creator-model.js';
export const GIFT_OCCASIONS={anniversary:'Aniversario',birthday:'Cumpleaños',thanks:'Gracias por todo',family:'Un recuerdo en familia',pregnancy:'Anunciar que viene un bebé',reunion:'Volver a estar juntos',memorial:'Recordar a alguien querido',other:'Otra ocasión'};
export const GIFT_RELATIONSHIPS={partner:'Mi pareja',mother:'Mi mamá',father:'Mi papá',friend:'Un amigo o amiga',family:'Alguien de mi familia',other:'Otra persona especial'};
export const GIFT_EMOTIONS={love:'Amor',gratitude:'Gratitud',nostalgia:'Nostalgia',joy:'Alegría'};
export function giftDraftStep(draft){
 if(!Number.isInteger(draft?.step))return 0;
 if(draft.version===4)return Math.max(0,Math.min(1,draft.step));
 const n=Math.max(0,Math.min(draft.version===1||!draft.version?2:3,draft.step));
 const old=draft.version===3?n:draft.version===2?[3,0,1,2][n]:[0,1,2][n];
 return old>=2?1:0;
}
export function giftQuestions({relationship,occasion}={}){
 const base={memory:'¿Qué recuerdo juntos convertirías en una escena?',detail:'¿Qué detalle solo ustedes reconocerían?',message:'¿Qué te gustaría decirle al terminar?',example:'Aquel domingo cocinamos juntos y acabamos llenos de harina.',hint:'Un lugar, una frase o un pequeño detalle bastan para empezar.'};
 if(occasion==='pregnancy')return {...base,memory:'¿Qué noticia quieres darle y cómo te gustaría revelarla?',detail:'¿Qué detalle haría que reconociera que el mensaje es para esa persona?',message:'¿Qué quieres decirle después de la sorpresa?',example:'Quiero decirle a mi mamá que será abuela. Al final, aparece una silla pequeña junto a la suya.',hint:'Cuéntanos lo que ya es cierto. No hace falta añadir nombres, fechas o detalles que aún no conoces.'};
 if(occasion==='reunion')return {...base,memory:'¿Qué pasó el día que volvieron a estar juntos?',detail:'¿Qué les ayudó a sentirse cerca durante la distancia?',example:'La reconocí al salir del aeropuerto. Llevaba el mismo suéter de nuestra última despedida.'};
 if(occasion==='memorial')return {...base,memory:'¿Qué momento con esa persona te gustaría volver a ver?',detail:'¿Qué gesto o frase suya quieres conservar?',message:'¿Qué te gustaría dedicarle?',example:'Mi abuelo nos esperaba cada domingo con café y su radio encendida.',hint:'Comparte solo lo que te haga sentir a gusto. No necesitas explicar la pérdida.'};
 if(relationship==='mother'||relationship==='father')return {...base,memory:'¿Qué hizo por ti que nunca has olvidado?',detail:'¿Qué frase o costumbre suya reconocería toda la familia?',message:occasion==='thanks'?'¿Qué quieres agradecerle?':base.message,example:'Se levantaba antes del amanecer para acompañarme al autobús, siempre con un café en la mano.'};
 if(relationship==='partner')return {...base,memory:'¿Qué momento de su historia te gustaría revivir?',detail:'¿Qué pequeña costumbre los hace ustedes?',example:'Nos conocimos en un café de Puebla. Olvidó su paraguas rojo y volvió al día siguiente.'};
 if(relationship==='friend')return {...base,memory:'¿Qué aventura juntos todavía les hace sonreír?',detail:'¿Qué broma o frase solo ustedes entienden?'};
 if(occasion==='thanks')return {...base,memory:'¿Qué hizo por ti que te gustaría agradecerle?',message:'¿Qué quieres que sepa sobre lo que hizo por ti?'};
 return base;
}
export const GIFT_TONES={warm:'Cálido y emotivo',playful:'Tierno y divertido',adventure:'Una aventura juntos'};
export const GIFT_SCRIPT_REQUEST='Escribe el guion completo de esta película de regalo a partir de la historia guardada. Respeta nombres, recuerdos, mensaje y referencias. No inventes datos biográficos ni añadas una venta. Propón el guion para mi revisión; no inicies imágenes, voz ni video todavía.';
function field(raw,key,max,required=false){const v=String(raw[key]??'').trim();if(v.length>max)throw Error('El campo es demasiado largo.');if(required&&!v)throw Error('Completa para quién es y al menos un recuerdo.');return v;}
export function giftRequest(raw,photos=[]){
 const packageCode=raw.package||'gift_60'; if(!['gift_60','gift_120'].includes(packageCode))throw Error('Elige una película de uno o dos minutos.');
 const targetDuration=packageCode==='gift_120'?120:60;
 const recipient=field(raw,'recipient',80,true),names=field(raw,'names',120)||field(raw,'additionalNames',120),memory1=field(raw,'memory1',300,true),memory2=field(raw,'memory2',300),memory3=field(raw,'memory3',300),message=field(raw,'message',300),avoid=field(raw,'avoid',160);
 const relationship=raw.relationship||'',emotion=raw.emotion||'';
 if((relationship&&!Object.hasOwn(GIFT_RELATIONSHIPS,relationship))||(emotion&&!Object.hasOwn(GIFT_EMOTIONS,emotion)))throw Error('Revisa la relación y la emoción de tu historia.');
 if(!Object.hasOwn(GIFT_OCCASIONS,raw.occasion)||!Object.hasOwn(GIFT_TONES,raw.tone)||raw.look!=='3d'||!['9:16','16:9'].includes(raw.ratio))throw Error('Revisa las opciones de tu película.');
 if(photos.length>3||photos.some(p=>!p.id||!p.label?.trim()||p.label.length>100))throw Error('Añade hasta tres fotos e indica quién aparece en cada una.');
 const idea=[`PELÍCULA PERSONALIZADA PARA REGALAR. Para: ${recipient}. ${raw.names?'Protagonistas y pronunciación':'Otros protagonistas y pronunciación'}: ${names||'No indicados'}. Ocasión: ${GIFT_OCCASIONS[raw.occasion]}. Tono: ${GIFT_TONES[raw.tone]}.`,
 relationship&&`Relación con quien regala: ${GIFT_RELATIONSHIPS[relationship]}.`,emotion&&`Emoción que debe transmitir: ${GIFT_EMOTIONS[emotion]}.`,
 'Estilo visual único: animación 3D tipo Pixar.',
 `Recuerdo o noticia que el cliente quiere contar: ${memory1}`,memory2&&`Detalle personal que deben reconocer: ${memory2}`,memory3&&`Otro recuerdo: ${memory3}`,message&&`Mensaje que quiero dedicar: ${message}`,avoid&&`No incluir ni cambiar: ${avoid}`,
 `Narra una historia de aproximadamente ${targetDuration===120?'dos minutos':'un minuto'}, con un comienzo, recuerdos conectados y una dedicatoria final. Prepara un momento de reconocimiento con un detalle concreto del recuerdo. Conserva los nombres, relaciones, hechos y rasgos de las fotos. No inventes bodas, hijos, fechas, pérdidas ni otros datos personales. Puedes enriquecer la puesta en escena sin alterar lo sucedido. Sin oferta, marca, beneficios comerciales ni CTA. Primero propone el guion; el cliente debe aprobarlo antes de producir.`,
 photos.length?`Referencias de identidad: ${photos.map(p=>`${p.label.trim()} (asset ${p.id})`).join('; ')}.`:'Sin fotografías todavía: no afirmes conocer el aspecto real de los protagonistas.'
 ].filter(Boolean).join('\n');
 const data=creatorRequest(idea,{kind:'story',targetDuration,aspectRatio:raw.ratio,creative:{format:'auto',look:raw.look},characterAssetIds:photos.map(p=>p.id)});
 return {...data,productProfile:'creator-v1',title:`Regalo para ${recipient} · ${GIFT_OCCASIONS[raw.occasion]}`.slice(0,120),referenceNotes:photos.map(p=>`${p.id}: ${p.label.trim()}`).join('\n')};
}
