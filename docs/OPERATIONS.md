# critiCal — Operación

## Instalar en un celular nuevo

1. Abrí https://critical-cal.vercel.app en **Safari**.
2. Compartir → **Agregar a inicio**.
3. Entrá con Google. Todo lo demás está en Supabase, no hay nada que migrar.

En la Mac: Safari → Archivo → **Agregar al Dock**.

## Entornos

|            | Web                                   | Base                             | Deploy                            |
| ---------- | ------------------------------------- | -------------------------------- | --------------------------------- |
| Local      | `npm run dev` (http://localhost:5173) | `supabase start` (puertos 553xx) | —                                 |
| Staging    | preview de Vercel (protegida)         | `critical-staging`               | cada merge a `main`               |
| Producción | https://critical-cal.vercel.app       | `critical-prod`                  | automático si staging + E2E pasan |

Pipeline: PR → CI (Biome, tsc, Vitest con cobertura, E2E iPhone/Safari, gitleaks, pgTAP/RLS, CodeQL, CodeRabbit) → merge → staging (migraciones + build en Vercel + E2E contra el deploy) → producción.

## Secretos

Nunca en el repo. Dónde vive cada uno:

| Secreto                                    | Dónde                                       | Para qué                                              |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                    | GitHub (repo)                               | migraciones y funciones desde CI                      |
| `VERCEL_TOKEN`                             | GitHub (repo)                               | deploys                                               |
| `SUPABASE_DB_PASSWORD`                     | GitHub (staging / production) + Llavero     | `supabase link`                                       |
| `VERCEL_AUTOMATION_BYPASS_SECRET`          | GitHub (staging)                            | E2E contra la preview protegida                       |
| `BACKUP_PASSPHRASE`                        | GitHub (production) + Llavero               | cifrar backups                                        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Vercel (Production y Preview)               | refrescar tokens de Google                            |
| `SUPABASE_SECRET_KEY`                      | Vercel (Production: prod, Preview: staging) | funciones de sincronización (`apps/web/api`)          |
| `VITE_VAPID_PUBLIC_KEY`                    | Vercel (Production y Preview)               | suscribir el dispositivo a Web Push (pública)         |
| `VAPID_PRIVATE_KEY`                        | Vercel (Production y Preview, Sensitive)    | firmar las notificaciones push                        |
| `ORS_API_KEY`                              | Vercel (Production y Preview, Sensitive)    | tiempos en auto entre lugares (OpenRouteService)      |
| `GEMINI_API_KEY`                           | Vercel (Production y Preview, Sensitive)    | leer programas en PDF (Google AI Studio, plan gratis) |
| `GEMINI_MODEL` (opcional)                  | Vercel                                      | forzar otro modelo de Gemini                          |
| `VITE_SENTRY_DSN`                          | Vercel (Production y Preview)               | errores a Sentry (app y funciones; no es secreto)     |

La clave publicable de Supabase (`sb_publishable_…`) es pública por diseño; la seguridad la dan las políticas RLS (testeadas en `supabase/tests`).

## Sincronización en el servidor

- **Google → webhook**: cada sync abre un canal de push por calendario (`google_channels`, se renuevan solos antes de vencer). Un cambio en Google llama a `/api/google-webhook`, que importa, replanifica y actualiza 📚 Plan aunque la app esté cerrada. Las ráfagas se agrupan (20 s).
- **Cron (pg_cron + pg_net)**: cada 5 min la base llama a `/api/cron` con una clave que se genera dentro de Postgres (`private.app_config`). Sincroniza Google e iCloud de cada usuario conectado si pasaron 9 min o quedó un webhook pendiente, replanifica y espeja el Plan.
- Solo en **producción**: la primera sync desde la app registra el origen (`register_app_url`). Staging no recibe webhooks ni cron.
- Si un cambio pisa un bloque de hoy, queda como propuesta en la Bandeja (no se aplica solo).
- Para ver el cron: Supabase → Integrations → Cron → `critical-tick` (historial en `cron.job_run_details`, respuestas en `net._http_response`).

## Notificaciones y offline

- Push: Ajustes → Notificaciones → «Activar en este dispositivo» (en el iPhone, solo con la app instalada). Se elige qué avisar: bloques críticos (N min antes), cambios propuestos para hoy y el recordatorio del domingo. Las manda el cron cada 5 min; cada aviso sale una sola vez (`private.push_log`).
- Claves VAPID nuevas: `npx web-push generate-vapid-keys` (cambiarlas obliga a reactivar en cada dispositivo).
- Offline: el estado vive en IndexedDB. Sin conexión se puede seguir usando; el punto de estado queda hueco y los cambios se escriben solos al volver la conexión. Salir de la cuenta borra la copia local.
- Sentry: con `VITE_SENTRY_DSN` cargado, la app y las funciones reportan errores (sin datos personales ni contenido del calendario).

## Traslados

- Ajustes → Lugares y traslados: guardá tu casa y los lugares frecuentes (nombre, alias, dirección). Con casa guardada, el plan reserva el viaje + el margen antes y después de cada evento con ubicación (o cuyo título nombra un lugar). Si el evento anterior terminó hace menos de 2 h, se sale desde ahí.
- «Calcular con las direcciones»: geocodifica con OpenStreetMap (una vez por lugar) y pide los tiempos en auto a OpenRouteService. Los tiempos cargados a mano nunca se pisan.
- La Bandeja pregunta «¿Dónde es?» por los eventos de los próximos 7 días sin lugar conocido; la respuesta queda como alias (o «no hace falta traslado»), así que no vuelve a preguntar.

## Planificación y cuatrimestre

- **Planificación semanal**: Ajustes → «Planificación semanal» (o el aviso del domingo). Muestra la semana (la próxima en fin de semana), horas por día, críticos, lo que no llega al mínimo y cuántas decisiones esperan en la Bandeja.
- **Inicio de cuatrimestre**: Ajustes → fechas, feriados del período, materias (con mínimo semanal opcional → silo semanal) y parciales/entregas.
- **Feriados de Uruguay**: calculados (fijos, Carnaval y Turismo según Pascua, y los trasladables al lunes). Se planifican con la rutina del domingo; se puede apagar.
- **Planificado vs. hecho**: en Silos, lo planificado en bloques ya terminados esta semana contra lo registrado.
- **Respaldo**: Ajustes → Cuenta → Exportar / Importar JSON (importar reemplaza todo, con confirmación).

## Widget y programas

- **Widget de silos (Scriptable)**: Ajustes → «Widget de silos» → «Generar script» → copiarlo en un script nuevo de Scriptable → agregar el widget de Scriptable en la pantalla de inicio. Usa un token personal (en la base solo queda su hash); generar otro invalida el anterior y «Desactivar» lo revoca.
- **Cargar programa (PDF) con IA**: Ajustes → elegir el PDF (hasta 3 MB). Gemini (`gemini-3.6-flash`, si está saturado `gemini-3.5-flash-lite`) propone unidades con horas y evaluaciones con fecha; se revisa y edita todo antes de crear. En el plan gratis Google puede usar el contenido para mejorar sus modelos.

## Backups

- Nocturno: workflow **Backup** → artefacto `backup-AAAA-MM-DD.tgz.gpg` (90 días).
- Restaurar:

  ```bash
  gpg --decrypt backup-2026-11-03.tgz.gpg | tar xz
  psql "$DB_URL" -f schema.sql && psql "$DB_URL" -f data.sql
  ```

  La clave está en el Llavero: `security find-generic-password -a critical-backup -s "critiCal backup passphrase" -w`.

## Rollback

- Web: Vercel → proyecto `critical` → Deployments → el anterior → **Promote**.
- Base: las migraciones son incrementales; para deshacer, una migración nueva que revierta (nunca editar una ya aplicada).

## Google Calendar

- La app lee todos los calendarios visibles y escribe los bloques en un calendario propio, **📚 Plan** (rojo tomate = crítico). Agregalo en el Calendario del iPhone y aparece en el widget nativo.
- Eventos marcados "Disponible" en Google no bloquean tiempo.
- La app OAuth está en producción sin verificar: la primera vez Google avisa "app no verificada" → Avanzado → Ir a critiCal.
