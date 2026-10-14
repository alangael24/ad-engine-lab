# Worker de /edicion (Render)

Toma pedidos pagados de `edicion_orders`, edita con Claude Opus (`claude -p`) y entrega el MP4.
Código: `workers/edicion-worker.mjs`, helpers del agente en `workers/edicion/bin/`, imagen en `workers/edicion/Dockerfile`.

## Cómo funciona un pedido
1. `claim` en `/api/edicion-worker` (solo si `EDICION_ENABLED=true` en Pages).
2. Descarga el video del cliente y la referencia (archivo, o enlace con yt-dlp; si el enlace falla,
   el agente trabaja con la descripción del cliente).
3. Corre `claude -p` con Opus en `EDICION_WORKDIR/<pedido>` con tope de gasto y de tiempo por plan
   (`PLAN_LIMITS`: básico $4/35 min, pro $8/45 min, premium $12/60 min). Al vencer el tiempo se mata
   todo el grupo de procesos del agente.
4. Valida `video_final.mp4` (1080x1920, con audio, duración coherente, ≤ 50 MB; si pesa más, re-codifica).
5. Sube con URL firmada y marca `delivered`. Si algo falla, marca `failed` para revisión humana.
6. Heartbeat cada 60 s (lease de 10 min). Borra carpetas de pedidos con más de `EDICION_KEEP_DAYS` días.

## Transcripción
- En Mac el proxy transcribe con Whisper local (`workers/edicion/transcribir_local.py`, mlx-whisper large-v3-turbo):
  gratis, ~20 s por video de 1 min. Requiere `pip3 install --user mlx-whisper` y el modelo en la caché de Hugging Face
  (se descarga una vez sin `HF_HUB_OFFLINE`). El arranque verifica que `mlx_whisper` se pueda importar.
- En servidor (Linux) usa ElevenLabs Scribe. El agente usa el mismo comando `transcribir` en ambos casos.

## Seguridad
- El agente solo recibe `ANTHROPIC_API_KEY`. OpenAI, ElevenLabs, el token del worker y Supabase se quedan
  en el proceso principal; el agente pide imágenes y transcripciones a un proxy local en 127.0.0.1 con
  secreto por pedido (`generar_imagen`, `transcribir`). El proxy limita imágenes según el plan.
- Las instrucciones del cliente van delimitadas en el prompt como preferencias, no como órdenes.
- Corre como usuario sin privilegios, un pedido a la vez, con `--strict-mcp-config`.
- Limitación conocida: el agente ejecuta código con acceso de red y puede leer `ANTHROPIC_API_KEY`.
  Mitigación recomendada: una llave de Anthropic dedicada a este worker con límite de gasto mensual
  en la consola. Siguiente paso: aislar cada pedido en un contenedor sin red (como `workers/video-use`).

## Variables de entorno (Render)
| Variable | Valor |
|---|---|
| `CREATIVE_RUSH_URL` | `https://creativerushai.com` |
| `EDICION_WORKER_TOKEN` | Igual que en Cloudflare Pages (≥ 32 caracteres) |
| `EDICION_WORKER_ID` | `edicion-render-1` |
| `ANTHROPIC_API_KEY` | Llave dedicada, con límite de gasto |
| `OPENAI_API_KEY` | Para imágenes (planes pro/premium) |
| `ELEVENLABS_API_KEY` | Transcripción (Scribe) en servidor. No hace falta en Mac |
| `EDICION_TRANSCRIBIR` | Opcional: `local` (Whisper en el chip de la Mac, por defecto en macOS) o `scribe` (por defecto en Linux) |
| `EDICION_IMAGE_MODEL` / `EDICION_IMAGE_QUALITY` | Opcional; por defecto `gpt-image-1.5` / `medium` (verificar nombre y precio vigentes) |
| `EDICION_KEEP_DAYS` | Opcional, por defecto 7 |

En Cloudflare Pages: `EDICION_ENABLED=true`, `EDICION_WORKER_TOKEN`, `STRIPE_SECRET_KEY`.

## Despliegue
1. Aplicar `supabase/migrations/20261014030000_edicion_orders.sql`.
2. Render → New → Background Worker → Docker, Dockerfile `workers/edicion/Dockerfile`, contexto la raíz del repo.
3. Instancia con al menos 4 GB de RAM y 2 CPU: el render de 1080x1920 en Python es pesado (en Standard de 2 GB
   probablemente falle o tarde demasiado). Verificar precios vigentes de Render.
4. Cargar las variables, desplegar y revisar logs: debe pasar las comprobaciones de arranque y quedar en espera.
5. Hacer un pedido real de prueba y revisar `entrega.json` (costo, imágenes, duración) en la carpeta del pedido.

## Cambios del cliente ("Pedir cambios")
- En "Tus videos", cada video entregado muestra **Pedir cambios** mientras le queden rondas (básico 2, pro 3, premium 5;
  `EDICION_PLANS[*].revisions` y `edicion_revision_max` deben coincidir, lo verifica un test).
- `POST /api/edicion {action:'revision', orderId, revisionId, request}` crea la ronda (idempotente por `revisionId`,
  una a la vez por video). Migración: `20261014040000_edicion_revisions.sql`.
- El worker, cuando no hay pedidos nuevos, toma rondas (`kind:'revision'`): Haiku (`EDICION_REVISION_MODEL`, tope $1/20 min)
  edita la receta y el script guardados en la carpeta del pedido y genera `video_final_vN.mp4`; si no sale un video válido,
  reintenta con Opus ($3/30 min). Si la carpeta ya no existe, Opus rehace el video incluyendo el cambio.
- La descarga siempre entrega la última versión. Un cambio que falla no consume la ronda.
- No depende del disco del worker: al entregar cada versión, el worker sube su **proyecto** (receta, script e imágenes,
  sin los videos del cliente) al bucket privado `edicion-proyectos` (`<usuario>/<pedido>/proyecto_vN.tar.gz`).
  Un cambio en cualquier servidor (Render tras un deploy, otra instancia, tu Mac) descarga ese proyecto y el material,
  y Haiku aplica el cambio. Solo si el proyecto no existe, Opus rehace el video con el cambio incluido (~$2).
- El proyecto se sube antes de cerrar el lease; si su subida falla, la entrega sigue igual.
