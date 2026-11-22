# critiCal — Operación

## Instalar en un celular nuevo

1. Abrí https://critical-cal.vercel.app en **Safari**.
2. Compartir → **Agregar a inicio**.
3. Entrá con Google. Todo lo demás está en Supabase, no hay nada que migrar.

En la Mac: Safari → Archivo → **Agregar al Dock**.

## Entornos

|            | Web                                   | Base                             | Deploy                            |
| ---------- | ------------------------------------- | -------------------------------- | --------------------------------- |
| Local      | `bun run dev` (http://localhost:5173) | `supabase start` (puertos 553xx) | —                                 |
| Preview PR | preview de Vercel (protegida)         | `critical-staging`               | cada push a un PR (sin migrar)    |
| Staging    | preview de Vercel (protegida)         | `critical-staging`               | cada merge a `main`               |
| Producción | https://critical-cal.vercel.app       | `critical-prod`                  | automático si staging + E2E pasan |

Pipeline: PR → preview protegida contra staging (`preview.yml`: URL comentada en el PR, E2E; no corre las migraciones del PR) y CI (Biome, tsc, Vitest con cobertura, E2E iPhone/Safari, gitleaks, pgTAP/RLS, CodeQL, Codacy) → merge → staging (migraciones + build en Vercel + E2E contra el deploy) → producción.

## Secretos

Nunca en el repo. Dónde vive cada uno:

| Secreto                                    | Dónde                                       | Para qué                                                |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                    | GitHub (repo)                               | migraciones y funciones desde CI                        |
| `VERCEL_TOKEN`                             | GitHub (repo)                               | deploys                                                 |
| `SUPABASE_DB_PASSWORD`                     | GitHub (staging / production) + Llavero     | `supabase link`                                         |
| `VERCEL_AUTOMATION_BYPASS_SECRET`          | GitHub (staging)                            | E2E contra la preview protegida                         |
| `BACKUP_PASSPHRASE`                        | GitHub (production) + Llavero               | cifrar backups                                          |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Vercel (Production y Preview)               | refrescar tokens de Google                              |
| `SUPABASE_SECRET_KEY`                      | Vercel (Production: prod, Preview: staging) | funciones de sincronización (`apps/web/api`)            |
| `VITE_VAPID_PUBLIC_KEY`                    | Vercel (Production y Preview)               | suscribir el dispositivo a Web Push (pública)           |
| `VAPID_PRIVATE_KEY`                        | Vercel (Production y Preview, Sensitive)    | firmar las notificaciones push                          |
| `ORS_API_KEY`                              | Vercel (Production y Preview, Sensitive)    | tiempos en auto entre lugares (OpenRouteService)        |
| `GEMINI_API_KEY`                           | Vercel (Production y Preview, Sensitive)    | leer programas en PDF (Google AI Studio, plan gratis)   |
| `GEMINI_MODEL` (opcional)                  | Vercel                                      | forzar otro modelo de Gemini                            |
| `VITE_SENTRY_DSN`                          | Vercel (Production y Preview)               | errores a Better Stack (app y funciones; no es secreto) |

La clave publicable de Supabase (`sb_publishable_…`) es pública por diseño; la seguridad la dan las políticas RLS (testeadas en `supabase/tests`).

## Sincronización en el servidor

- **Google → webhook**: cada sync abre un canal de push por calendario (`google_channels`, se renuevan solos antes de vencer). Un cambio en Google llama a `/api/google-webhook`, que importa, replanifica y actualiza 📚 Plan aunque la app esté cerrada. Las ráfagas se agrupan (20 s).
- **Cron (pg_cron + pg_net)**: cada 5 min la base llama a `/api/cron` con una clave que se genera dentro de Postgres (`private.app_config`). Sincroniza Google e iCloud de cada usuario conectado si pasaron 9 min o quedó un webhook pendiente, replanifica y espeja el Plan.
- Solo en **producción**: la primera sync desde la app registra el origen (`register_app_url`). Staging no recibe webhooks ni cron.
- Si un cambio pisa un bloque de hoy, queda como propuesta en la Bandeja (no se aplica solo).
- Para ver el cron: Supabase → Integrations → Cron → `critical-tick` (historial en `cron.job_run_details`, respuestas en `net._http_response`).

## Notificaciones y offline

- Push: Ajustes → Notificaciones → «Activar en este dispositivo» (en el iPhone, solo con la app instalada). Se elige qué avisar: bloques críticos (N min antes), cambios propuestos para hoy y el recordatorio del domingo. Las manda el cron cada 5 min; cada aviso sale una sola vez (`private.push_log`).
- Claves VAPID nuevas: `bunx web-push generate-vapid-keys` (cambiarlas obliga a reactivar en cada dispositivo).
- Offline: el estado vive en IndexedDB. Sin conexión se puede seguir usando; el punto de estado queda hueco y los cambios se escriben solos al volver la conexión. Salir de la cuenta borra la copia local.
- Errores: con `VITE_SENTRY_DSN` cargado, la app y las funciones reportan errores (sin datos personales ni contenido del calendario). Desde el 2026-11-18 el DSN es el de Better Stack (Errors → aplicación «critiCal», pestaña Ingest), que acepta el SDK de Sentry; la variable conserva su nombre. Los reportes de la CSP llegan ahí como errores `CSP: <directiva> blocked <dirección>`.

## Traslados

- Ajustes → Lugares y traslados: guardá tu casa y los lugares frecuentes (nombre, alias, dirección). Con casa guardada, el plan reserva el viaje + el margen antes y después de cada evento con ubicación (o cuyo título nombra un lugar). Si el evento anterior terminó hace menos de 2 h, se sale desde ahí.
- «Calcular con las direcciones»: geocodifica con OpenStreetMap (una vez por lugar) y pide los tiempos en auto a OpenRouteService. Los tiempos cargados a mano nunca se pisan.
- La Bandeja pregunta «¿Dónde es?» por los eventos de los próximos 7 días sin lugar conocido; la respuesta queda como alias (o «no hace falta traslado»), así que no vuelve a preguntar.

## Ómnibus (horarios y rutas)

- **Fuentes** (datos abiertos de Uruguay, «Licencia de Datos Abiertos»: se puede usar citando la fuente; la app la muestra junto a los horarios): STM de Montevideo (Intendencia: `uptu_pasada_variante`, `uptu_pasada_circular`, paradas y variantes del portal GIS; horarios **teóricos**, la IM los regenera todos los días) y líneas metropolitanas (MTOP/DNT: GTFS del catálogo de datos abiertos, «Horarios Metropolitanos GTFS»; «en etapa de revisión», sin garantía de la DNT). No existe un GTFS del STM.
- **Caché semanal**: `pg_cron` (`critical-transit-import`, lunes 03:00 de Montevideo) llama a `/api/transit` con la clave de cron; la función descarga, compacta y guarda cada fuente en `public.transit_feed` (unos 1 MB en total; las ~2,3 millones de pasadas crudas no se guardan). Si una descarga falla, queda lo guardado; si la nueva trae menos del 60 % de las variantes guardadas, se rechaza. Los errores van a Sentry (`transit-import`). Solo corre donde la app registró su origen (producción).
- **Primera carga** (o forzarla): leé la clave (`select value from private.app_config where key = 'cron_key'`, en el editor SQL de Supabase o con `psql`) y corré `curl -X POST <origen>/api/transit -H "x-cron-key: <clave>" -H "content-type: application/json" -d '{}'` (un solo origen: `{"source":"stm"}` o `{"source":"dnt"}`). En local, con `VITE_FAKE_PROVIDERS=1`, importa un GTFS inventado (dos líneas que se cruzan sobre la zona del geocodificador falso); el STM falla a propósito.
- **Cálculo**: `POST /api/transit` con `{action:"plan"}` (contrato en `apps/web/src/transit.ts`). Hasta 1 transbordo (si no hay opción, reintenta con 2; `maxTransfers` lo fija), paradas a menos de 900 m, 5 min de margen por transbordo, 3 opciones; los tramos a pie usan OpenRouteService (perfil a pie, una llamada por cálculo) y, si no responde, la distancia en línea recta ×1,3 a 4,8 km/h. Cada persona puede pedir 10 cálculos por minuto y 200 por día (por instancia de la función).
- Tabla `bus_routes`: rutas habituales por persona (RLS), con la opción elegida, la versión de los horarios con que se calculó (`feed_version`) y si es teórica.

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

## Demo de pruebas

Para probar sin la cuenta personal: en la pantalla de inicio, **Demo de pruebas** (debajo de «Probar con datos de ejemplo»), o abrir `/?demo=pruebas`. No usa cuenta ni Supabase: todo queda en este dispositivo (`localStorage`), aparte de los datos del demo común. En Ajustes → Cuenta dice «Demo de pruebas»; **Reiniciar demo** la vuelve a cargar tal cual (y reinicia los Primeros pasos). Los datos se arman en `apps/web/src/demoPruebas.ts`, relativos a hoy. Para volver al demo común, «Salir» y «Probar con datos de ejemplo».

Qué probar, paso a paso (lo que se ve depende del día; lo ideal es abrirla un lunes o martes, así hay bloques ya pasados):

1. **Primeros pasos**: arriba de la Semana, «Primeros pasos · 1 de 3». «Saltar por ahora» la guarda; en Ajustes → Primeros pasos vuelve a aparecer en la Semana al instante (sin pasar por Silos ni Bandeja).
2. **Bandeja** (una tarjeta de cada tipo): asignar la materia de «Parcial SD (del calendario)»; «Elegí» (no llegás a todo) con «Empezar antes» para «Informe corto SD», «No hacer…», «Usar tiempo libre»; un lugar sin dirección conocido («Parque Rodó», «¿Cuántos minutos desde casa?»); y los bloques de ayer/hoy ya pasados para Hecho / Parcial / No, y «Corregir» + Deshacer después. Para ver «gym no entra», subí las veces por semana de Gym en Ajustes → Rutinas (7), o esperá a la segunda mitad de la semana.
3. **Ómnibus**: el evento «evento gran» del miércoles (13:00, Atlántida 1213 Bis) → su ventanita → Cómo llegar: Ómnibus muestra Ida y Vuelta con transbordos; «Guardar como ruta habitual» en cada tramo.
4. **Rutinas con «Distinto según el día»**: Ajustes → Rutinas → Gym: de lunes a viernes 9–17, miércoles de 17 a 20 y sábado y domingo «No ese día».
5. **Comidas de días pasados**: en Semana, mirá el almuerzo y la cena de la semana pasada (12:30 y 20:30, antes de hace dos semanas; hoy 13:00 y 21:00). Cambiá los horarios en Ajustes → Mi semana y comprobá que los días ya pasados no se mueven y los futuros sí.
6. **Planificación semanal**: Ajustes → Planificación semanal (un domingo, o desde ahí cualquier día): sobre la semana próxima, con «Parcial Física I» (partes con peso) y las entregas de Sistemas Distribuidos y Programación 2.
7. **Lugares**: Ajustes → Lugares y traslados: «Casa» (mi casa, con dirección), «Casa Fran» (con dirección), «Casa de la abuela Marta» (sin dirección) y «Facultad» (alias FING, por ómnibus). Comprobá que «Casa de la abuela Marta» no se confunde con «Casa» y que hay una sola casa.
8. **Materias y parciales**: Ajustes → Materias (Cálculo II, Física I, Programación, Sistemas Distribuidos) y el semestre en Ajustes → Inicio de cuatrimestre.
9. **Borradores**: abrí un formulario (un lugar, una materia), escribí algo, cerralo con la X y verificá que pide confirmar el descarte.

## Pruebas E2E: qué cubre cada una y qué sigue siendo manual

Playwright, en `apps/web/e2e/`, contra la build (`bun run e2e`; en CI también contra staging y la preview). Todas arrancan en **modo demo**, con el celular de 375×812 y zona horaria de Montevideo, y los proyectos `iphone` y `desktop-safari` (WebKit). Las que dependen de la fecha fijan el reloj con `page.clock` (domingo 22/11/2026 12:00 o lunes 23/11 08:00), así que no cambian con el día en que corren. Los helpers están en `e2e/helpers.ts`.

| Archivo                | Qué cubre                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.spec.ts`        | Demo: semana, camino crítico, globo, silos y Bandeja; manifiesto, privacidad y funciones de sync (solo contra un sitio desplegado).                                                                  |
| `planificacion.spec.ts` | Planificación semanal un domingo: «Semana del lun … al dom …» de la semana próxima, «Cerrar resumen» vuelve a Ajustes, el silo de la rutina pasa a «la semana próxima» y sigue así al recargar.         |
| `lugares.spec.ts`      | Casa: «Falta tu casa», «Tu casa no tiene dirección», una sola casa (la segunda no ofrece «Mi casa»), desmarcar la casa vuelve a avisar, nombres repetidos.                                             |
| `bloque.spec.ts`       | Hoja de bloque: Hecho, Parcial, No y Corregir, cada uno con «Deshacer» que deja el bloque como estaba.                                                                                                 |
| `avance.spec.ts`       | «Guardar avance»: un doble toque guarda una sola vez y no cambia de pestaña; sin nada anotado avisa.                                                                                                  |
| `bandeja.spec.ts`      | Bandeja: Hecho, No hecho, Hice una parte y Elegir una opción, cada uno con su «Deshacer».                                                                                                              |
| `rutinas.spec.ts`      | Rutinas «Distinto según el día»: la Semana respeta la franja de cada día y no pone la rutina en los días «No»; horarios ilegibles se marcan.                                                           |
| `respaldo.spec.ts`     | Respaldo: exportar desde la demo, importar (sin duplicados, también dos veces, persiste al recargar, «Deshacer») y rechazo de archivos que no son un respaldo.                                          |
| `borradores.spec.ts`   | Borradores (§14): recargar con «Nueva» abierta restaura lo escrito, Escape con cambios pregunta (y Escape en la pregunta sigue editando), «Descartar» borra; lo mismo con un formulario de Ajustes.      |
| `letra-grande.spec.ts` | Letra grande (raíz a 24 y 32 px) con tema claro y oscuro: ninguna pestaña, pantalla de Ajustes ni hoja tiene contenido que se salga por el costado (`scrollWidth > clientWidth` y elementos fuera de pantalla). Solo corre en `iphone`. |

Tiempos: toda la suite tarda ~1 min en una PC con los dos proyectos; `letra-grande.spec.ts` es la más lenta (56 pruebas, ~40 s en un solo proyecto), el resto tarda segundos por archivo.

**Sigue siendo manual** (no se puede probar sin un aparato o una cuenta reales):

- Instalar la PWA y abrirla desde el ícono en un **iPhone físico**: barra de estado, teclado, gestos de borde, el zoom de texto del sistema (las pruebas simulan la letra grande cambiando la raíz, no el ajuste de iOS), notificaciones push y Face ID.
- Todo lo que necesita una **cuenta real**: entrar con Google, sincronizar con Google Calendar / iCloud, invitaciones, el widget de Scriptable, cargar un programa en PDF con Gemini, el cálculo de traslados con OpenRouteService y los horarios de ómnibus. En la demo no hay sesión ni servidor.
- Lo que cambia con la **fecha real**: el aviso del domingo y el cron del servidor.
