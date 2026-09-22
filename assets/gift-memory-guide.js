const topic=(id,label,question,hint,example)=>({id,label,question,hint,example});
export function giftMemoryOptions({relationship,occasion}={}){
 if(occasion==='pregnancy')return [
  topic('news','La noticia','¿Qué noticia quieres revelar y a quién?','Cuenta lo que ya sabes y en qué momento quieres revelar la sorpresa.','Quiero decirle a mi mamá que va a ser abuela. Que la noticia aparezca al final.'),
  topic('bond','Lo que nos une','¿Qué recuerdo explica por qué quieres compartirle esta noticia?','Piensa en algo que esa persona haya hecho por ti.','Mi mamá me leía un cuento cada noche. Me emociona imaginarla haciéndolo otra vez.'),
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
 return [
  topic('day','Un día especial','¿Qué pasó ese día y por qué lo recuerdas?','Elige una escena: dónde estaban, qué hicieron y cómo te hizo sentir.','Cocinamos juntos un domingo y acabamos llenos de harina.'),
  topic('support','Un gesto que agradezco','¿Qué hizo por ti que nunca has olvidado?','Algo concreto, aunque parezca pequeño.','Vino a buscarme cuando perdí el último autobús y no me dejó volver solo.'),
  topic('ritual','Una costumbre nuestra','¿Qué hacen juntos que te gustaría conservar?','Una frase, un lugar o una tradición que reconozcan.','Nos reunimos cada domingo a desayunar y siempre prepara el mismo café.')];
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
