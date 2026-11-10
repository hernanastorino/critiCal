# critiCal — trabajo pendiente y cómo seguirlo

Este archivo es para que cualquier agente, sin más contexto que el repo, retome el trabajo.
La fuente de verdad del producto es [`SPEC.md`](SPEC.md) (sobre todo §14–§17); la operación, [`OPERATIONS.md`](OPERATIONS.md).
Mantené este archivo al día: al empezar, al abrir o mergear un PR, y antes de cortar.

**Que quede corto**: acá va solo lo pendiente, lo que está en curso y lo que está en validación. Un tema se **borra** de este archivo (no se pasa a «hecho») cuando cumple todo esto: PR con todos los checks en verde, mergeado a `main`, vuelta limpia del agente atacante y prueba en producción sin problemas (Sentry incluido). Lo que se hizo queda en la SPEC (✅) y en el historial de git.

## Retomar desde otra cuenta o sin memoria (leer primero)

Una cuenta nueva de Claude no ve la memoria local (`~/.claude/projects/...`), ni las sesiones, ni las tareas programadas de la anterior. Todo lo necesario está en el repo: este archivo, [`SPEC.md`](SPEC.md) y [`OPERATIONS.md`](OPERATIONS.md).

1. **Leé en este orden**: este archivo entero → `SPEC.md` §14–§18 → `OPERATIONS.md`.
2. **Mirá el estado real**, no solo lo que dice acá: `gh pr list --state open`, `gh run list --branch main --limit 5` y Sentry (org `hernanastorino`, proyecto `critical`: `is:unresolved` de las últimas 24 h; un issue nuevo, sobre todo de seguridad, se arregla con un PR sin esperar a que lo pidan).
3. **Terminá lo que está en la tabla de §1** antes de empezar algo nuevo (salvo los PRs pausados a pedido del usuario, como el #68: se dejan como están y no se mergean). Un PR que abrió otra sesión se puede continuar: `gh pr checkout <n>` en un worktree propio (si la rama ya está en otro worktree, `git worktree list` y seguí en ese), leé sus hilos de CodeRabbit y seguí el ciclo de §2.
4. **Preguntas pendientes para el usuario**: §1.1 de este archivo. Recordáselas en cuanto escriba.

### Cómo quiere trabajar el usuario (decidido por él; vale para cualquier cuenta)

- **Idioma y tono**: español rioplatense («vos»). Respuestas cortas, al estilo «decí menos»: primero la respuesta, una idea por frase, hasta unas 20 palabras, voz activa. Nunca omitir «no», «nunca» ni «solo». Código, comandos y rutas, tal cual. En alertas de seguridad o si el usuario está confundido, frases completas.
- **Preguntar antes de tocar código**: todas las dudas juntas al principio (decisiones de producto que la SPEC no resuelve son preguntas, no supuestos). Si el usuario no está, anotarlas en §1.1 y seguir con lo que no dependa de ellas.
- **Todo pedido nuevo se anota primero en la SPEC**, así la idea no se pierde.
- **Un PR por tema**, rama `claude/<tema>`, worktree propio. **Auto-fix prendido en cada PR.**
- **Mergear vos mismo** (squash) solo cuando: CI en verde, el check «CodeRabbit» del **último** commit terminado (puede tardar 5–20 min; mergear antes le cancela la revisión), **cero hilos abiertos** y vuelta limpia del agente atacante. Cada hilo de CodeRabbit se responde en una línea con la firma «_🤖 Addressed by [Claude Code](https://claude.com/claude-code)_» y se resuelve. No recortar la config de CodeRabbit (revisión completa siempre).
- **Tareas separadas → sesiones hijas** (pedido del 2026-11-07, para gastar menos tokens): una sesión por tarea con Sonnet 5.5, esfuerzo medio y permisos Auto, en su worktree, con un brief autosuficiente (qué, sección de la SPEC, plan, metodología de §2, criterios de aceptación intermedios y finales, reglas). Las hijas no tocan este archivo; la sesión principal revisa, mergea de a uno y lo mantiene. El límite semanal es compartido: 2–3 hijas a la vez como mucho.
- **Lo que no se toca sin pedido**: la barra de pestañas de abajo queda pegada al borde inferior (la app corre como PWA instalada); el PR #68 (buscador de Ajustes) no se mergea hasta que el usuario lo pida.
- **Datos y cuentas**: nunca contraseñas ni cuentas reales de Google o iCloud; solo la cuenta de prueba local y datos inventados. El agente atacante nunca ataca producción.
- **Producción**: https://critical-cal.vercel.app (la PWA cachea: para probar una versión nueva, actualizá el service worker y recargá). Modo demo: «Probar con datos de ejemplo».
- **Límites de uso**: al 90 % del límite de 5 h, dejar este archivo al día y cortar; al 90 % del semanal, frenar y avisar. Las tareas programadas de relevo arrancan en modo de permisos por defecto y se traban pidiendo permisos: si se usan, configurarlas en modo Auto desde la app.

### Vigilar Sentry desde la cuenta nueva

En la cuenta original lo hace la tarea programada `critical-sentry-watch` (cada hora). **Recién cuando el usuario confirmó que la frenó** (ver §0 punto 2), creá en la cuenta nueva una tarea equivalente (herramienta de tareas programadas de Claude Code, cada hora, en **modo de permisos Auto**, si no se traba pidiendo permisos) con este prompt, resumido:

1. Buscar en Sentry (org `hernanastorino`, región https://us.sentry.io, proyecto `critical`) los issues `is:unresolved`, `is:regressed` y `is:escalating` de las últimas 24 h, y además los PRs abiertos con «Fixes CRITICAL-» (`gh pr list --search "Fixes CRITICAL"`), aunque su issue ya no salga en esa ventana. Solo si no hay ninguna de las dos cosas, terminar con «Sentry limpio».
2. Por cada uno, ver detalle, breadcrumbs y stack trace, y clasificarlo:
   - **Seguridad** primero (sesión o tokens filtrados, errores de permisos o RLS como Postgres 42501 o PGRST301, XSS o CSP, redirecciones abiertas, 401 o 403 de nuestra API, datos de otro usuario).
   - **Bug nuestro**: se arregla.
   - **Ruido** ajeno (extensiones, cortes de red reconocidos): se resuelve en Sentry con el motivo, sin tocar código.
3. Si ya hay un PR abierto con «Fixes CRITICAL-N», solo hacerlo avanzar (nunca un duplicado).
4. Arreglo: worktree nuevo desde `origin/main` en la rama `claude/sentry-<issue>`, test de regresión, `npx biome check .`, `npx tsc -b`, `npx vitest run` (y `supabase test db` si toca `supabase/`), «Fixes CRITICAL-N» en el commit y en el PR.
5. Mergear con las reglas de §2 (CodeRabbit terminado sobre el último commit, sin hilos ni hallazgos pendientes); si todavía no terminó, dejarlo abierto para la corrida siguiente.
6. Confirmar el deploy de `main` y marcar el issue como resuelto en Sentry, con el link al PR.
7. Informe de 2 a 4 líneas. Si un problema de seguridad no quedó resuelto, decirlo arriba de todo.

Nunca aprobar entornos de producción, cambiar secretos de Vercel o Supabase, cargar credenciales ni tocar la barra de pestañas de abajo.

### 1.1 Preguntas y decisiones pendientes del usuario

Ninguna por ahora. (Mascota: elegida, es Roy, ver §5.4 punto 1.)

## 0. Antes de empezar algo nuevo

1. **Terminá lo que está en curso.** Mirá la tabla de abajo y `gh pr list --state open`. Un PR abierto se termina (CI, CodeRabbit, merge) antes de abrir otro, salvo los pausados a pedido del usuario (como el #68), que no frenan nada y siguen sin mergearse.
2. **Una sola corrida a la vez.** Las corridas automáticas de la cuenta original comparten el estado en `~/.claude/projects/-Users-hamsmac-IdeaProjects-critiCal/memory/production-ready-handoff.md` (línea `heartbeat:`): con un heartbeat de menos de 30 min, otra corrida trabaja y no se toca nada. **Desde otra cuenta** ese archivo no se ve: antes de seguir, pedile al usuario que frene en la cuenta anterior sus sesiones y tareas programadas (`critical-production-ready-relay-*` y `critical-sentry-watch`, en «Scheduled» de la app) y que confirme que no queda nada corriendo; recién ahí continuá. Mientras tanto, un commit o PR nuevo de otra cuenta en `gh pr list` / `git log origin/main` es señal de que sigue activa.
3. **Respondé en español rioplatense**, corto (respuesta primero, frases cortas).

## 1. En curso (actualizar siempre)

| Qué                                                                                                         | Estado                                                     | Qué falta                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| PR #68 `claude/settings-a-search` (buscador arriba de Ajustes, mockup B)                                    | Borrador, **atrasado**: `main` cambió `Settings.tsx` (#69) | **No mergear** hasta que el usuario lo pida. Rebasar sobre `main` (reaplicar el buscador sobre el `Settings.tsx` actual; ver el PR). |
| PR #98 Roy (§18.1, escalera de Jacob toon 3D), sesión `roy`                                                 | Abierto; toca `styles.css` y `Loading`                     | CI, CodeRabbit sobre el último commit, atacante local, merge con las reglas de §2.                                                   |
| PRs de Dependabot #94 (`supabase-js` 2.119.0) y #101 (`web-push` 4.0.0, versión mayor), sesión `dependabot` | Abiertos (#92, #95, #96, #99 y #100 ya mergeados)          | Validar cada uno y mergear con las reglas de §2.                                                                                     |

Si en esta tabla hay un PR con checks corriendo, esperá y seguilo; no empieces otro tema. Un PR pausado a pedido del usuario (como el #68, que no se mergea hasta que lo pida) no frena el resto: se deja como está.

## 2. Reglas de trabajo (decididas por el usuario)

- **Un PR por tema**, rama `claude/<tema>`, en un worktree propio (`git worktree add .claude/worktrees/<tema> -b claude/<tema> origin/main`). La carpeta principal la usa otra tarea (vigilar Sentry cada hora): no cambies su rama ni dejes archivos sueltos ahí.
- **Validar antes de mergear** (cada merge a `main` despliega a staging y, si el E2E pasa, a producción; §17):
  1. `npx biome check .`, `npx tsc -b`, `npx vitest run` (con coverage en CI: 80 %).
  2. Probar en el **simulador de iPhone** (`mcp__Claude_Code_iOS_Simulator__control`, Safari contra el dev server), modo demo y cuenta de prueba local, como pide la SPEC §17. En corridas programadas el simulador no está disponible: ahí se usa el navegador integrado con viewport de iPhone (375×812) y se anota en el PR que la prueba en el simulador queda pendiente.
  3. **Agente atacante**: un subagente sin contexto técnico (solo la URL) intenta romper todo y encontrar vulnerabilidades. Primero en local (destructivo), después en la preview del PR (solo modo demo, sin cambiar datos). Nunca en producción.
  4. Arreglar todo lo reportado en el mismo PR, con tests, y repetir hasta una vuelta limpia. **Freno** (§17): si la misma falla vuelve 3 veces, o hay 5 vueltas seguidas con fallas nuevas, parar y avisar al usuario con el detalle.
- **Merge**: solo con el CI en verde, CodeRabbit terminado sobre el **último** commit (la revisión con `commit_id` igual al head) y **sin hilos abiertos**. Squash. Responder cada hilo y resolverlo.
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
   - Íconos de línea de 2 px desde `icons.tsx`, sin emojis como íconos de interfaz. Quedan en algunos componentes y el ícono de critiCal es relleno.
   - Espaciados y radios desde los tokens de `styles.css`.
   - Toques de 44 pt.
   - Números de silos que se animan con cifras tabulares.
4. **Interacción y animaciones**:
   - Transiciones con resorte, con fundido si el sistema pide reducir movimiento.
   - Respuesta optimista con reversión y aviso.
   - **Deshacer en vez de confirmar**, por ejemplo «Reiniciar demo», que hoy borra todo sin Deshacer.
   - Gestos: deslizar un bloque para marcarlo y deslizar para cambiar de día o semana, siempre con su botón equivalente.
   - Háptica como extra.
5. ✅ **Accesibilidad**: hecha (#84: contraste AA, letra del sistema en `rem`, foco, diálogos, etiquetas, orden de lectura), ver §6.
6. **Primer uso guiado**: recorrido corto (conectar Google → primera materia o entrega → primer plan) que se puede saltar y retomar desde Ajustes.

### 5.2 Traslados en ómnibus (§15)

Las decisiones ya están en la SPEC: GTFS del STM, caché semanal en el servidor, rutas habituales guardadas y selector auto/ómnibus por lugar y por traslado. Es grande: conviene partirlo en datos y servidor primero, UI después.

### 5.3 Refuerzos sueltos (hallados por el agente atacante, no reproducidos como bugs)

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

Un PR por punto. Las respuestas del usuario están en el §18 (todas respondidas el 2026-11-06). **Orden**: 6 → 5 → 3 → 4 → 2 → 7 → 1 (con el resto del §14 de 5.1) → ómnibus (5.2) → 8. Hechos: 2–7. Lo que sigue: Roy (§1) y Dependabot (§1); el resto de §5.1 (Formularios y botones, Consistencia visual, Interacción y animaciones, Primer uso guiado), un PR por grupo; ómnibus (§15) y Bun (§18.8), los dos grandes (partirlos).

1. Psicología de UX del video: valores por defecto, gradiente de meta, valor antes del registro, efecto IKEA, encuadre de pérdidas y **compensar el camino infeliz con gracia** (lo que más quiere ver): texto con humor + **Roy** (escalera de Jacob toon 3D, estilo A · Madera pintada, elegido; animación por caso en SPEC §18.1) como personaje y animación de carga. Implementarlo enchufándolo al `<Loading>` de la sesión `esperas-errores`. Textos y esperas: sesión hija `esperas-errores`.
2. Hecho (#80, validado en producción). Queda: arrastrar comidas como a los bloques.
3. Hecho (#78, validado en producción).
4. Hecho (#79, validado en producción).
5. Hecho (#77, validado en producción).
6. Hecho (#76, validado en producción).
7. Hecho (#82, validado en producción). «Empezar antes» en la Bandeja: mergeado (#87), ver §6.
8. Bun como gestor de paquetes y para correr los scripts; medir el motor antes de pensar en Rust/WASM.

## 6. Mergeado, falta confirmar la validación en producción

Borrar cada uno cuando se confirme (atacante limpio + prueba en prod + Sentry sin issues nuevos).

- #84 Accesibilidad (§14, hallazgos de §5.3): falta la prueba en producción en modo demo (tamaño de letra, foco con teclado, ventanita de un bloque) y revisar Sentry.
- #89 Mensajes y esperas: la vuelta del atacante en la **preview** no se hizo (Vercel la protege con login, el enlace compartible da 403; decisión del usuario). Falta la prueba en producción en modo demo (carga, sin conexión, Reintentar) y revisar Sentry.
- #90 Refuerzos de Ajustes (borradores, «atrás» del sistema, nombre repetido, validación de `settings.data`): falta la prueba en producción y revisar Sentry.
- #96 Migración `settings_data_check` con fecha posterior a `start_after` (el Deploy de `main` fallaba al migrar staging con `supabase db push`): Deploy de `main` ok; falta confirmar que la migración se aplicó en producción y revisar Sentry.
- #87 «Empezar antes» en la Bandeja: desplegado a producción el 2026-11-07 (el deploy de `main` se repitió sobre el mismo SHA `aff9f1f`, que seguía siendo el último de `main`). Falta la prueba en prod y revisar Sentry. Si un deploy vuelve a fallar por el límite de Vercel y ya hay otro merge, lanzá un Deploy nuevo sobre el `main` actual en vez de `gh run rerun`.
