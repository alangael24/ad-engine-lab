export const COURSE_CATALOG = Object.freeze({
  title: "Tu primer anuncio con IA",
  subtitle: "Una ruta práctica para pasar de una oferta a un anuncio vertical listo para probar.",
  version: "Ruta 1.0",
  modules: [
    {
      id: "inicio",
      number: "01",
      title: "Define el anuncio que vas a producir",
      lessons: [
        {
          slug: "define-tu-primer-anuncio",
          title: "Define el anuncio que vas a producir",
          duration: "10 min",
          format: "Guía práctica",
          summary: "Antes de generar escenas, decide qué producto, qué persona y qué acción debe provocar el anuncio.",
          objective: "Salir con un brief de una sola página que puedas convertir en guion.",
          sections: [
            {
              heading: "El anuncio empieza antes de la IA",
              body: "La herramienta puede acelerar la producción, pero necesita una decisión comercial clara. Elige un solo producto, un solo tipo de comprador y una sola acción: comprar, pedir información o visitar una página.",
            },
            {
              heading: "Completa este brief",
              body: "Producto: qué vendes. Comprador: quién lo necesita ahora. Problema: qué quiere dejar de sufrir. Resultado: qué quiere conseguir. Prueba: por qué debería creerte. Acción: qué debe hacer después de ver el anuncio.",
            },
            {
              heading: "Regla de claridad",
              body: "Si no puedes explicar la oferta en una frase que entienda alguien ajeno a tu negocio, todavía no generes. Simplifica hasta que la promesa sea concreta y fácil de repetir.",
            },
          ],
          checklist: [
            "Elegí un solo producto u oferta.",
            "Definí a quién le habla el anuncio.",
            "Escribí una promesa concreta y una llamada a la acción.",
          ],
        },
      ],
    },
    {
      id: "angulo",
      number: "02",
      title: "Elige un ángulo que pueda vender",
      lessons: [
        {
          slug: "elige-un-angulo",
          title: "Convierte el problema en un ángulo",
          duration: "14 min",
          format: "Ejercicio",
          summary: "Un formato llama la atención; el ángulo hace que la persona sienta que el anuncio fue creado para ella.",
          objective: "Crear tres ángulos y elegir el que tiene más urgencia, claridad y credibilidad.",
          sections: [
            {
              heading: "Tres ángulos para empezar",
              body: "Dolor: muestra el costo de seguir igual. Deseo: enseña el resultado que la persona quiere. Mecanismo: presenta una forma distinta de conseguirlo. Escribe una versión de cada uno sin exagerar ni prometer resultados garantizados.",
            },
            {
              heading: "Hazlo específico",
              body: "Cambia palabras vagas como mejor, fácil o increíble por situaciones visibles. En vez de ahorrar tiempo, muestra qué tarea deja de hacer, cuántas veces la repite o qué obstáculo desaparece.",
            },
            {
              heading: "Elige el ganador inicial",
              body: "Puntúa cada ángulo del uno al cinco en relevancia, urgencia y facilidad de demostración visual. Produce primero el que obtenga la suma más alta; los otros serán tus variantes.",
            },
          ],
          checklist: [
            "Escribí un ángulo de dolor, uno de deseo y uno de mecanismo.",
            "Eliminé afirmaciones vagas o imposibles de demostrar.",
            "Elegí el ángulo más fácil de entender y visualizar.",
          ],
        },
      ],
    },
    {
      id: "guion",
      number: "03",
      title: "Escribe el guion escena por escena",
      lessons: [
        {
          slug: "guion-escena-por-escena",
          title: "Guion de respuesta directa, escena por escena",
          duration: "18 min",
          format: "Plantilla",
          summary: "Construye un guion corto donde cada frase tenga una función y cada plano pueda convertirse en un clip.",
          objective: "Terminar un guion vertical de 20 a 35 segundos dividido en escenas de hasta cinco segundos.",
          sections: [
            {
              heading: "Estructura base",
              body: "Gancho: detén el scroll con el problema o resultado. Tensión: explica por qué seguir igual cuesta. Mecanismo: presenta la nueva forma de resolverlo. Prueba: muestra el producto, proceso o evidencia. Acción: pide un solo siguiente paso.",
            },
            {
              heading: "Escribe para ser visto",
              body: "Al lado de cada frase escribe lo que aparece en pantalla. Evita escenas abstractas: usa manos, producto, interfaces, transformaciones, comparaciones y acciones que puedan reconocerse sin audio.",
            },
            {
              heading: "Ritmo de cinco segundos",
              body: "Una escena debe comunicar una idea. Si el plano necesita explicar dos cosas, divídelo. Esto hace más fácil regenerar únicamente la parte débil sin volver a producir todo el anuncio.",
            },
          ],
          checklist: [
            "Mi gancho se entiende en los primeros tres segundos.",
            "Cada frase tiene una imagen o acción concreta.",
            "Dividí el guion en escenas de hasta cinco segundos.",
          ],
        },
      ],
    },
    {
      id: "produccion",
      number: "04",
      title: "Genera escenas sin desperdiciar saldo",
      lessons: [
        {
          slug: "genera-tus-escenas",
          title: "Genera escenas consistentes sin desperdiciar saldo",
          duration: "16 min",
          format: "Tutorial de trabajo",
          summary: "Convierte el guion en instrucciones visuales claras y usa las referencias para mantener producto, personaje y estilo.",
          objective: "Producir los clips que forman tu primer anuncio con el saldo incluido en tu compra.",
          sections: [
            {
              heading: "Describe lo que la cámara ve",
              body: "Incluye sujeto, acción, escenario, encuadre, movimiento de cámara, iluminación y estilo. Termina con formato vertical 9:16. Evita mezclar instrucciones comerciales con instrucciones visuales.",
            },
            {
              heading: "Mantén continuidad",
              body: "Usa la misma imagen de referencia y repite los rasgos esenciales del personaje o producto. Cambia una variable por generación: acción, ángulo o fondo. Así sabrás qué produjo la mejora.",
            },
            {
              heading: "Cuida el saldo",
              body: "Primero valida la idea con una imagen o una escena clave. Cuando el estilo funcione, genera las escenas restantes. Los créditos iniciales son limitados y están pensados para producir tu primer anuncio y aprender el flujo real.",
            },
          ],
          checklist: [
            "Separé cada escena en una instrucción visual.",
            "Elegí una referencia consistente para producto o personaje.",
            "Validé una escena antes de producir el anuncio completo.",
          ],
          action: { label: "Abrir la herramienta", href: "/herramienta/" },
        },
      ],
    },
    {
      id: "montaje",
      number: "05",
      title: "Monta, exporta y prepara variaciones",
      lessons: [
        {
          slug: "monta-y-prueba",
          title: "Convierte los clips en un anuncio listo para probar",
          duration: "15 min",
          format: "Checklist de entrega",
          summary: "Ordena las escenas, añade voz y texto, y exporta una versión que puedas lanzar y medir.",
          objective: "Salir con un archivo vertical terminado y dos variaciones de gancho.",
          sections: [
            {
              heading: "Monta para retención",
              body: "Coloca primero la escena más fácil de entender. Corta silencios, acelera transiciones y evita logos largos al inicio. La primera tarea del anuncio es conseguir el siguiente segundo de atención.",
            },
            {
              heading: "Texto y sonido",
              body: "Usa subtítulos grandes y contrasta las palabras importantes. La voz debe poder entenderse en un teléfono. La música acompaña el ritmo; no debe competir con el mensaje.",
            },
            {
              heading: "Exporta variantes",
              body: "Mantén el cuerpo del anuncio y exporta al menos dos inicios distintos. Nombra los archivos por ángulo y gancho para que después puedas relacionar el resultado con la idea que probaste.",
            },
          ],
          checklist: [
            "Exporté en vertical 9:16 y revisé el archivo en un teléfono.",
            "El mensaje se entiende incluso sin sonido.",
            "Creé al menos dos versiones cambiando el gancho.",
          ],
        },
      ],
    },
    {
      id: "biblioteca",
      number: "06",
      title: "Desmonta anuncios de referencia",
      lessons: [
        {
          slug: "desmonta-anuncios",
          title: "Desmonta anuncios antes de imitarlos",
          duration: "20 min",
          format: "Análisis guiado",
          summary: "Mira ejemplos reales del formato y estudia su estructura comercial, no solo el acabado visual.",
          objective: "Detectar gancho, tensión, mecanismo, prueba y llamada a la acción en cada referencia.",
          sections: [
            {
              heading: "Qué debes observar",
              body: "Pausa después de los primeros tres segundos y escribe qué prometió el anuncio. Después marca cada cambio de plano, qué información añade y qué emoción intenta provocar.",
            },
            {
              heading: "No copies la superficie",
              body: "El estilo visual es reemplazable. Conserva la lógica que funciona y adapta el producto, comprador, problema y evidencia a tu oferta. Una buena referencia es un mapa, no un archivo para duplicar.",
            },
          ],
          checklist: [
            "Identifiqué el gancho de cada ejemplo.",
            "Anoté la función de cada cambio de escena.",
            "Elegí una estructura que puedo adaptar a mi oferta.",
          ],
          videos: [
            { title: "Referencia 01", src: "/videos/03_ads_animados.mp4" },
            { title: "Referencia 02", src: "/videos/03_ads_animados_2.mp4" },
            { title: "Referencia 03", src: "/videos/03_ads_animados_3.mp4" },
            { title: "Referencia 04", src: "/videos/03_ads_animados_4.mp4" },
            { title: "Referencia 05", src: "/videos/03_ads_animados_5.mp4" },
            { title: "Referencia 06", src: "/videos/03_ads_animados_6.mp4" },
            { title: "Referencia 07", src: "/videos/facebook_ad_885662797596174.mp4" },
          ],
        },
      ],
    },
  ],
});
