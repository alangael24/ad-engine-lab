# Regalos: producción desde Codex

La web recibe la historia y las referencias privadas. No invoca OpenAI ni crea trabajos de GPU. El operador revisa periódicamente los pedidos; todavía no hay notificación automática. La oferta estándar anuncia 24 horas; la opción de dos minutos tiene entrega prioritaria sin promesa de una hora.

1. El cliente envía el formulario en `/regalos/`; el pedido aparece en `/regalos/pedido/`.
2. El operador exporta el brief y las fotos a una carpeta privada, trabaja el guion en Codex y lo publica.
3. El cliente solicita cambios o aprueba. Aprobar reserva una sola vez 60 o 120 segundos de su saldo pagado. Checkout y webhook mantienen la validación existente; nunca se toma una redirección como prueba de pago.
4. El operador inicia el pedido aprobado, produce con Codex y las herramientas autorizadas, revisa la película completa y la entrega.
5. La cuenta del cliente muestra una descarga privada con enlace temporal. Se devuelven los segundos no utilizados. Cancelar antes de entregar libera la reserva una sola vez.

## Operación local

Usar Node con un archivo de entorno privado que contenga `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. No copiarlo a `assets`, `dist` ni a Git. La entrega requiere ffprobe en PATH.

```
node --env-file=/ruta/privada.env scripts/gift-operator.mjs list
node --env-file=/ruta/privada.env scripts/gift-operator.mjs export ORDER_ID /carpeta/pedido
node --env-file=/ruta/privada.env scripts/gift-operator.mjs script ORDER_ID /carpeta/guion.txt
node --env-file=/ruta/privada.env scripts/gift-operator.mjs start ORDER_ID
node --env-file=/ruta/privada.env scripts/gift-operator.mjs deliver ORDER_ID /carpeta/final.mp4 /carpeta/revision.txt
```

La nota de revisión debe describir la comprobación de historia, referencias, continuidad, narración, subtítulos y reproducción del MP4. El comando comprueba pistas de audio/video y duración; no sustituye la revisión humana. Conserva cada resultado intermedio y no vuelve a generar recursos al reintentar una subida. La misma película produce el mismo asset ID, para recuperar una entrega interrumpida.

No encender GPU ni generar voz sin presupuesto autorizado. Apagar/eliminar el cómputo al finalizar o fallar y registrar el costo real por separado del uso de la suscripción de Codex.

## Panel administrador

`/regalos/admin/` permite consultar todos los pedidos, filtrar por estado, abrir la historia, fotos privadas, correo del cliente, guion, cambios y revisión de entrega. La descarga exige un pedido ya entregado. El panel es de consulta: no inicia generaciones ni modifica pedidos.

La API `/api/gift-admin` verifica la sesión con Auth antes de consultar datos. Requiere `app_metadata.creativerush_gift_admin === true` administrado en servidor, o un correo **verificado** incluido en el secreto de Pages `GIFT_ADMIN_EMAILS`. Nunca acepta `user_metadata`, correos enviados por el navegador ni parámetros como autorización. La configuración por correo también funciona para una cuenta creada posteriormente, una vez verificada. Para revocar, quitar el correo de la configuración y cualquier rol de app_metadata; publicar la configuración nueva. Las referencias se firman solo si pertenecen al cliente del pedido. Los enlaces caducan a los 15 minutos; Actualizar obtiene enlaces nuevos.

## Paquetes y entrega

- $299 MXN: Un recuerdo inolvidable, un minuto, entrega estándar en 24 horas.
- $499 MXN: Su historia juntos, dos minutos, Más popular, entrega prioritaria sin plazo de una hora publicado.
- El plazo inicia cuando están confirmados el pago, la aprobación del guion y las referencias completas si el cliente decidió incluir fotos. Sin fotos se pueden usar personajes inventados.
- El operador debe atender primero los pedidos prioritarios que ya estén listos para producir, respetando los compromisos de 24 horas de pedidos estándar. El panel identifica la modalidad en la lista y el detalle.
- Esto sigue siendo cumplimiento manual: no hay un planificador ni alertas automáticas para estos plazos. No prometer una hora hasta validar capacidad y tiempos reales.
