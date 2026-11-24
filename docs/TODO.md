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
4. Arreglo: worktree nuevo desde `origin/main` en la rama `claude/sentry-<issue>`, test de regresión, `bunx biome check .`, `bunx tsc -b`, `bunx vitest run` (y `supabase test db` si toca `supabase/`), «Fixes CRITICAL-N» en el commit y en el PR.
5. Mergear con las reglas de §2 (Codacy en verde sobre el último commit, sin hilos ni hallazgos pendientes); si todavía no terminó, dejarlo abierto para la corrida siguiente.
6. Confirmar el deploy de `main` y marcar el issue como resuelto en Sentry, con el link al PR.
7. Informe de 2 a 4 líneas. Si un problema de seguridad no quedó resuelto, decirlo arriba de todo.

Nunca aprobar entornos de producción, cambiar secretos de Vercel o Supabase, cargar credenciales ni tocar la barra de pestañas de abajo.

### 1.1 Preguntas y decisiones pendientes del usuario

Las del 2026-11-18, 2026-11-19 y 2026-11-21 están respondidas en la SPEC §18 puntos 11 y 12; sus tareas en §5.6 y §5.7.

(Mascota: elegida, es Roy, ver §5.4 punto 1.)

- ~~Borradores de formularios~~: respondida el 2026-11-22 (las dos cosas: borrador al recargar y confirmar al descartar), hecha en #213.

## 0. Antes de empezar algo nuevo

1. **Terminá lo que está en curso.** Mirá la tabla de abajo y `gh pr list --state open`. Un PR abierto se termina (CI, Codacy, merge) antes de abrir otro, salvo los pausados a pedido del usuario (como el #68), que no frenan nada y siguen sin mergearse.
2. **Una sola corrida a la vez.** Las corridas automáticas de la cuenta original comparten el estado en `~/.claude/projects/-Users-hamsmac-IdeaProjects-critiCal/memory/production-ready-handoff.md` (línea `heartbeat:`): con un heartbeat de menos de 30 min, otra corrida trabaja y no se toca nada. **Desde otra cuenta** ese archivo no se ve: antes de seguir, pedile al usuario que frene en la cuenta anterior sus sesiones y tareas programadas (`critical-production-ready-relay-*` y `critical-sentry-watch`, en «Scheduled» de la app) y que confirme que no queda nada corriendo; recién ahí continuá. Mientras tanto, un commit o PR nuevo de otra cuenta en `gh pr list` / `git log origin/main` es señal de que sigue activa.
3. **Respondé en español rioplatense**, corto (respuesta primero, frases cortas).

## 1. En curso (actualizar siempre)

| Qué                                    | Estado                                                                                                                                                                                          | Qué falta                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Ciclo del agente atacante sobre `main` | En segundo plano cada 2–3 PRs mergeados; la última es la 29.ª (2026-11-23, Medias arregladas en #238, Altas resueltas con decisiones del usuario en #239 y #240); la 30.ª toca tras 2–3 PRs más | Nada urgente. Las Bajas de cada vuelta están en §5.3. |

Si en esta tabla hay un PR con checks corriendo, esperá y seguilo; no empieces otro tema. Un PR pausado a pedido del usuario (como el #68, que no se mergea hasta que lo pida) no frena el resto: se deja como está.

## 2. Reglas de trabajo (decididas por el usuario)

- **Un PR por tema**, rama `claude/<tema>`, en un worktree propio (`git worktree add .claude/worktrees/<tema> -b claude/<tema> origin/main`). La carpeta principal la usa otra tarea (vigilar Sentry cada hora): no cambies su rama ni dejes archivos sueltos ahí.
- **Validar antes de mergear** (cada merge a `main` despliega a staging y, si el E2E pasa, a producción; §17):
  1. `bunx biome check .`, `bunx tsc -b`, `bunx vitest run` (con coverage en CI: 80 %).
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
- Dev server de un worktree en otro puerto: `cd .claude/worktrees/<tema>/apps/web && bunx vite --port 5178 --strictPort`. Los worktrees dentro de `.claude/worktrees/` usan el `node_modules` del checkout principal; uno creado en otra carpeta necesita su propio `bun install` primero (desde #202 el repo usa Bun; nunca enlazar `node_modules` con un junction).
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
2. **Formularios y botones** (✅ botones con verbo: sin «OK» ni «Listo» sueltos, con test; ✅ Silos vacío explica qué va y apunta a «Nueva»; ✅ ayuda bajo los campos no obvios, #198): ✅ estados vacíos útiles en Bandeja, Rutinas, Lugares y Materias, con su acción y tests unitarios y E2E): botones con verbo concreto, cada sección termina con una acción, nada pedido dos veces. Hecho.
3. **Consistencia visual**:
   - ✅ Íconos de línea de 2 px desde `icons.tsx`, sin emojis como íconos de interfaz (PR de `claude/iconos-de-linea`). Falta el ícono de critiCal, que es relleno: pregunta en §1.1.
   - ✅ Espaciados (#183) y radios desde los tokens de `styles.css` (`--radius-round` para círculos; `radiusTokens.test.ts` falla ante un radio literal).
   - ✅ Toques de 44 pt: todo lo que se dibuja más chico (píldoras de la semana, botones chicos, cerrar, íconos de la cabecera) tiene un área invisible de 44 px.
   - ✅ Números de silos que se animan con cifras tabulares (`CountUp`: cuentan hasta el valor nuevo en 450 ms; con «reducir movimiento» saltan).
4. **Interacción y animaciones**:
   - Transiciones con resorte, con fundido si el sistema pide reducir movimiento.
   - ✅ Respuesta optimista con reversión y aviso (#199: tras guardar se muestra la copia de la base; lo rechazado vuelve y avisa).
   - ✅ **Deshacer en vez de confirmar**: «Reiniciar demo» ya tiene Deshacer. El único `confirm` que queda es al cerrar sesión con cambios sin guardar, que no se pueden recuperar.
   - ✅ Gestos: deslizar para cambiar de semana (#180) y deslizar una tarjeta de «¿Cómo te fue?» en la Bandeja para marcarla hecha (derecha) o no hecha (izquierda), con los botones de siempre y el mismo «Deshacer». En la grilla de la Semana no se marca deslizando (choca con deslizar de semana y con arrastrar).
   - ✅ Háptica como extra: `navigator.vibrate(10)` al marcar y al empezar un arrastre donde exista; en iPhone no hay API y no se hace nada.
5. ✅ **Accesibilidad**: hecha (#84: contraste AA, letra del sistema en `rem`, foco, diálogos, etiquetas, orden de lectura), ver §6.
6. ✅ **Primer uso guiado** (`FirstSteps.tsx`, falta verlo con una cuenta real): recorrido corto (conectar Google → primera materia o entrega → primer plan) que se puede saltar y retomar desde Ajustes.

### 5.2 Traslados en ómnibus (§15)

Datos, servidor e interfaz mergeados (la interfaz en #185: modo por lugar, columna `places.travel_mode`, y por evento, con la ida casa → evento en la tarjeta del evento). Falta, un PR cada uno:

1. ✅ Que el plan reserve el tiempo del ómnibus (#190: minutos puerta a puerta guardados de `/api/transit`, ida y vuelta desde casa; sin dato, los de auto con aviso en la tarjeta).
2. ✅ La vuelta (evento → casa) como viaje propio (#193).
3. ✅ Rutas habituales (`bus_routes`) desde la interfaz (#193).
4. ✅ Probar la tarjeta del evento: la «Demo de pruebas» trae dos eventos futuros en Ómnibus (con horarios inventados, `demoTransit.ts`, sin cuenta ni red: uno con plan y transbordo, otro en un lugar sin datos de tránsito) y `e2e/omnibus.spec.ts` lo recorre en WebKit 375×812: solo líneas y hora de salida de ida y vuelta, paradas y transbordos al tocar, el plan reserva los minutos del ómnibus antes y después, sin dato usa el auto con aviso, la fuente está en Ajustes (grupo Cuenta) y no en la tarjeta, sin desbordes y campos ≥ 16 px. Falta solo verlo con la cuenta real contra el Supabase y la API de verdad.

### 5.3 Refuerzos sueltos (hallados por el agente atacante)

Las listas de las vueltas 5–21 se revisaron una por una el 2026-11-21/22 (#186–#188, #194–#197): lo vigente se arregló y lo que ya no pasaba quedó fijado con tests (el detalle de cada ítem está en la descripción de cada PR). Queda:

- **Decisiones del usuario del 2026-11-22** (ya implementadas; SPEC §5 y §7):
  - **El pasado nunca se recalcula** (#210). Única excepción: un evento externo (Google/iCloud) borrado deja de mostrarse y su tarea pasa a «dropped», pero se conserva el tiempo dedicado registrado.
  - **Casa única y solo por el interruptor «Mi casa»** (#209): el nombre «Casa» no la sugiere por texto; con una casa marcada no se ofrece marcar otra.
  - **Comidas guardadas por tramos** (comida × día de la semana, tabla `meal_runs`, #210): al abrir se congelan los días hasta ayer, así los días pasados muestran dónde estuvo cada comida.
- **25.ª vuelta** (2026-11-23, en segundo plano sobre `main` local con #216, #218 y #220, solo modo demo): **sin Altas**. La Media (duración 0 de una comida borraba el pasado) y las Bajas de comidas y respaldo se arreglaron en #223; las de rutinas (etiqueta de semana, «mínimo 0h», Gym del domingo 22:30) en #222. Quedan Bajas: Las cinco Bajas restantes (tope de largo en dirección y alias, «Guardar parcial» idempotente, borradores uniformes con Escape/arrastre/«‹ Ajustes»/«Cancelar», datos raros —fecha pasada con aviso, cuatrimestre pasado o de 1 día, semanas hasta 2000–año+5, bidi— y aviso al arrastrar una comida pasada) se arreglaron en #225.
- **26.ª vuelta** (2026-11-23, en segundo plano sobre `main` local, solo modo demo): **sin Altas ni Medias**, solo Bajas. Arregladas en el PR «Comidas de hoy que ya empezaron…»: (1) cambiar Mi semana conserva las comidas de hoy que ya empezaron (se escriben como tramos `mealRuns` que arrancan hoy, `keepStartedMeals`; las que faltan toman lo nuevo y el cierre de mañana no las pisa); (2) los mensajes de error del importador citan los textos sin caracteres bidi ni invisibles (`stripInvisible`); (3) Lugares valida nombre (60) y dirección (200) al guardar; (4) el importador pone tope de 500 partes por tarea con aviso claro; (5) con letra al tope la tarjeta «Primeros pasos» deja la grilla de la Semana en ≥ 400 px (E2E `letra-grande-semana`). **No son errores**: una rutina atrasada sin sesiones en una semana sobrecargada, y que la navegación de semanas llegue a 2021–2029.
- **29.ª vuelta** (2026-11-23, en segundo plano sobre `main` local, modo demo con datos sucios de vueltas anteriores, 375×812). Arreglado en #238: «Ver anteriores» usaba la semana enfocada y escondía lo que vence esta semana; «No hace falta traslado» ahora tiene Deshacer. Las dos Altas no eran bugs y se resolvieron con decisiones del usuario: «Hecho» con partes pregunta cuáles hiciste, se puede seguir sin elegir (#240); los bloques de hoy anteriores a «Me levanté» quedan «no hecho · dormías» y el día se replanifica desde esa hora (#239, migración `check_in_slept`). Además, #240 sacó las notas explicativas que había sumado #238: la UI va limpia, que lo digan los botones. **Quedan Bajas:** espacios múltiples y caracteres invisibles o bidi que se conservan en el dato (se ven normalizados); «Materia Zeta», creada con «+ Nueva…», sin la etiqueta «· materia» en Ajustes → Materias; unidades poco claras en «planificado vs. hecho»; un bloque «dormías» sigue diciendo «crítico: no llega a tiempo» en su `aria-label`. **Lo que no probó:** deslizar en la Bandeja, exportar e importar un respaldo válido, letra grande, Ómnibus, Lugares, Mi semana, Comidas, recargar a mitad de un formulario, editar entregas archivadas, repaso espaciado.
- **28.ª vuelta** (2026-11-23, en segundo plano sobre `main` local, solo modo demo, 375×812): 1 **Alta**, 2 Medias y Bajas. Arregladas en el PR «28.ª vuelta…»: (**Alta**) Silos > Nueva > «Entrega / parcial» con Materia «+ Nueva…» y un nombre igual a una materia existente salvo mayúsculas/espacios («cálculo ii» con «Cálculo II») cerraba la hoja y la entrega desaparecía (el reductor descartaba el guardado por el nombre repetido); ahora el editor usa la materia que ya existe (`sameName`) y la entrega queda en ella. (Media 1) Planificación semanal: «No llega al mínimo» solo culpa a lo que vence dentro de la semana a planear o después (antes culpaba a entregas que vencían antes de esa semana) y, si hay faltantes, ya no dice «hay margen en todo». (Media 2) «Tu semana tipo» cuenta solo las rutinas activas (no las pausadas, terminadas ni descartadas). Bajas: horas con dígitos de ancho completo («１２») dan un solo error (se saltea el «mínimo mayor que…»); la fecha límite con año pasado del tope falla al cambiar el campo, no al guardar; el título largo en la hoja de detalle se corta a tres líneas con `overflow-wrap` (el tope de 80 de `TITLE_MAX` ya rige al tipear: el largo viene de datos importados o sembrados); las horas vacías de un borrador restaurado no muestran error hasta tocar o guardar, y con las horas borradas «Es un parcial» vuelve a sugerir; un lugar con nombre solo invisible se ve como «Sin nombre». Migas repetidas en Ajustes > Rutinas > Crear rutina nueva: decidido el 2026-11-23, queda solo «‹ Rutinas» (en curso, hija de las Bajas de la 27.ª).
- **27.ª vuelta** (2026-11-23, en segundo plano sobre `main` local, solo modo demo, 375×812): **sin Altas**, 2 Medias y varias Bajas. Arregladas en el PR «27.ª vuelta…»: (1) la comida de hoy conservada ya no desaparece al volver Mi semana: el desayuno de las 01:30 seguía en los datos pero quedaba fuera de la grilla de la Semana (que va del despertar más temprano a la hora de acostarse); ahora la grilla se ensancha para incluir las comidas conservadas; (2) los nombres de solo caracteres invisibles (RLO + U+200B + U+200C…) se rechazan como vacíos en Lugares, Silos, Rutinas, Materias y al guardar un lugar desde una dirección (`isBlank` usa la misma lista que `stripInvisible`, con más invisibles: Hangul/braille en blanco, U+034F…); (3) «Saltar por ahora» de Primeros pasos deja pasar el segundo toque del doble toque (misma guarda de 400 ms que al cerrar una hoja); (4) el estado vacío del buscador de Ajustes cita la búsqueda sin bidi ni invisibles; (5) «Rutina nueva» saca el RLO al tipear; (6) etiquetas asociadas con `for`/`id` en Mi semana (Me levanto, Me acuesto), Hoy y Silos > Nueva (horas estimadas, mínimo, «Es un parcial»). **«La Semana de fondo no queda inert con una hoja abierta»**: no se reprodujo, Ajustes, Silos > Nueva y la burbuja de un bloque ponen `inert` a la Semana, el encabezado y la barra de pestañas (test `atacante27`). **Quedan Bajas (no se arreglaron):** «Guardar para L M M J V» es ambiguo en la etiqueta visible (el `aria-label` sí es correcto); el toast de «Deshacer» tapa las flechas y el título de la semana; las tarjetas «¿Dónde es?» de la Bandeja tienen un scroller interno. **Lo que el atacante no probó** (para la próxima vuelta): deslizar tarjetas de la Bandeja, importar/exportar respaldo, letra grande, Ómnibus y la Planificación semanal.
- **24.ª vuelta** (2026-11-22, en segundo plano sobre `main` local con #208 y #209, solo modo demo): **sin Altas ni Medias**. Bajas 1–3 arregladas en #211 (Planificación semanal dice de qué semana es; Silos dice «la semana próxima» tras planearla; casa sin dirección avisa «Tu casa no tiene dirección»). La 4.ª (Escape descarta sin aviso el formulario de un silo nuevo) quedó resuelta con los borradores (#213).
- **23.ª vuelta** (2026-11-22, en segundo plano sobre `main` local después de #206, solo modo demo; sin Altas). Arreglada en el PR de la vuelta: la Media del doble toque (el segundo toque, tras cerrar una hoja con «Guardar avance» o «Eliminar», caía en lo de abajo: la barra de pestañas o la fila siguiente; ahora un toque real en los 400 ms siguientes a cerrar una hoja, fuera de otra hoja abierta, se descarta). La Media dudosa (Planificación semanal un domingo resumía la semana que terminaba ese día) se resolvió en #208: la planificación es siempre de la semana próxima. Bajas:
  - Los mensajes de validación que aparecen o se van corren el botón o el campo que ibas a tocar (Rutinas, Materias).
  - Buscador de Ajustes sin resultados: la hoja se achica y un toque donde estaba el campo cae en el fondo y cierra Ajustes.
  - Escape no cierra Ajustes con el foco en un `<input type="time">` (a propósito: el selector nativo se cierra primero; hay que salir con Tab).
  - Recargar con un formulario abierto pierde el borrador y vuelve a la Semana (espera la decisión de borradores, §1.1).
  - Notificaciones en demo: las casillas se pueden tocar aunque no funcionan sin cuenta.
  - Tema claro: la hoja de Ajustes deja ver la semana a través del fondo.
  - Un aviso tapa los botones de la cabecera unos segundos.
  - No probado: exportar e importar un respaldo válido, Mi semana, tarjeta de evento con Auto/Ómnibus, Lugares, «Reacomodar hoy» / «Reiniciar demo», arrastre táctil real.
- **22.ª vuelta** (2026-11-22, en segundo plano sobre `main` local después de #199, solo modo demo; sin Altas). Las tres Medias (doble «Guardar» en Silos → Nueva duplica, doble Deshacer tras «Fijar acá», lugar en ómnibus sin dirección) y dos Bajas (nombre accesible de silos archivados, hojas cerradas sin `inert`) se arreglaron en #204; las de letra grande y avisos largos, en #205. Queda:
  - No probado: tema claro, lector de pantalla real, Tab completo, arrastrar con precisión, Rutinas extremas, tarjeta de un evento con Auto/Ómnibus, recargar a mitad de un formulario, silos con partes.
- **No se arreglan (decisiones, a revisar por el usuario si quiere)**:
  - Borradores de Ajustes con fecha cambiada desde otro dispositivo (#90/#197: caso muy raro).
  - `/api/csp-report`: el `limiter` es por instancia (#197: un tope compartido necesita Redis/KV).
  - Las copias de Deshacer anteriores a la migración siguen sin `origin` (18.ª, B1) y un cliente viejo en caché contra la base nueva (18.ª, B2, transitorio).
- A revisar por el usuario cuando quiera: los textos de los avisos de #139 («Todo sigue como estaba», «"X" ignorada») y los límites del webhook de Google (30 por minuto por canal, 120 por IP).

### 5.4 Próximos desarrollos (SPEC §18, pedidos del 2026-11-06)

Un PR por punto. Las respuestas del usuario están en el §18 (todas respondidas el 2026-11-06). **Orden**: 6 → 5 → 3 → 4 → 2 → 7 → 1 (con el resto del §14 de 5.1) → ómnibus (5.2) → 8. Hechos: 2–7. Roy (§1, con el camino infeliz completo desde el 2026-11-23, ver SPEC §18.1; los valores por defecto aprendidos están hechos; el efecto IKEA «Tu semana tipo» también está hecho: la psicología de UX del §18.1 está completa) y Dependabot ya están (`Roy.tsx`, `.github/dependabot.yml`). Hecho el 2026-11-22: Bun (#202, §18.8) y el buscador de Ajustes rehecho sobre `main` (#201, reemplaza al #68, cerrado). Háptica y deslizar un bloque quedaron fuera: el usuario eligió solo deslizar la semana.

1. Psicología de UX del video: valores por defecto, gradiente de meta, valor antes del registro, efecto IKEA, encuadre de pérdidas y **compensar el camino infeliz con gracia** (lo que más quiere ver): texto con humor + **Roy** (escalera de Jacob toon 3D, estilo A · Madera pintada, elegido; animación por caso en SPEC §18.1) como personaje y animación de carga. Implementarlo enchufándolo al `<Loading>` de la sesión `esperas-errores`. Textos y esperas: sesión hija `esperas-errores`.
2. Hecho (#80, validado en producción; arrastrar comidas, #108).
3. Hecho (#78, validado en producción).
4. Hecho (#79, validado en producción).
5. Hecho (#77, validado en producción).
6. Hecho (#76, validado en producción).
7. Hecho (#82, validado en producción). «Empezar antes» en la Bandeja: mergeado (#87), ver §6.
8. ✅ Bun como gestor de paquetes y para correr los scripts (#202); la medición del motor y la conclusión sobre Rust/WASM están en la SPEC §18.8.

### 5.5 Idea futura (sin hacer)

- Un segundo widget que muestre siempre la Bandeja en la pantalla de inicio, para saber si hay algo que decidir o registrar sin abrir la app.

### 5.6 Decisiones del 2026-11-18 para implementar (SPEC §18 punto 11)

Un PR por tema, con la SPEC actualizada en el mismo PR:

1. ✅ Comidas cuando te levantás tarde (#142).
2. ✅ Horarios válidos por rutina y por día (#146), con «No ese día» y la franja del día prestado en feriados (decidido y hecho el 2026-11-20).
3. ✅ Rutina creada a mitad de semana, proporcional y redondeando hacia arriba (#147).
4. ✅ Una tarea que no entra ni sola no marca críticos a las demás (#150).
5. ✅ Respaldo: ids nuevos al importar con cuenta y extras mal formados descartados con aviso (#144, que también arregla `isPermanent` con `22P02` y `42501`).
6. ✅ Ajustes → Hoy: «Me levanté» no puede ser futura (#143).
7. CSP completa: en modo `Content-Security-Policy-Report-Only` desde #145 (reportes a `/api/csp-report`, que los manda como errores «CSP: …» a Better Stack, #148). Revisado el 2026-11-22 con el MCP de Better Stack: en la aplicación «critiCal» solo hay el reporte de prueba de conexión (19/11) y un `otp_expired` (link de acceso vencido, uso normal); ningún evento después del 19/11, así que no hay uso real para decidir. Revisado otra vez el 2026-11-23 (tras #229, con la Demo de pruebas recorrida en producción): igual, sin reportes CSP nuevos ni errores nuevos (solo dos `otp_expired`, que desde #230 muestran un aviso con Roy al volver al login). Falta: usar la app en producción un par de días por todas las pantallas (Lugares, Comidas, viajes, login, PWA instalada), volver a mirar y, si sigue limpio, renombrar la cabecera a `Content-Security-Policy` (`apps/web/vercel.json`, `vercelHeaders.test.ts`, SPEC).
8. ✅ Tarjeta «¿A qué hora te levantaste?» de la Bandeja: no acepta una hora que todavía no pasó («Todavía no son las HH:MM.»), ni siquiera la supuesta si todavía no llegó.

### 5.7 Decisiones del 2026-11-21 para implementar (SPEC §18 punto 12)

Un PR por tema, en este orden:

1. ✅ «Fijar acá» también en bloques seguidos (#176; uno suelto de hoy ya se podía).
2. ✅ Avisos abajo con letra grande (#177).
3. ✅ Grilla con letra grande: horas y días con tope de 175 % (#178).
4. ✅ «Elegí»: Roy chico con pose por opción y aviso al desaparecer (#179).
5. ✅ Deslizar a los costados en la Semana para cambiar de semana (#180).
6. §5.1: ✅ transiciones (#181), ✅ espaciados (#183), ✅ primer uso guiado (#182). Ómnibus (§5.2): ✅ interfaz (#185), plan (#190), vuelta y rutas habituales (#193).

### 5.8 Prueba en producción del usuario (2026-11-22) — arreglado, falta confirmar

Decisiones del usuario: tarjeta de ómnibus con líneas + hora de salida (el detalle al tocar), atribución de datos abiertos en Ajustes → Acerca de; entorno de prueba = «Demo de pruebas»; rutinas: siempre planeada la semana en curso y la siguiente completa; no se puede hacer zoom. Del 2026-11-23: con letra grande la app crece hasta un **tope de ~24 px**; en Planificación semanal, con letra grande los días pasan a **iniciales**; una **rutina atrasada** planea solo las sesiones que entran en lo que queda de la semana (sin bloques críticos a deshora); sin iPhones en la nube pagos: lo de iOS se cubre con WebKit y tests de reglas, y al usuario se le piden 2–3 pasos como máximo cuando pida las instrucciones.

Arreglado y mergeado: zoom, alineación, Roy, buscador (#217); Primeros pasos (#215); Demo de pruebas (#219); Rutinas en lista + crear aparte y tarjeta de ómnibus (#216); rutinas la semana siguiente completa y comidas pasadas congeladas (#218); E2E de los flujos del §6 (#220); letra grande con tope, iniciales y tests de campos ≥16 px / zoom bloqueado / sin desborde (#221); rutinas fuera de Silos, semana nombrada en el detalle y rutina atrasada (#222); comidas pasadas con duración 0, etiquetas del pasado y validación del respaldo (#223).

Probado por Claude en producción (Demo de pruebas, 375×812, 2026-11-23, antes de #221–#223): viewport sin escala, campos de 16 px, sin desborde, Primeros pasos en la Semana, Rutinas en lista. Repetido el 2026-11-23 tras el deploy de #229: Lugares con topes (nombre 60, dirección 200, alias 500), campos de 16 px y sin desborde a 375 px. Falta la confirmación del usuario en su iPhone (2–3 pasos: zoom tras el teclado, tarjeta de ómnibus).

### 5.9 Deuda técnica

- `inboxRows` (`apps/web/src/inbox.ts`, usado por el widget desde #235) repite la lógica de `Inbox.tsx`: conviene unificarlas en una sola función para que la Bandeja y el widget no se separen.

## 6. Mergeado, falta confirmar la validación en producción

Borrar cada uno cuando se confirme (atacante limpio + prueba en prod + Sentry sin issues nuevos).

- **Trabajo del 2026-11-23 (tarde), mergeado** (#238–#241): 29.ª vuelta, «Hecho» con partes, «dormías» y margen de 30 s para un test pesado de la 28.ª, que superaba los 5 s con coverage también en `main`. **Probado por Claude en producción** (Demo de pruebas, 375×812): «No hace falta traslado» → Deshacer restaura la tarjeta; «Hecho» en la Bandeja muestra las partes como chips y «Práctico 4» bajó «faltan» de 10 h a 7 h; «Me levanté» a las 16:45 dejó el bloque de las 16:00 como «dormías» (marcado en la Semana, fuera de la Bandeja) y no tocó el de las 14:00, que ya tenía respuesta. Better Stack sin errores.

- **Trabajo del 2026-11-23, mergeado** (#230–#236): camino infeliz con Roy, Bajas y Medias de la 27.ª vuelta, defaults aprendidos (#233), «Tu semana tipo» (#234), widget (#235) y 28.ª vuelta (#236). **Probado por Claude en producción** tras el deploy de #236 (Demo de pruebas, 375×812): Nueva entrega propone horas con la nota «Como tus entregas anteriores de esta materia.» y las ajusta tras una entrega nueva; «+ Nueva…» con «cálculo ii» guarda la entrega en Cálculo II sin duplicar la materia; «gym» avisa «Ya tenés una rutina con ese nombre»; Planificación semanal muestra «Tu semana tipo: 4 materias, 1 rutina, 5 lugares» sin contradicciones; un lugar de nombre invisible se ve como «Sin nombre»; un título de 398 caracteres se corta a tres líneas en el detalle. Better Stack sin errores nuevos. Falta: **el usuario tiene que volver a pegar el script del widget** en Scriptable (los pasos están en el cuerpo de #235); si reporta algo, mirar `apps/web/api/_lib/widget.ts` y `apps/web/src/widget-script.ts`.

- **Trabajo del 2026-11-22, mergeado**: #206 (TODO), #207 (23.ª vuelta), #208 Planificación semanal siempre sobre la semana próxima (Silos y widget pasan a la siguiente una vez planeada; `settings.weekPlannedFor`, sin migración), #209 casa solo por el interruptor (una sola casa), #210 el pasado no se recalcula (migración `meal_runs`), #211 Bajas de la 24.ª vuelta. Falta: confirmar que el Deploy aplicó `meal_runs` en staging y producción, prueba en producción en modo demo (Planificación semanal un domingo, comidas de días pasados tras cambiar los horarios, formulario de lugar con casa ya marcada) y revisar Better Stack.

- **Trabajo del 2026-11-18/19, mergeado y desplegado** (staging y producción en verde): #123–#128 (capturas), #130–#131 y #132–#140 (vueltas 5–11 del atacante), #141 y #149 (decisiones y TODO), #142 comidas al levantarse tarde, #143 «Me levanté» no futura, #144 respaldo con ids nuevos, #145 CSP en modo reporte, #160–#162 (19.ª vuelta y tarjeta de la Bandeja sin hora futura), #164 íconos de línea, #165 «Soltar todo» en bloques seguidos, #166 toques de 44 pt en la cabecera, #167 20.ª vuelta (botones con letra grande), #168 «Fijar acá» con Deshacer, #170 números que cuentan, #171 «No ese día», #172 botones con verbo, #173 Silos vacío, #174 21.ª vuelta, #176–#183 (decisiones del 21-11, resorte, escala de tokens, deslizar semana, primeros pasos), #185 ómnibus: interfaz (migración `places_travel_mode`, aplicada por el Deploy del 2026-11-21), #186–#188 Bajas de servidor, Semana y accesibilidad, #190 el plan reserva el tiempo del ómnibus, #193 ómnibus: vuelta y rutas habituales, #194–#197 Bajas viejas, #198 ayuda bajo los campos, #199 reversión de lo rechazado por la base, #201 buscador de Ajustes, #202 Bun (primer Deploy con Bun en verde, demo en producción sin errores), #204–#205 22.ª vuelta, #146 horarios por rutina y día (migración `valid_hours`), #147 rutina proporcional, #148 Better Stack, #150 tarea imposible no marca críticas, #151–#157 vueltas 13–18 (migraciones `check_in_retired` y `units_by_hand_checkin_origin`). Falta verificar:
  - Prueba en producción en modo demo y en el simulador de iPhone (todo se probó solo en local con WebKit de Playwright y jsdom): «Primeros pasos» con cuenta nueva, tarjeta de ómnibus de un evento con lugar, zoom con dos dedos en iPhone, hoja de bloque con Hecho/Parcial/No/Corregir y su Deshacer, Bandeja (Deshacer de cada acción), Rutinas con «Distinto según el día», comidas al levantarse tarde, letra grande y tema oscuro.
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
