# CreativeRush: backend de video ads

## Estado de esta entrega

Publicado en **https://creativerushai.com/** el 29 de agosto de 2026 (hora local).
Pages: `f1f61717.ad-engine-lab.pages.dev`, rama de producción `main`.
Incluye la actualización de registro antes del pago. La entrega anterior del
backend fue `c29d7bd3.ad-engine-lab.pages.dev`.
La migración aditiva se aplicó al proyecto Supabase `ozkewphfxaohtihxmgoo`;
su versión remota es `20260830015235_saas_generation_jobs`, equivalente al archivo
local `20260830011058_saas_generation_jobs.sql` (el MCP asignó la versión remota).

**Generación desactivada:** `GENERATION_ENABLED=false` en Pages. No se encendió
una GPU ni se desplegó el sweeper. No se modificaron productos remotos de Stripe
ni se hizo una compra o generación facturable de extremo a extremo.
La landing avisa del estado antes de comprar; videos e imágenes no están activos.

Verificación: 34 pruebas locales pasan, Functions compila y el HTML/JS/CSS del
dominio real coincide con el build. Config pública responde 200; APIs de videos,
referencias y worker rechazan solicitudes sin autenticar. Stripe rechaza eventos
sin firma. Se verificaron RLS, grants, buckets privados y conservación de saldos.
Advisors no reportó errores ni advertencias: solo dos avisos informativos de RLS
sin políticas en tablas exclusivas del servidor (`generation_references` y
`generation_workers`), intencionales para bloquear el acceso directo del cliente.

La vista en el servidor estático de `127.0.0.1:4173` no ejecuta Pages Functions;
por eso muestra «Backend sin conectar». Para el backend real local usa
`pnpm dev` con un proyecto **de pruebas** de Supabase y las variables siguientes.
No apuntes pruebas destructivas a la base de producción.

La generación de imágenes/Nano Banana aún no tiene proveedor conectado. El saldo
de imágenes se conserva, y la herramienta indica esta limitación. Tampoco se ha
añadido un editor automático de anuncios completos: H3 genera escenas/clips.

## Registro antes del pago

La landing ahora dirige «Generar video» a `/cuenta/`. El registro por enlace de
correo permite crear una cuenta sin compra previa y sin regalar saldo. La cuenta
debe confirmar su correo antes de continuar al pago.

1. `/cuenta/` solicita un enlace de Supabase Auth (`shouldCreateUser: true`);
   el modo de inicio de sesión no crea usuarios nuevos.
2. El enlace vuelve a `/herramienta/`. `/api/account` valida al usuario en servidor:
   sin compras ni saldo abre `/planes/`; un comprador previo entra al estudio,
   incluso si ya agotó su saldo.
3. `/planes/` muestra únicamente el pack existente: $999 MXN, pago único, 12 clips
   y 20 imágenes. Advierte antes del botón de pago que la generación está pausada.
4. `/api/checkout` exige sesión y correo confirmado. Devuelve el Payment Link
   existente con `locked_prefilled_email` basado en el usuario verificado; no
   acepta importes, correos ni redirecciones elegidos por el navegador.
5. Solo el webhook firmado concede el saldo. `client_reference_id` no se utiliza
   para autorizar ni para desviar saldo a otra cuenta.

La creación de cuenta y la vista de planes no disparan `InitiateCheckout`; este
evento se envía al continuar explícitamente a Stripe. Localhost sigue excluido.

Verificación del registro: 34 pruebas locales pasan y Functions compila. Se probó
en el navegador el recorrido y los errores con un transporte de autenticación de
prueba, sin correos ni cargos reales. `tests/onboarding-preview.mjs` no se publica.
Las rutas `/cuenta/`, `/planes/` y sus assets en el dominio real coinciden con el
build verificado. `/api/account` y `/api/checkout` rechazan acceso sin sesión.
La configuración pública de Auth permite registro por email y exige confirmación.
**Sigue pendiente verificar SMTP, las URLs permitidas y la llegada del enlace a
un correo real.** No se pudo acceder al panel de Auth durante esta entrega; no se
desactivó la confirmación de correo ni se modificó la configuración del proveedor.

### Google: proveedor activado, publicación y prueba final pendientes

El botón y `signInWithOAuth({ provider: 'google' })` están implementados localmente.
Usan el cliente PKCE existente y el callback `/herramienta/`; después se aplica la
misma validación de cuenta/saldo. No se piden permisos de Gmail, Drive ni acceso
offline a Google. Cancelar OAuth devuelve al registro con un mensaje seguro.
La disponibilidad se consulta en Auth: un proveedor desactivado no se presenta
como funcional ni se abre su página de error. Las 37 pruebas locales pasan.

**Estos cambios de Google aún no se han desplegado.** El 29 de agosto de 2026 se
creó el proyecto Google Cloud `creativerush-507102` (CreativeRush) y el cliente
«CreativeRush Web Production». Con autorización del propietario, se guardaron el
ID y secreto en el proveedor de Supabase del proyecto `ozkewphfxaohtihxmgoo`.
La comprobación del endpoint público de Auth devolvió `external.google: true`
y `external.email: true`. No se incluyó el secreto en el código ni en esta guía.
Las opciones «Skip nonce checks» y «Allow users without an email» siguen apagadas.

Google todavía muestra estado **Prueba**, cero usuarios de prueba y el botón
«Publicar app» deshabilitado por información de marca incompleta. El nombre y
correo autorizado sí están guardados; los campos de página principal, política
de privacidad y condiciones están vacíos. No se encontró una política de
privacidad en el proyecto local. Falta resolver esta información y comprobar
la redirección permitida de Supabase antes del despliegue y una sesión real.
Un proveedor habilitado no demuestra por sí solo que el inicio de sesión público
funcione. No se modificó el proyecto ajeno «Agent Genia».

Configuración requerida, siguiendo la guía oficial:
- Cliente OAuth web de CreativeRush en Google Cloud, sin modificar el proyecto
  ajeno «Agent Genia» seleccionado por defecto ni reutilizar sus credenciales.
- Origen: `https://creativerushai.com`.
- Callback autorizado en Google:
  `https://ozkewphfxaohtihxmgoo.supabase.co/auth/v1/callback`.
- ID y secreto en el proveedor Google de Supabase, únicamente en servidor.
- Redirect permitido en Supabase: `https://creativerushai.com/herramienta/`.
- Validar acceso de usuarios externos (no solo test users), publicar el build y
  probar una sesión real antes de afirmar que está activo.

Referencia: https://supabase.com/docs/guides/auth/social-login/auth-google

## Flujo de producción

1. Stripe confirma el pago con un webhook firmado.
2. `apply_saas_purchase` crea el saldo una sola vez por Checkout Session.
3. La cuenta registrada accede a `/herramienta/`. Las compras previas conservan el curso.
4. El cliente sube una referencia privada opcional y envía un prompt.
5. La API valida al usuario con `auth.getUser`; una transacción reserva saldo y
   crea el trabajo. 5/10/15 segundos cuestan 1/2/3 clips; se muestran antes de enviar.
6. Un worker recoge un trabajo mediante `FOR UPDATE SKIP LOCKED`.
7. El worker utiliza el helper H3 existente, `turbo8`, sin recortar pasos o calidad.
8. Guarda el MP4 en un bucket privado y confirma el trabajo.
9. Solo el dueño recibe enlaces temporales para ver y descargar.

No se usa un servicio de cola adicional: la cola es Postgres. Se pueden ejecutar
varios workers con **IDs diferentes**; cada uno procesa un clip a la vez.

## Archivos

- `supabase/migrations/20260830011058_saas_generation_jobs.sql`: cola, privacidad,
  referencias, contabilidad, leases, cancelaciones y recuperación. También corrige
  el `ON CONFLICT (user_id)` ambiguo de la antigua función de compras sin editar
  la migración histórica.
- `functions/api/generations/`: crear/listar/ver/cancelar trabajos propios.
- `functions/api/references.js`: validar y almacenar referencias.
- `functions/api/worker.js`: API autenticada del worker, sin exponer la clave de Supabase.
- `workers/h3-adapter.mjs`: adaptador al contrato existente `/h3-simple/build` + ComfyUI.
- `workers/h3-worker.mjs`: consumidor en la máquina con H3, o con acceso privado a ella.
- `workers/sweeper.js`: reconciliación independiente de las GPUs.

## Variables de Pages (secret store / `.dev.vars` local ignorado por Git)

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL` | Proyecto de Supabase del entorno |
| `SUPABASE_PUBLISHABLE_KEY` | Clave pública para el login |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor; nunca navegador ni worker GPU |
| `STRIPE_WEBHOOK_SECRET` | Firma del webhook correspondiente al entorno |
| `APP_URL` | Origen público del entorno, sin slash final |
| `GENERATION_ENABLED` | `false` hasta completar verificación; `true` para aceptar trabajos |
| `GENERATION_WORKER_TOKEN` | Secreto aleatorio de al menos 32 caracteres, compartido solo con workers/sweeper |

Los Payment Links existentes siguen mapeados en `src/backend.js`; no se crearon
ni renombraron productos remotos. El enlace de $999 representa el pack SaaS para
compras nuevas; los dos enlaces antiguos mantienen su derecho al curso. Revisar
descripciones, precios y URL de confirmación en Stripe antes de publicar la oferta
SaaS. No activar renovaciones automáticas: este flujo es prepago, no suscripción.

## Arranque del worker H3

Requisitos: Node 22 o superior, ComfyUI con H3 completo y el helper probado.
`COMFY_URL` debe ser privado/localhost. No expongas ComfyUI sin autenticación.
El worker no instala modelos, alquila, inicia ni detiene pods.

Configurar por el gestor de secretos del contenedor:

```text
CREATIVE_RUSH_URL=https://<dominio-del-entorno>
GENERATION_WORKER_TOKEN=<mismo secreto que Pages>
H3_WORKER_ID=<id-unico-y-estable-de-este-worker>
COMFY_URL=http://127.0.0.1:8188
```

Ejecutar un solo proceso por `H3_WORKER_ID`:

```bash
node workers/h3-worker.mjs
```

El adaptador requiere que `/h3-simple/build` devuelva
`{ "workflow": { "prompt": { ... } } }`, como el helper usado en las pruebas
anteriores. Envía `duration`, `resolution`, `aspect`, `preset=turbo8`, `prompt`
y `image` opcional. No altera el texto ni inventa diálogos.

No habilites generación antes de verificar con el helper instalado que estas
opciones coinciden: portrait/landscape/square y 480/720. El worker solo extrae MP4.

## Recuperación y control de costos

- Una solicitud repetida con el mismo ID no crea otro trabajo ni descuenta otra vez.
- Hasta tres trabajos activos por cuenta; el saldo se verifica dentro de la transacción.
- El worker confirma que ComfyUI responde antes de anunciar disponibilidad.
- Un lease dura tres minutos y se renueva cada veinte segundos durante el procesamiento.
- Las reservas en cola caducan tras treinta minutos; los trabajos en ejecución
  caducan al perder el lease o superar cuarenta y cinco minutos.
- Los fallos/cancelaciones devuelven saldo una única vez. Un éxito no puede
  convertirse en un reembolso por un callback atrasado.
- Una interrupción ambigua al enviar a ComfyUI no dispara otra generación:
  se busca el job ID en cola/historial y, si no puede recuperarse, se falla y reembolsa.
- Un `SIGTERM` permite terminar el trabajo actual; no interrumpe globalmente ComfyUI.
- Máximo 6 MB y 30 referencias nuevas al día por usuario. Resultados MP4 de hasta 50 MB.

**El sweeper es obligatorio** para recuperar trabajos cuando todas las GPUs estén
apagadas. Desplegar `workers/wrangler.toml` como Worker separado con cron de un
minuto, configurando `CREATIVE_RUSH_URL` y `GENERATION_WORKER_TOKEN`. Su endpoint
es autenticado. No activar jobs de clientes antes de comprobar este cron.

## Activación pendiente, en orden

1. Completado: revisión del esquema remoto previo y comparación de la función de
   compras. No había compras, saldos ni cuentas de clientes registrados en estas
   tablas. La migración no elimina datos; conserva los derechos previos al curso.
2. Completado: migración aditiva aplicada, advisors y verificaciones de RLS/grants.
3. Registrar `/herramienta/` en las URLs de redirección permitidas de Supabase Auth;
   comprobar email/SMTP y la llegada del enlace en el navegador del comprador.
4. Completado: secretos existentes conservados y Pages desplegado con
   `GENERATION_ENABLED=false`.
5. Desplegar el sweeper y verificar que corre aun con la GPU apagada.
6. Arrancar un worker H3 autorizado; probar 5 s/720p/turbo8, con y sin referencia,
   revisar visualmente los resultados y medir tiempo/costo. No se hizo en esta entrega.
7. Probar un Checkout Session de Stripe **test**, login, generación, descarga,
   saldo insuficiente, callback duplicado y fallo. Verificar después el entorno live.
8. Activar `GENERATION_ENABLED=true` y vigilar errores, cola y saldo. Para pausar
   pedidos nuevos, volver a `false`; los trabajos ya iniciados pueden terminar.

## Pruebas locales sin GPU ni pagos

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run check:functions
pnpm build
```

Las pruebas ejecutan SQL real con PGlite (PostgreSQL embebido); simulan únicamente
el transporte HTTP de Supabase/Storage, Stripe y el motor H3. Esto **no reemplaza**
una prueba con Supabase Auth/Storage reales, ni mide inferencia o calidad H3.
Incluyen firmas de Stripe, duplicados, privacidad por usuario, falla, lease vencido,
cancelación, descarga privada y checkpoint del proveedor. No leen credenciales live.

Los Pixel events están deshabilitados únicamente en localhost/file para no enviar
tráfico de desarrollo. En producción sigue activo el pixel existente. `Purchase`
usa importe/moneda confirmados por servidor, no una cantidad deducida del plan.

Referencias revisadas para la implementación:
[funciones de Postgres](https://supabase.com/docs/guides/database/functions),
[uploads privados](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[URLs de subida firmadas](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).
