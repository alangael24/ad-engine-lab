# Estudio de marcas, escenas y versiones

El estudio vive en `/estudio/`. Usa la sesión y el saldo existentes. Guarda el contexto de cada marca, una línea de escenas asociada a la narración y las versiones de cada toma. La generación de clips respeta el interruptor de disponibilidad del proveedor existente.

## Comportamiento

- La marca conserva producto, apariencia, beneficios, afirmaciones permitidas, restricciones, una fotografía y una muestra de voz con indicaciones. Cada anuncio recibe una copia del contexto. Editar la marca no modifica anuncios previos; «Actualizar contexto de marca» es explícito.
- El usuario sube la narración completa y prepara escenas a partir del guion. La distribución inicial de tiempos es aproximada: debe escuchar y confirmar los cortes. Cada escena conserva ID, frase, intervalo, dirección visual, imagen y versión elegida. Los tiempos deben ser contiguos, sin solapamientos.
- Generar una toma reserva únicamente su coste (1/2/3 créditos para hasta 5/10/15 segundos). El prompt conserva contexto de marca, frase actual, escenas vecinas y corrección solicitada. Reintentar la misma solicitud no genera otro cargo. Las versiones previas permanecen disponibles.
- También se pueden importar clips MP4. Elegir otra versión conserva narración y otras escenas; si el anuncio está completo y hay un worker de montaje conectado, crea un montaje nuevo. El anterior no se sobrescribe.
- El render captura un manifiesto inmutable. FFmpeg monta las tomas a 24 fps, incorpora la narración continua, normaliza audio y añade subtítulos por escena. Comprueba duración, dimensiones y decodificación antes de subir el MP4 privado.

## Límites de esta primera versión

Incluye análisis revisado de un video subido desde el estudio mediante Flash Vision y transcripción. El enlace de referencia se conserva, pero no se descarga automáticamente. No incluye generación de guion o imágenes desde el estudio, ni síntesis/clonación de voz conectada. Guardar la muestra de voz no genera narraciones nuevas. Los subtítulos son por frase de escena, sin alineación automática de palabras. La generación de clips continúa pausada hasta activar el proveedor y su worker.

Hasta 24 escenas, 120 segundos por anuncio y 15 segundos por escena. Subidas máximas: imagen 6 MB, audio 20 MB, clip 50 MB. Biblioteca por cuenta: 200 archivos y 500 MB. Las exportaciones tienen un límite de 50 MB. Estos topes requieren una política de retención y facturación antes de escalar el servicio.

## Infraestructura y privacidad

Migración: `supabase/migrations/20260904230633_brand_storyboard_versions.sql`.

Las seis tablas tienen RLS. Las operaciones de escritura pasan por API autenticada y RPC reservadas al rol de servicio. No se confía en identificadores de usuario enviados por el navegador. Los objetos de `studio-media` son privados; las lecturas utilizan enlaces firmados de 15 minutos. Los tokens de worker, leases y rutas internas no se exponen al cliente.

Rutas: `/api/studio` y `/api/studio-worker`. El worker CPU utiliza `STUDIO_WORKER_TOKEN`, separado del token de generación. La API valida propiedad, revisiones y solicitudes repetidas. La cola usa leases con vencimiento; una finalización atrasada no puede sustituir una edición nueva.

## Worker de montaje

Requiere Node con `fetch`, `ffmpeg` y `ffprobe` en PATH, incluyendo el filtro `subtitles` de FFmpeg. Variables de entorno:

```text
CREATIVE_RUSH_URL=https://creativerushai.com
STUDIO_WORKER_ID=identificador-del-worker
STUDIO_WORKER_TOKEN=<secreto aleatorio de al menos 32 caracteres>
```

El mismo token debe estar configurado en Cloudflare Pages. Cargarlo desde un archivo protegido o gestor de secretos; nunca incluirlo en Git, argumentos de línea de comandos o capturas. Iniciar con `node workers/studio-worker.mjs`. SIGTERM/SIGINT deja de tomar trabajos al terminar el actual. No requiere GPU.

La instalación inicial corre en la Mac de Alan y depende de que la computadora y el proceso estén disponibles. La interfaz deshabilita montajes nuevos cuando no hay un heartbeat reciente. Para ofrecer disponibilidad continua hay que mover este proceso a un servidor CPU persistente y supervisado; esta entrega no contrata infraestructura adicional.

## Validación

`node --test tests/*.test.mjs`: 49 pruebas aprobadas. Incluyen separación entre cuentas, RLS, concurrencia, cobros idempotentes, selección de versiones, manifiestos inmutables, leases y compatibilidad con la cola anterior. Auth y Storage se simulan en estas pruebas; PostgreSQL corre con PGlite.

`tests/studio-preview.mjs` es una fixture exclusiva de localhost y exige `STUDIO_FIXTURE_ROOT`. Usa archivos privados de Nebula y no debe publicarse. La prueba de interfaz produjo un MP4 real de 37.75 segundos con once tomas mediante FFmpeg y comprobó cambio/restauración de una escena con conservación del montaje anterior. No ejecutó otra inferencia GPU ni probó un cobro real.

El despliegue inicial conserva el backend y los archivos de autenticación que ya estaban publicados, e incorpora las dos rutas nuevas mediante un wrapper. El `dist/` general contiene trabajo previo de OAuth que aún no debe publicarse incidentalmente.

## Análisis de referencia revisado

Dentro de cada anuncio, «Analizar referencia» acepta video local de 2–120 s y hasta 200 MB. El navegador extrae 8–24 fotogramas (con IDs y tiempos) y audio mono WAV a 16 kHz. Envía hasta cuatro hojas JPEG y el audio; el archivo de video original se queda en el navegador. Se muestra una vista previa local. Si el video solo tiene música/texto, el usuario puede indicar que no tiene narración; esta limitación queda registrada.

La API autenticada `/api/reference-analysis` usa ElevenLabs `scribe_v1` para transcribir y `deepseek-v4-flash-vision-exp` mediante OpenCode Go para analizar. Claves exclusivamente en Cloudflare: `REFERENCE_FLASH_KEY`, `REFERENCE_SCRIBE_KEY`, `REFERENCE_ANALYSIS_ENABLED=true`. No confundir esta variante con Flash solo texto. El proveedor no recibe la ficha de nuestra marca en este paso.

El resultado es un borrador: oferta, hook, estilo, personajes, bloques visuales, CTA de origen, afirmaciones atribuidas al anuncio e incertidumbres. El servidor exige todos los IDs en orden, sin omisiones o repeticiones, e incorpora los tiempos extraídos. Esos momentos muestreados NO se convierten en los cortes del anuncio. Se rechazan resultados truncados, modelo distinto o una estructura inválida. Se toleran cercas Markdown y una breve introducción, conservando la validación semántica.

«Usar dirección revisada» exige una revisión explícita en interfaz y guarda solo el texto de dirección visual que eligió el usuario. Mantiene guion, tiempos, tomas, versiones y afirmaciones aprobadas de marca. Una revisión de proyecto desactualizada no puede sobrescribir cambios de otra pestaña. La dirección sugerida no copia la lista de personajes ni las promesas de la referencia.

La solicitud queda registrada antes de llamar a proveedores; el ID y un hash de entrada permiten recuperar un resultado sin repetir las llamadas. Se guarda la transcripción antes de solicitar el análisis. En errores o respuestas ambiguas no hay reenvío automático; el usuario puede recuperar el estado o iniciar explícitamente otra solicitud. Si Cloudflare interrumpe una petición antes de guardar la respuesta, pasados cuatro minutos aparece como incierta: no se garantiza recuperar un resultado que el proveedor no confirmó. No se prometen cargos idempotentes internos del proveedor.

Primera versión: 5 solicitudes por cuenta en 24 h, una activa a la vez, límite global de 100 solicitudes en 24 h. Cuenta intentos; no descuenta créditos de clips ni imágenes. No hay worker GPU ni nuevo servidor. La ejecución espera la respuesta HTTP del análisis; al cerrar la pestaña antes de terminar puede quedar incierta y requiere recuperación. La tabla `studio_reference_analyses` usa RLS y no permite lectura/escritura directa desde el navegador; las mutaciones se reservan al servidor.

Migración local: `20260905015812_studio_reference_analysis.sql`. Se comprueba con pruebas de API/PostgreSQL para propiedad, cuotas, reintentos, truncamiento, orden de frames, conservación de contexto y cabeceras WAV binarias. `tests/reference-preview.mjs` es una fixture exclusivamente local con Auth/DB aislados; puede usar proveedores reales mediante variables de entorno, nunca se despliega.

Documentación comprobada: [API y RLS de Supabase](https://supabase.com/docs/guides/api/securing-your-api), [transcripción de ElevenLabs](https://elevenlabs.io/docs/api-reference/speech-to-text/convert), [límites de Workers](https://developers.cloudflare.com/workers/platform/limits/).

## Marca desde una tienda (2026-09-04)

El alta de marca empieza por un enlace HTTPS de tienda o producto. `/api/store-import` requiere sesión y extrae JSON-LD, metadatos de producto y enlaces del mismo origen. En tiendas Shopify sin productos estructurados consulta el catálogo público (hasta 12 artículos). La persona elige el producto y puede editar la ficha; las opciones adicionales quedan plegadas. No se exige aprobar individualmente las afirmaciones de la tienda. El texto se copia de la fuente, sin un modelo generativo; `sourceUrl` y `sourceText` conservan su procedencia en la marca y en las instantáneas de anuncios. Los campos visibles están limitados a la longitud editorial existente.

La configuración y muestra de voz se retiraron de la interfaz de marca y del contexto mostrado. Los valores antiguos se conservan por compatibilidad, pero no son parte del alta. La narración de cada anuncio sigue disponible.

Las fotos detectadas se seleccionan en la ficha y se guardan en el almacenamiento privado al guardar la marca. Los permisos de importación de fotos están firmados, ligados al usuario y a la URL exacta, caducan en 30 minutos y usan un ID de archivo estable para recuperar una respuesta perdida. No se cargan claves ni cookies a la tienda. Se validan HTTPS, nombres públicos, respuestas DNS, redirecciones, tamaño, formato y tiempo de respuesta. La red pública de Workers es parte de la frontera de seguridad: no conectar este lector a bindings VPC ni portarlo a una red privada sin revisar el transporte. Referencia: https://blog.cloudflare.com/workers-environment-live-object-bindings/

No requiere modelos de pago, cambios de esquema, nuevos servicios ni GPU. Las tiendas que dependen de JavaScript, bloquean lectores o carecen de datos de producto pueden necesitar un enlace directo o la alternativa manual. La importación no determina por sí sola la veracidad de los mensajes del comercio ni crea afirmaciones adicionales.

## Entrada creativa limpia

El estudio inicia con un cuadro de idea, un selector de producto, un adjunto de video y un selector de dirección. La biblioteca se abre desde «Mis anuncios». Los formatos «Esqueleto» y «Explicación visual» se pueden combinar con 3D o plastilina. Las recetas están en `assets/creative-formats.js`, adaptadas de las tres skills; las reglas de toma se incorporan a `scenePrompt` y la idea y configuración se guardan en los datos del proyecto. Son direcciones de producción; el selector no ejecuta automáticamente todas las etapas de las skills ni genera un personaje de referencia por sí solo.

La creación conserva un identificador al recuperar una respuesta ambigua. Si cambia la idea o su configuración, usa una nueva solicitud. El video adjunto se entrega al panel de referencias del proyecto recién creado; se analiza con la acción existente. Los archivos pendientes se mantienen en memoria durante la navegación y se advierte al cerrar con un borrador; no se guardan antes de crear el anuncio.

Dentro del anuncio, Idea, Guion, Escenas y Video muestran un paso a la vez. La generación automática de guiones y la edición mediante chat libre no se incorporaron en esta publicación. El guion/narración y las escenas usan las herramientas existentes; los servicios de clips y montaje mantienen su disponibilidad real. No se generan voces ni música de los creadores nombrados por las skills.

## Edición por chat con Flash (2026-09-05)

`/api/studio-chat` conecta Flash V4 Vision experimental mediante OpenCode con una herramienta tipada; esta integración no usa Codex app-server. El modelo recibe la ficha, idea, receta de formato, guion, escenas, versiones e historial reciente, con la dirección revisada de referencia. No recibe los clips originales ni vuelve a analizarlos visualmente en cada turno.

Permite pedir un borrador de guion en proyectos sin escenas, cambiar el hook o dirección de una escena, cambiar acabado, quitar/mover escenas, elegir una versión existente, deshacer el último cambio del chat y solicitar montaje. Solo una operación por turno; las dudas se responden con una aclaración. Cambiar el hook desconecta la narración anterior y la toma inicial; cambiar dirección/acabado deselecciona las tomas afectadas. No presenta medios anteriores como si se hubieran regenerado. Las imágenes, TTS y nuevas generaciones de clips no se ejecutan desde el chat.

Quitar/mover escenas conserva sus tomas y registra `narrationStart`: el worker corta los tramos de la narración original, los reordena y ajusta subtítulos al nuevo tiempo. Tolera la misma cola final de silencio de hasta 0.75 s del montaje previo. Requiere tiempos revisados y tomas listas; entonces crea un render inmutable automáticamente. Si el worker está desconectado o faltan medios, guarda la edición e informa del pendiente. Deshacer restaura la instantánea previa; si hubo cambios manuales posteriores, rechaza un deshacer que pudiera sobrescribirlos. No ofrece una pila de deshacer de múltiples niveles.

La migración `20260905045330_studio_chat_edits.sql` añade historial exclusivo del servidor y amplía el manifiesto de audio. Auth y propiedad se verifican antes del proveedor. Las revisiones se comprueban otra vez al aplicar y el cambio/historial/solicitud de render se guardan en una transacción. Cada solicitud tiene ID persistente en la sesión del navegador; las respuestas repetidas recuperan la operación sin ejecutarla de nuevo. El servidor rechaza respuestas truncadas, otro modelo o más de una herramienta. Límite inicial: 30 instrucciones por cuenta en 24 h, una en curso y 300 globales. Pasados tres minutos un resultado pendiente queda incierto y no puede aplicarse tarde. No hay reintentos automáticos del proveedor ni garantía de cargos idempotentes de ese proveedor.

Validación: 77 pruebas automatizadas. Prueba de navegador con API real de Flash, Auth/Storage/Postgres locales aislados y once clips reales de Nebula: quitó la tercera escena, creó MP4 1080×1920 de 32.541667 s y deshizo el cambio restaurando exactamente el proyecto y creando otro MP4 de 37.75 s. Correlación de voz después del corte con el tramo esperado del original: 0.99998 sin desplazamiento. Sin errores JavaScript ni desbordamiento a 390 px. La ejecución autenticada completa se probó localmente; en producción se verifica la publicación, la protección del endpoint, los permisos de DB y el heartbeat del worker. El worker CPU continúa en la Mac; la disponibilidad permanente en servidor sigue pendiente.


## Production director (2026-09-05)

The chat `produce` operation atomically starts a snapshot production. `workers/production-worker.mjs` checkpoints direction, narration, actual timestamp alignment, contextual images, clip versions and final assembly. `studio_production_work` fences leases and project revisions; ambiguous external operations stop instead of being billed again. The panel displays progress and the final render.

Run the worker with CREATIVE_RUSH_URL, PRODUCTION_WORKER_TOKEN, PRODUCTION_WORKER_ID, REFERENCE_FLASH_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY and PRODUCTION_VOICE_ID. Server-side PRODUCTION_ENABLED and the existing GENERATION_ENABLED flags must be deliberately configured only after provider and billing validation. No such activation was performed in this release. Existing render and H3 queues remain separate workers.

Validated with `node --test tests/*.test.mjs` (86 passing) and a real Flash director plus existing Nebula images/audio/clips in `tests/production-preview.mjs`. The fixture produced an eleven-scene 37.375-second MP4 from one chat approval. It uses cached Scribe timestamps and a described material catalog. New OpenAI image and ElevenLabs speech adapters have not been live-tested. This is not a claim that unrestricted new-media customer production is ready. Deployment: 4429495d.ad-engine-lab.pages.dev.


## Conversation interface (2026-09-05)

The project opens on a single conversation with the current script, production progress, playable render and download action. Reference upload opens from the chat toolbar. Scene, timing and manual assembly controls are available only through the collapsed “Detalles del anuncio” section. This interface change does not enable new-media providers. Locally verified opening/closing optional details, reference dialog and playback of the saved Nebula result without provider calls.
