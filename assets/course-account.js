const $ = (selector) => document.querySelector(selector);
const gate = $("#auth-gate");
const app = $("#course-app");
const form = $("#auth-form");
const emailInput = $("#auth-email");
const message = $("#auth-message");
const submit = $("#auth-submit");
const accountButton = $("#account-button");
const nav = $("#course-nav");
const courseHome = $("#course-home");
const lessonView = $("#lesson-view");
const moduleGrid = $("#module-grid");
const modulesButton = $("#modules-button");
const completeButton = $("#complete-button");
const nextButton = $("#next-button");
const isModulePreview = new URLSearchParams(window.location.search).get("preview") === "modulos";

const MODULE_PREVIEW_COURSE = {
  title: "Tu primer anuncio con IA",
  subtitle: "Una ruta práctica para pasar de una oferta a un anuncio vertical listo para probar.",
  version: "Vista previa del curso",
  modules: [
    {
      id: "inicio",
      number: "01",
      title: "Define el anuncio que vas a producir",
      lessons: [{ slug: "preview-01", summary: "Producto, comprador, problema, resultado, prueba y llamada a la acción.", objective: "Brief de una página" }],
    },
    {
      id: "angulo",
      number: "02",
      title: "Elige un ángulo que pueda vender",
      lessons: [{ slug: "preview-02", summary: "Dolor, deseo y mecanismo: crea tres opciones y selecciona la más clara, urgente y demostrable.", objective: "3 ángulos comparados" }],
    },
    {
      id: "guion",
      number: "03",
      title: "Escribe el guion escena por escena",
      lessons: [{ slug: "preview-03", summary: "Gancho, tensión, mecanismo, prueba y acción divididos en planos de hasta cinco segundos.", objective: "Guion listo para producir" }],
    },
    {
      id: "produccion",
      number: "04",
      title: "Genera escenas sin desperdiciar saldo",
      lessons: [{ slug: "preview-04", summary: "Instrucciones visuales, referencias y continuidad para validar primero y producir después.", objective: "Clips del primer anuncio" }],
    },
    {
      id: "montaje",
      number: "05",
      title: "Monta, exporta y prepara variaciones",
      lessons: [{ slug: "preview-05", summary: "Ritmo, subtítulos, voz, formato 9:16 y dos ganchos distintos para probar.", objective: "Anuncio terminado" }],
    },
    {
      id: "biblioteca",
      number: "06",
      title: "Desmonta anuncios de referencia",
      lessons: [{ slug: "preview-06", summary: "Analiza ejemplos y separa la lógica comercial del estilo para adaptar la estructura a tu oferta.", objective: "Criterio para seguir creando" }],
    },
  ],
};

let supabase = null;
let session = null;
let course = null;
let lessons = [];
let completed = new Set();
let currentIndex = 0;
let accessRequest = 0;

function setMessage(copy, tone = "neutral") {
  message.textContent = copy;
  message.dataset.tone = tone;
}

function showGate(copy = "El acceso se activa automáticamente después de una compra confirmada.", tone = "neutral") {
  app.hidden = true;
  gate.hidden = false;
  accountButton.hidden = true;
  setMessage(copy, tone);
}

function flattenLessons(catalog) {
  return catalog.modules.flatMap((module) => module.lessons.map((lesson) => ({
    ...lesson,
    moduleId: module.id,
    moduleNumber: module.number,
    moduleTitle: module.title,
  })));
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function moduleLessonIndexes(module) {
  return module.lessons
    .map((lesson) => lessons.findIndex((item) => item.slug === lesson.slug))
    .filter((index) => index >= 0);
}

function renderModules() {
  moduleGrid.replaceChildren();
  const coverMarks = {
    inicio: "◎",
    angulo: "↗",
    guion: "✎",
    produccion: "✦",
    montaje: "▦",
    biblioteca: "◫",
  };

  course.modules.forEach((module) => {
    const indexes = moduleLessonIndexes(module);
    const completeCount = module.lessons.filter((lesson) => completed.has(lesson.slug)).length;
    const percent = module.lessons.length ? Math.round((completeCount / module.lessons.length) * 100) : 0;
    const firstLesson = module.lessons[0];
    const card = createElement("a", "module-card");
    card.href = `#${module.id}`;
    card.setAttribute("aria-label", `Abrir módulo ${module.number}: ${module.title}`);
    if (isModulePreview) card.setAttribute("aria-disabled", "true");

    const cover = createElement("div", `module-cover module-cover--${module.id}`);
    cover.append(
      createElement("span", "module-cover-number", `MÓDULO ${module.number}`),
      createElement("span", "module-cover-mark", coverMarks[module.id] || "✦"),
      createElement("h2", "module-cover-title", module.title),
    );

    const body = createElement("div", "module-card-body");
    body.append(
      createElement("h2", "", module.title),
      createElement("p", "module-description", firstLesson?.summary || "Abre el módulo para continuar tu ruta."),
      createElement("p", "module-result", firstLesson ? `Resultado: ${firstLesson.objective}` : "Resultado práctico al completar el módulo."),
    );

    const progress = createElement("div", "module-card-progress");
    const progressCopy = createElement("div", "module-progress-copy");
    progressCopy.append(
      createElement("span", "", completeCount ? `${completeCount} de ${module.lessons.length} completadas` : "Sin empezar"),
      createElement("span", "", `${percent}%`),
    );
    const progressTrack = createElement("div", "module-progress-track");
    const progressFill = createElement("div", "module-progress-fill");
    progressFill.style.width = `${percent}%`;
    progressTrack.append(progressFill);
    const open = createElement("div", "module-open");
    const openCopy = isModulePreview ? "Disponible al entrar" : (percent === 100 ? "Repasar módulo" : "Abrir módulo");
    open.append(createElement("span", "", openCopy), createElement("span", "", isModulePreview ? "🔒" : "→"));
    progress.append(progressCopy, progressTrack, open);
    body.append(progress);
    card.append(cover, body);
    card.addEventListener("click", (event) => {
      event.preventDefault();
      if (isModulePreview) return;
      selectLesson(indexes[0] ?? 0, true);
    });
    moduleGrid.append(card);
  });
}

function showCourseHome({ scroll = true } = {}) {
  lessonView.hidden = true;
  courseHome.hidden = false;
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function showLessonView() {
  courseHome.hidden = true;
  lessonView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderNavigation() {
  nav.replaceChildren();
  course.modules.forEach((module) => {
    const wrapper = createElement("section", "module");
    wrapper.append(createElement("p", "module-label", `${module.number} · ${module.title}`));

    module.lessons.forEach((lesson) => {
      const index = lessons.findIndex((item) => item.slug === lesson.slug);
      const button = createElement("button", "lesson-nav");
      button.type = "button";
      button.dataset.index = String(index);
      button.dataset.complete = String(completed.has(lesson.slug));
      button.setAttribute("aria-current", String(index === currentIndex));

      const check = createElement("span", "nav-check", completed.has(lesson.slug) ? "✓" : String(index + 1));
      check.setAttribute("aria-hidden", "true");
      button.append(check, createElement("span", "nav-title", lesson.title));
      button.addEventListener("click", () => selectLesson(index));
      wrapper.append(button);
    });
    nav.append(wrapper);
  });
}

function renderProgress() {
  const total = lessons.length;
  const count = completed.size;
  const percent = total ? Math.round((count / total) * 100) : 0;
  $("#progress-fill").style.width = `${percent}%`;
  $("#progress-label").textContent = `${count} de ${total} completadas`;
  $("#progress-percent").textContent = `${percent}%`;
  $("#home-progress-fill").style.width = `${percent}%`;
  $("#home-progress-label").textContent = `${count} de ${total} completadas`;
  $("#home-progress-percent").textContent = `${percent}%`;
  renderModules();
}

function renderLesson() {
  const lesson = lessons[currentIndex];
  if (!lesson) return;

  $("#lesson-module").textContent = `Módulo ${lesson.moduleNumber}`;
  $("#lesson-format").textContent = lesson.format;
  $("#lesson-duration").textContent = lesson.duration;
  $("#lesson-title").textContent = lesson.title;
  $("#lesson-summary").textContent = lesson.summary;
  $("#lesson-objective").textContent = `Resultado de esta lección: ${lesson.objective}`;

  const sections = $("#lesson-sections");
  sections.replaceChildren();
  lesson.sections.forEach((section) => {
    const wrapper = createElement("section", "lesson-section");
    wrapper.append(createElement("h2", "", section.heading), createElement("p", "", section.body));
    sections.append(wrapper);
  });

  const checklist = $("#lesson-checklist");
  checklist.replaceChildren(...lesson.checklist.map((item) => createElement("li", "", item)));

  const videoSection = $("#video-section");
  const videoGrid = $("#video-grid");
  videoGrid.replaceChildren();
  if (lesson.videos?.length) {
    videoSection.hidden = false;
    lesson.videos.forEach((item) => {
      const card = createElement("article", "video-card");
      const video = document.createElement("video");
      video.src = item.src;
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      card.append(video, createElement("div", "video-title", item.title));
      videoGrid.append(card);
    });
  } else {
    videoSection.hidden = true;
  }

  const action = $("#lesson-action");
  if (lesson.action) {
    action.hidden = false;
    action.href = lesson.action.href;
    action.textContent = `${lesson.action.label} →`;
  } else {
    action.hidden = true;
    action.removeAttribute("href");
  }

  const isComplete = completed.has(lesson.slug);
  completeButton.dataset.complete = String(isComplete);
  completeButton.textContent = isComplete ? "Completada ✓" : "Marcar como completada ✓";
  nextButton.hidden = currentIndex === lessons.length - 1;
  document.querySelectorAll(".lesson-nav").forEach((button) => {
    button.setAttribute("aria-current", String(Number(button.dataset.index) === currentIndex));
  });
}

function selectLesson(index, openView = true) {
  currentIndex = Math.max(0, Math.min(index, lessons.length - 1));
  renderLesson();
  if (openView) showLessonView();
}

async function loadProgress() {
  const { data, error } = await supabase
    .from("course_progress")
    .select("lesson_slug")
    .eq("user_id", session.user.id);
  if (error) throw error;
  completed = new Set((data || []).map((row) => row.lesson_slug).filter((slug) => lessons.some((item) => item.slug === slug)));
}

async function openCourse(nextSession) {
  const requestId = ++accessRequest;
  session = nextSession;
  if (!session) {
    showGate();
    return;
  }

  setMessage("Comprobando tu compra…");
  try {
    const response = await fetch("/api/course", {
      headers: { authorization: `Bearer ${session.access_token}`, accept: "application/json" },
    });
    const data = await response.json();
    if (requestId !== accessRequest) return;
    if (!response.ok) {
      showGate(data.error || "No pudimos abrir tu curso.", "error");
      accountButton.hidden = false;
      accountButton.textContent = "Cerrar sesión";
      return;
    }

    course = data.course;
    lessons = flattenLessons(course);
    await loadProgress();
    if (requestId !== accessRequest) return;

    $("#course-version").textContent = course.version;
    $("#course-name").textContent = course.title;
    $("#course-subtitle").textContent = course.subtitle;
    $("#home-version").textContent = course.version;
    $("#home-course-name").textContent = course.title;
    $("#home-course-subtitle").textContent = course.subtitle;
    currentIndex = Math.max(0, lessons.findIndex((lesson) => !completed.has(lesson.slug)));
    renderNavigation();
    renderProgress();
    renderLesson();
    showCourseHome({ scroll: false });
    gate.hidden = true;
    app.hidden = false;
    accountButton.hidden = false;
    accountButton.title = session.user.email || "Cerrar sesión";
  } catch (error) {
    console.error("course_boot_failed", error?.message || error);
    showGate("No pudimos comprobar el acceso. Recarga la página o inténtalo de nuevo.", "error");
  }
}

async function boot() {
  if (isModulePreview) {
    course = MODULE_PREVIEW_COURSE;
    lessons = flattenLessons(course);
    completed = new Set();
    $("#home-version").textContent = course.version;
    $("#home-course-name").textContent = course.title;
    $("#home-course-subtitle").textContent = course.subtitle;
    renderProgress();
    gate.hidden = true;
    app.hidden = false;
    accountButton.hidden = true;
    showCourseHome({ scroll: false });
    return;
  }

  if (window.location.protocol === "file:") {
    showGate("El curso protegido funciona en la versión publicada del sitio.");
    return;
  }

  try {
    const response = await fetch("/api/public-config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok || !config.enabled) throw new Error("El acceso todavía no está configurado.");
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm");
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { detectSessionInUrl: true, persistSession: true, flowType: "pkce" },
    });
    const { data: { session: initialSession }, error } = await supabase.auth.getSession();
    if (error) throw error;
    await openCourse(initialSession);
    supabase.auth.onAuthStateChange((_event, nextSession) => window.setTimeout(() => openCourse(nextSession), 0));
  } catch (error) {
    console.error("course_config_failed", error?.message || error);
    showGate("El acceso automático no está disponible en este momento.", "error");
    emailInput.disabled = true;
    submit.disabled = true;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const email = emailInput.value.trim().toLowerCase();
  if (!email) return;
  submit.disabled = true;
  setMessage("Enviando tu enlace seguro…");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/curso/` },
  });
  submit.disabled = false;
  setMessage(
    error ? "No encontramos una compra con ese correo. Usa exactamente el correo de Stripe." : "Listo. Revisa tu correo y abre el enlace para entrar.",
    error ? "error" : "success",
  );
});

completeButton.addEventListener("click", async () => {
  const lesson = lessons[currentIndex];
  if (!supabase || !session || !lesson) return;
  completeButton.disabled = true;
  const isComplete = completed.has(lesson.slug);
  const request = isComplete
    ? supabase.from("course_progress").delete().eq("user_id", session.user.id).eq("lesson_slug", lesson.slug)
    : supabase.from("course_progress").insert({ user_id: session.user.id, lesson_slug: lesson.slug });
  const { error } = await request;
  completeButton.disabled = false;
  if (error) {
    console.error("progress_update_failed", error.message);
    completeButton.textContent = "No se pudo guardar. Intenta otra vez.";
    return;
  }
  if (isComplete) completed.delete(lesson.slug);
  else completed.add(lesson.slug);
  renderNavigation();
  renderProgress();
  renderLesson();
});

nextButton.addEventListener("click", () => selectLesson(currentIndex + 1));
modulesButton.addEventListener("click", () => showCourseHome());
accountButton.addEventListener("click", async () => {
  if (!supabase) return;
  accountButton.disabled = true;
  await supabase.auth.signOut();
  accountButton.disabled = false;
});

boot();
