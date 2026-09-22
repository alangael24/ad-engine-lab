const topic=(id,label,question,hint,example)=>({id,label,question,hint,example});
function relationshipMemoryOptions({relationship,occasion}={}){
 if(occasion==='pregnancy')return [
  topic('news','La noticia','¿Qué noticia quieres revelar y a quién?','Cuenta lo que ya sabes y en qué momento quieres revelar la sorpresa.','Quiero anunciar que viene un bebé. Que la sorpresa aparezca al final de nuestra historia.'),
  topic('bond','Lo que nos une','¿Qué recuerdo explica por qué quieres compartirle esta noticia?','Piensa en algo que esa persona haya hecho por ti.','Siempre hablamos de lo importante que es la familia. Quiero recordar una de esas conversaciones antes de dar la noticia.'),
  topic('reveal','Cómo sorprenderle','¿Qué detalle haría que entendiera la sorpresa?','Una frase, un objeto o una costumbre que tenga sentido para ustedes.','Siempre pone un plato de más. Quiero que al final aparezca una sillita junto a la mesa.')];
 if(occasion==='memorial')return [
  topic('ritual','Su costumbre','¿Qué pequeña costumbre suya te gustaría volver a ver?','El lugar, lo que hacía y un detalle que te haga recordarle.','Los domingos preparaba café y ponía su radio junto a la ventana.'),
  topic('day','Un día juntos','¿Qué día con esa persona guardas con cariño?','Elige un momento que te haga sentir a gusto recordar; no necesitas explicar la pérdida.','Una tarde me enseñó a plantar tomates en su jardín.'),
  topic('words','Su frase','¿Qué te decía que todavía llevas contigo?','Puedes escribir sus palabras tal como las recuerdas.','Antes de cada examen me decía: hazlo con calma, yo te espero aquí.')];
 if(occasion==='reunion')return [
  topic('meeting','El reencuentro','¿Dónde se vieron y qué hicieron al reconocerse?','Un gesto, una frase o lo primero que notaste al verle.','Me esperaba en el aeropuerto con su suéter azul. Dejé la maleta para abrazarla.'),
  topic('distance','Durante la distancia','¿Qué hacían para sentirse cerca cuando estaban lejos?','Una llamada, una canción o una costumbre que mantuvieron.','Todos los domingos cenábamos juntos por videollamada.'),
  topic('together','Juntos otra vez','¿Qué fue lo primero que disfrutaron al estar juntos?','Algo cotidiano también puede ser un gran recuerdo.','Al día siguiente desayunamos en el mismo puesto de siempre.')];
 if(relationship==='partner')return [
  topic('start','Cómo nos conocimos','¿Dónde se conocieron y qué recuerdas de ese primer momento?','El lugar + algo que pasó + qué te llamó la atención de esa persona.','Nos conocimos en un café de Puebla. Pidió lo mismo que yo y empezamos a reírnos.'),
  topic('date','Nuestra primera cita','¿Qué pasó en esa cita que todavía recuerdan?','No hace falta que haya sido perfecta: un pequeño imprevisto puede hacerla muy suya.','Empezó a llover en nuestra primera cita. Corrimos a refugiarnos en una panadería.'),
  topic('trip','Un viaje juntos','¿Qué momento de ese viaje contarían una y otra vez?','Elige una escena concreta, no todo el viaje: dónde estaban y qué hicieron.','Nos perdimos camino a la playa y terminamos viendo el atardecer en un pueblo.'),
  topic('support','Cuando estuvo para mí','¿Qué hizo por ti en un momento que lo necesitabas?','Cuenta solo lo que te sientas cómodo compartiendo: su gesto y lo que significó.','Cuando empecé mi negocio, se sentaba conmigo cada noche a preparar los pedidos.'),
  topic('routine','Algo muy nuestro','¿Qué pequeña costumbre hace que su relación sea única?','Una frase, una comida, una canción o una broma que ambos reconozcan.','Cada viernes cocinamos pizza. Siempre discutimos en broma por el último pedazo.')];
 if(relationship==='mother'||relationship==='father')return [
  topic('childhood','Cuando era pequeño/a','¿Qué momento de tu infancia con esa persona recuerdas mejor?','Dónde estaban, qué hacían y un detalle que se te quedó grabado.','Me enseñó a andar en bicicleta en el parque. Corría detrás de mí para que no tuviera miedo.'),
  topic('support','Cómo me cuidó','¿Qué hizo por ti que ahora valoras todavía más?','Un gesto concreto dice más que una lista de cualidades.','Se levantaba antes del amanecer para acompañarme al autobús.'),
  topic('ritual','Una costumbre suya','¿Qué hace siempre que toda la familia reconoce?','Una frase, una receta o una manera de recibirte.','Cada vez que llego, pregunta si ya comí y empieza a calentar tortillas.'),
  topic('proud','Un logro compartido','¿Qué logro celebraron juntos y cómo reaccionó?','Elige el instante en que compartieron la alegría.','Al verme salir con mi diploma, me abrazó y me dijo que siempre había confiado en mí.')];
 if(relationship==='friend')return [
  topic('start','Cómo empezó la amistad','¿Cómo pasaron de conocerse a ser amigos?','Un encuentro o una conversación que recuerden.','Nos sentaron juntos en clase. Nos reímos tanto que nos cambiaron de lugar.'),
  topic('adventure','Nuestra aventura','¿Qué aventura todavía les hace reír?','Qué intentaban hacer y qué terminó pasando.','Fuimos a acampar y tardamos una hora en entender cómo armar la tienda.'),
  topic('support','Cuando me apoyó','¿Cuándo estuvo ahí para ti?','Un gesto concreto que quieras agradecerle.','Llegó con comida y se quedó conmigo toda la tarde cuando más compañía necesitaba.'),
  topic('joke','Nuestra broma','¿Qué broma o costumbre solo ustedes entienden?','Explica cómo empezó, para poder representarla.','Siempre nos regalamos la misma taza que ninguno de los dos quiere perder.')];
 if(relationship==='family')return [
  topic('tradition','Nuestra tradición','¿Qué tradición familiar te gustaría convertir en una escena?','Cuenta una ocasión concreta: quién estaba y qué pasó.','Cada diciembre hacemos tamales en casa de mi tía. El año pasado terminamos cantando en la cocina.'),
  topic('growing','Crecimos juntos','¿Qué recuerdo de cuando eran más pequeños todavía les hace sonreír?','Un juego, una travesura o un lugar que compartían.','Mi prima y yo construíamos casas con las sábanas de la abuela y dormíamos ahí.'),
  topic('gathering','Una reunión especial','¿Qué pasó en aquella reunión que nadie ha olvidado?','No necesitas contar toda la celebración: elige su mejor momento.','Mi hermano intentó preparar el pastel y todos acabamos ayudándole a decorarlo.'),
  topic('support','Cuando nos apoyamos','¿Qué hizo esa persona por ti o por la familia?','Un gesto concreto y por qué te importó.','Mi tía me recibió en su casa cuando empecé a estudiar en otra ciudad.')];
 if(relationship==='other')return [
  topic('connection','Cómo llegó a mi vida','¿Cómo conociste a esta persona y qué hizo que fuera importante para ti?','Explica qué vínculo tienen sin necesidad de ponerle una etiqueta.','Fue mi profesora de dibujo. Un día guardó mi trabajo para enseñarlo en la exposición.'),
  topic('lesson','Algo que me enseñó','¿Qué aprendiste de esa persona en un momento concreto?','Cuenta lo que hicieron o las palabras que recuerdas.','Me ayudó a practicar mi primera presentación hasta que dejé de tener miedo.'),
  topic('gesture','Un gesto inolvidable','¿Qué pequeño gesto suyo te gustaría devolver con este regalo?','Dónde ocurrió, qué hizo y cómo te hizo sentir.','Mi vecino cuidó mis plantas mientras estuve fuera y me recibió con una flor nueva.'),
  topic('shared','Un momento compartido','¿Qué momento juntos te gustaría volver a ver?','Puede ser algo sencillo; lo importante es que tenga sentido para ustedes.','Después de cada ensayo nos sentábamos en la plaza a platicar.')];
 return [
  topic('day','Un día especial','¿Qué pasó ese día y por qué lo recuerdas?','Elige una escena: dónde estaban, qué hicieron y cómo te hizo sentir.','Cocinamos juntos un domingo y acabamos llenos de harina.'),
  topic('support','Un gesto que agradezco','¿Qué hizo por ti que nunca has olvidado?','Algo concreto, aunque parezca pequeño.','Vino a buscarme cuando perdí el último autobús y no me dejó volver solo.'),
  topic('ritual','Una costumbre nuestra','¿Qué hacen juntos que te gustaría conservar?','Una frase, un lugar o una tradición que reconozcan.','Nos reunimos cada domingo a desayunar y siempre prepara el mismo café.')];
}
// The occasion leads; relationship topics remain available without adding fields.
export function giftMemoryOptions(context={}){
 const base=relationshipMemoryOptions(context);
 if(['pregnancy','memorial','reunion'].includes(context.occasion))return base;
 const byOccasion={
  birthday:[topic('birthday','Un cumpleaños inolvidable','¿Qué pasó en un cumpleaños suyo que todavía recuerdan?','Un momento concreto: la sorpresa, quién estuvo o algo que les hizo reír.','Se fue la luz antes de partir el pastel y terminamos cantando con las linternas del celular.'),topic('celebrate','Lo que celebro de ti','¿Qué hizo esa persona que muestra por qué es tan especial para ti?','Piensa en una escena que muestre esa cualidad.','Siempre logra hacernos reír. Una vez improvisó un baile en la cocina para animarnos.')],
  thanks:[topic('gratitude','Lo que hizo por mí','¿Qué hizo por ti que quieres agradecerle con este regalo?','Cuenta cuándo pasó, qué hizo y cómo te ayudó.','Me acompañó a mi primer día de trabajo y me esperó a la salida para saber cómo me había ido.'),topic('impact','Lo que cambió para mí','¿Qué cambió en tu vida gracias a ese gesto?','Una consecuencia real, aunque sea pequeña.','Después de practicar conmigo cada tarde, por fin me animé a manejar sola.')],
  family:[topic('family-day','Un día en familia','¿Qué día con tu familia te gustaría volver a vivir?','Elige una escena e indica quién estaba.','Fuimos al río con mis hermanos. Mi papá nos enseñó a lanzar piedras sobre el agua.')],
  anniversary:context.relationship==='partner'?[]:[topic('anniversary','Lo que celebramos','¿Qué aniversario celebran y qué momento lo representa?','Aclara de quién es la historia y qué fecha o etapa están recordando.','Mis papás cumplen treinta años de casados. Quiero recrear cómo se conocieron en el baile del pueblo.')]
 };
 return [...(byOccasion[context.occasion]||[]),...base].slice(0,5);
}
export function giftDedicationGuide({relationship,occasion}={}){
 const occasionGuides={
  pregnancy:{question:'¿Qué quieres decirle después de revelar la noticia?',example:'Nos emociona compartir contigo esta nueva etapa de nuestra familia.'},
  memorial:{question:'¿Qué palabras te gustaría dedicarle?',example:'Tu manera de cuidarnos sigue conmigo. Gracias por tanto cariño.'},
  reunion:{question:'¿Qué significa para ti volver a estar juntos?',example:'Extrañaba hasta nuestros desayunos de siempre. Qué alegría tenerte cerca otra vez.'},
  birthday:{question:'¿Qué quieres desearle en este cumpleaños?',example:'Que este año te regale tantas alegrías como las que tú nos das.'},
  thanks:{question:'¿Qué quieres que sepa sobre lo que hizo por ti?',example:'Quizá para ti fue un pequeño gesto. Para mí significó no estar solo.'},
  family:{question:'¿Qué quieres decirle sobre los momentos que comparten?',example:'Lo que más me gusta de estos recuerdos es haberlos vivido contigo.'},
  anniversary:relationship==='partner'?{question:'¿Qué quieres decirle sobre su historia juntos?',example:'Volvería a elegir aquella primera cita contigo. Feliz aniversario.'}:{question:'¿Qué quieres dedicarle en este aniversario?',example:'Qué bonito poder celebrar esta historia y todos los recuerdos que nos ha dado.'}
 };
 if(occasionGuides[occasion])return occasionGuides[occasion];
 const examples={partner:'Gracias por hacer que cualquier lugar se sienta como casa.',mother:'Mamá, ahora entiendo mejor todo lo que hiciste por mí. Gracias por tanto.',father:'Papá, llevo conmigo lo que me enseñaste. Gracias por estar ahí.',friend:'Gracias por las risas y por quedarte también en los días difíciles.',family:'Qué suerte compartir estos recuerdos y ser parte de la misma familia.',other:'Lo que hiciste por mí sigue siendo importante. Quería que lo supieras.'};
 return {question:'¿Qué te gustaría decirle al terminar?',example:examples[relationship]||'Gracias por ser parte de estos recuerdos. Quería regalarte una forma de volver a vivirlos.'};
}
// These are prompts for remembering, never prefilled biography.
export function mountGiftMemoryGuide(container,{context={},input,question,hint,second=false}){
 const options=giftMemoryOptions(context);container.replaceChildren();
 const title=document.createElement('p');title.className='memory-guide-title';title.textContent=second?'¿Qué otro momento les gustaría revivir?':'¿No sabes qué contar? Elige por dónde empezar.';
 const chips=document.createElement('div');chips.className='memory-guide-options';chips.setAttribute('role','group');chips.setAttribute('aria-label',second?'Ideas para el segundo recuerdo':'Ideas para elegir tu recuerdo');
 for(const item of options){const button=document.createElement('button');button.type='button';button.textContent=item.label;button.setAttribute('aria-pressed','false');button.onclick=()=>{for(const b of chips.children)b.setAttribute('aria-pressed',String(b===button));question.textContent=item.question;input.placeholder='Ejemplo: '+item.example;if(hint)hint.textContent=item.hint;input.focus({preventScroll:true});};chips.append(button);}
 const note=document.createElement('p');note.className='helper';note.textContent=second?'Elige un momento distinto del primero. No necesitas responder todas las ideas.':'Elige algo que realmente les haya pasado. Una pequeña anécdota basta; también puedes escribir libremente.';
 container.append(title,chips,note);
}
