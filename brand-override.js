(function () {
  "use strict";

  const replaceBrand = (value) =>
    value
      .replaceAll("AvatarHype Lab", "CreativeRush AI")
      .replaceAll("AvatarHype Ecom", "CreativeRush AI")
      .replaceAll("Avatar Hype Academy", "CreativeRush AI Academy")
      .replaceAll("AvatarHype", "CreativeRush AI")
      .replaceAll("Avatar Hype", "CreativeRush AI")
      .replaceAll("Ad Engine Lab", "CreativeRush AI");

  const hasLegacyBrand = (value) =>
    /AvatarHype|Avatar Hype|Ad Engine Lab/i.test(value || "");

  const skippedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
  const brandLogo = "assets/creative-rush-logo.svg";
  const brandTheme = "assets/brand-theme.css?v=20260825-3";

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function setHtml(element, value) {
    if (element && element.innerHTML !== value) element.innerHTML = value;
  }

  const stripeOffers = {
    real: {
      href: "https://buy.stripe.com/8x2fZh5B591h4y4eFObwk01",
      price: "$1,499 MXN",
      button: "Elegir Esencial — $1,499 MXN",
      name: "Esencial",
      label: "Para comenzar",
      subline: "pago único · 25 clips · 50 imágenes",
      description:
        "Para aprender el método y producir tu primer bloque de creativos con saldo incluido.",
      features: [
        "Campus privado y curso práctico de 6 módulos",
        "La misma cuenta abre el curso y la herramienta",
        "25 generaciones de video de hasta 5 segundos",
        "50 generaciones de imágenes",
        "Guion, dirección de escenas, montaje y pruebas",
        "Pago único; sin mensualidad del curso",
      ],
    },
    complete: {
      href: "https://buy.stripe.com/14AbJ1aVp6T9c0wfJSbwk00",
      price: "$1,999 MXN",
      button: 'Elegir Pro — $1,999 MXN <span class="arr">→</span>',
      name: "Pro",
      label: "Más producción",
      subline: "pago único · 60 clips · 100 imágenes",
      description:
        "Para salir con más variaciones, probar más ángulos y producir creativos durante más tiempo.",
      features: [
        "Campus privado y el mismo curso de 6 módulos",
        "La misma cuenta abre el curso y la herramienta",
        "60 generaciones de video de hasta 5 segundos",
        "100 generaciones de imágenes",
        "Más saldo para hooks, escenas y variaciones",
        "Pago único; sin mensualidad del curso",
      ],
    },
    animated: {
      hidden: true,
    },
  };

  function getOfferKey(tier) {
    const heading = tier.querySelector("h3")?.textContent.replace(/\s+/g, " ").trim();
    if (!heading) return null;
    if (/Pro|Completo/i.test(heading)) return "complete";
    if (/Animados/i.test(heading)) return "animated";
    if (/Esencial|Avatar Real/i.test(heading)) return "real";
    return null;
  }

  function updateOfferSection() {
    document.querySelectorAll(".tiers .tier").forEach((tier) => {
      const key = getOfferKey(tier);
      if (!key) return;

      const offer = stripeOffers[key];
      if (offer.hidden) {
        tier.remove();
        return;
      }

      tier.hidden = false;
      tier.removeAttribute("aria-hidden");
      setText(tier.querySelector(".tlabel"), offer.label);
      setHtml(tier.querySelector("h3"), `Plan<br>${offer.name}`);
      setText(tier.querySelector(".psub"), offer.subline);
      setText(tier.querySelector(".tdesc"), offer.description);
      setHtml(
        tier.querySelector("ul"),
        offer.features.map((feature) => `<li>${feature}</li>`).join(""),
      );

      const price = tier.querySelector(".price .now");
      const button = tier.querySelector("a.tbtn");
      if (price && price.textContent !== offer.price) price.textContent = offer.price;
      if (button && button.href !== offer.href) button.href = offer.href;

      if (button) {
        button.setAttribute("data-checkout", key === "complete" ? "pro" : "esencial");
        button.setAttribute("target", "_self");
        button.setAttribute("rel", "noopener");
        const expectedText =
          key === "complete" ? "Elegir Pro — $1,999 MXN →" : offer.button;
        const currentText = button.textContent.replace(/\s+/g, " ").trim();
        if (currentText !== expectedText) {
          if (key === "complete") button.innerHTML = offer.button;
          else button.textContent = offer.button;
        }
      }

      if (key === "complete") {
        setText(tier.querySelector(".ribbon"), "★ Más saldo por cada peso");
        const savings = tier.querySelector(".psub");
        setText(savings, offer.subline);
        const oldPrice = tier.querySelector(".price .was");
        if (oldPrice) oldPrice.remove();
      }
    });

    const comparisons = document.querySelectorAll(".price-math");
    setHtml(
      comparisons[0],
      "<strong>Esencial:</strong> 25 clips + 50 imágenes por $1,499 MXN. Es el plan para aprender y producir tu primer lote de creativos.",
    );
    setHtml(
      comparisons[1],
      "<strong>Pro:</strong> por $500 MXN adicionales obtienes 35 clips y 50 imágenes extra.",
    );
    setHtml(
      comparisons[2],
      "Ambos planes incluyen el curso y la herramienta. Cambia únicamente el saldo inicial de generación.",
    );
  }

  function updateCheckoutLinks() {
    const defaultCheckout = stripeOffers.complete.href;

    document
      .querySelectorAll('a[href="#pedido"], a[data-checkout="complete"], a[data-checkout="pro"]')
      .forEach((anchor) => {
        anchor.setAttribute("href", defaultCheckout);
        anchor.setAttribute("data-checkout", "pro");
        anchor.setAttribute("target", "_self");
      });
  }

  function updateHeroSection() {
    const headline = document.querySelector(".r4-h1");
    const stamp = document.querySelector(".hero-stamp");
    const replacement =
      "Vende más. Gasta menos.<br>Aprende a crear anuncios con IA que generan ventas.";
    const description = document.querySelector(".r4-what");
    const descriptionReplacement =
      "<strong>Deja de pagar cientos por producir un solo anuncio.</strong> Aprende el método dentro del curso y utiliza nuestra herramienta para crear anuncios con IA diseñados para vender — sin cámaras, actores ni agencias.";
    const chip = document.querySelector(".r4-chip");
    const lede = document.querySelector(".hero-lede");

    if (stamp && stamp.textContent !== "curso práctico + herramienta propia") {
      stamp.textContent = "curso práctico + herramienta propia";
    }

    if (headline && headline.innerHTML !== replacement) {
      headline.innerHTML = replacement;
    }

    if (description && description.innerHTML !== descriptionReplacement) {
      description.innerHTML = descriptionReplacement;
    }

    if (chip && chip.textContent !== "curso + herramienta + producción incluida") {
      chip.textContent = "curso + herramienta + producción incluida";
    }

    setText(
      lede,
      "Entra al curso, aprende el sistema y utiliza la producción incluida para crear tu primer anuncio y sus variaciones. Tu objetivo no es coleccionar lecciones: es salir con anuncios listos para probar y encontrar el que vende.",
    );

    const crossedOutLabels = [
      "cámaras",
      "actores",
      "agencias",
      "esperas",
      "rodajes",
      "mensualidad del curso",
    ];
    document.querySelectorAll(".washi-item .x").forEach((label, index) =>
      setText(label, crossedOutLabels[index % crossedOutLabels.length]),
    );

    document.querySelectorAll(".launch-bar.offer-bar").forEach((bar) => {
      const anchor = bar.querySelector(".lb-in");
      const offer =
        '<span class="lb-dot" aria-hidden="true"></span>' +
        '<span class="lb-offer lb-offer-full">ENTRA AL CURSO · PRODUCE TU PRIMER ANUNCIO SIN PAGAR GENERACIONES EXTRA</span>' +
        '<span class="lb-offer lb-offer-m">TU PRIMER ANUNCIO · PRODUCCIÓN INCLUIDA</span> ' +
        '<span aria-hidden="true">→</span>';

      if (bar.getAttribute("aria-label") !== "Produce tu primer anuncio con el curso y la herramienta") {
        bar.setAttribute("aria-label", "Produce tu primer anuncio con el curso y la herramienta");
      }
      if (anchor && anchor.innerHTML !== offer) anchor.innerHTML = offer;
    });
  }

  function updateHowSection() {
    const section = document.querySelector('[data-section="how_it_works"]');
    if (section && section.id !== "proceso") section.id = "proceso";
    const thirdStep = document.querySelector(
      ".how-steps > li:nth-of-type(3) > .how-t",
    );
    const replacement =
      "<b>LO PRODUCES</b> — utilizas nuestra herramienta para crear cada escena con personajes consistentes, darle vida a tu oferta y terminar con un anuncio listo para probar. La producción para empezar ya viene incluida en tu plan.";

    if (thirdStep && thirdStep.innerHTML !== replacement) {
      thirdStep.innerHTML = replacement;
    }
  }

  function updateWhoSection() {
    const section = document.querySelector('[data-section="quien_sale"]');
    if (!section) return;

    setText(section.querySelector("h3"), "¿Quién sale en tus anuncios?");
    const paragraphs = section.querySelectorAll(".r4-quien-p");
    const content = [
      "Presentadores y avatares creados con IA, consistentes de una escena a otra: tu marca hablando, demostrando y vendiendo sin que tengas que salir tú.",
      "Mantén el mismo personaje, la misma apariencia y el mismo estilo visual de principio a fin.",
      "Elige quién aparece, qué hace, dónde está y cómo interactúa con tu producto.",
      "Describe la acción, el encuadre y el movimiento con lenguaje normal; no necesitas saber código.",
      "El curso te enseña qué debe comunicar cada escena para detener el scroll y mover al cliente hacia la compra.",
    ];
    paragraphs.forEach((paragraph, index) => setText(paragraph, content[index]));
    setText(
      section.querySelector(".r4-quien-note"),
      "¿Quieres aparecer tú? Puedes combinar material propio con escenas generadas. La oferta base no incluye clonación de cara o voz ni exige contratar software externo.",
    );
  }

  function updateFormatsSection() {
    const section = document.querySelector('[data-section="formats"]');
    if (!section) return;

    setText(section.querySelector(".fmt-head .tab .ref"), "/ 8 posibilidades");
    setHtml(
      section.querySelector(".fmt-head h2"),
      'Ocho direcciones creativas. <span class="serif">Un mismo método.</span>',
    );
    const intro = section.querySelector(".fmt-head > p:not(.r4-fmt-all)");
    setText(
      intro,
      "No compras ocho cursos separados. Aprendes a pensar el ángulo, escribir el guion y dirigir escenas que puedes adaptar a distintos estilos de anuncio.",
    );
    setText(
      section.querySelector(".r4-fmt-all"),
      "Estas fichas son referencias visuales de lo que puedes explorar; el resultado depende de tu oferta, el guion y las escenas que decidas producir.",
    );

    const formats = [
      ["UGC visual", "Un presentador o cliente ficticio muestra el problema, usa el producto o explica la transformación con una escena natural."],
      ["Historia con voz en off", "Clips de acciones, producto y contexto unidos por una narración que lleva del problema a la oferta."],
      ["Producto animado", "Convierte una foto o concepto de producto en escenas con movimiento, demostraciones y transiciones que detienen el scroll."],
      ["Autoridad tipo podcast", "Una conversación o monólogo visual para explicar una idea, desmontar una objeción y construir confianza antes de vender."],
      ["Diálogo y contraste", "Dos puntos de vista, personajes o situaciones enfrentadas para hacer visible el antes, el después o la decisión de compra."],
      ["Gancho inspirado en tendencias", "Adapta un patrón visual reconocible a tu oferta sin depender de copiar literalmente el anuncio de otra marca."],
      ["Creativo estático", "Imágenes para feeds, comparativas, testimonios y conceptos que también puedes utilizar como referencia para tus clips."],
      ["Variaciones de gancho", "Mantén el cuerpo del anuncio y cambia el inicio, el encuadre o la promesa para descubrir qué merece más inversión."],
    ];

    section.querySelectorAll(".ficha").forEach((card, index) => {
      const item = formats[index];
      if (!item) return;
      setText(card.querySelector(".ficha-tab"), `Posibilidad ${String(index + 1).padStart(2, "0")} /8`);
      setText(card.querySelector("h3"), item[0]);
      setText(card.querySelector("p"), item[1]);
      const play = card.querySelector(".ficha-play");
      if (play) play.setAttribute("aria-label", `Reproducir ejemplo de ${item[0]}`);
      card.querySelectorAll(".ex-count, .made-chip, .seemore, .nuevo-tape, .ficha-play").forEach((element) => {
        element.hidden = true;
      });
    });

    setText(section.querySelector(".swipe-hint"), "desliza para explorar las posibilidades →");
    const cta = section.querySelector("a.stamp");
    if (cta) setHtml(cta, 'Quiero el curso + la herramienta <span class="arr">→</span>');
    setText(
      section.querySelector(".plat-bridge"),
      "Ahora, por qué juntamos el aprendizaje y la producción en una sola oferta ↓",
    );
  }

  function updateNavigationAndProof() {
    const navLinks = document.querySelectorAll(".nav-links a");
    const links = [
      ["Cómo funciona", "#proceso"],
      ["Mi campus", "campus/"],
      ["Temario", "#temario"],
      ["Elegir Pro", stripeOffers.complete.href],
    ];
    navLinks.forEach((link, index) => {
      if (!links[index]) return;
      setText(link, links[index][0]);
      link.setAttribute("href", links[index][1]);
    });

    // La prueba social forma parte de la página y debe permanecer visible.
  }

  function updateNumbersSection() {
    const section = document.querySelector('[data-section="nums"]');
    if (!section) return;

    setText(section.querySelector(".nums-head h2"), "Tu primera campaña ya viene incluida.");

    const cards = section.querySelectorAll(".nums-grid .num");
    const cardContent = [
      {
        big: "25–60",
        label:
          "escenas de video para construir, variar y probar anuncios sin pagar generaciones extra para empezar.",
        calc: "producción de video incluida ✓",
      },
      {
        big: "50–100",
        label:
          "imágenes para productos, personajes, conceptos, anuncios estáticos y referencias consistentes.",
        calc: "más creativos para probar",
      },
      {
        big: "1.º",
        label:
          "tu primer anuncio listo para lanzar, con recursos para probar nuevos ganchos y versiones según tu plan.",
        calc: "sales creando, no estudiando",
      },
    ];

    cards.forEach((card, index) => {
      const content = cardContent[index];
      if (!content) return;
      setText(card.querySelector(".big"), content.big);
      setText(card.querySelector(".lbl"), content.label);
      setText(card.querySelector(".calc"), content.calc);
    });

    setText(
      section.querySelector(".r2-cost-table h3"),
      "No compras solo un curso. Sales con algo que puedes probar.",
    );
    setText(
      section.querySelector(".r4-bug-hero"),
      "Elige cuánta producción quieres llevarte: Esencial para crear tu primer anuncio; Pro para salir con más escenas, ganchos y variaciones listas para probar.",
    );

    const rows = section.querySelectorAll(".ct-row");
    const rowContent = [
      [
        "PLAN ESENCIAL",
        "25 escenas de video + 50 imágenes para aprender el sistema y producir tu primer anuncio",
      ],
      [
        "PLAN PRO",
        "60 escenas de video + 100 imágenes para probar más ganchos, ángulos y versiones",
      ],
      [
        "EL RESULTADO",
        "anuncios reales listos para lanzar, medir y mejorar — no otra carpeta llena de teoría",
      ],
    ];
    rows.forEach((row, index) => {
      const content = rowContent[index];
      if (!content) return;
      setText(row.querySelector(".ct-k"), content[0]);
      setText(row.querySelector(".ct-v"), content[1]);
    });

    const notes = section.querySelectorAll(".ct-note");
    const noteContent = [
      "El saldo de tu plan se añade una sola vez con la compra. No es una suscripción y no se renueva automáticamente.",
      "Cada generación de video crea una escena de hasta 5 segundos. Las generaciones no son ilimitadas.",
      "No recibes anuncios genéricos: aprendes a dirigir cada escena para construir creativos con intención de venta.",
      "Cuando termines el saldo incluido, la generación se detiene sin cargos automáticos. El curso y tu progreso permanecen activos.",
    ];
    notes.forEach((note, index) => setText(note, noteContent[index]));

    setText(
      section.querySelector(".plat-bridge"),
      "Ahora mira exactamente qué recibes en Esencial y en Pro ↓",
    );
  }

  function updateStorySection() {
    const section = document.querySelector('[data-section="story"]');
    if (!section) return;

    const paragraphs = section.querySelectorAll("p:not(.r4-magic)");
    const paragraphContent = [
      "La mayoría no tiene un problema de ideas. Tiene un problema de producción: escribir el guion, conseguir cada escena, corregirla, montarla y repetirlo antes de que el anuncio deje de ser relevante.",
      "Puedes abrir diez herramientas de IA y seguir exactamente igual. Porque la herramienta genera; lo que convierte una colección de clips en un anuncio es saber qué decir, qué mostrar y en qué orden.",
      "Por eso construimos dos piezas que casi siempre te venden por separado:",
    ];
    paragraphs.forEach((paragraph, index) =>
      setText(paragraph, paragraphContent[index]),
    );

    const bullets = section.querySelectorAll("li");
    setText(
      bullets[0],
      "El curso te lleva por una ruta concreta de 6 módulos: brief, ángulo, guion, escenas, montaje y análisis de referencias.",
    );
    setText(
      bullets[1],
      "Nuestra herramienta te permite ejecutarla. Esencial incluye 25 clips y 50 imágenes; Pro incluye 60 clips y 100 imágenes.",
    );
    setText(
      section.querySelector(".r4-magic"),
      "Y no, no hay un botón mágico que garantice ventas. La IA genera las escenas; tú aprendes a dirigirlas. La diferencia es que aquí no terminas con apuntes: terminas con un anuncio listo para probar.",
    );
  }

  function updateMythsSection() {
    const section = document.querySelector('[data-section="myths"]');
    if (!section) return;

    const items = section.querySelectorAll("li");
    const itemContent = [
      "una app que pulsas una vez y mágicamente garantiza ventas",
      "una mensualidad obligatoria por acceder al curso",
      "una agencia que produce por ti mientras tú sigues sin aprender el proceso",
      "generaciones ilimitadas escondidas detrás de una promesa imposible",
      "otro curso de prompts sueltos que te deja sin saber qué anuncio crear",
      "SÍ es: un curso práctico + nuestra herramienta + saldo inicial real. Aprendes el método y eliges entre 25 clips + 50 imágenes o 60 clips + 100 imágenes. Después, el curso y tu progreso permanecen en la misma cuenta.",
    ];
    items.forEach((item, index) => setText(item, itemContent[index]));

    setText(
      section.querySelector(".r4-clon-chip"),
      "No necesitas cámaras, actores ni grabarte. Puedes crear las escenas con presentadores y recursos generados con IA; tú decides el ángulo, el guion y el montaje que los convierte en un anuncio.",
    );
    setText(
      section.querySelector(".plat-bridge"),
      "Ahora mira exactamente qué incluye cada plan y elige cuánto quieres producir ↓",
    );
  }

  function updatePricingSection() {
    const section = document.querySelector('[data-section="pricing"]');
    if (!section) return;

    setText(section.querySelector(".pd1-line"), "DOS PLANES. UN SOLO PAGO.");
    setText(section.querySelector(".pd1-src"), "DESDE $1,499 MXN");
    setText(section.querySelector(".lo-tag"), "ELIGE EL SALDO QUE NECESITAS PARA EMPEZAR");
    setText(
      section.querySelector(".lo-count"),
      "Esencial: 25 clips + 50 imágenes · Pro: 60 clips + 100 imágenes",
    );
    setText(
      section.querySelector(".lo-why"),
      "Los dos planes crean la misma cuenta y desbloquean el mismo campus, curso y herramienta. Solo cambia el saldo inicial de producción.",
    );

    const paymentCopy = section.querySelector(".price-head > p:last-of-type");
    setHtml(
      paymentCopy,
      "<strong>Pago único.</strong> Stripe confirma el cobro, crea tu cuenta y te envía un enlace seguro por email. No necesitas contraseña y tu tarjeta no queda suscrita al curso.",
    );

    setText(section.querySelector(".bs-tag"), "ESENCIAL O PRO · TÚ ELIGES CUÁNTO PRODUCIR");
    setText(section.querySelector(".bs-clock"), "sin mensualidad del curso");
    setText(
      section.querySelector(".bs-why"),
      "Esencial incluye 25 clips de hasta 5 segundos y 50 imágenes por $1,499 MXN.",
    );
    setText(
      section.querySelector(".bs-redeem"),
      "Pro incluye 60 clips de hasta 5 segundos y 100 imágenes por $1,999 MXN.",
    );
    setText(
      section.querySelector(".bs-bridge"),
      "En ambos casos el curso sigue siendo tuyo. Al terminar el saldo no existe ningún cargo automático.",
    );

    setText(
      section.querySelector(".tbtn-kicker"),
      "El curso es permanente. El saldo de generación es inicial y no se renueva automáticamente.",
    );

    const quickQuestions = section.querySelectorAll(".eco-q");
    const quickFaq = [
      [
        "¿Esto es un curso o una suscripción?",
        "Es un curso práctico dentro de un campus privado e incluye acceso a la herramienta. Se paga una vez y no existe una mensualidad automática del curso.",
      ],
      [
        "¿Qué recibo exactamente al pagar?",
        "Una cuenta para abrir el campus, el curso de 6 módulos y la herramienta, más el saldo de tu plan: 25 clips + 50 imágenes en Esencial o 60 clips + 100 imágenes en Pro.",
      ],
      [
        "¿Qué cambia entre Esencial y Pro?",
        "El curso y la herramienta son los mismos. Pro incluye 35 clips y 50 imágenes adicionales por $500 MXN más.",
      ],
    ];
    quickQuestions.forEach((question, index) => {
      const content = quickFaq[index];
      if (!content) return;
      setText(question, content[0]);
      setText(question.closest("details")?.querySelector("p"), content[1]);
    });

    setHtml(
      section.querySelector(".r4-pay-badges"),
      '<span class="hp-label">PAGO SEGURO CON STRIPE</span><span class="pm pm-visa">VISA</span><span class="pm pm-mc">MC</span><span class="pm pm-wallet">Apple Pay</span><span class="pm pm-wallet">G Pay</span>',
    );
    setText(
      section.querySelector(".r4-precedente"),
      "El precio y el contenido exacto de cada plan aparecen de nuevo en Stripe antes de que confirmes el pago.",
    );
    setHtml(
      section.querySelector(".r4-precheckout"),
      'Al pulsar vas al checkout seguro de CreativeRush AI en Stripe. Después del pago regresarás a esta web y recibirás el enlace de acceso en el correo que utilizaste. Si ya compraste, puedes entrar desde <a href="/campus/">Mi campus</a>.',
    );
    setText(
      section.querySelector(".r4-clon-bump"),
      "No necesitas mostrar tu cara ni clonar tu voz. La oferta base no incluye servicios de clonación ni suscripciones externas obligatorias.",
    );

    const priceMath = section.querySelectorAll(".price-math");
    setHtml(
      priceMath[0],
      "<strong>Esencial:</strong> 25 clips + 50 imágenes por $1,499 MXN. Es el plan para aprender y producir tu primer lote de creativos.",
    );
    setHtml(
      priceMath[1],
      "<strong>Pro:</strong> por $500 MXN adicionales obtienes 35 clips y 50 imágenes extra.",
    );
    setText(
      priceMath[2],
      "Ambos planes incluyen el curso y la herramienta. Cambia únicamente el saldo inicial de generación.",
    );
  }

  function updateFinalSection() {
    const section = document.querySelector('[data-section="final"]');
    if (!section) return;

    setHtml(
      section.querySelector("h2"),
      'Crea anuncios con IA diseñados para vender. <span class="serif">Empieza hoy.</span>',
    );
    const paragraphs = section.querySelectorAll("p");
    setText(
      paragraphs[0],
      "Entra con todo lo que necesitas para pasar de una idea a anuncios reales: el método, nuestra herramienta y producción incluida para crear sin cámaras, actores ni agencias.",
    );
    setText(
      section.querySelector(".final-live"),
      "Tu meta no es terminar otro curso. Es lanzar tu primer anuncio, probar versiones y descubrir qué hace que tu cliente se detenga, haga clic y compre.",
    );
    setText(
      section.querySelector(".final-lock"),
      "PD: el saldo inicial no es ilimitado ni se renueva automáticamente. Cuando se termina, la herramienta no realiza ningún cargo por su cuenta.",
    );

    const chips = section.querySelectorAll(".chip");
    ["primer anuncio", "producción incluida", "listo para probar"].forEach(
      (label, index) => setText(chips[index], label),
    );
  }

  function updatePlatformTourSection() {
    const section = document.querySelector('[data-section="platform_tour"]');
    if (!section) return;

    const intro = section.querySelector(
      ".plat-head > p:not(.r4-frontier):not(.r4-bit-chip)",
    );
    const frontier = section.querySelector(".r4-frontier");
    const creditChip = section.querySelector(".r4-bit-chip");
    const benefits = section.querySelector(".plat-bullets");
    const grid = section.querySelector(".plat-grid");

    const introText =
      "Al pagar no recibes un PDF perdido ni tienes que pedir acceso por mensaje. Stripe activa una cuenta que abre todo tu sistema de alumno.";
    const frontierText =
      "Curso y herramienta viven bajo la misma cuenta. Tu progreso y tu saldo quedan asociados al correo que utilizaste en Stripe.";
    const creditText =
      "ACCESO AUTOMÁTICO · SIN CONTRASEÑA · SIN RENOVACIÓN DEL CURSO";
    const benefitsHtml = [
      "una sola cuenta para campus, curso y herramienta",
      "ruta práctica de 6 módulos en español",
      "progreso del curso guardado por alumno",
      "saldo visible de clips e imágenes según el plan",
      "ningún cargo automático cuando se termina el saldo",
    ]
      .map((benefit) => `<li>${benefit}</li>`)
      .join("");
    const deliveryHtml = [
      ["01", "Pagas en Stripe", "El checkout confirma el pago y utiliza el correo que escribiste para identificar tu cuenta."],
      ["02", "Creamos tu acceso", "Recibes un enlace seguro por email. Si ya eras alumno, reutilizamos la misma cuenta en lugar de duplicarla."],
      ["03", "Entras al campus", "Desde un solo panel abres el curso, continúas tu progreso y accedes a la herramienta."],
      ["04", "Producción con saldo", "Tu plan carga automáticamente clips e imágenes. Siempre puedes ver cuánto te queda antes de producir."],
    ]
      .map(
        ([number, title, copy]) =>
          `<article class="ae-delivery-card"><span>${number}</span><h3>${title}</h3><p>${copy}</p></article>`,
      )
      .join("");

    if (intro && intro.textContent !== introText) intro.textContent = introText;
    if (frontier && frontier.textContent !== frontierText) {
      frontier.textContent = frontierText;
    }
    if (creditChip && creditChip.textContent !== creditText) {
      creditChip.textContent = creditText;
    }
    if (grid && grid.innerHTML !== deliveryHtml) {
      grid.classList.add("ae-delivery-grid");
      grid.removeAttribute("tabindex");
      grid.removeAttribute("role");
      grid.removeAttribute("aria-roledescription");
      grid.setAttribute("aria-label", "Cómo se entrega el acceso");
      grid.innerHTML = deliveryHtml;
    }
    if (benefits && benefits.innerHTML !== benefitsHtml) {
      benefits.innerHTML = benefitsHtml;
    }
    section.querySelectorAll(".plat-nav, .swipe-hint").forEach((element) => {
      element.hidden = true;
    });
    setText(section.querySelector(".plat-head .tab .ref"), "/ así se entrega");
    setText(section.querySelector(".plat-cta .stamp"), "Elegir el plan Pro →");
    setText(
      section.querySelector(".plat-bridge"),
      "¿Qué tipo de anuncios puedes construir con el sistema? ↓",
    );
  }

  function updateCurriculumSection() {
    const section = document.querySelector('[data-section="temario"]');
    if (!section) return;

    setHtml(
      section.querySelector("h2"),
      'Seis módulos. <span class="serif">Una salida concreta: tu primer anuncio.</span>',
    );
    setText(
      section.querySelector(".bit-p"),
      "La ruta sigue el orden real de trabajo. No empiezas memorizando herramientas: empiezas aclarando la oferta y terminas con un archivo vertical listo para probar.",
    );

    const modules = [
      ["1. Define el anuncio que vas a producir", "Producto, comprador, problema, resultado, prueba y llamada a la acción.", "brief de una página"],
      ["2. Elige un ángulo que pueda vender", "Dolor, deseo y mecanismo: crea tres opciones y selecciona la más clara, urgente y demostrable.", "3 ángulos comparados"],
      ["3. Escribe el guion escena por escena", "Gancho, tensión, mecanismo, prueba y acción divididos en planos de hasta cinco segundos.", "guion listo para producir"],
      ["4. Genera escenas sin desperdiciar saldo", "Instrucciones visuales, referencias y continuidad para validar primero y producir después.", "clips del primer anuncio"],
      ["5. Monta, exporta y prepara variaciones", "Ritmo, subtítulos, voz, formato 9:16 y dos ganchos distintos para probar.", "anuncio terminado"],
      ["6. Desmonta anuncios de referencia", "Analiza ejemplos y separa la lógica comercial del estilo para adaptar la estructura a tu oferta.", "criterio para seguir creando"],
    ];
    const list = section.querySelector(".temario");
    const modulesHtml = modules
      .map(
        ([title, description, outcome]) =>
          `<li><strong>${title}</strong><span class="tem-d">${description}</span><span class="tem-m">Resultado: ${outcome}</span></li>`,
      )
      .join("");
    if (list && list.innerHTML !== modulesHtml) list.innerHTML = modulesHtml;
    setText(
      section.querySelector(".r2-temario-total"),
      "El curso está dentro de tu campus privado, en español y a tu ritmo. Tu progreso se guarda automáticamente y el acceso al contenido permanece activo después de terminar el saldo.",
    );
    const nextDrop = section.querySelector(".next-drop");
    if (nextDrop) nextDrop.hidden = true;
    setText(
      section.querySelector(".plat-bridge"),
      "Y ahora, exactamente qué incluye el pago y qué no ↓",
    );
  }

  function updateFinePrintSection() {
    const section = document.querySelector('[data-section="fine_print"]');
    if (!section) return;

    const heading = section.querySelector("h3");
    const items = section.querySelector(".fp-items");
    const close = section.querySelector(".fp-close");
    const headingText =
      "El curso se paga una vez. El saldo de la herramienta es limitado.";
    const itemsHtml = [
      "El curso se paga una sola vez: tu tarjeta no queda suscrita.",
      "Stripe crea o reutiliza una cuenta asociada al correo de la compra y te envía un enlace seguro.",
      "La misma cuenta abre el campus, el curso y la herramienta; tu progreso queda guardado.",
      "Esencial incluye 25 clips de hasta 5 segundos y 50 generaciones de imágenes.",
      "Pro incluye 60 clips de hasta 5 segundos y 100 generaciones de imágenes.",
      "Las generaciones no son ilimitadas ni se renuevan automáticamente. Cuando se terminan, la herramienta no realiza ningún cobro por su cuenta.",
      "Para unir los clips necesitas un teléfono o una computadora normal y un editor de video como CapCut.",
    ]
      .map((item) => `<li>${item}</li>`)
      .join("");
    const closeText =
      "Recibes exactamente esto: cuenta, campus, curso, acceso a la herramienta y el saldo del plan elegido. El curso permanece activo aunque el saldo llegue a cero.";

    if (heading && heading.textContent !== headingText) {
      heading.textContent = headingText;
    }
    if (items && items.innerHTML !== itemsHtml) items.innerHTML = itemsHtml;
    if (close && close.textContent !== closeText) close.textContent = closeText;
  }

  function updateFaqSection() {
    const section = document.querySelector('[data-section="faq"]');
    if (!section) return;

    const entries = {
      "faq-a-0": {
        question: "¿Esto es un curso o una herramienta para generar anuncios?",
        answer:
          "Son las dos partes de un mismo sistema. Stripe crea una cuenta que abre el campus, el curso de 6 módulos y la herramienta. Esa cuenta recibe 25 clips + 50 imágenes en Esencial o 60 clips + 100 imágenes en Pro.",
      },
      "faq-a-5": {
        question: "¿Funciona para lo que yo vendo?",
        answer:
          "Sí, porque el método no depende de un nicho concreto. Aprendes a investigar qué necesita escuchar tu comprador, elegir el ángulo, escribir el hook y convertir el guion en escenas. Puedes aplicarlo a productos, servicios, ecommerce, infoproductos o aplicaciones; cambian los ejemplos, no el proceso.",
      },
      "faq-a-9": {
        question: "¿Tengo que salir yo en los anuncios?",
        answer:
          "No. Puedes generar presentadores, productos y escenas sin cámaras ni actores. Si quieres aparecer, puedes combinar tu propio material con las escenas generadas, pero la oferta base no incluye clonación de cara o voz.",
      },
      "faq-a-14": {
        question: "¿Puedo usar mi propia voz?",
        answer:
          "Sí. Puedes grabar una narración normal y añadirla durante el montaje. Clonar tu voz no forma parte de esta oferta y no es necesario para terminar el método.",
      },
      "faq-a-1": {
        question: "¿Cómo funciona la herramienta y qué incluye cada plan?",
        answer:
          "Divides el guion en escenas y utilizas la herramienta para producir clips o imágenes. Esencial carga 25 clips de hasta 5 segundos y 50 imágenes; Pro carga 60 clips y 100 imágenes. El saldo pertenece a la misma cuenta que utilizas para el curso.",
      },
      "faq-a-2": {
        question: "¿Qué pasa cuando se terminan los créditos incluidos?",
        answer:
          "La generación se detiene y no se realiza ningún cargo automático. Tu acceso al curso y tu progreso permanecen intactos. Si decides comprar más saldo, tendrás que aceptar expresamente la cantidad y el precio antes de pagar.",
      },
      "faq-a-10": {
        question: "¿Tendré que pagar algo más después?",
        answer:
          "No para conservar y completar el curso. Solo existiría otro pago si terminas el saldo incluido y eliges comprar más generaciones. No hay renovaciones ni cargos automáticos.",
      },
      "faq-a-3": {
        question: "¿Necesito saber de tecnología o de IA?",
        answer:
          "No. Cero nodos y cero código. La ruta utiliza instrucciones claras, ejercicios y listas de comprobación para llevarte de la oferta al guion, del guion a las escenas y de las escenas al anuncio terminado.",
      },
      "faq-a-4": {
        question: "¿Me van a dar un botón mágico que hace el anuncio solo?",
        answer:
          "No, y desconfía de quien te lo prometa. La herramienta genera las escenas; tú diriges el ángulo, el guion, lo que ocurre en cada plano y el montaje. Los créditos incluidos te permiten aplicar el método y producir tu primer anuncio, pero la estrategia creativa la aprendes dentro del curso.",
      },
      "faq-a-6": {
        question: "¿En qué idioma está el curso? ¿Y los anuncios que cree?",
        answer:
          "El campus y el curso están en español. Puedes escribir el guion, los textos y tu narración en el idioma de tu mercado. La disponibilidad concreta de voces depende de los modelos activos en la herramienta.",
      },
      "faq-a-7": {
        question: "¿Cuánto dura y en qué formato es?",
        answer:
          "Son 6 módulos prácticos dentro de un campus privado: explicaciones, ejercicios, listas de comprobación y anuncios de referencia. Avanzas a tu ritmo, no hay horarios ni clases obligatorias en vivo y tu progreso se guarda en tu cuenta.",
      },
      "faq-a-8": {
        question: "¿Qué diferencia hay entre Esencial y Pro?",
        answer:
          "Los dos incluyen el mismo curso y el mismo acceso a la herramienta. Esencial trae 25 clips y 50 imágenes por $1,499 MXN. Pro trae 60 clips y 100 imágenes por $1,999 MXN.",
      },
      "faq-a-12": {
        question: "¿Puedo pagar desde mi país?",
        answer:
          "Sí. El pago se procesa de forma segura mediante Stripe. En el checkout verás la moneda final y los métodos disponibles para tu país antes de confirmar. Es un solo cobro por el curso y tu tarjeta no queda suscrita automáticamente.",
      },
      "faq-a-11": {
        question: "¿Qué pasa si cambia el modelo de IA?",
        answer:
          "Actualizamos la herramienta y el método para incorporar mejores modelos y procesos sin obligarte a empezar de cero. Tú conservas el sistema estratégico: investigación, guion y dirección. La tecnología puede cambiar; la capacidad de crear buenos anuncios se queda contigo.",
      },
      "faq-a-13": {
        question: "¿Y cómo sé que esto no es humo?",
        answer:
          "Porque antes de pagar puedes ver los 6 módulos, el proceso de entrega y el saldo exacto de cada plan. No garantizamos ventas: te damos un método y recursos de producción para terminar un anuncio y someterlo a una prueba real.",
      },
      "faq-a-15": {
        question: "¿Esto es solo un curso, o hay algo más detrás?",
        answer:
          "Es un sistema de aprendizaje y producción: una cuenta, un campus, un curso de 6 módulos, la herramienta y saldo de video e imagen para llevar la teoría a una pieza terminada.",
      },
    };

    for (const [answerId, entry] of Object.entries(entries)) {
      const question = section.querySelector(`[aria-controls="${answerId}"]`);
      const answer = section.querySelector(`#${answerId} .faq-a-in`);
      const questionHtml = `${entry.question}<span class="pm" aria-hidden="true">+</span>`;

      if (question && question.innerHTML !== questionHtml) {
        question.innerHTML = questionHtml;
      }
      if (answer && answer.textContent !== entry.answer) {
        answer.textContent = entry.answer;
      }
    }

    const contact = section.querySelector(".faq-dm");
    const contactHtml =
      '¿Ya compraste? Entra con el mismo correo que utilizaste en Stripe. <a href="/campus/">Abrir Mi campus <span class="arr">→</span></a>';
    if (contact && contact.innerHTML !== contactHtml) {
      contact.innerHTML = contactHtml;
    }
  }

  function updateFooterSection() {
    const footer = document.querySelector(".footer");
    if (footer) {
      const subtitle = footer.querySelector(".brand .sub");
      const meta = footer.querySelector(".footer-meta");
      const metaHtml =
        '© 2026 CreativeRush AI · Campus + curso + herramienta de anuncios con IA <span aria-hidden="true">·</span> <a href="/campus/">Mi campus</a>';

      if (subtitle && subtitle.textContent !== "campus + curso + herramienta") {
        subtitle.textContent = "campus + curso + herramienta";
      }
      if (meta && meta.innerHTML !== metaHtml) meta.innerHTML = metaHtml;
    }

    const sticky = document.querySelector(".sticky-cta");
    if (sticky) {
      const summary = sticky.querySelector(".sc");
      const full = sticky.querySelector(".st-full");
      const mobile = sticky.querySelector(".st-m");
      const buttonFull = sticky.querySelector("a .st-full");
      const buttonMobile = sticky.querySelector("a .st-m");

      const summaryText = summary
        ? [...summary.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
        : null;
      if (summaryText && summaryText.nodeValue !== "Plan Pro · $1,999 MXN") {
        summaryText.nodeValue = "Plan Pro · $1,999 MXN";
      }

      if (full && full.textContent !== "60 clips · 100 imágenes · pago único") {
        full.textContent = "60 clips · 100 imágenes · pago único";
      }
      if (mobile && mobile.textContent !== "60 clips + 100 imágenes") {
        mobile.textContent = "60 clips + 100 imágenes";
      }
      if (buttonFull && buttonFull.textContent !== "Elegir Pro") {
        buttonFull.textContent = "Elegir Pro";
      }
      if (buttonMobile && buttonMobile.textContent !== "Elegir Pro") {
        buttonMobile.textContent = "Elegir Pro";
      }
    }
  }

  function updateTextNode(node) {
    if (!hasLegacyBrand(node.nodeValue)) return;
    if (node.parentElement && skippedTags.has(node.parentElement.tagName)) return;
    node.nodeValue = replaceBrand(node.nodeValue);
  }

  function updateElement(element) {
    if (!(element instanceof Element)) return;

    if (element.matches(".brand .b")) {
      const logo = element.querySelector("img.ae-logo");
      if (!logo || logo.getAttribute("src") !== brandLogo) {
        element.innerHTML =
          `<img class="ae-logo" src="${brandLogo}" alt="CreativeRush AI">`;
      }
    }

    for (const attribute of ["alt", "aria-label", "title"]) {
      const value = element.getAttribute(attribute);
      if (hasLegacyBrand(value)) {
        element.setAttribute(attribute, replaceBrand(value));
      }
    }
  }

  function ensureBrandTheme() {
    let stylesheet = document.querySelector('link[data-ae-brand-theme="true"]');
    if (!stylesheet) {
      stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = brandTheme;
      stylesheet.setAttribute("data-ae-brand-theme", "true");
      document.head.appendChild(stylesheet);
    }
    document.body?.classList.add("ae-branded");
  }

  function updateSubtree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      updateTextNode(root);
      return;
    }
    if (!(root instanceof Element) && root !== document) return;

    if (root instanceof Element) updateElement(root);
    const scope = root === document ? document.documentElement : root;

    scope.querySelectorAll(".brand .b, [alt], [aria-label], [title]").forEach(updateElement);

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) updateTextNode(node);

    updateHeroSection();
    updateHowSection();
    updateWhoSection();
    updateNumbersSection();
    updateStorySection();
    updateMythsSection();
    updatePricingSection();
    updatePlatformTourSection();
    updateFormatsSection();
    updateCurriculumSection();
    updateFinePrintSection();
    updateFaqSection();
    updateFinalSection();
    updateFooterSection();
    updateNavigationAndProof();
    updateOfferSection();
    updateCheckoutLinks();
  }

  function updateMetadata() {
    document.title = "CreativeRush AI — Curso + herramienta para crear anuncios con IA";
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", "#070709");
    const metadata = {
      'meta[name="description"]': "Aprende a crear tu primer anuncio con IA dentro de un campus privado. Curso de 6 módulos, herramienta y saldo inicial desde 25 clips y 50 imágenes.",
      'meta[property="og:title"]': "Vende más. Gasta menos. Crea anuncios con IA.",
      'meta[property="og:description"]': "Una cuenta para aprender el método, producir las escenas y terminar tu primer anuncio listo para probar.",
      'meta[property="og:url"]': "https://creativerushai.com/",
      'meta[property="og:site_name"]': "CreativeRush AI",
      'meta[name="twitter:title"]': "CreativeRush AI — Curso + herramienta de anuncios con IA",
      'meta[name="twitter:description"]': "Campus privado, curso práctico, herramienta y saldo inicial de generación.",
    };
    for (const [selector, content] of Object.entries(metadata)) {
      const meta = document.querySelector(selector);
      if (meta) meta.setAttribute("content", content);
    }
    document.querySelectorAll('link[rel="canonical"], link[rel="alternate"]').forEach((link) => {
      if (link.rel === "canonical") link.setAttribute("href", "https://creativerushai.com/");
      else link.remove();
    });
    document.querySelectorAll('script[type="application/ld+json"], script[data-legacy-schema="true"]').forEach((script) => script.remove());
    if (!document.querySelector("#ae-offer-schema")) {
      const schema = document.createElement("script");
      schema.id = "ae-offer-schema";
      schema.type = "application/ld+json";
      schema.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "CreativeRush AI",
        description: "Campus, curso práctico y herramienta para crear anuncios con IA.",
        brand: { "@type": "Brand", name: "CreativeRush AI" },
        offers: {
          "@type": "AggregateOffer",
          lowPrice: "1499",
          highPrice: "1999",
          priceCurrency: "MXN",
          offerCount: 2,
          availability: "https://schema.org/InStock",
        },
      });
      document.head.appendChild(schema);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") updateTextNode(mutation.target);
      mutation.addedNodes.forEach(updateSubtree);
    }
    updateHeroSection();
    updateHowSection();
    updateWhoSection();
    updateNumbersSection();
    updateStorySection();
    updateMythsSection();
    updatePricingSection();
    updatePlatformTourSection();
    updateFormatsSection();
    updateCurriculumSection();
    updateFinePrintSection();
    updateFaqSection();
    updateFinalSection();
    updateFooterSection();
    updateNavigationAndProof();
    updateOfferSection();
    updateCheckoutLinks();
  });

  let brandingStarted = false;

  function setupInteractions() {
    document.querySelectorAll(".faq-q").forEach((button) => {
      const answer = document.getElementById(button.getAttribute("aria-controls"));
      const expanded = button.getAttribute("aria-expanded") === "true";
      if (answer) answer.hidden = !expanded;
      setText(button.querySelector(".pm"), expanded ? "−" : "+");
    });

    document.addEventListener("click", (event) => {
      const faqButton = event.target.closest?.(".faq-q");
      if (faqButton) {
        const answer = document.getElementById(faqButton.getAttribute("aria-controls"));
        const next = faqButton.getAttribute("aria-expanded") !== "true";
        faqButton.setAttribute("aria-expanded", String(next));
        if (answer) answer.hidden = !next;
        setText(faqButton.querySelector(".pm"), next ? "−" : "+");
        return;
      }

      const arrow = event.target.closest?.(".fmt-nav .sarrow");
      if (arrow) {
        const arrows = [...arrow.parentElement.querySelectorAll(".sarrow")];
        const direction = arrows.indexOf(arrow) === 0 ? -1 : 1;
        document.querySelector(".fmt-grid")?.scrollBy({
          left: direction * Math.min(window.innerWidth * 0.82, 620),
          behavior: "smooth",
        });
        return;
      }

      const reviewArrow = event.target.closest?.(".dm-nav .sarrow");
      if (reviewArrow) {
        const arrows = [...reviewArrow.parentElement.querySelectorAll(".sarrow")];
        const direction = arrows.indexOf(reviewArrow) === 0 ? -1 : 1;
        document.querySelector(".dm-grid")?.scrollBy({
          left: direction * Math.min(window.innerWidth * 0.82, 620),
          behavior: "smooth",
        });
      }
    });
  }

  function startBranding() {
    if (brandingStarted) return;
    brandingStarted = true;
    ensureBrandTheme();
    updateMetadata();
    updateSubtree(document);
    setupInteractions();
    document.addEventListener(
      "click",
      (event) => {
        const anchor = event.target.closest?.("a.tbtn");
        const tier = anchor?.closest(".tier");
        const key = tier && getOfferKey(tier);
        if (!key) return;
        event.preventDefault();
        window.location.assign(stripeOffers[key].href);
      },
      true,
    );
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startBranding, { once: true });
  } else {
    startBranding();
  }
})();
