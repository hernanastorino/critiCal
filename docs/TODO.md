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

| Qué                                                                        | Estado                                                | Qué falta                                                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| PR #68 `claude/settings-a-search` (buscador arriba de Ajustes, mockup B)   | Borrador, rebasado sobre `main`                       | **No mergear** hasta que el usuario lo pida. Si `main` cambia `Settings.tsx`, rebasar. |
| PR #73 `claude/toast` (§14 «Éxito»: un solo aviso, `components/Toast.tsx`) | Abierto; CI y CodeRabbit corriendo; atacante en local | Arreglar lo que reporten el atacante y CodeRabbit, mergear, revisar producción.        |

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

## 5. Pendientes, en orden

Marcá cada uno con ✅ en la SPEC al mergearlo y movelo a «Hecho».

### 5.1 Guías de UI/UX del §14 (un PR por grupo)

1. **Mensajes y esperas**
   - ~~Un solo aviso de éxito~~ → en PR #73.
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
- Avisos (agente atacante sobre #73): después de «Deshacer» el foco queda en `<body>` (debería volver al bloque restaurado); «Deshacer» dura 6 s y por teclado no se llega a tiempo (WCAG 2.2.1: ofrecer más tiempo o un atajo); el aviso tapa la mitad del botón «Guardar» en las hojas; mover un bloque sin consecuencias o «Fijar acá» no ofrecen «Deshacer»; con camino crítico activo se apilan dos avisos rojos que repiten el faltante; el `aria-label` de los bloques no dice el día.

### 5.4 Próximos desarrollos (SPEC §18, pedidos del 2026-11-06)

Un PR por punto. Las respuestas del usuario a las preguntas quedan en el §18.

1. Psicología de UX del video: valores por defecto, gradiente de meta, valor antes del registro, efecto IKEA, encuadre de pérdidas y **compensar el camino infeliz con gracia** (lo que más quiere ver).
2. Comidas siempre presentes: regla nueva en §5.1 (corre lo no fijo; si no hay lugar, aparece superpuesta y se puede arrastrar a cualquier hora). Además: ayuno, merienda y saltear una comida un solo día.
3. Eventos superpuestos lado a lado, en columnas más angostas.
4. Ubicación de un evento: «Eliminar» borra el lugar exacto y conserva el tiempo de traslado puesto a mano.
5. Silos: se ocultan solos al terminar la semana en la que pasó su fecha final.
6. Barra de arriba: «2 – 8 nov» y la flecha de Deshacer con el trazo del resto de los íconos.
7. Empezar más tarde: una tarea o materia que no se puede empezar hasta una fecha, una demora o un tiempo antes de la entrega.
8. Bun y Rust.

## 6. Mergeado, falta confirmar la validación en producción

Borrar cada uno cuando se confirme (atacante limpio + prueba en prod + Sentry sin issues nuevos).

- #69 validación de formularios de Ajustes y del respaldo · #70 ErrorBoundary con reporte a Sentry · #71 todas las hojas como modales.
