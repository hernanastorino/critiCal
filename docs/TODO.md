# critiCal — trabajo pendiente y cómo seguirlo

Este archivo es para que cualquier agente, sin más contexto que el repo, retome el trabajo.
La fuente de verdad del producto es [`SPEC.md`](SPEC.md) (sobre todo §14–§17); la operación, [`OPERATIONS.md`](OPERATIONS.md).
Mantené este archivo al día: al empezar, al abrir o mergear un PR, y antes de cortar.

**Que quede corto**: acá va solo lo pendiente, lo que está en curso y lo que está en validación. Un tema se **borra** de este archivo (no se pasa a «hecho») cuando cumple todo esto: PR con todos los checks en verde, mergeado a `main`, vuelta limpia del agente atacante y prueba en producción sin problemas (Sentry incluido). Lo que se hizo queda en la SPEC (✅) y en el historial de git.

## 0. Antes de empezar algo nuevo

1. **Terminá lo que está en curso.** Mirá la tabla de abajo y `gh pr list --state open`. Un PR abierto se termina (CI, CodeRabbit, merge) antes de abrir otro.
2. **Una sola corrida a la vez.** Las corridas automáticas comparten el estado en `~/.claude/projects/-Users-hamsmac-IdeaProjects-critiCal/memory/production-ready-handoff.md` (línea `heartbeat:`). Con un heartbeat de menos de 30 min, otra corrida trabaja: no toques nada.
3. **Respondé en español rioplatense**, corto (respuesta primero, frases cortas).

## 1. En curso (actualizar siempre)

| Qué                                                                                          | Estado                                                     | Qué falta                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| PR #68 `claude/settings-a-search` (buscador arriba de Ajustes, mockup B)                     | Borrador, **atrasado**: `main` cambió `Settings.tsx` (#69) | **No mergear** hasta que el usuario lo pida. Rebasar sobre `main` (reaplicar el buscador sobre el `Settings.tsx` actual; ver el PR). |
| PR #80 `claude/meals-always` (§18.2 comidas siempre presentes, mover/sacar un día, merienda) | Abierto; atacante limpio (3.ª vuelta)                      | CodeRabbit sobre el último commit, merge, prod.                                                                                      |
| PR #82 `claude/start-later` (§18.7 empezar más tarde)                                        | Abierto; atacante corriendo                                | Vuelta limpia, CodeRabbit, merge, prod.                                                                                              |

Si en esta tabla hay un PR con checks corriendo, esperá y seguilo; no empieces otro tema.

## 2. Reglas de trabajo (decididas por el usuario)

- **Un PR por tema**, rama `claude/<tema>`, en un worktree propio (`git worktree add .claude/worktrees/<tema> -b claude/<tema> origin/main`). La carpeta principal la usa otra tarea (vigilar Sentry cada hora): no cambies su rama ni dejes archivos sueltos ahí.
- **Validar antes de mergear** (cada merge a `main` despliega a staging y, si el E2E pasa, a producción; §17):
  1. `npx biome check .`, `npx tsc -b`, `npx vitest run` (con coverage en CI: 80 %).
  2. Probar en el **simulador de iPhone** (`mcp__Claude_Code_iOS_Simulator__control`, Safari contra el dev server), modo demo y cuenta de prueba local, como pide la SPEC §17. En corridas programadas el simulador no está disponible: ahí se usa el navegador integrado con viewport de iPhone (375×812) y se anota en el PR que la prueba en el simulador queda pendiente.
  3. **Agente atacante**: un subagente sin contexto técnico (solo la URL) intenta romper todo y encontrar vulnerabilidades. Primero en local (destructivo), después en la preview del PR (solo modo demo, sin cambiar datos). Nunca en producción.
  4. Arreglar todo lo reportado en el mismo PR, con tests, y repetir hasta una vuelta limpia. **Freno** (§17): si la misma falla vuelve 3 veces, o hay 5 vueltas seguidas con fallas nuevas, parar y avisar al usuario con el detalle.
- **Merge**: solo con el CI en verde, CodeRabbit terminado sobre el **último** commit (la revisión con `commit_id` igual al head) y **sin hilos abiertos**. Squash. Responder cada hilo y resolverlo.
- **Después del merge**: esperar el workflow Deploy de `main`, revisar Sentry (sin issues nuevos) y una prueba rápida en https://critical-cal.vercel.app en modo demo.
- **Preguntas que son del usuario** y la SPEC no resuelve: anotarlas en `~/.claude/projects/-Users-hamsmac-IdeaProjects-critiCal/memory/pending-questions.md` y seguir con otra cosa.
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

1. **Mensajes y esperas**
   - ✅ Un solo aviso de éxito (#73, `components/Toast.tsx`).
   - Errores que dicen qué pasó y qué hacer, con el botón para hacerlo.
   - Esperas de más de ~1 s con texto: sincronización, IA, traslados («Calculando traslados 3 de 8…»).
   - Skeletons en vez de pantallas vacías al cargar.
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
5. **Accesibilidad**:
   - Contraste AA y criticidad marcada con algo más que el color.
   - VoiceOver en bloques y silos.
   - Respetar la letra del sistema: hoy casi todo está en px y no escala.
   - Teclado completo en la Mac.
6. **Primer uso guiado**: recorrido corto (conectar Google → primera materia o entrega → primer plan) que se puede saltar y retomar desde Ajustes.

### 5.2 Traslados en ómnibus (§15)

Las decisiones ya están en la SPEC: GTFS del STM, caché semanal en el servidor, rutas habituales guardadas y selector auto/ómnibus por lugar y por traslado. Es grande: conviene partirlo en datos y servidor primero, UI después.

### 5.3 Refuerzos sueltos (hallados por el agente atacante, no reproducidos como bugs)

- Cambios sin guardar en Ajustes que se pierden sin aviso al cerrar.
- El gesto o botón «atrás» del sistema no vuelve de una subpantalla de Ajustes (no hay estado en el historial).
- Validar `settings.data` en el servidor, con cuidado: filas viejas de producción podrían no cumplir una restricción nueva. Hacerlo con `NOT VALID` o como validación en `/api`.
- Rutinas con nombre repetido al **renombrar** una materia existente (al agregar ya se impide).
- Avisos (agente atacante sobre #73): después de «Deshacer» el foco queda en `<body>` (debería volver al bloque restaurado); «Deshacer» dura 6 s y por teclado no se llega a tiempo (WCAG 2.2.1: ofrecer más tiempo o un atajo); el aviso tapa la mitad del botón «Guardar» en las hojas; mover un bloque sin consecuencias o «Fijar acá» no ofrecen «Deshacer»; con camino crítico activo se apilan dos avisos rojos que repiten el faltante.
- Semana (agentes atacantes sobre #76 y #78, anteriores a esos PRs):
  - Escape no cierra la ventanita de un bloque o evento, y la ventanita tapa al bloque vecino.
  - Después de «Fijar acá» el foco queda en `<body>`.
  - «Deshacer» sobre una semana que no estás viendo deshace sin mostrar dónde (llevar a esa semana o nombrarla en el aviso).
  - Arrastrar a un día pasado (o a una hora sin lugar) vuelve sin decir por qué.
  - El orden de lectura de los bloques no es por hora (comidas, luego eventos, luego plan); no se anuncia la hora de fin ni el borde rojo.
  - El botón flotante de camino crítico tapa la esquina de abajo a la derecha del domingo.
- Comidas (#80, detalles que quedaron): en una propuesta por una comida, «Dejar como está» igual saca el bloque de debajo (§5.1: nunca estudio encima; falta un texto propio para ese caso); al volver a poner una comida sacada se olvida la hora a la que se había movido; las acciones de comidas no entran en el historial de «Deshacer» de arriba (solo en el aviso); después de «Reacomodar» el aviso de abajo sigue mostrando el anterior.
- **Regresión de #78** (no es anterior): con dos cosas lado a lado a 320 px, cada una mide ~17 px de ancho y cuesta tocarla; buscar un ancho mínimo o abrir una lista al tocar.
- Silos (agente atacante sobre #77): «Archivar» no tiene Deshacer y no hay dónde ver lo archivado; en «Nueva», Enter en el nombre no guarda; el campo «Partes» no tiene etiqueta propia.
  - Contraste: números blancos sobre tanques naranjas (~1,9:1); «Venció» en rojo de 11 px (~3,9:1); total gris sobre tanque vacío en claro (~3,9:1).
  - «Entrega / parcial» y «Hábito semanal» no tienen `aria-pressed`; la hoja de un hábito pide «Temas en total».
  - Registrar 240 min de avance descuenta ~200 (el factor de descanso o de aprendizaje no se explica en pantalla).
- Semana (3.ª vuelta sobre #76): el anillo de foco naranja en modo claro tiene ~2:1 de contraste; la ventanita de un bloque no es un diálogo (el foco no entra) y en bloques de la tarde tapa la barra; arrastrar no avisa nada (y hoy hace desaparecer la cena: lo resuelve §18.2).
- Comidas (agente atacante sobre #80, anteriores a ese PR):
  - Mi semana corrige en silencio valores raros (duración «-20» queda en 0, o sea sin esa comida); la fila de Ajustes muestra el horario de un solo día («09:00 – 00:00») aunque los días difieran; el desayuno puede caer antes de «arreglarse».
  - Los campos de hora y duración de Mi semana se anuncian por su valor («textbox 13:00»), no por su nombre.
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

Un PR por punto. Las respuestas del usuario están en el §18 (todas respondidas el 2026-11-06). **Orden**: 6 → 5 → 3 → 4 → 2 → 7 → 1 (con el resto del §14 de 5.1) → ómnibus (5.2) → 8.

1. Psicología de UX del video: valores por defecto, gradiente de meta, valor antes del registro, efecto IKEA, encuadre de pérdidas y **compensar el camino infeliz con gracia** (lo que más quiere ver): texto con humor + mascota (antes, 3 bocetos para que elija).
2. → PR #80. Comidas siempre presentes: regla nueva en §5.1 (corre lo no fijo; si no hay lugar, aparece superpuesta y se puede arrastrar a cualquier hora). Además: «Hoy no» por comida y merienda opcional. Al implementarlo, ajustar la propiedad de `scheduler.test.ts` («nunca sobre eventos fijos») para que acepte solo las comidas superpuestas del §5.1 y siga rechazando estudio nuevo encima de lo fijo.
3. Hecho (#78, validado en producción).
4. Hecho (#79, validado en producción).
5. Hecho (#77, validado en producción).
6. Hecho (#76, validado en producción).
7. Empezar más tarde → PR #82.
8. Bun como gestor de paquetes y para correr los scripts; medir el motor antes de pensar en Rust/WASM.

## 6. Mergeado, falta confirmar la validación en producción

Borrar cada uno cuando se confirme (atacante limpio + prueba en prod + Sentry sin issues nuevos).

(Nada por ahora.)
