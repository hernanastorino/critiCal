# critiCal — trabajo pendiente y cómo seguirlo

Este archivo es para que cualquier agente, sin más contexto que el repo, retome el trabajo.
La fuente de verdad del producto es [`SPEC.md`](SPEC.md) (sobre todo §14–§17); la operación, [`OPERATIONS.md`](OPERATIONS.md).
Mantené este archivo al día: al empezar, al abrir o mergear un PR, y antes de cortar.

**Que quede corto**: acá va solo lo pendiente, lo que está en curso y lo que está en validación. Un tema se **borra** de este archivo (no se pasa a «hecho») cuando cumple todo esto: PR con todos los checks en verde, mergeado a `main`, vuelta limpia del agente atacante y prueba en producción sin problemas (Sentry incluido). Lo que se hizo queda en la SPEC (✅) y en el historial de git.

## Retomar desde otra cuenta o sin memoria (leer primero)

Una cuenta nueva de Claude no ve la memoria local (`~/.claude/projects/...`), ni las sesiones, ni las tareas programadas de la anterior. Todo lo necesario está en el repo: este archivo, [`SPEC.md`](SPEC.md) y [`OPERATIONS.md`](OPERATIONS.md).

1. **Leé en este orden**: este archivo entero → `SPEC.md` §14–§18 → `OPERATIONS.md`.
2. **Mirá el estado real**, no solo lo que dice acá: `gh pr list --state open`, `gh run list --branch main --limit 5` y Sentry (org `hernanastorino`, proyecto `critical`: `is:unresolved`, sin límite de tiempo; un issue nuevo, sobre todo de seguridad, se arregla con un PR sin esperar a que lo pidan).
3. **Terminá lo que está en la tabla de §1** antes de empezar algo nuevo (salvo los PRs pausados a pedido del usuario, como el #68: se dejan como están y no se mergean). Un PR que abrió otra sesión se puede continuar: `gh pr checkout <n>` en un worktree propio (si la rama ya está en otro worktree, `git worktree list` y seguí en ese), leé lo que marcó Codacy y seguí el ciclo de §2.
4. **Preguntas pendientes para el usuario**: §1.1 de este archivo. Recordáselas en cuanto escriba.

### Cómo quiere trabajar el usuario (decidido por él; vale para cualquier cuenta)

- **Idioma y tono**: español rioplatense («vos»). Respuestas cortas, al estilo «decí menos»: primero la respuesta, una idea por frase, hasta unas 20 palabras, voz activa. Nunca omitir «no», «nunca» ni «solo». Código, comandos y rutas, tal cual. En alertas de seguridad o si el usuario está confundido, frases completas.
- **Preguntar antes de tocar código**: todas las dudas juntas al principio (decisiones de producto que la SPEC no resuelve son preguntas, no supuestos). Si el usuario no está, anotarlas en §1.1 y seguir con lo que no dependa de ellas.
- **Todo pedido nuevo se anota primero en la SPEC**, así la idea no se pierde.
- **Un PR por tema**, rama `claude/<tema>`, worktree propio. **Auto-fix prendido en cada PR.**
- **Mergear vos mismo** (squash) solo cuando: CI en verde, el check «Codacy Static Code Analysis» del **último** commit en verde (lo exige la regla «Require Codacy» de `main`; sus hallazgos están en la página del PR en Codacy, `https://app.codacy.com/gh/hernanastorino/critiCal/pull-requests/N`), **cero hilos abiertos** y vuelta limpia del agente atacante. Cada hilo de revisión se responde en una línea con la firma «_🤖 Addressed by [Claude Code](https://claude.com/claude-code)_» y se resuelve. CodeRabbit ya no se usa (se terminó su prueba gratis): su check aparece como «skipping» y no cuenta.
- **Tareas separadas → sesiones hijas** (pedido del 2026-11-07, para gastar menos tokens): una sesión por tarea con Sonnet 5.5, esfuerzo medio y permisos Auto, en su worktree, con un brief autosuficiente (qué, sección de la SPEC, plan, metodología de §2, criterios de aceptación intermedios y finales, reglas). Las hijas no tocan este archivo; la sesión principal revisa, mergea de a uno y lo mantiene. El límite semanal es compartido: 2–3 hijas a la vez como mucho.
- **Lo que no se toca sin pedido**: la barra de pestañas de abajo queda pegada al borde inferior (la app corre como PWA instalada); el PR #68 (buscador de Ajustes) no se mergea hasta que el usuario lo pida.
- **Datos y cuentas**: nunca contraseñas ni cuentas reales de Google o iCloud; solo la cuenta de prueba local y datos inventados. El agente atacante nunca ataca producción.
- **Producción**: https://critical-cal.vercel.app (la PWA cachea: para probar una versión nueva, actualizá el service worker y recargá). Modo demo: «Probar con datos de ejemplo».
- **Límites de uso**: al 90 % del límite de 5 h, dejar este archivo al día y cortar; al 90 % del semanal, frenar y avisar. Las tareas programadas de relevo arrancan en modo de permisos por defecto y se traban pidiendo permisos: si se usan, configurarlas en modo Auto desde la app.

### Errores: Better Stack, no Sentry (desde el 2026-11-18)

El usuario no puede entrar a Sentry. Los errores van a **Better Stack Errors** (equipo `t637956`, aplicación «critiCal», id `2842817`, host `s2842817.us-west-2a.betterstackdata.com`), que acepta el SDK de Sentry: la variable sigue llamándose `VITE_SENTRY_DSN` (config, no secreta) y el código no cambió. Donde abajo dice «Sentry», leé Better Stack: los issues se miran en `https://errors.betterstack.com/team/t637956/applications/2842817` (o con su API o su servidor MCP). Si `errors.betterstack.com` no abre, el bloqueador de DNS del usuario lo tapa (resuelve a `0.0.0.0`): pedile que lo desactive o lo permita.

### Vigilar Sentry desde la cuenta nueva

En la cuenta original lo hace la tarea programada `critical-sentry-watch` (cada hora). **Recién cuando el usuario confirmó que la frenó** (ver §0 punto 2), creá en la cuenta nueva una tarea equivalente (herramienta de tareas programadas de Claude Code, cada hora, en **modo de permisos Auto**, si no se traba pidiendo permisos) con este prompt, resumido:

1. Buscar en Sentry (org `hernanastorino`, región https://us.sentry.io, proyecto `critical`) los issues `is:unresolved` (sin límite de 24 h: uno sin PR no se pierde si una corrida se interrumpió) y los `is:regressed` y `is:escalating` de las últimas 24 h, y además los PRs abiertos con «Fixes CRITICAL-» (`gh pr list --search "Fixes CRITICAL"`), aunque su issue ya no salga en esa ventana. Solo si no hay ninguna de las dos cosas, terminar con «Sentry limpio».
2. Por cada uno, ver detalle, breadcrumbs y stack trace, y clasificarlo:
   - **Seguridad** primero (sesión o tokens filtrados, errores de permisos o RLS como Postgres 42501 o PGRST301, XSS o CSP, redirecciones abiertas, 401 o 403 de nuestra API, datos de otro usuario).
   - **Bug nuestro**: se arregla.
   - **Ruido** ajeno (extensiones, cortes de red reconocidos): se resuelve en Sentry con el motivo, sin tocar código.
3. Si ya hay un PR abierto con «Fixes CRITICAL-N», solo hacerlo avanzar (nunca un duplicado). Si el PR ya está mergeado pero el Deploy de `main` falló, recuperar ese deploy (un Deploy nuevo sobre el `main` actual) antes de crear otro PR.
4. Arreglo: worktree nuevo desde `origin/main` en la rama `claude/sentry-<issue>`, test de regresión, `npx biome check .`, `npx tsc -b`, `npx vitest run` (y `supabase test db` si toca `supabase/`), «Fixes CRITICAL-N» en el commit y en el PR.
5. Mergear con las reglas de §2 (Codacy en verde sobre el último commit, sin hilos ni hallazgos pendientes); si todavía no terminó, dejarlo abierto para la corrida siguiente.
6. Confirmar el deploy de `main` y marcar el issue como resuelto en Sentry, con el link al PR.
7. Informe de 2 a 4 líneas. Si un problema de seguridad no quedó resuelto, decirlo arriba de todo.

Nunca aprobar entornos de producción, cambiar secretos de Vercel o Supabase, cargar credenciales ni tocar la barra de pestañas de abajo.

### 1.1 Preguntas y decisiones pendientes del usuario

Las del 2026-11-18 y 2026-11-19 están respondidas en la SPEC §18 punto 11 y sus tareas en §5.6.

- El ícono de critiCal (`CriticalIcon`, arriba a la izquierda y en el ícono de la app) es relleno y la SPEC §14 pide íconos de línea. ¿Se pasa a línea de 2 px, o el logo queda relleno como excepción por ser la marca?

(Mascota: elegida, es Roy, ver §5.4 punto 1.)

## 0. Antes de empezar algo nuevo

1. **Terminá lo que está en curso.** Mirá la tabla de abajo y `gh pr list --state open`. Un PR abierto se termina (CI, Codacy, merge) antes de abrir otro, salvo los pausados a pedido del usuario (como el #68), que no frenan nada y siguen sin mergearse.
2. **Una sola corrida a la vez.** Las corridas automáticas de la cuenta original comparten el estado en `~/.claude/projects/-Users-hamsmac-IdeaProjects-critiCal/memory/production-ready-handoff.md` (línea `heartbeat:`): con un heartbeat de menos de 30 min, otra corrida trabaja y no se toca nada. **Desde otra cuenta** ese archivo no se ve: antes de seguir, pedile al usuario que frene en la cuenta anterior sus sesiones y tareas programadas (`critical-production-ready-relay-*` y `critical-sentry-watch`, en «Scheduled» de la app) y que confirme que no queda nada corriendo; recién ahí continuá. Mientras tanto, un commit o PR nuevo de otra cuenta en `gh pr list` / `git log origin/main` es señal de que sigue activa.
3. **Respondé en español rioplatense**, corto (respuesta primero, frases cortas).

## 1. En curso (actualizar siempre)

| Qué                                                                      | Estado                                                                        | Qué falta                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| PR #68 `claude/settings-a-search` (buscador arriba de Ajustes, mockup B) | Borrador, **atrasado**: `main` cambió `Settings.tsx` (#69)                    | **No mergear** hasta que el usuario lo pida.          |
| Ciclo del agente atacante sobre `main`                                   | **Cerrado** (SPEC §17) el 2026-11-19: 19 vueltas; la 19.ª sin Altas ni Medias | Nada urgente. Las Bajas de cada vuelta están en §5.3. |

Si en esta tabla hay un PR con checks corriendo, esperá y seguilo; no empieces otro tema. Un PR pausado a pedido del usuario (como el #68, que no se mergea hasta que lo pida) no frena el resto: se deja como está.

## 2. Reglas de trabajo (decididas por el usuario)

- **Un PR por tema**, rama `claude/<tema>`, en un worktree propio (`git worktree add .claude/worktrees/<tema> -b claude/<tema> origin/main`). La carpeta principal la usa otra tarea (vigilar Sentry cada hora): no cambies su rama ni dejes archivos sueltos ahí.
- **Validar antes de mergear** (cada merge a `main` despliega a staging y, si el E2E pasa, a producción; §17):
  1. `npx biome check .`, `npx tsc -b`, `npx vitest run` (con coverage en CI: 80 %).
  2. Probar en el **simulador de iPhone** (`mcp__Claude_Code_iOS_Simulator__control`, Safari contra el dev server), modo demo y cuenta de prueba local, como pide la SPEC §17. En corridas programadas el simulador no está disponible: ahí se usa el navegador integrado con viewport de iPhone (375×812) y se anota en el PR que la prueba en el simulador queda pendiente.
  3. **Agente atacante** (cambiado por el usuario el 2026-11-20): ya **no bloquea el merge**. Corre en segundo plano (subagente sin contexto técnico, solo la URL) contra `main` en local, una vez cada 2–3 PRs mergeados; **nunca** contra producción ni contra la preview hasta nuevo aviso. Si reporta algo Alto o Medio, se arregla primero, en un PR propio; las Bajas van a §5.3.
  4. Lo que reporte el atacante se arregla con tests (Altas y Medias primero, en su propio PR). **Freno** (§17): si la misma falla vuelve 3 veces, o hay 5 vueltas seguidas con fallas nuevas, parar y avisar al usuario con el detalle.
- **Merge**: solo con el CI en verde, Codacy en verde sobre el **último** commit y **sin hilos abiertos**. Squash. Responder cada hilo y resolverlo.
- **Después del merge**: esperar el workflow Deploy de `main`, revisar Sentry (sin issues nuevos) y una prueba rápida en https://critical-cal.vercel.app en modo demo.
- **Preguntas que son del usuario** y la SPEC no resuelve: anotarlas en §1.1 de este archivo (y, si existe, en la memoria local `pending-questions.md`) y seguir con otra cosa.
- **Nunca** contraseñas ni cuentas reales de Google o iCloud. Datos de prueba siempre inventados.

## 3. Cómo correr todo en local

- `supabase start` y, para el seed de la cuenta de prueba, `supabase db reset` (borra la base local).
- `apps/web/.env.local` del worktree (ignorado por git), con las claves de `supabase status` y `VITE_FAKE_PROVIDERS=1` (ver `.env.example`; ahí están también el email y la contraseña de la cuenta de prueba).
- Dev server de un worktree en otro puerto: `cd .claude/worktrees/<tema>/apps/web && npx vite --port 5178 --strictPort`. Los worktrees dentro de `.claude/worktrees/` usan el `node_modules` del checkout principal; uno creado en otra carpeta necesita su propio `npm ci` primero.
- Con `VITE_FAKE_PROVIDERS=1`, Google, iCloud, los mapas y Gemini responden datos inventados (`apps/web/api/_lib/fake-providers.ts`). «Reconectar Google» queda dentro de la app.

## 4. Problemas conocidos del entorno

- Un check que queda en curso más de 15 min en «playwright install --with-deps webkit» está colgado: `gh run cancel <id>` y `gh run rerun <id>`.
- El bash de macOS no tiene arrays asociativos: en scripts de monitoreo usá variables simples.
- Vitest ignora `apps/web/.env.local` (`vite.config.ts`, `test.env`); si un test cambia de comportamiento solo en tu máquina, revisá eso.
- Auto-fix de PRs no está disponible en corridas programadas.

## 5. Pendientes

El orden en que se hacen §5.1, §5.2 y §5.4 está en §5.4.

Marcá cada uno con ✅ en la SPEC al mergearlo y pasalo a la sección 6 hasta que cumpla todos los criterios de validación; recién ahí se borra de este archivo.

### 5.1 Guías de UI/UX del §14 (un PR por grupo)

1. ✅ **Mensajes y esperas**: hecho (#89: `Loading`, `Notice`, skeletons, errores con salida), ver §6.
2. **Formularios y botones**: ayuda bajo los campos no obvios, botones con verbo concreto, cada sección termina con una acción, nada pedido dos veces, estados vacíos útiles.
3. **Consistencia visual**:
   - ✅ Íconos de línea de 2 px desde `icons.tsx`, sin emojis como íconos de interfaz (PR de `claude/iconos-de-linea`). Falta el ícono de critiCal, que es relleno: pregunta en §1.1.
   - Espaciados y radios desde los tokens de `styles.css`.
   - ✅ Toques de 44 pt: todo lo que se dibuja más chico (píldoras de la semana, botones chicos, cerrar, íconos de la cabecera) tiene un área invisible de 44 px.
   - Números de silos que se animan con cifras tabulares.
4. **Interacción y animaciones**:
   - Transiciones con resorte, con fundido si el sistema pide reducir movimiento.
   - Respuesta optimista con reversión y aviso.
   - ✅ **Deshacer en vez de confirmar**: «Reiniciar demo» ya tiene Deshacer. El único `confirm` que queda es al cerrar sesión con cambios sin guardar, que no se pueden recuperar.
   - Gestos: deslizar un bloque para marcarlo y deslizar para cambiar de día o semana, siempre con su botón equivalente.
   - Háptica como extra.
5. ✅ **Accesibilidad**: hecha (#84: contraste AA, letra del sistema en `rem`, foco, diálogos, etiquetas, orden de lectura), ver §6.
6. **Primer uso guiado**: recorrido corto (conectar Google → primera materia o entrega → primer plan) que se puede saltar y retomar desde Ajustes.

### 5.2 Traslados en ómnibus (§15)

Las decisiones ya están en la SPEC: GTFS del STM, caché semanal en el servidor, rutas habituales guardadas y selector auto/ómnibus por lugar y por traslado. Es grande: conviene partirlo en datos y servidor primero, UI después.

### 5.3 Refuerzos sueltos (hallados por el agente atacante, no reproducidos como bugs)

- **20.ª vuelta del agente atacante** (2026-11-20, en segundo plano sobre `main` local después de #164, solo modo demo; sin Altas ni Medias). Arregladas en el PR de la vuelta: con letra al 200 % los botones Hecho / Parcial / No ya no se cortan a mitad de palabra (las filas de botones de hojas y tarjetas pasan a otra línea) y la duración de una parte («3 h») no se parte. No arregladas (Bajas):
  - El aviso «Corregido: …» con letra al 200 % ocupa 4 líneas y tapa la barra de arriba mientras dura.
  - Con letra grande, la grilla de la semana (píldoras, íconos, horas) no crece.
  - Mover una comida: la validación mira solo el inicio («entre las 09:00 y las 23:00»); un almuerzo de 1 h a las 22:30 termina 23:30, encima de la noche.
  - «Fijar acá» avisa sin «Deshacer» en el aviso (está solo en el ícono de la barra de arriba).
  - Tras tocar un bloque y cerrar su burbuja, el bloque queda con el aro de seleccionado un rato.
  - Las dos opciones de «No llegás a todo · elegí» usan el mismo dibujo de Roy y ocupan mucho alto; cuando desaparecen solas (el plan ya alcanza) no se avisa.
  - Para confirmar: «Reacomodar hoy» con levantada 11:00 y un bloque 10–12 sin responder dibuja un bloque angosto y uno diminuto pegados.
  - No probado: textos con HTML/JS, la tarjeta «¿A qué hora te levantaste?», recargar a mitad de un flujo, teclado completo y tema claro.
- **19.ª vuelta del agente atacante sobre `main`** (2026-11-19, después de #157; sin Altas ni Medias: con el criterio de la SPEC §17 el ciclo queda cerrado). Arregladas en el PR de la vuelta: la cabecera de la semana con letra al 200 % (el título «16 – 22 nov» se parte en dos líneas dentro de su ancho en vez de pisar la flecha «›», y la grilla de días deja de empujar al domingo fuera de la pantalla: la columna de horas cede y los días pueden encogerse) y el Deshacer a medias tras editar la misma entidad (`restoreState` ahora fusiona por campo: de cada tarea o materia que la acción tocó vuelve solo lo que la acción cambió y nadie volvió a cambiar; si un campo cambiado se editó después, no se pisa y el aviso dice «No se pudo deshacer todo: quedó …»). No arreglado (Baja): `withOrphanMarks` en `parseBackup` corre antes de mezclar con los registros más nuevos de la app (solo con archivos incoherentes).
- **18.ª vuelta del agente atacante sobre `main`** (2026-11-19, después de #156; sin Altas). Arregladas en el PR de la vuelta: el Deshacer de la Bandeja y de «Eliminar todo / de hoy en adelante» ya no pisa lo hecho mientras el aviso está visible (`restoreState` restaura solo lo que la acción tocó, entidad por entidad: vuelve lo borrado, devuelve a su versión anterior lo que la acción cambió y deja lo agregado o editado después; los registros nunca se borran: los de la silo vuelven con ella y los que la acción hubiera agregado se retiran con un registro `origin: "undo"`); un respaldo con una parte hecha y `doneByHand: false` que ningún registro declara se lee como hecha a mano (ya no se reabre al importar); la insignia de la pestaña Bandeja ya no se monta sobre el ícono con letra grande y el anillo de foco de «Semana anterior» ya no toca el título. No arreglado (Bajas): B1 las copias de Deshacer anteriores a la migración siguen sin `origin`; B2 un cliente viejo en caché contra la base nueva (transitorio).
- **17.ª vuelta del agente atacante sobre `main`** (2026-11-19, después de #155; sin Altas). Arregladas en el PR de la vuelta: la causa de fondo de las partes (cada parte guarda si fue marcada a mano, `task_units.done_by_hand`; está hecha si es a mano o si la declara el registro vigente de algún bloque, y `settleUnits` en `refresh` lo recalcula siempre, ya no se comparan fechas; también arregla la importación que dejaba partes que luego se reabrían solas y el caso de marca y registro en el mismo ms; respaldos viejos sin el campo se leen con la regla de la migración), «Eliminar todo» y «Eliminar de hoy en adelante» de un silo con Deshacer y foco, `check_ins.origin = 'undo'` para saber que un registro lo escribió Deshacer (una respuesta repetida a mano festeja), foco en la fila tras Deshacer de borrar una materia, enlace «Saltar a las pestañas» con `tabIndex`, avisos neutros ya no en rojo (`tone: "alert"` solo para rechazos), «Después de la entrega de `<nombre>` no» y placeholders «7:00» / «19:30». Migración `20261119100000_units_by_hand_checkin_origin.sql`, que hay que aplicar en Supabase antes de desplegar. No arreglado: B2 («Reacomodar semana» sin cambios) ya estaba resuelto en la 14.ª vuelta, se agregó un test; los registros de Deshacer anteriores a la migración (copias sin `origin`) no se marcan, solo los «retired».
- **16.ª vuelta del agente atacante sobre `main`** (2026-11-19, después de #154; sin Altas; registros y partes). Arregladas en el PR de la vuelta: «Llevo hechos» + minutos ya no deja que el siguiente registro reabra los temas (una parte solo cuenta como marcada por un registro si algún registro de la tarea la declara con esa misma fecha; las marcas a mano nunca se tocan; no hizo falta campo nuevo ni migración), Corregir arranca con las partes del registro vigente tildadas y ofrecidas aunque estén hechas, reabrir una parte desde el silo agrega un registro de corrección en vez de editar registros viejos, importar un respaldo marca solo con los registros vigentes, una copia agregada por Deshacer no vuelve a festejar «entrega cerrada» (`undoCheckIn` ahora es solo por `id`), y `loadData` pide el resto por rango cuando una tabla llega a 1000 filas (todas las tablas, no solo `check_ins`). Sin hallazgos abiertos de esta vuelta. Nota: un mismo registro repetido a mano tras una corrección (mismo estado, minutos y partes que uno anterior del bloque) cuenta como copia y no festeja.
- **15.ª vuelta del agente atacante sobre `main`** (2026-11-19, después de #153; sin Altas; todo en los registros de bloques). Arregladas en el PR de la vuelta: las tres Medias (corregir «Hecho (con parte)» a «No»/«Parcial» o deshacer una corrección dejaba partes marcadas o reabiertas de más: ahora las partes marcadas por un registro se recalculan desde los registros vigentes y las marcas a mano no se tocan; y «Deshacer» con cuenta no llegaba a la base porque `authenticated` no puede borrar `check_ins`: ahora deshacer agrega un registro —una copia del anterior, o uno «retired» que cuenta como sin registro—; migración `20261119090000_check_in_retired.sql`, que hay que aplicar en Supabase) y las Bajas de orden del registro vigente (por fecha y id, y la carga pide `order("created_at")`) y de corregir un bloque de la semana anterior (la semana sale del inicio del bloque, no de cuándo se registró). No quedan hallazgos abiertos de esta vuelta.
- **14.ª vuelta del agente atacante sobre `main`** (2026-11-19, después de #152; sin Altas). Arregladas en el PR de la vuelta: la Media (registrar un bloque desde su hoja daba «Ya registrado» sin aviso, sin «Deshacer» y sin salida: ahora «Hecho», «Parcial» y «No» avisan con «Deshacer» como la Bandeja, «Hice una parte» también, y un bloque ya registrado se corrige con una corrección nueva —el registro solo crece, cuenta la más nueva—; el globito ya no pide «Marcar cómo te fue» si está registrado) y las Bajas de arrastre sin motivo real tras la entrega o fuera del horario (`moveRefusal` también en el arrastre), enlace «Saltar a las pestañas» y `<main>`, «Reacomodar semana» sin cambios («Ya estaba acomodada», foco al botón, sin versión vacía en Deshacer), foco tras Deshacer de «Hoy no almuerzo» y `inboxCount` con igualdad en `rendimiento.test.tsx`. Quedan:
  - Baja: marcar «Hecho» en la demo hace aparecer «No llegás a todo» (el factor de avance; mismo origen que lo anotado de 240 min ≈ 200).
  - Baja: el aviso de movimiento rechazado tapa la barra de arriba 2,5 s.
  - Baja (`api/syllabus`): no valida que `pdf` sea base64 / empiece con `%PDF` antes de gastar cupo.
  - Baja (`api/_lib/caldav.ts`): los pedidos CalDAV no tienen `AbortSignal.timeout`.
  - Baja (`api/icloud-sync.ts`): el `upsert` de `calendars` no mira el error.
  - Baja (`api/travel`): la cola de geocodificación es global (un usuario puede demorar a los demás).
  - Baja (`api/account`): ignora el error de `google_channels`.
- **13.ª vuelta del agente atacante sobre `main`** (2026-11-19, después de #150; sin Altas). Arregladas en el PR de la vuelta: la Media (franja de rutina que no cae en la grilla de 30 min: formulario, respaldo y motivo de la Bandeja) y las Bajas de «Distinto según el día» pegado al botón y de los hábitos del respaldo sin `createdAt`. Quedan:
  - Baja: la tarjeta «¿A qué hora te levantaste?» de la Bandeja no validaba hora futura: arreglado (TODO §5.6 punto 8).
  - Baja: `/api/csp-report` es público: permite inyectar texto en el rastreador, su `limiter` es por instancia y acepta `chunked` sin `content-length`.
  - ✅ Baja (rendimiento de #150): `schedule` corre una vez más por cada tarea con déficit para ver si entra sola, y `options.ts` llama a `schedule` muchas veces. Medido con la demo + 5 rutinas imposibles: el plan tarda ~100 ms y las decisiones de la Bandeja ~850 ms. Se memoizó el chequeo por tarea mientras la tarea y el resto del input sean los mismos objetos (~15 % menos); el grueso es el costo de cada `schedule` de la demo (unos 35 ms por corrida), no el chequeo. Si molesta, bajar la cantidad de corridas de `options.ts`. Resuelto: las decisiones ya no se calculan dentro del render de cada toque; se calculan al pedirlas (Bandeja) o, para el contador, justo después de pintar.
- **12.ª vuelta del agente atacante sobre `main`** (2026-11-18, después de #139/#140):
  - Media: `isPermanent` (`apps/web/src/data.ts`) no reconoce `22P02` (regex `/^2[23]\d{3}$/`): ese error de la base se reintenta para siempre y traba los guardados siguientes.
  - Media: importar el respaldo de otra cuenta conserva los ids y choca con filas ajenas (RLS `42501`, tampoco permanente). Se resuelve con la decisión de dar ids nuevos (§5.6).
  - Baja: lo creado desde el calendario con título > 300 o fecha a más de 5 años se exporta pero no se reimporta.
  - Baja: materia con estudio semanal enorme pasada a Rutina en la Bandeja (`sortActivity` sin `validRoutine`) queda inimportable.
  - Baja: Deshacer de Ignorar/Materia/Rutina/Juntar/Es una materia/Evento suelto/Dejar como está deja el foco en el título «Bandeja» (`Inbox.tsx` busca `data-block-id`, que esas tarjetas no tienen).
  - Baja: «Estudio semanal» casi cero (`0,004`) se descarta o queda en 1 min sin aviso (`Subjects.tsx`).
  - Baja: `api/_lib/google-run.ts` ignora errores de base en `get_oauth_token`, `google_channels` y el `update` de `plan_blocks.google_event_id`; `api/transit.ts` da 401 ante un error de `check_cron_key` (como lo que #139 arregló en `cron.ts`).
  - Baja: el `limiter` de `_lib/rate.ts` se vacía al pasar de 1000 claves, así que ids de canal inventados reinician el límite del webhook.
  - A revisar por el usuario cuando quiera: los textos de los avisos nuevos de #139 («Todo sigue como estaba», «"X" ignorada») y los límites del webhook de Google (30 por minuto por canal, 120 por IP).

- **6.ª vuelta del agente atacante sobre `main`** (2026-11-18, después de #131). La Alta («Deshacer» de los avisos inerte con una hoja abierta) se arregló; el resto sin arreglar, por el freno:
  - Media: «Importar JSON» reemplaza todos los datos tras un `window.confirm` y sin «Deshacer» (§14: solo borrar la cuenta confirma).
  - Media: «Guardar avance» en una entrega con partes no da aviso y «Faltan» no se mueve (solo el mínimo); el silo del Parcial muestra 13 h arriba y 10 h abajo (horas estimadas distintas de la suma de partes).
  - Media: no hay cabeceras de seguridad en el repo (CSP, `frame-ancestors`/`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`). Confirmar si están en el panel de Vercel.
  - Baja: fecha límite imposible (`2026-02-30`, `24:00`) se reinterpreta sin avisar; fechas del cuatrimestre sin tope (`0001`/`9999`, congela ~4 s) y sin mensaje con «Empieza» imposible.
  - Baja: nombre de entrega sin tope y texto que se sale de la tarjeta en la Bandeja (falta `overflow-wrap:anywhere`); `parseBackup` no limita nombres ni IDs duplicados.
  - Baja: el formulario de una materia corrige en silencio valores raros (0, negativos, 9999) y acepta un nombre invisible (U+200B).
  - Baja: «Ya hay una materia o rutina con ese nombre» sin `role="alert"`; Hoy con «25:99» dice «NaN h»; hora imposible en «Prefiero desde» da un mensaje equivocado.
  - Baja: marcar otro lugar como «Es mi casa» le saca el 🏠 al anterior sin avisar.
  - Baja: `viewport` con `maximum-scale=1, user-scalable=no` impide el zoom (WCAG 1.4.4).
  - Baja: `POST /api/widget` rota el token con cualquier cuerpo (una acción mal escrita rompe el widget) en vez de dar 400.
  - Baja: presupuesto de peticiones por usuario solo en `/api/transit`; faltan en `/api/travel` y `/api/syllabus`.

- **5.ª vuelta del agente atacante sobre `main`** (2026-11-18, después de #121). Sin arreglar, por el freno:
  - **Alta**: el avance registrado en una entrega descuenta también a otras entregas de la misma materia (una entrega nueva con una parte de 60 min muestra «faltan 44m» sin avance propio).
  - **Alta**: «Faltan» de una entrega con partes no coincide con las partes que quedan (se descuentan los minutos registrados además de las partes; la pantalla dice que lo que falta se mide por las partes).
  - **Alta**: al mover un bloque con el teclado, la comida que se corre queda encima del estudio (almuerzo 14:30–15:30 sobre un bloque 15:00–17:00).
  - Media: «Dedicarle menos a Leer (mínimo 10 h)» dice «llegás a todos los mínimos» pero deja Leer en 8 h y achica un bloque de otra entrega.
  - Media: «Deshacer» de «Usar tiempo libre para llegar al objetivo» saca la decisión pero no el bloque que agregó.
  - Media: «Hacelo por hoy» no ofrece Deshacer y deja el foco en el «Deshacer» de otra decisión.
  - Media: «Esta semana: planificado vs. hecho» no se actualiza hasta recargar.
  - Media: Ajustes → Hoy acepta «me levanté 23:00, me acuesto 06:00» y arma un día absurdo (tiene «Deshacer: ajustar el día»).
  - Baja: foco en `<body>` tras «Guardar parcial» (Bandeja), «Listo» del modo edición y el último «Deshacer: mover o fijar un bloque»; Editar entrega acepta horas estimadas 0 con partes que suman 10 h; una parte marcada no se puede desmarcar desde la hoja del silo; en Rutinas los errores salen de a uno y Enter no agrega; bloques de la grilla con zona tocable menor a 44 px (comidas 30×15).

- **Contraste AA que quedó sin cerrar en #84** (SPEC §14 «Contraste AA» sin ✅): en modo claro, las opciones de `ActionSheet` usan `#0a72ff` sobre blanco (4,32:1, menos de 4,5:1); se ve, por ejemplo, al desactivar un hábito. Oscurecer el azul de texto y revisar el resto de los textos azules.
- **Borradores de Ajustes** (caso muy raro, decidido no arreglarlo en #90): si otro dispositivo cambia una fecha guardada del cuatrimestre con Ajustes abierto y se vuelve a tipear la fecha vieja, el borrador se borra y se pierde la edición (`useDraft`, `Semester.tsx`).
- Avisos (agente atacante sobre #73): «Deshacer» dura 6 s y por teclado no se llega a tiempo (WCAG 2.2.1: ofrecer más tiempo o un atajo); el aviso tapa la mitad del botón «Guardar» en las hojas; mover un bloque sin consecuencias o «Fijar acá» no ofrecen «Deshacer»; con camino crítico activo se apilan dos avisos rojos que repiten el faltante.
- Semana (agentes atacantes sobre #76 y #78, anteriores a esos PRs):
  - Después de «Fijar acá» el foco queda en `<body>`.
  - «Deshacer» sobre una semana que no estás viendo deshace sin mostrar dónde (llevar a esa semana o nombrarla en el aviso).
  - Arrastrar a un día pasado (o a una hora sin lugar) vuelve sin decir por qué.
  - El botón flotante de camino crítico tapa la esquina de abajo a la derecha del domingo.
- Comidas (#80, detalles que quedaron): en una propuesta por una comida, «Dejar como está» igual saca el bloque de debajo (§5.1: nunca estudio encima; falta un texto propio para ese caso); al volver a poner una comida sacada se olvida la hora a la que se había movido; las acciones de comidas no entran en el historial de «Deshacer» de arriba (solo en el aviso); después de «Reacomodar» el aviso de abajo sigue mostrando el anterior.
- Silos (agente atacante sobre #77): «Archivar» no tiene Deshacer y no hay dónde ver lo archivado.
  - La hoja de un hábito pide «Temas en total».
  - Registrar 240 min de avance descuenta ~200 (el factor de descanso o de aprendizaje no se explica en pantalla).
- Semana (3.ª vuelta sobre #76): arrastrar no avisa nada (y hoy hace desaparecer la cena: lo resuelve §18.2).
- Comidas (agente atacante sobre #80, anteriores a ese PR):
  - Mi semana corrige en silencio valores raros (duración «-20» queda en 0, o sea sin esa comida); la fila de Ajustes muestra el horario de un solo día («09:00 – 00:00») aunque los días difieran; el desayuno puede caer antes de «arreglarse».
  - Con la hoja de Ajustes abierta, el lector de pantalla llega a la grilla de atrás; una alerta de validación queda visible después de volver.
  - Días pasados muestran el plan congelado con las comidas recalculadas: puede verse estudio al lado de una comida de un día que ya pasó.
  - Una comida movida a 23:59 queda como una rayita al pie del día, difícil de tocar.
- Lugares (agente atacante sobre #79, anteriores a ese PR):
  - `spotKey` borra los emojis: «🏠🎉 de 👵» y «💼 de 🏢» quedan las dos como «de» y comparten minutos.
  - Una dirección que contiene «Casa» («Casa de la abuela Marta») se toma como la casa; la dirección exacta de casa en minúsculas no.
  - Se puede guardar un lugar con nombre repetido («Casa» dos veces).
  - Enter no confirma los minutos de la Bandeja ni el nombre de «Guardar como lugar»; «abc» en minutos vuelve al valor anterior sin aviso; los errores no marcan el campo con `aria-invalid`.
  - En la Bandeja, marcar «Guardar como lugar» no lleva el foco al nombre; cambiar los minutos de un traslado muestra «Un evento nuevo pisa…» aunque no hay evento nuevo; los avisos tapan la última fila de las hojas.
  - Los campos de minutos de las tarjetas de la Bandeja tienen todos el mismo nombre; «Abrir evento ›» del globito no se anuncia como botón; una dirección larguísima se muestra entera.

### 5.4 Próximos desarrollos (SPEC §18, pedidos del 2026-11-06)

Un PR por punto. Las respuestas del usuario están en el §18 (todas respondidas el 2026-11-06). **Orden**: 6 → 5 → 3 → 4 → 2 → 7 → 1 (con el resto del §14 de 5.1) → ómnibus (5.2) → 8. Hechos: 2–7. Roy (§1) y Dependabot ya están (`Roy.tsx`, `.github/dependabot.yml`). Lo que sigue: el resto de §5.1 (Formularios y botones, Consistencia visual, Interacción y animaciones, Primer uso guiado), un PR por grupo; ómnibus (§15) y Bun (§18.8), los dos grandes (partirlos).

1. Psicología de UX del video: valores por defecto, gradiente de meta, valor antes del registro, efecto IKEA, encuadre de pérdidas y **compensar el camino infeliz con gracia** (lo que más quiere ver): texto con humor + **Roy** (escalera de Jacob toon 3D, estilo A · Madera pintada, elegido; animación por caso en SPEC §18.1) como personaje y animación de carga. Implementarlo enchufándolo al `<Loading>` de la sesión `esperas-errores`. Textos y esperas: sesión hija `esperas-errores`.
2. Hecho (#80, validado en producción). Queda: arrastrar comidas como a los bloques.
3. Hecho (#78, validado en producción).
4. Hecho (#79, validado en producción).
5. Hecho (#77, validado en producción).
6. Hecho (#76, validado en producción).
7. Hecho (#82, validado en producción). «Empezar antes» en la Bandeja: mergeado (#87), ver §6.
8. Bun como gestor de paquetes y para correr los scripts; medir el motor antes de pensar en Rust/WASM.

### 5.6 Decisiones del 2026-11-18 para implementar (SPEC §18 punto 11)

Un PR por tema, con la SPEC actualizada en el mismo PR:

1. ✅ Comidas cuando te levantás tarde (#142).
2. ✅ Horarios válidos por rutina y por día (#146). Falta: un día «sin horario válido» y la franja en feriados con rutina prestada.
3. ✅ Rutina creada a mitad de semana, proporcional y redondeando hacia arriba (#147).
4. ✅ Una tarea que no entra ni sola no marca críticos a las demás (#150).
5. ✅ Respaldo: ids nuevos al importar con cuenta y extras mal formados descartados con aviso (#144, que también arregla `isPermanent` con `22P02` y `42501`).
6. ✅ Ajustes → Hoy: «Me levanté» no puede ser futura (#143).
7. CSP completa: en modo `Content-Security-Policy-Report-Only` desde #145 (reportes a `/api/csp-report`, que los manda como errores «CSP: …» a Better Stack, #148). Falta: revisar los reportes unos días con uso real y pasarla a `Content-Security-Policy`.
8. ✅ Tarjeta «¿A qué hora te levantaste?» de la Bandeja: no acepta una hora que todavía no pasó («Todavía no son las HH:MM.»), ni siquiera la supuesta si todavía no llegó.

## 6. Mergeado, falta confirmar la validación en producción

Borrar cada uno cuando se confirme (atacante limpio + prueba en prod + Sentry sin issues nuevos).

- **Trabajo del 2026-11-18/19, mergeado y desplegado** (staging y producción en verde): #123–#128 (capturas), #130–#131 y #132–#140 (vueltas 5–11 del atacante), #141 y #149 (decisiones y TODO), #142 comidas al levantarse tarde, #143 «Me levanté» no futura, #144 respaldo con ids nuevos, #145 CSP en modo reporte, #160–#162 (19.ª vuelta y tarjeta de la Bandeja sin hora futura), #146 horarios por rutina y día (migración `valid_hours`), #147 rutina proporcional, #148 Better Stack, #150 tarea imposible no marca críticas, #151–#157 vueltas 13–18 (migraciones `check_in_retired` y `units_by_hand_checkin_origin`). Falta verificar:
  - Prueba en producción en modo demo y en el simulador de iPhone (todo se probó solo en local con WebKit de Playwright y jsdom): hoja de bloque con Hecho/Parcial/No/Corregir y su Deshacer, Bandeja (Deshacer de cada acción), Rutinas con «Distinto según el día», comidas al levantarse tarde, letra grande y tema oscuro.
  - Con cuenta real (nunca probado contra Supabase): importar un respaldo de otra cuenta o del demo (ids nuevos), Deshacer después de guardar (registro `retired` / `origin: "undo"`, que no reaparezca al recargar), carga paginada con más de 1000 registros.
  - Better Stack (`errors.betterstack.com`, aplicación «critiCal»): que no aparezcan errores nuevos tras el uso real, y revisar los reportes «CSP: …» unos días; si no hay nada roto, pasar la CSP a `Content-Security-Policy` (TODO §5.6 punto 7).
  - CI: #158 (cache de Playwright) mergeado el 2026-11-19; comprobar en una corrida que el log diga «Cache restored».
  - Pi-hole del usuario: `*.betterstackdata.com` (envío de errores) está permitido. `errors.betterstack.com` (el panel) puede seguir bloqueado: si no abre, pedile que lo permita.

- Arreglos de las capturas del 2026-11-18 (SPEC §18.10), mergeados el 2026-11-18: #124 materias que volvían, #127 avisos arriba, #128 Roy al doble, #123 fecha de un silo, #126 «Editar» de lugares, #125 bloques seguidos en una píldora (incluye ocultar la barra de Vercel en los E2E del preview, que tapaba el cierre de la hoja). Falta la vuelta del atacante, la prueba en producción en modo demo y revisar Sentry.
- #111 Arreglos visuales (SPEC §18.9): mergeado el 2026-11-17. Falta la prueba en el simulador de iPhone (se probó en el navegador a 375×812), la prueba en producción en modo demo y revisar Sentry.
- #84 Accesibilidad (§14, hallazgos de §5.3): falta la prueba en producción en modo demo (tamaño de letra, foco con teclado, ventanita de un bloque) y revisar Sentry.
- #89 Mensajes y esperas: la vuelta del atacante en la **preview** no se hizo (Vercel la protege con login, el enlace compartible da 403; decisión del usuario). Falta la prueba en producción en modo demo (carga, sin conexión, Reintentar) y revisar Sentry.
- #90 Refuerzos de Ajustes (borradores, «atrás» del sistema, nombre repetido, validación de `settings.data`): falta la prueba en producción y revisar Sentry.
- #96 Migración `settings_data_check` con fecha posterior a `start_after` (el Deploy de `main` fallaba al migrar staging con `supabase db push`): Deploy de `main` ok; falta confirmar que la migración se aplicó en producción y revisar Sentry.
- #87 «Empezar antes» en la Bandeja: desplegado a producción el 2026-11-07 (el deploy de `main` se repitió sobre el mismo SHA `aff9f1f`, que seguía siendo el último de `main`). Falta la prueba en prod y revisar Sentry. Si un deploy vuelve a fallar por el límite de Vercel y ya hay otro merge, lanzá un Deploy nuevo sobre el `main` actual en vez de `gh run rerun`.
