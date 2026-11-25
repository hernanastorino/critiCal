# critiCal — Especificación

Calendario personal que planifica automáticamente el tiempo de estudio y hábitos alrededor de los eventos de Google Calendar e iCloud, se reorganiza según lo que realmente hice y marca qué es crítico. Uso personal, un solo usuario. Montevideo (America/Montevideo), feriados de Uruguay.

---

## 1. Plataforma

- **PWA** (React + Vite + TypeScript). iPhone: "Agregar a inicio". Mac: Safari → "Agregar al Dock". Sin Electron ni App Store.
- Offline: caché en IndexedDB; las marcas hechas sin conexión se sincronizan después.
- Notificaciones: Web Push (iOS 16.4+ con la PWA instalada).
- Widgets:
  - Calendario de Google **"📚 Plan"** escrito por la app → visible en el widget nativo de Calendario de iOS (rojo = crítico).
  - Widget de **Scriptable** con los silos de progreso, leyendo un endpoint de la API.
    - Muestra solo silos **vigentes**: los de la semana en foco (§ #208) cuyo vencimiento no pasó (`widgetSilos` usa `splitPastSilos`, igual que la vista Silos, y además descarta los vencidos de esta semana). Las rutinas semanales siguen.
    - Sin silos vigentes muestra la **Bandeja** (`inboxRows`, `src/inbox.ts`: los mismos títulos y secciones que las tarjetas de la app); si no hay nada, «Todo al día ✓».
    - `GET /api/widget` devuelve `{updatedAt, silos}` (formato original, para los scripts ya pegados) más lo ya armado: `mode` (`silos` | `inbox`), `style` (`tanks` | `list`), `rows` (`title`, `detail`, `color`, `level`, `ratio?`), `empty` y `refreshMinutes` (5). El script solo dibuja eso: lo nuevo no pide volver a pegarlo.
    - El script guarda la última respuesta buena; sin conexión la muestra con «Sin conexión · datos de hace X», y si `updatedAt` tiene más de 45 min lo dice igual. Pide refrescar a los `refreshMinutes` (iOS decide).
- Login: **Iniciar sesión con Google** (Supabase Auth), la misma cuenta del calendario.

## 2. Calendarios

| Fuente             | Acceso                                          | Sincronización                                                                       |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Google Calendar    | API oficial, lectura y escritura                | Push notifications (webhooks) → reorganización inmediata                             |
| iCloud             | CalDAV con contraseña de app (cifrada en Vault) | Consulta cada 5–10 min con sync tokens + al abrir la app + botón "sincronizar ahora" |
| "📚 Plan" (Google) | Solo lo escribe la app                          | Salida del planificador                                                              |

- Recomendación: Google como calendario por defecto en el iPhone, para que los eventos nuevos impacten al instante.
- **"Mostrar como: Disponible"** → el evento es compatible con bloques planificados (paralelo). "Ocupado" → bloquea.
- **Detección de entregas**: eventos con emoji/tag (`📝`, `#entrega`, `#parcial`, `#presentación`) en cualquier calendario (salvo los marcados «Ignorar») se proponen en la bandeja para estimar. Si el evento pierde la etiqueta, su tarea sale del plan; si la recupera, vuelve.
- **Eventos flexibles**: `#flex` en el título o un calendario marcado «Flexible». Las evaluaciones (parcial, entrega, presentación) nunca se ofrecen mover: la entrega es solo un plazo y no ocupa tiempo.
- **Eventos tentativos**: estado _tentative_ de Google / `STATUS:TENTATIVE` de iCloud, o un título que termina en «?».
- OAuth de Google en modo **Production** (no verificado) para que los refresh tokens no venzan a los 7 días.

## 3. Modelo de datos (fuente de verdad)

El plan es **dato derivado**: se puede recalcular entero en cualquier momento desde lo siguiente.

- **Entrega**: materia, fecha límite, unidades (cada una con estimación) u horas totales, mínimo total, prioridad, flexibilidad. Un parcial es un objetivo propio, distinto del mínimo semanal de la materia.
- **Materia / Actividad**: color, mínimo semanal opcional, duración máxima de sesión, descanso tras sesión (por defecto 50/10), franja preferida (ej. Mate a la mañana).
- **Hábito**: gym, etc. Frecuencia semanal, duración, franja preferida, mínimo. Una **rutina** (la actividad de un hábito) puede tener además un **horario válido**: una franja de inicio y fin para todos los días y, opcionalmente, una franja propia para cada día de la semana (`Activity.validHours`, §5.4).
- **Evento fijo**: viene del calendario (clases, cumpleaños, juntadas, familia).
- **Evento tentativo**: reserva el lugar; el motor mantiene un plan B.
- **Comidas**: desayuno, almuerzo y cena de cada día de la rutina, cada una con hora preferida y duración (0 = sin esa comida). Rutinas guardadas antes del desayuno (solo almuerzo y cena) toman un desayuno de 30 min al levantarse. Un evento cuyo título dice que es una comida («Almuerzo con la abuela») es esa comida ese día.
- **Registro (append-only)**: por bloque, ✓ / ✗ / parcial + unidades completadas + timestamp. Nunca se edita, solo se agregan correcciones. Deshacer también agrega un registro (una copia del anterior, o uno «retirado» si era el primero); lo que cuenta de cada bloque es su registro más nuevo y de él se derivan las partes marcadas, «Faltan» y lo hecho de la semana (la del inicio del bloque). Una parte está hecha si fue marcada a mano (`done_by_hand`) o si la declara el registro vigente de algún bloque; su fecha es la de la marca a mano o la del registro vigente más antiguo que la declare. Un registro escrito por Deshacer lo dice (`origin = 'undo'`). **«Hecho» pregunta las partes** (decisión del 2026-11-23): si la entrega del bloque tiene partes pendientes («Práctico 1», «Práctico 2»…), tocar «Hecho» (botón o deslizar a la derecha en la tarjeta «¿Cómo te fue?» de la Bandeja; en la hoja del bloque las partes ya están a la vista) muestra en la misma tarjeta las partes como chips y un botón «Anotar hecho»; se puede seguir sin elegir ninguna. Las elegidas van al registro (`unitIds`) y «Faltan» baja; sin elegir ninguna, el bloque cuenta como tiempo estimado y es válido. Sin partes, «Hecho» no pregunta nada. «Deshacer» sigue igual. **La UI no explica su funcionamiento con textos**: lo evidente lo dicen los botones (no hay notas bajo «planificado vs. hecho» ni en Planificación semanal sobre la Bandeja).
- **Ajuste del día**: "me levanté a las X" / "me acuesto a las X". Decir que me levanté a las X (Ajustes → Hoy, «Reacomodar hoy» o la tarjeta de la Bandeja «¿A qué hora te levantaste?») cierra solo, como «dormías», los bloques de hoy anteriores a X que no tienen registro (ver «El pasado no se recalcula»).
- **Lugares guardados**: casa, facu, gym, familia… con tiempos de viaje fijados a mano.
- **Versiones del plan**: historial para "deshacer".

## 4. Parámetros fijos (configurables)

Sueño (hora de acostarse/levantarse), un rato para arreglarse y trasladarse al levantarse, desayuno, almuerzo y cena (hora y duración), traslados, **franja libre** (ej. después de 19:30, límite _blando_: solo se usa como opción explícita cuando algo crítico no entra; los eventos fijos como clases pasadas las 19:30 se respetan siempre).

## 5. Motor de planificación (sin IA, TypeScript puro)

Paquete independiente, determinista, que corre igual en el cliente y en Edge Functions.

1. **Capacidad**: grilla de bloques de 30 min (registro con granularidad de 15). Se restan sueño, comidas, eventos ocupados, traslados (+10 min de margen) y franja libre.
   - **Comidas fijas**: todos los días hay desayuno, almuerzo y cena (salvo que el usuario diga otra cosa, §18.2). Comer no es opcional: el plan **siempre** les deja lugar, aunque sea ineficiente o no llegue a los objetivos. El plan nunca pone estudio ni entregas encima de una comida. Lo único que puede quedar superpuesto con una comida es lo que el plan no mueve: eventos fijos, sus traslados y bloques 📌 que fijé yo; y, de forma transitoria, un bloque de hoy sin 📌 mientras su corrimiento espera mi OK o mientras está en curso (paso 1). Lo que el plan no mueve tiene prioridad y la comida se superpone con aviso (paso 3), sin que el plan sume estudio nuevo encima. Dos comidas nunca se superponen entre sí: si la anterior ya ocupa la hora preferida, la siguiente se superpone a continuación de ella. Siempre dentro de lo despierto: la «hora preferida» se toma a lo sumo desde que me levanto y hasta la hora de dormir (si el desayuno es a las 8 y me levanté a las 10, cuenta desde las 10). Si lo despierto no alcanza para todas las comidas sin superponerlas (por ejemplo, me levanté muy tarde), manda este orden: que la comida exista, que no pise otra comida, que quede dentro de lo despierto. La que no entra (cae mientras dormís o pasada la hora de dormir) se omite ese día, nunca se pone dormido; el desayuno tampoco se pone si me levanté a la hora del almuerzo o después. Si querés comer igual, la ponés a mano (§18.2). Se ubican en orden (desayuno, almuerzo, cena):
     1. a su **hora preferida**; si ahí hay bloques que no son fijos, el plan los corre para dejarle lugar. Vale la estabilidad del §5.7: de mañana en adelante se corren solos; si el cambio toca hoy, llega como propuesta en la bandeja y, mientras no la acepte, la comida se muestra superpuesta como en el paso 3. El bloque en curso no se corre nunca: la comida empieza cuando termina, si cae dentro del rango; si no, va al paso 3;
     2. si a esa hora hay algo fijo (evento gris u «Ocupado», su traslado, un bloque 📌, también uno que acabo de soltar ahí, u otra comida ya ubicada): primero justo al salir de lo que la pisa, si termina cerca; si no, al hueco más cercano, antes o después, dentro de 1 h 30 de su hora (el desayuno, contado desde que me levanto si me levanté más tarde), corriendo también ahí lo que no sea fijo. Nunca antes de levantarme ni pasada la hora de dormir (tampoco en los pasos 1 y 3);
     3. si en ese rango no queda ningún hueco libre tan largo como la comida (todo ocupado por cosas fijas, o solo huecos más cortos), la comida **aparece igual a su hora preferida, superpuesta** con lo que haya, y la bandeja avisa («Sin lugar para almorzar · mar 10/11») para que yo decida: la dejo ahí o la arrastro a cualquier momento del día (a mano sí puedo ponerla a cualquier hora, incluso fuera de lo despierto), incluso encima de un evento fijo. Donde la suelto queda 📌 y el plan acomoda el resto alrededor.
        (Cambia la decisión anterior de solo avisar en la bandeja con un botón para ver el día.)
2. **Factibilidad (EDF)**: por deadline creciente, `demanda mínima acumulada ≤ capacidad acumulada`.
3. **Holgura** = tiempo libre hasta el deadline − mínimo restante.
   - 🟢 margen · 🟡 holgura < 1 día de capacidad · 🔴 si salteás este bloque no llegás al mínimo. Una tarea que no entra ni sola (más sesiones que días, un mínimo mayor que lo despierto hasta su deadline) se avisa sola y **no cuenta** para el nivel de los bloques de las demás tareas: ni su demanda ni su tiempo posible los vuelven críticos.
4. **Asignación**: menor holgura primero, luego mejora local con penalizaciones:
   - bloque mínimo por materia (ej. 60 min seguidos) y máximo de materias distintas por día (ej. 2), como reglas blandas;
   - duración máxima por materia con descansos implícitos (no se muestran en el calendario);
   - franja preferida por materia;
   - **horario válido de una rutina** (firme, no una preferencia): el plan pone sus sesiones solo dentro de la franja de ese día (el tiempo de la sesión entero adentro). Cada día usa su propia franja si la tiene y, si no, la de todos los días; sin franja, a cualquier hora. Un día puede ser «No ese día» (decidido el 2026-11-20): la rutina no va ese día y las veces de la semana se reparten en los demás (se guarda como `null` en `days`). Un feriado que se arma como otro día (rutina prestada) usa la franja de ese día prestado (decidido el 2026-11-20). Ejemplo: correr a más tardar a las 19:00 entre semana y a las 20:00 los sábados. Si en esa franja no entra, la rutina queda corta y se avisa como cualquier otra que no entra. Se guarda como `{ all, days }` en minutos (columna `activities.valid_hours`) y viaja en el respaldo. En Ajustes → Rutinas (en la vista de «Crear rutina nueva») y en el editor de su hábito: «Desde» y «Hasta» (por ejemplo «7» o «19:30»; «Desde» vacío es desde el principio del día y «Hasta» vacío hasta el final) y «Distinto según el día», donde un día vacío usa el horario de todos. Errores en su campo, con un solo anuncio si hay varios: «Desde» no antes de «Hasta», hora que no es una hora, franja más corta que una sesión. «Más corta» cuenta lo que el motor puede usar: solo los bloques enteros de la grilla de 30 min que caen dentro (de 07:10 a 08:10 solo entra 07:30–08:00, así que no alcanza para 60 min: «ampliá la franja»). El respaldo se valida con la misma cuenta, y si una rutina así llega igual, la Bandeja dice que la franja es corta (no «más veces de las que caben»). Un hábito sin fecha de creación en un respaldo importado a una cuenta toma una fecha antigua (2000-01-01): pide la semana entera, como las rutinas de antes.
   - repaso espaciado antes de parciales, con opción de dedicar el día previo solo a esa materia.
5. **Recomendaciones**: compara el plan que respeta las reglas blandas con uno que las rompe; si romperlas ahorra algo (ej. no invadir la franja libre), lo sugiere con su costo ("salvo que quieras estudiar a las 20, hoy conviene 30 min de Mate y 30 de Física").
6. **Infactibilidad → opciones** (cada una con vista previa de la semana):
   abandonar X · bajar X a su mínimo · recorte proporcional · usar franja libre / extender hoy · mover un evento flexible · versión mínima viable de una entrega · priorizar temas por peso en un parcial.
   **El pronóstico de cada opción es el plan que da elegirla** (35.ª vuelta): la app aplica la opción a los datos y vuelve a planificar con las mismas reglas del plan real (rutinas de la semana siguiente primero; una rutina atrasada no cuenta como faltante, ni para decidir si el plan entra), así que «Con esto todavía faltaría tiempo» nunca contradice lo que pasa al elegirla, y sin nada que no entre la sección no aparece. **Un «mínimo» nombrado en una opción** («Dedicarle menos a X (mínimo 4h30)», «Entregar una versión mínima (2h30)») es el que queda en las pantallas (Bandeja, hoja del bloque, Silo), calculado con `progress()` y con el formato de `hours()` (`4h30`). «Deshacer» una decisión solo devuelve el tiempo libre si es la de «Usar tiempo libre»: deshacer un «No hacer» posterior no lo quita ni deja ofrecerlo otra vez.
7. **Estabilidad**: mover lo mínimo; el bloque en curso y lo ya visto de hoy quedan congelados. Cambios que afectan hoy → **propuesta** en la bandeja + push; no se aplican sin OK. De mañana en adelante se reorganiza solo.
8. **Aprendizaje estadístico**: ratio real/estimado por materia (ej. Física 1,3×) que ajusta estimaciones futuras. Confirmado el 2026-11-18: sigue por materia. Decisión del 2026-11-24: «Faltan» (silo, detalle de la entrega y donde se muestre lo que falta de una tarea) es siempre lo que el plan reserva en el calendario: las partes que quedan, ajustadas por el ratio aprendido, con el mismo cálculo del motor para que no puedan divergir.
9. **Ajuste por desvelo**: después de un evento nocturno, la bandeja pregunta a qué hora me levanté en vez de asumir el horario normal.

### El pasado no se recalcula (regla general, decidida el 2026-11-22)

Nada anterior a la hora actual se recalcula ni se reescribe: ni el algoritmo de eventos, ni las comidas (lugar y horario), ni los parciales, pruebas o entregas pasadas, ni los bloques y el tiempo ya registrado. El plan solo mueve lo que queda desde ahora.

- **Comidas** (decidido el 2026-11-22): se guardan como **tramos por comida y día de la semana** (4 comidas × 7 días = 28 series por usuario). Tabla `meal_runs` (RLS por usuario): `meal`, `weekday` (0 = domingo … 6 = sábado), `from_date`, `to_date` (nulo = tramo abierto), `start_minutes`, `end_minutes`, `place_id` (el lugar, cuando se conoce; hoy queda vacío), clave `(user_id, meal, weekday, from_date)`. En el modo demo el equivalente vive en el almacenamiento local (`mealRuns`).
  - Se congela solo lo que ya pasó: los días hasta **ayer** (hoy se sigue calculando). Antes de aplicar cualquier otra acción (en particular un cambio de ajustes), por cada día desde el último congelado (`mealsFrozenThrough`) hasta ayer y por cada comida se compara hora (y lugar) con el tramo abierto de su serie: igual → nada; distinto → ese tramo se cierra con `to_date` = el día anterior a **esa fecha** (no a hoy) y se abre uno nuevo desde esa fecha. Así, si la app no se abre varios días, el cambio de ajustes que llega después no reescribe esos días: se congelan con los ajustes vigentes antes del cambio. Sin historia previa (cuenta nueva, demo recién creada, primera vez que se abre esta versión) **se congelan los 60 días anteriores a hoy**, no solo ayer: así cambiar la hora del almuerzo justo después de abrir no mueve el almuerzo de ayer ni de los días de atrás (falla encontrada el 2026-11-22: solo se guardaba ayer y el resto se recalculaba con los ajustes nuevos). Un hueco largo congela como mucho 60 días, y un día anterior al primer tramo de su serie toma ese primer tramo. Los datos que llegan enteros (`replace`) no se congelan al llegar (eso reescribiría la copia del servidor en cada sincronización); se congelan con la siguiente acción, antes de aplicarla.
  - Una excepción de un día es cerrar, abrir un tramo de ese día y reabrir: no hay tabla de excepciones. Una comida omitida ese día no deja marca (queda el tramo vigente).
  - Leer un día pasado: el tramo de esa comida y ese día de la semana con `from_date ≤ fecha ≤ to_date` (o abierto). Lo que no tiene tramo (datos de antes) se calcula como antes. Borrar eventos de iCloud o Google no toca los tramos.
- **Rutinas**: el plan siempre cubre la semana en curso **y la siguiente completa** (lunes a domingo), cualquier día en que se abra (decidido el 2026-11-22). El plan principal trabaja la semana de los hábitos; una segunda pasada (`withNextWeekRoutines` en `planning.ts`) ubica las sesiones de la semana siguiente alrededor de todo lo ya puesto (lo de esta semana solo ocupa lugar), con horario válido, «Distinto según el día», días excluidos y tope diario. Una rutina «dejada afuera esta semana» (`skipUntil`) vuelve en la siguiente; una pausada o terminada no se ubica. Lo que no entra la semana siguiente todavía no se avisa en la Bandeja: pasa a ser de esa semana cuando empieza. Silos y el widget siguen contando la semana en foco (§ #208), no los bloques. Solo reparten el tiempo que queda. Una rutina de 3 veces por semana creada un sábado pide 1 sesión entre sábado y domingo (`sessionsThisWeek`); nunca se agrega lo «atrasado» de los días que ya pasaron.
- **«Dormías»** (decidido el 2026-11-23): cuando digo que me levanté a las X de hoy, los bloques de estudio o rutina de hoy que empezaban antes de X, ya terminaron y no tienen registro se cierran solos con un registro nuevo: `status = 'missed'` con `origin = 'slept'` (la migración amplía el `check` de `check_ins.origin`, que solo admitía `'undo'`). Es un registro más del log, que solo se agrega: el pasado no se recalcula. No van a «¿Cómo te fue?», no se pueden corregir ni deshacer y en la Semana se ven como no hechos con una marca mínima «dormías»; no se borran, así que no se puede esconder lo que no se hizo, pero tampoco se me culpa. Lo que tenían para hacer se vuelve a planificar desde X con todas las reglas (las comidas ya se corren si me levanto tarde). Un bloque que ya tiene registro (hecho, parcial o no) no se toca. Si después corrijo X a una hora más temprana, los «dormías» de bloques que ya no empezaban antes de X se retiran con un registro de Deshacer (`origin = 'undo'`, estado `retired`) y esos bloques vuelven a «¿Cómo te fue?»; nada se borra. Sin texto explicativo en la interfaz.
- **Única excepción**: si se borra un evento de iCloud o de Google Calendar, el evento desaparece (y su tarea de origen deja de planificarse), pero el tiempo adjudicado y el progreso que realmente se dedicó a él quedan: los registros de avance nunca se borran.

## 6. Traslados (auto)

- Origen: ubicación del evento anterior si terminó hace < 2 h; si no, casa. En huecos largos evalúa volver a casa.
- Prioridad: lugares guardados (tiempos manuales) → OpenRouteService perfil auto (plan gratis) con caché por par de lugares.
- Geocodificación: Nominatim (OSM), una vez por lugar, cacheada.
- Evento sin ubicación: se intenta por título contra lugares guardados; si no, pregunta en la bandeja.
- **Mi casa y reconocimiento de lugares**: la casa sale **solo** del interruptor «Mi casa» del lugar, nunca de que se llame «Casa». Hay **una sola**: al crear un lugar se pregunta si es tu casa solo mientras no haya una; con una ya marcada el formulario no ofrece el interruptor y dice que la casa ya es X y que, para cambiarla, se desmarque allí (otras casas van como lugares aparte, p. ej. «Casa Punta del Este»). Una **ubicación** reconoce un lugar solo si es su nombre o un alias completos (sin importar mayúsculas ni tildes) o su dirección: un texto con más palabras es otro lugar («Casa de la abuela Marta» no es «Casa»). Un **título** sin ubicación sí puede mencionar el lugar entre otras palabras, pero «Casa de …» no lo toma. **Renombrar un lugar** guarda el nombre viejo como alias (salvo que solo cambien mayúsculas o tildes, que ya sea alias, o que otro lugar lo tenga), así sus eventos siguen vinculados. Un lugar **con dirección y sin coordenadas** que se usa en ómnibus se geocodifica en segundo plano aunque sus minutos ya estén cargados a mano (`missingPairs`): la tarjeta de ómnibus necesita las coordenadas. Que la casa aparezca sugerida en el buscador de lugares no la asigna: solo se asigna al elegirla.

## 7. Pantallas

- **Bandeja** (se abre al entrar): bloques por confirmar · cambios propuestos para hoy · decisiones de infactibilidad · eventos sin ubicación · entregas detectadas.
- **Calendario**: día/semana, colores por criticidad, tap en bloque → ✓ / ✗ / parcial con unidades. Las comidas se ven como bloques del mismo color ámbar las tres (`--meal`), a la hora en que quedaron; el tap dice si se corrieron y lleva a Ajustes para cambiar hora y duración. Se mueven solas (§5.1) y además, al tocarlas, se pueden **mover a cualquier hora** solo ese día («Mover a…», también encima de un evento fijo, y «A su hora» para volver) o sacar ese día («Hoy no almuerzo»), siempre con Deshacer. La que quedó encima de algo fijo se ve con borde punteado; las superpuestas van lado a lado (§18.3). **Arrastrarlas como a los bloques**: mantené apretado (o en el modo edición, directo) y llevala; el mismo gesto y la misma vista previa (fantasma, lupa y marcas en el eje), solo dentro de su día y de lo despierto (§5.1), con Deshacer; en el modo edición, con ↑/↓ del teclado. Una que ya pasó no se mueve. Soltarla sobre otro día no hace nada y lo dice. El botón equivalente es «Mover a…» de arriba. No van a «📚 Plan» (sumarían 21 eventos por semana a Google sin decir nada nuevo).
- **Hojas**: todas con la barra fija de arriba (pastilla para arrastrar y ✕), §18.9.
- **Dashboard de silos**: un silo vertical por entrega/hábito, ordenados por urgencia; nombre abajo; horas totales arriba dentro del silo; lo que falta como "stock" adentro, abajo. Color por holgura.
- **Planificado vs. hecho**: vista semanal.
- **Planificación semanal** (domingo, ~5 min): semana, críticos y decisiones. Es **siempre de la semana que viene** (lunes a domingo próximos), el día que se abra. Silos y widget muestran la semana en curso y, desde que el usuario toca «Cerrar resumen» en la planificación (`settings.weekPlannedFor` = el lunes de esa semana), la siguiente.
- **Inicio de cuatrimestre**: materias, fechas, feriados.
- **Ajustes**: parámetros fijos, reglas, lugares, conexiones, exportar/importar JSON.
- Diseño visual: lo provee el usuario, siguiendo las guías del §14.

## 8. IA (opcional, v2)

Solo al cargar datos: proponer unidades y estimaciones a partir de un PDF de programa. Nunca interviene en la reorganización.

## 9. Infraestructura (todo gratis)

| Pieza   | Elección                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| Repo    | GitHub público `critiCal`                                                                                    |
| Hosting | Vercel Hobby (`*.vercel.app`), preview por PR                                                                |
| Backend | Supabase (cuenta personal nueva): proyecto **prod** + proyecto **staging**; dev con Supabase local en Docker |
| Cron    | pg_cron: sync iCloud, recálculo nocturno, push de críticos, keep-alive                                       |
| Errores | Sentry free                                                                                                  |
| Backups | GitHub Action nocturna: `pg_dump` cifrado como artefacto/repo privado + exportar JSON desde la app           |

## 10. CI/CD y calidad

- PR: Biome (lint/format), `tsc`, Vitest con cobertura (motor ≥ 90 %, global ≥ 80 %), property-based tests con fast-check sobre invariantes del motor (nunca sobre eventos fijos, salvo las comidas superpuestas que permite el §5.1, nunca bajo mínimos, nunca en franja libre sin permiso).
- Playwright E2E contra la preview, con emulación iPhone (WebKit) y desktop.
- Merge a `main` → deploy a staging + migraciones → E2E → deploy a prod automático si staging y su E2E pasan (GitHub Environment `production`, limitado a `main`).
- Migraciones versionadas (Supabase CLI), Dependabot, CodeQL, rollback a un clic en Vercel.
- Análisis estático: Codacy en cada PR (el check «Codacy Static Code Analysis» es requerido por la regla «Require Codacy» de la rama `main`). Si marca algo nuevo, se arregla en el mismo PR. Reemplazó a CodeRabbit en noviembre de 2026, al terminar su prueba gratis. (La prueba contra Macroscope se descartó.)
- Sentry en cliente y funciones. En el cliente, los cortes de red reconocidos («Load failed», «Failed to fetch», etc.) no se reportan como errores.

## 11. Seguridad

- Nunca se commitea `.env`; solo `.env.example`.
- gitleaks en pre-commit y CI + push protection de GitHub.
- RLS en todas las tablas, con test en CI que falla si alguna no tiene.
- Service role key, client secret de Google y tokens: solo en secrets de Edge Functions / GitHub Environments.
- Tokens OAuth y contraseña de app de iCloud cifrados en Supabase Vault.
- Datos de prueba siempre inventados.

## 12. Fases

0. Repo, CI/CD, entornos, secretos
1. Motor de planificación + tests
2. Google Calendar (lectura, escritura de "📚 Plan", webhooks)
3. UI con los diseños (bandeja, calendario, silos)
4. iCloud, traslados, notificaciones push
5. Widget Scriptable · v2: IA para carga de programas

## 13. Estado (noviembre 2026)

Hecho y en producción, además de las fases 0–5 (incluidos el widget de Scriptable y la IA para cargar programas):

- **Descansos por materia**: estudio + descanso (50/10 por defecto, editable). El plan reserva bloques con el descanso incluido; los registros guardan el factor con que se hicieron.
- **Repaso espaciado** antes de parciales (7, 3 y 1 días antes) y opción «día anterior solo para esta materia»; un bloque de otra materia en ese día pasa a propuesta. El motor marca esos bloques (`review`) y se guardan así; en la Semana llevan un ícono de «repetir» centrado en la burbuja y su nombre y el detalle dicen «Repaso · tarea».
- **Eventos tentativos**: el plan cuenta con ellos; si uno de hoy se cae, el plan B llega como propuesta (no se aplica solo) y vence con el día.
- **Desvelo**: si un evento terminó pasada la hora de dormir, la bandeja pregunta a qué hora me levanté; mientras tanto se asumen las horas de sueño habituales desde que terminó.
- **Opciones de infactibilidad completas**: mover un evento flexible (se muestra en la bandeja para moverlo en el calendario), versión mínima de una entrega (la mitad del mínimo) y priorizar temas por peso (% del parcial, propuesto por la IA del programa).
- **Deshacer**: últimas 20 versiones del plan, botón en Semana; las decisiones aplicadas se deshacen en cualquier orden.
- **«📚 Plan»**: todos los bloques planificados; los críticos en rojo (Tomato), el resto neutros.
- **/api/travel**: hasta 60 s para buscar lugares.
- **Errores de Sentry corregidos**: el cron ya no reescribe eventos del Plan sin cambios (cuota de Google) y reintenta los límites; en la app no se reportan los cortes de red reconocidos («Load failed», «Failed to fetch», etc.).
- **Solo por invitación**: la cuenta dueña (la primera) maneja en Preferencias la lista de emails invitados; las cuentas que ya existían quedan invitadas. Quien entra sin invitación ve «Esta app es por invitación»: la base no le deja leer ni escribir nada y el servidor (funciones, cron, webhooks, widget) lo saltea.
- **Gemini propio**: cada usuario puede cargar su clave de Google AI Studio en Preferencias («Tu IA (Gemini)»); se valida, se guarda cifrada en el servidor y nunca vuelve al navegador. Sin clave propia se usa la de critiCal.

## 14. Guías de UI/UX

Reglas para que la app se sienta premium. Se aplican a todo lo nuevo y se pueden implementar de a una, en un PR por grupo. Entre paréntesis está lo que falta hoy (noviembre 2026).

### Mensajes y esperas

- ✅ **Éxito**: un solo aviso para toda la app (toast, `components/Toast.tsx`), con el mismo tono y duración (2,5 s; 4 s si ofrece «Deshacer»), anunciado a VoiceOver y que no se va mientras tiene el puntero (de mouse; un toque con el dedo no lo retiene) o el foco encima. Los avisos con «Deshacer» se apilan (hasta 2): uno nuevo no deja sin deshacer al anterior; uno común reemplaza lo que había. Los errores siguen junto a su campo.
- ✅ **Errores específicos**: dicen qué pasó y **qué hacer ahora**, con el botón para hacerlo, como ya hace Calendarios con el botón «Reconectar Google». Nada de «Probá más tarde» sin más.
- ✅ **Esperas**: toda carga de más de ~1 s dice qué está haciendo («Leyendo el programa…», «Calculando traslados 3 de 8…»); si se conoce, muestra el progreso. Componente único `components/Loading.tsx` (`kind`: sync, ai, travel, generic; con hueco `mascot`), `Skeleton.tsx` y `Notice.tsx`; textos del camino infeliz en `friendly.ts` (tono seco y breve, humor solo en lo leve; decidido 2026-11-07).
- ✅ **Skeletons**: mientras carga una pantalla se muestra su forma en gris, en vez de un spinner o un hueco vacío.

### Formularios y botones

- ✅ Texto de ayuda debajo de los campos que no son obvios (formato, para qué sirve, ejemplo). Es una línea corta, asociada al campo con `aria-describedby` (junto a su error, si lo tiene) y sin repetir la etiqueta: Reglas (máximo de materias, margen, avisar cuando el margen baja), «Arreglarse, traslado», «Nada de estudio desde», «Estudio semanal» (al agregar una materia y en el editor), Rutinas (veces por semana, minutos) y los alias de un lugar. `Field` recibe `help`; los campos hechos a mano usan `Help` y `describedBy` (`components/fields.tsx`). Los campos cuyo sentido ya dice la etiqueta (horas de comidas, nombre, dirección) no llevan.
- ✅ **Borradores y descartar** (decidido el 2026-11-22): lo escrito en un formulario abierto y no guardado (el editor de silos y entregas, y los formularios de Ajustes) se guarda en `sessionStorage` de la pestaña —solo texto, horas y fechas del formulario, nada sensible— y **recargar la página lo restaura** donde estaba (la pestaña, la hoja y la pantalla de Ajustes). Guardar, archivar o descartar lo borra; cambiar de cuenta o reiniciar la demo también. **Cerrar con cambios sin guardar** (✕, Escape, el fondo o arrastrar la pastilla hacia abajo) pregunta «¿Descartar los cambios?» con «Descartar» y «Seguir editando»: el foco empieza en «Seguir editando» y Escape en la pregunta también sigue editando. Un formulario sin cambios se cierra sin preguntar. En Ajustes, ✕ y el fondo preguntan por cualquier borrador; salir de una **pantalla** con algo escrito en ella (Escape, arrastrar la hoja, «‹ Ajustes» o, en «Crear rutina nueva», «‹ Rutinas») pregunta lo mismo, y «Descartar» borra lo de esa pantalla y vuelve a la lista (un borrador de otra pantalla no hace preguntar). «Cancelar» en el formulario de un lugar con texto escrito también pregunta. Reemplaza al «sin diálogo de confirmación» de §16.
- Botones con un verbo concreto («Guardar reglas», «Conectar iCloud»), nunca «OK», «Listo» o «Aceptar» sueltos.
- Cada sección termina con una acción clara: el siguiente paso o el botón para crear lo primero.
- No pedir dos veces el mismo dato: lo que ya se sabe (lugares, materias, horarios) se propone precargado.
- ✅ **Estados vacíos útiles**: explican qué iría ahí y tienen el botón para crear lo primero. Hechos: Silos, Bandeja («Ver mi semana»), Rutinas, Lugares, Materias (botones a «Inicio de cuatrimestre» y «Rutinas») y la búsqueda de Ajustes («Ver todos los ajustes»); con tests (`emptyStates.test.tsx`, `e2e/vacios.spec.ts`).

### Privacidad y cuenta

- ✅ Link a la política de privacidad (`privacy.html`) en Ajustes y en la pantalla de login.
- Los permisos (notificaciones, ubicación, fotos, archivos) se piden solo al usar la función que los necesita y explicando para qué, nunca al abrir la app. (Hoy ya se cumple).
- ✅ **Revocar todo y borrar la cuenta** en Ajustes, en un solo lugar y con un paso de confirmación escribiendo «BORRAR»: revoca los tokens de Google, borra la contraseña de iCloud y la clave de Gemini del Vault, borra el calendario «📚 Plan» si el usuario quiere (viene marcado) y elimina la cuenta con todos sus datos y su invitación. Ofrece antes exportar el JSON. La cuenta dueña no se puede borrar (se quedaría la app sin quien maneje las invitaciones): solo revoca.

### Consistencia visual

- **Íconos**: todos de línea de 2px, con extremos redondeados y del mismo tamaño, desde `icons.tsx`; los emojis no se usan como íconos de interfaz (sí en los datos, como «📚 Plan» o `📝`). ✅ Botones y marcas con íconos de línea (`Marks` en `icons.tsx`: cerrar, hecho, parcial, no, fijado, casa); un test impide volver a dibujarlos con emojis o ✓ ✗ ✕ ◐. Los ✓ dentro de una frase quedan como texto. Falta: el ícono de critiCal, que es relleno (pregunta en TODO §1.1).
- ✅ **Escala de diseño**: espaciados múltiplos de 4/8, pocas medidas de texto y radios fijos, todo desde los tokens de `styles.css`, sin valores sueltos (`--radius-*`, incluido `--radius-round` para círculos; `radiusTokens.test.ts` falla ante un radio literal).
- ✅ **Toques y bordes de iPhone**: zonas táctiles de al menos 44pt y safe areas respetadas. Lo que se dibuja más chico (píldoras, botones chicos, cerrar, íconos de la cabecera) agranda su área con un `::before` invisible, sin moverse. La barra de pestañas queda pegada al borde de abajo, como está.
- ✅ **Números que se animan** (`CountUp`: silos y «planificado vs. hecho»; con «reducir movimiento» saltan al valor): las horas de los silos y los totales cuentan hasta el valor nuevo al cambiar, con números tabulares para que no salten.
- **Filtros**: si alguna vez hay filtros, siempre con un botón «Limpiar filtros».

### Interacción y animaciones

- **Transiciones con resorte** (200–300 ms) en hojas, pestañas, bloques que cambian de lugar y avisos. Con «reducir movimiento» pasan a un fundido corto o a nada.
- ✅ **Respuesta optimista**: marcar ✓/✗, mover o editar se ve al instante; si el servidor falla, se revierte con un aviso que dice qué no se guardó. Sin conexión no se revierte nada: el cambio queda en el dispositivo y se reintenta. Si la base **rechaza para siempre** un cambio (un dato que no acepta), `flush` en `Connected.tsx` escribe fila por fila lo que sí acepta, lee de la base su copia (que es justo lo guardado) y la muestra en lugar de la local: el cambio rechazado vuelve a como estaba y lo demás se queda. Si se editó algo mientras tanto, no se pisa y la próxima sincronización lo muestra. El aviso dice «volvió a como estaba» y que lo demás sí se guardó.
- **Deshacer en vez de confirmar**: las acciones destructivas (borrar, abandonar una entrega, rechazar una propuesta) se hacen al toque y muestran un aviso con «Deshacer». El aviso se anuncia a VoiceOver, se alcanza con el teclado, no se va mientras tiene el foco o el puntero encima, y lo deshecho también se puede recuperar después desde el historial de «Deshacer» (§13). Solo borrar la cuenta pide confirmación.
- **Gestos**: deslizar un bloque para marcarlo hecho o salteado, y deslizar horizontalmente para cambiar de día o semana. Siempre con un botón equivalente.
- **Vibración háptica** al marcar un bloque y al soltar un arrastre, donde el navegador la soporte (Safari en iPhone casi no la soporta: es un extra, no puede ser la única señal).

### Accesibilidad

- ✅ **Contraste AA** en texto y en los colores de criticidad (además del color, un ícono o una palabra). El azul de las opciones de hoja usa `--link-ink` (≥ 4,5:1 en claro y oscuro). **El zoom está bloqueado** por decisión del usuario (2026-11-22): `<meta viewport>` con `maximum-scale=1, user-scalable=no`, `touch-action: pan-y` en `html`/`body`, `gesturestart`/`gesturechange` cancelados, y todos los campos con `font-size: max(16px, …)` para que iOS no amplíe al enfocar (ni con el texto del sistema pequeño). Reemplaza el pedido anterior de permitir el zoom, aunque no cumpla WCAG 1.4.4.
- ✅ Etiquetas para VoiceOver en todo lo que se toca, incluidos los bloques del calendario y los silos.
- ✅ El texto respeta el tamaño de letra del sistema sin romper la grilla.
- ✅ Foco visible y uso completo con teclado en la Mac.

### Primer uso guiado

- La primera vez, un recorrido corto con progreso visible: conectar Google → crear la primera materia o entrega → ver el primer plan. Se puede saltar y retomar desde Ajustes. ✅ Implementado (`FirstSteps.tsx`): tarjeta «Primeros pasos · N de 3» arriba de la Semana, solo con cuenta; conectar Google cuenta como paso hecho (gradiente de meta); «Saltar por ahora» la guarda en el dispositivo y Ajustes → Cuenta → «Primeros pasos» la vuelve a mostrar.

## 15. Traslados en ómnibus (Montevideo y Canelones) — datos y servidor ✅, interfaz ✅

- Elegir por traslado (o por par de lugares) entre **auto** y **ómnibus**.
- Tiempos del sistema real: STM de Montevideo y líneas metropolitanas de Canelones — horarios y pasadas por parada, **esperas** y **transbordos**.
- Sugerir qué ómnibus tomar para minimizar el tiempo puerta a puerta.
- **Rutas habituales** (ej. casa → trabajo cada día de la semana) guardadas en los datos del usuario con los ómnibus y tiempos elegidos, para no recalcular a diario y tenerlas aunque el teléfono se haya apagado.
- Decisiones (noviembre 2026, tomadas por Claude a pedido del usuario; se pueden revisar):
  - **Fuentes** (verificadas el 10/11/2026): **no existe un GTFS del STM**. La Intendencia publica las pasadas teóricas por parada de cada variante (CSV, 2,25 millones de filas, regeneradas a diario) y las paradas y variantes como shapefile en UTM; el MTOP/DNT publica un **GTFS real** de las líneas metropolitanas (Canelones y San José). Se importan ambos a un modelo común (`apps/web/api/_lib/transit`). Licencia de Datos Abiertos de Uruguay: se cita la fuente en la interfaz. **No hay tiempo real**: la API de pasadas en vivo de la IM no figura en el catálogo abierto, así que todo se marca como «horario teórico» (queda pendiente si aparece una API pública).
  - **Caché**: el servidor descarga y compacta los horarios una vez por semana (cron de la base) y los guarda en `transit_feed` (~1 MB: por variante, la hora de salida y los minutos a cada parada; no las 2,3 millones de pasadas). Las rutas habituales (`bus_routes`) guardan la opción elegida y la versión de los horarios; la app las recalcula si cambia la versión, si cambia la hora del evento o del traslado, si el horario guardado no corre ese día (otro día de la semana, feriado o fin de horarios) o si el usuario lo pide (`staleReason` en `apps/web/src/transit.ts`).
  - **Cálculo**: `POST /api/transit` `{action:"plan"}`: directo o con **un** transbordo por defecto (y, si con uno no llega ningún ómnibus, el servidor reintenta solo con **dos** y lo marca en `raised`); `maxTransfers: 2` lo permite siempre («solo esta vez» en un traslado, o fijo en un lugar o ruta; los selectores son de la UI), `maxTransfers: 1` lo impide. Paradas a menos de 900 m a pie, 5 min de margen por transbordo, hasta 3 opciones. La búsqueda es por rondas (una por ómnibus tomado): sumar un transbordo es una ronda más. «Llegar a las HH:MM» devuelve la salida más tardía que llega a tiempo; «salir a las HH:MM», el primer ómnibus que se alcanza. Los tramos a pie usan OpenRouteService (perfil a pie) y, sin respuesta, la línea recta ×1,3 a 4,8 km/h. Los feriados corren con el horario de domingo (la app manda `dayType: 3`).
  - ✅ **Interfaz**: un selector Auto / Ómnibus en cada lugar guardado (modo por defecto para llegar ahí: columna `places.travel_mode`, `car` por defecto) y otro en cada evento con lugar guardado (tarjeta que se abre al tocarlo en la semana; vale solo para ese evento y se guarda en `settings.state.tripModes`, con «Volver a …» para soltarlo). En ómnibus, la tarjeta pide `POST /api/transit` (casa → lugar, llegar a la hora del evento; un feriado corre como domingo) y muestra la mejor opción **en una línea por tramo** («Ida · salís 11:35 · 701 → 710», «Vuelta · salís 14:00 · 710 → 724»: las líneas en el orden en que se toman, con la hora de salida). Al tocar el tramo se despliega el detalle: cuándo salir y llegar, cada tramo a pie, la línea con su destino, la parada y la hora de pasada, dónde bajar y los botones de la ruta habitual (una sola vez por tramo, ahí dentro). La tarjeta no repite «horario teórico» ni la atribución de los datos: van en **Ajustes → Cuenta**, junto a la política de privacidad («Horarios teóricos: Intendencia de Montevideo (STM) y Dirección Nacional de Transporte (MTOP), datos abiertos de Uruguay. Son horarios teóricos, sin tiempo real»; también se encuentra con el buscador de Ajustes). Sin cuenta (demo), sin coordenadas o fuera de la zona, la tarjeta lo dice en vez de calcular. La tarjeta muestra la **ida** y la **vuelta** (ver abajo).
  - ✅ **El plan reserva el tiempo del ómnibus**: si el evento va en ómnibus (su elección en `tripModes`, o el modo de su lugar), el motor bloquea antes del evento lo que dura el viaje **puerta a puerta** (de que salís a que llegás, con la espera) más el margen de siempre, y después del evento lo mismo para volver a casa (la vuelta es su propio viaje: se calcula aparte, ver «Vuelta y rutas habituales»), en vez de los minutos en auto. El motor no llama a la red: `TravelOptions.tripMinutes(evento)` es una función que le pasa la app. La app guarda en `settings.state.tripMinutes` (`{minutos, start}` por evento) el `totalMinutes` de la mejor opción cada vez que la tarjeta recibe la respuesta de `/api/transit`; el dato vale solo para el `start` con el que se calculó (si el evento se mueve, deja de valer). Solo cuenta para el viaje que sale de casa: entre dos eventos seguidos se mantienen los minutos en auto, porque no se sabe el ómnibus entre esos dos lugares. **Sin dato** (nunca se abrió la tarjeta, sin cuenta, sin coordenadas, sin ómnibus que llegue a tiempo) el plan usa los minutos en auto y la tarjeta lo avisa: «Todavía no tengo los minutos del ómnibus: el plan usa los del auto».
  - ✅ **Vuelta y rutas habituales**: la tarjeta tiene dos bloques, **Ida** y **Vuelta**. La vuelta pide `POST /api/transit` del lugar a casa, «salir» a la hora en que termina el evento (el mismo día de horarios que la ida). El plan reserva la ida puerta a puerta (`totalMinutes`) y la vuelta **desde que termina el evento hasta que llegás a casa** (cuenta la espera del ómnibus). Se guardan en `settings.state.tripMinutes` como `{minutes, start, back?}`; el motor las pide con `TravelOptions.tripMinutes(evento, "there" | "back")` y, si no hay cifra de vuelta, usa la de la ida. **Rutas habituales**: bajo cada bloque, «Guardar como ruta habitual» guarda la mejor opción en `bus_routes` (casa → lugar, o lugar → casa), con el día de la semana y la hora del evento (llegar para la ida, salir para la vuelta); se reemplaza la del mismo hueco. **Se prefiere la ruta guardada**: si hay una en el hueco del evento, la tarjeta pregunta solo la versión actual de los horarios (`action: "status"`) y, mientras `staleReason` diga que sigue valiendo (mismos horarios, corre ese día, no venció), la muestra «sin consultar los horarios» y de ella toma los minutos; si quedó vieja, avisa por qué, muestra lo que dan los horarios de hoy y ofrece «Actualizar ruta habitual»; sin conexión (no se puede preguntar la versión) se confía en la guardada. Se ven y se borran en **Lugares → Rutas de ómnibus** (también «Borrar ruta habitual» en la tarjeta). Una ruta sirve solo para el mismo día de la semana y la misma hora; otro horario del mismo evento es otra ruta.
  - Pendiente: calcular los minutos de los eventos de la semana sin que haya que abrir cada tarjeta.

## 16. Rediseño de Configuración ✅

Problemas reportados: el panel de Ajustes quedó muy largo; los botones de las secciones no tienen borde y se pierden; abrir una sección empuja todo el resto y abrir y cerrar secciones se siente tosco.

- Hacer **3 mockups** bien distintos del panel de Configuración (por ejemplo: lista agrupada estilo Ajustes de iOS que navega a subpantallas; buscador con secciones en tarjetas; resumen con lo importante arriba y lo avanzado aparte). Cada uno se evalúa con criterio: ¿está muy cargado?, ¿se entiende qué hace cada botón sin leer de más?, ¿es lo más rápido y cómodo para las tareas frecuentes?, ¿se puede aliviar?, y cómo cumple las guías del §14.
- Entrega: una presentación corta y navegable con una pantalla por mockup, renderizada como en el iPhone, con sus pros y contras. Se publica en un link privado de claude.ai para mostrarla a otras personas, y una copia HTML queda en `docs/mockups/`.
- El usuario y las personas que consulte eligen uno. **Se implementa recién cuando el usuario lo elige**, en un PR aparte, y después se vuelve a pasar por el ciclo del §17.
- Se empieza recién cuando los cambios de UI en curso estén terminados, validados, mergeados y desplegados en producción.
- ✅ **Elegido (noviembre 2026): el mockup A**, lista agrupada como Ajustes de iOS (`docs/mockups/configuracion.html`), con el **aviso de arriba del C**:
  - Arriba, solo si algo pide acción: Google o iCloud sin sincronizar (con «Reconectar Google» o «Ver Calendarios») y la casa sin guardar («Agregar casa»). Si todo está bien no se muestra nada.
  - Después «Hoy» y cinco grupos: Planificar, Mi tiempo, Lugares, Conexiones y Cuenta. «Revocar todo y borrar la cuenta» va solo, en rojo, al final. Cada fila dice su estado a la derecha.
  - Cada sección es una pantalla que entra de costado (con resorte; con «reducir movimiento», un fundido). El foco pasa a «‹ Ajustes» y, al volver, a la fila que la abrió. Lo de atrás queda inerte. Las pantallas siguen montadas, así un formulario a medio llenar no se pierde al volver.
  - ✅ **Refuerzos**: lo escrito y no guardado (Mi semana, Reglas, Horas, una materia abierta, Rutinas, Inicio de cuatrimestre) **se conserva aunque se cierre Ajustes** (hasta recargar la app, cambiar de cuenta o reiniciar la demo) y dice «Cambios sin guardar»; al salir de Ajustes con algo así pregunta «¿Descartar los cambios?» (§14). El «atrás» del sistema vuelve de la pantalla a la lista y de la lista a la app; cerrar con ✕ o Escape no deja entradas de más en el historial. Renombrar una materia o rutina a un nombre que ya existe se impide, como al agregar. En la base, un disparador rechaza `settings.data` que la app nunca escribiría (semana que no tiene 7 días, número como texto, más de 64 KB) y solo mira filas nuevas o cuyo `data` cambia, así una fila vieja de producción no queda bloqueada.
    - **Rutinas en dos vistas** (decidido el 2026-11-22): Ajustes → Rutinas muestra las rutinas hechas (tocar una la edita, pausa o elimina, como siempre) y el botón «Crear rutina nueva». El botón abre, dentro de la misma hoja, una vista que solo tiene el formulario («‹ Rutinas» para volver al nivel anterior; no se ven «‹ Ajustes» ni el título «Rutinas» arriba, una sola miga, decidido el 2026-11-23); al guardar vuelve a la lista con la nueva. Si hay algo escrito, «‹ Rutinas» pregunta «¿Descartar los cambios?»; un borrador que quedó de antes (recarga) abre directo el formulario.
- «Materias» y «Rutinas» son filas distintas (antes «Materias y rutinas» y «Rutinas» se pisaban).
  - ✅ **Buscador** (del mockup B, rehecho sobre la Ajustes actual): un campo «Buscar un ajuste» arriba de la lista (dentro de `role="search"`, con etiqueta y placeholder de ejemplo, letra de 16 px o más). Encuentra por el nombre de la fila y por las palabras de lo que hay adentro (`KEYWORDS` en `Settings.tsx`: «almuerzo» → Mi semana, «omnibus» → Lugares y traslados, «margen» → Reglas), sin importar acentos ni mayúsculas; cada palabra escrita tiene que empezar una palabra de la sección (así «dia» encuentra «días» pero no «media»). También encuentra las filas que no son pantallas: Planificación semanal, Política de privacidad, Primeros pasos, Reiniciar demo y Salir. Con texto, los avisos, «Hoy» y los grupos dejan lugar a los resultados (las mismas filas, con su estado a la derecha); lo escrito en «Hoy» no se pierde. Un estado de lectura anuncia «N ajustes coinciden» / «Ningún ajuste coincide». «Limpiar búsqueda» (o «Ver todos los ajustes» si no hay resultados) vacía el campo y le devuelve el foco; con el campo vacío o con solo espacios se ve la lista de siempre. Abrir un resultado y volver deja el foco en su fila y conserva la búsqueda. Al sumar un campo a una sección, hay que sumar sus palabras a `KEYWORDS`.

## 17. Hasta producción: orden de trabajo y ciclo de validación

Lo que falta y en qué orden, para retomar sin más contexto: [`TODO.md`](TODO.md).

Orden:

1. Terminar, mergear y desplegar lo que está en curso.
2. Hacer los mockups del §16.
3. Implementar todo lo que el proyecto tiene pendiente: las guías del §14 que no tienen ✅, los traslados en ómnibus del §15 y cualquier TODO que haya en el código. Un PR por tema.
4. Correr el ciclo de validación hasta que quede limpio.

**Cuenta de prueba local**: un usuario con email y contraseña inventados, creado por el seed de Supabase local (`supabase/seed.sql`, activado en `[db.seed]` de `config.toml`). La pantalla de login muestra un formulario de email y contraseña **solo** cuando la app corre en desarrollo (`import.meta.env.DEV`) contra el Supabase local (URL `127.0.0.1`/`localhost`); en staging y producción ese formulario no existe y el proveedor de email está apagado. Las credenciales quedan en el seed y en `.env.example`, nunca en el chat. Google e iCloud reales no se prueban con esta cuenta. Para que funcionen los traslados, la sync y el resto de `/api` en local, las funciones se sirven con `vercel dev` (o un proxy equivalente en Vite) con un `.env.local` que apunta al Supabase local; las claves de terceros (OpenRouteService, Gemini) son las de desarrollo y, si faltan, esas funciones se prueban con sus respuestas simuladas. La sincronización con Google e iCloud no se puede probar de punta a punta sin cuentas reales: se valida con los tests automáticos que simulan Google y CalDAV (`apps/web/api/*.test.ts`), y en el simulador se prueba con la **cuenta de prueba local** (no en modo demo, que no sincroniza): las funciones `/api` locales usan proveedores simulados de Google y CalDAV, activables solo en desarrollo, que devuelven eventos inventados. Desde la interfaz se comprueba la sync exitosa (aparecen los eventos, «✓ N eventos · hora» en Calendarios, se replanifica) y los estados de error y «Reconectar». Como «Reconectar Google» pasa por el OAuth de Supabase y no por `/api`, en desarrollo con el proveedor simulado ese botón usa un OAuth simulado que deja el permiso otra vez válido sin salir de la app; que el OAuth real pida los scopes correctos se cubre con un test unitario de la llamada. El modo demo queda exceptuado de las pruebas de sincronización. ✅ Hecho: `supabase db reset` crea la cuenta (dueña de la app, con un permiso de Google vencido para probar «Reconectar»); `bun run dev` sirve `/api` desde el mismo servidor de Vite (no hace falta `vercel dev`), y con `VITE_FAKE_PROVIDERS=1` contra el Supabase local Google, iCloud, los mapas y Gemini responden con datos inventados (`apps/web/api/_lib/fake-providers.ts`). Cómo prepararlo: `.env.example`.

**Ciclo de validación**: se valida **antes** de mergear, porque cada merge a `main` termina desplegado en producción. Se repite entero después de cada arreglo:

1. **Local**: Claude abre la app del PR en el simulador de iPhone (dev server y Supabase local en Docker) y prueba **todas** las funciones, con los caminos felices y los de error, en modo demo y con la cuenta de prueba local. Anota lo que falle.
2. **Agente atacante**: un agente sin contexto técnico de la app usa la interfaz de iPhone con un solo objetivo: encontrar todas las vulnerabilidades que pueda y romper todas las funciones posibles, y reportarlas. Ataca primero el entorno **local** y después repite en la **preview del PR** (con el Supabase de staging) solo las pruebas que no rompen datos. Nunca ataca producción. La preview la despliega `preview.yml` en cada push a un PR y comenta la URL; no corre las migraciones del PR, así que un PR con migraciones nuevas se prueba con ellas solo en local.
3. Todo lo reportado se arregla en el mismo PR y se vuelve al paso 1.
4. Con una vuelta limpia, el CI en verde y Codacy sin hallazgos nuevos, se mergea. Staging se despliega solo y, si su E2E pasa, producción también (no hay aprobación manual: por eso se valida antes de mergear).
5. **Producción**: Sentry sin errores nuevos ni problemas de seguridad abiertos después del deploy, más una prueba rápida de la app desplegada en el simulador (modo demo). Si algo falla, se abre un PR con el arreglo y vuelve al paso 1.

El ciclo termina cuando una vuelta completa no encuentra nada. Si la misma falla vuelve 3 veces, o pasan 5 vueltas seguidas con fallas nuevas, se frena y se avisa al usuario con el detalle. **Criterio del freno** (decidido el 2026-11-18, después de 12 vueltas): cada vuelta arregla sus Altas y Medias; las Bajas se anotan en el TODO (§5.3) y no traban el resto del trabajo. Se frena y se avisa solo si aparecen Altas nuevas 3 vueltas seguidas o la misma Alta vuelve.

## 18. Próximos desarrollos (noviembre 2026)

Pedidos del usuario del 2026-11-06. Lo que dice «a decidir» se resuelve preguntándole; sus respuestas quedan acá. Seguimiento en [`TODO.md`](TODO.md).

1. **Psicología de UX** (video «The UX Psychology Behind Apps People Can't Stop Using», uxpeak, https://www.youtube.com/watch?v=2TlIg3VokY8). Aplicar lo que sirve en una app gratis (el principio de contraste de precios no aplica):
   - **Valores por defecto inteligentes**: formularios precargados con lo más probable (materia con duración y franja típicas, entrega con fecha sugerida), nunca en blanco.
   - **Gradiente de meta**: el primer uso no arranca en 0 % (conectar la cuenta ya cuenta como un paso hecho); progreso visible por entrega y por semana.
   - **Valor antes de registrarse**: el modo demo deja ver un plan completo antes de pedir Google.
   - **Efecto IKEA**: lo que el usuario arma (sus materias, rutinas, lugares) se muestra como suyo y crece con el uso (por ejemplo, «tu semana tipo»).
   - **Encuadre de pérdidas**, sin manipular: «si salteás este bloque perdés 2 h de margen para el parcial» en vez de «estudiá».
   - **Compensar el camino infeliz** (lo que el usuario más quiere ver): cuando algo sale mal (no llego, salteé bloques, falla la sync, no hay lugar) la app responde con gracia y algo de humor, sin culpa, y siempre con la salida concreta (las opciones del §5.6, «Reconectar», «Reacomodar hoy»). Decidido: **texto con humor + un personaje animado**.
   - Bocetos de mascotas (Tic el reloj, Punta el lápiz, Dosi la píldora): [`mockups/mascota.html`](mockups/mascota.html). **Descartados** (2026-11-07): en vez de elegir una mascota, el usuario elige un **estilo toon 3D** y sus animaciones.
   - **Escalera de Jacob** (el juguete de tablitas de madera unidas con cintas, https://en.wikipedia.org/wiki/Jacob%27s_ladder_(toy)): es el personaje y se llama **Roy**. Cuando un texto de la app se refiere a él, dice «Roy», nunca «la escalera» («Se le desarmó Roy»). Se dibuja en 3D medio isométrico, con las tablitas de colores del juguete de referencia del usuario (fotos y videos del 2026-11-07, no van al repo).
     - **Cargando**: el juguete en movimiento, la tabla de arriba se da vuelta y el golpe baja tablita por tablita, en bucle. Reemplaza al indicador de espera del §14 (el componente `<Loading>` recibe el caso y dibuja la forma que corresponde).
     - **Una forma por caso**: con las mismas tablitas arma figuras distintas (colgando, festejo con los brazos arriba, encogerse de hombros, desarmado en el piso, puente, acordeón que piensa, oruga que avanza para los traslados).
     - Con «reducir movimiento» se muestra la forma quieta, con fundido.
   - Claude hace **3 estilos toon 3D** con todas las animaciones, en una presentación (link privado + copia en [`mockups/estilo-toon.html`](mockups/estilo-toon.html); https://claude.ai/artifact/XGtofmsjQxt3fqQT7MXTwv). El usuario elige estilo y, por caso, qué animación usar; se implementa recién después.
   - **Elegido** (2026-11-07): estilo **A · Madera pintada** (madera saturada con cintas, veta y sombra en dos tonos, easing con golpe). Animación por caso:
     - Cargando: cascada. Sincronizando: va y vuelve. La IA piensa: acordeón. Calculando traslados: oruga.
     - Me recuperé o todo hecho: festejo. No llego o salteé bloques: hombros. Falla la sync: desarmado. No hay lugar: puente. Nada para hoy: reposo.
   - ✅ **Implementado** (`components/Roy.tsx`, siempre `aria-hidden`; con «reducir movimiento» queda la forma quieta del caso). Decidido (2026-11-09):
     - `<Loading>` dibuja a Roy según el caso (genérico: cascada; sync: va y vuelve; IA: acordeón; traslados: oruga), también en `inline`, en miniatura (24 px) en vez de la ruedita. `mascot` lo reemplaza.
     - Falla la sync (Google o iCloud, en los avisos de Ajustes): desarmado.
     - No entra o no hay lugar (comidas sin lugar y opciones de «No llegás a todo»): puente.
     - Nada para hoy (un cambio que deja el día libre): reposo.
     - Salteé bloques: hombros, también en el aviso de abajo («Anotado, sin culpa»): Roy chico a la izquierda del texto, encoge los hombros una vez y queda quieto.
     - Festejo: al reacomodar el plan (aceptar un cambio o elegir una salida de la Bandeja) y cuando una entrega llega al 100 % (un silo se cierra; los hábitos no cuentan porque empiezan de nuevo cada semana). No al terminar el día.
   - ✅ **Auditoría del 2026-11-23** (resto de la psicología de UX contra el código):
     - Valor antes de registrarse ✅ (la demo se abre sin cuenta). Gradiente de meta ✅ («Primeros pasos» no arranca en 0 %: conectar cuenta cuenta como un paso).
     - **Camino infeliz** ✅ en todos los casos: no llego y salteé bloques (Roy hombros), falla la sync Google/iCloud (Roy desarmado + «Reconectar Google»), no hay lugar (puente), importador con error (Roy desarmado + «Reintentar»), sin conexión o carga fallida (Roy desarmado + «Reintentar»/«Descartar»), guardado rechazado por la base (Roy desarmado + «Entendido»), pantalla trabada (Roy desarmado + «Recargar») y enlace de entrada vencido o permiso de Google rechazado (`otp_expired` / `access_denied`: aviso con Roy desarmado y «Entrar con Google» al lado; la dirección queda limpia).
     - **Encuadre de pérdidas** ✅: el bloque futuro de una tarea con fecha dice «Si lo salteás, el plan tiene que encontrar 50 min en otro momento antes de la entrega del 12 nov»: solo los minutos que tiene el bloque y la fecha, sin apuro (los críticos ya dicen que no llegás al mínimo).
     - **Valores por defecto que aprenden** ✅: al crear una entrega (Silos > Nueva), las horas estimadas y el mínimo salen de la **mediana** de las entregas anteriores del mismo tipo (parcial o entrega; cuentan las hechas, no las descartadas, los hábitos ni los silos de estudio) y, si la materia ya tiene, de las de esa materia (`learnedDefaults.ts`). Sin historia quedan las horas fijas (4 h y 2 h). Se dice sin cifras ni apuro debajo de los campos («Como tus parciales anteriores de esta materia») y se puede editar como siempre: al escribir las horas dejan de cambiar solas al elegir otra materia o marcar «Es un parcial».
     - **Efecto IKEA** ✅: la planificación semanal muestra una línea «Tu semana tipo: 4 materias, 3 rutinas, 5 lugares» con los conteos reales de lo que el usuario armó (`weekType.ts`); lo que está en cero no se nombra y sin nada armado no hay línea. Crece con el uso; sin porcentajes, metas ni progreso inventado.
   - Ética: nada de urgencia, escasez, progreso ni resultados falsos.
2. ✅ **Comidas siempre presentes**: la regla nueva está en §5.1. Decidido:
   - **«Hoy no»**: al tocar una comida, «Hoy no almuerzo» la saca solo ese día (con Deshacer, §14). El plan usa ese tiempo y al día siguiente vuelve.
   - **Merienda opcional**: una cuarta comida en Mi semana, con hora y duración (0 = sin merienda), que se ubica con la misma regla que las otras. Va entre el almuerzo y la cena.
   - El ayuno se maneja con esas dos opciones y con duración 0 en la rutina. No hay una ventana de ayuno aparte (se puede sumar más adelante).
3. ✅ **Eventos superpuestos lado a lado**: cuando dos o más bloques se pisan, se dibujan en columnas más angostas, una al lado de la otra, como en Calendario de iOS, nunca uno encima del otro.
4. ✅ **Olvidar el lugar y conservar el tiempo**: un evento de un calendario (por ejemplo iCloud) trae una ubicación a la que voy una sola vez. Le pongo 20 min de traslado y no quiero guardar el lugar, pero hoy «Olvidar» también borra los 20 min y la otra opción es guardarlo como lugar. Tiene que haber una opción **Eliminar** que avise que se borra la ubicación exacta pero que el tiempo estimado se mantiene y el plan lo sigue teniendo en cuenta. Decidido: una tercera opción, **«Eliminar lugar»**, al lado de «Guardar como lugar» y «Olvidar», con el aviso «Se borra la dirección; los 20 min de traslado quedan para este evento y el plan los sigue contando». El tiempo queda guardado en el evento, no como lugar.
5. ✅ **Silos que se van solos**: un silo cuya fecha final ya pasó desaparece de la vista de silos cuando termina esa semana. Se ven solo los que están en curso y los terminados **esta** semana, para que no se acumulen semestre tras semestre. Los datos no se borran. Decidido: al final de la vista, un botón chico **«Ver anteriores (N)»** los muestra agrupados por cuatrimestre. Cuatrimestres por fecha de entrega: enero–julio es el 1.º; agosto–diciembre, el 2.º (así el año del título es el de las fechas).
6. ✅ **Barra de arriba**:
   - El rango de la semana se escribe «2 – 8 nov» (el mes una sola vez; si cruza de mes, «27 oct – 2 nov»).
   - La flecha de Deshacer usa el mismo ícono de línea de 2 px que el resto (`icons.tsx`).
7. ✅ **Empezar más tarde**: una tarea (o una materia entera) que no puedo empezar hasta cierto momento. Se puede indicar:
   - una demora relativa a hoy («dentro de 10 días»);
   - un tiempo antes de la entrega («4 días antes»);
   - o una fecha exacta, que tiene que ser anterior a la entrega.
     Antes de esa fecha el plan no le asigna bloques. Desde ese momento el plan reparte el trabajo en los días que quedan, y si no entra avisa con las opciones del §5.6. Decidido:
   - Se configura en la **tarea** y en la **materia**: lo de la materia vale para todas sus tareas, salvo que una diga otra cosa.
   - ✅ Opción **«Empezar antes»** en las decisiones de la Bandeja cuando no entra por la fecha de inicio. Por defecto de Claude: se adelanta a **el último día en que todo entra** (o «ya» si ninguno alcanza), se guarda como fecha en la tarea y se puede deshacer.
   - Por defecto de Claude: el aviso de que no entra sale **al guardar**, con la vista previa del §5.6, y no recién cuando llega la fecha.
8. **Bun y Rust**: pasar el sistema a Bun y Rust para mejorar los tiempos de compilado y de ejecución. Decidido:
   - **Bun** como gestor de paquetes y para correr los scripts y el CI; Vite, Vitest y Vercel siguen como están.
   - ✅ **Bun hecho** (2026-11-22): `bun.lock` (sin `package-lock.json`), `packageManager: bun@1.4.5`, CI y Deploy con `oven-sh/setup-bun` fijo y `bun install --frozen-lockfile`, scripts con `bun run`, Dependabot en el ecosistema `bun`. Node 24 sigue instalado en CI porque Vitest, Playwright y la CLI de Vercel corren sobre él.
   - ✅ **Motor medido** con `bun run bench` / `bun run bench:node` (`packages/engine/bench/schedule.bench.ts`), mediana de `schedule()` en una PC con Windows (Bun 1.4.5 vs Node 22.14):

     | Caso                                 | Bun     | Node    |
     | ------------------------------------ | ------- | ------- |
     | demo (3 materias, 6 tareas, 14 días) | 3,7 ms  | 7,3 ms  |
     | mediano (8, 40, 30 días)             | 35,8 ms | 29,9 ms |
     | grande (15, 150, 90 días)            | 958 ms  | 328 ms  |
     | enorme (30, 500, 180 días)           | 18,2 s  | 5,4 s   |

   - **Conclusión: no se hace Rust/WASM.** Un uso real (demo hasta mediano) tarda decenas de milisegundos. El costo crece más que lineal con tareas y días, por lo que lo que escala mal es el algoritmo, no el lenguaje: si algún día hiciera falta, conviene optimizar el algoritmo antes. Además Bun (JavaScriptCore) no es más rápido que Node (V8) en los casos grandes, y el motor corre en el navegador y en Vercel, no en Bun.

9. ✅ **Arreglos visuales** (pedido del 2026-11-16, sobre 18 capturas del iPhone). Decidido:
   - **Sin reborde de color a la izquierda** en tarjetas, globitos, avisos ni secciones. El color de una tarjeta o de un bloque se marca con un **punto** antes del título. Una sección de Ajustes va directo sobre la hoja, sin caja; una tarjeta dentro de una hoja lleva un contorno fino.
   - **Sin líneas divisorias** entre filas: se separan con espacio. Quedan solo donde hacen falta: la lista agrupada de Ajustes, las opciones apiladas de una hoja de acciones y el borde de la barra de pestañas.
   - **Aire entre un texto y su botón**: nunca menos de 12 px, en todas las pantallas.
   - **Pull tab**: toda hoja tiene arriba una barra fija con la pastilla y la ✕, que no se va al deslizar el contenido. Arrastrar la pastilla hacia abajo cierra la hoja (en una pantalla de Ajustes, vuelve a la lista); ✕ y Escape siguen siendo los botones equivalentes.
   - **Política de privacidad**: la página tiene arriba, fijo, «‹ Volver a critiCal» (instalada como app no hay barra del navegador para volver).
   - **Casillas**: un solo dibujo propio para casillas y opciones, igual en todos los navegadores.
   - **Planificación semanal**: la parte llena de cada barra es redondeada arriba y abajo, como la barra.
   - **Lugares**: el formulario de un lugar se abre en su fila, no al final. Las direcciones de eventos (con sus minutos) y los traslados que quedaron al eliminar una dirección van juntos en «Direcciones de eventos», **cerrado por defecto**: una dirección que ya tiene sus minutos no pide nada.
   - **Minutos en auto, a demanda**: ya no se calculan todas las combinaciones de lugares. La app calcula sola, en segundo plano, solo los viajes que el plan hace en las próximas dos semanas y todavía no tienen tiempo: de casa a cada lugar con evento y la vuelta, y de un lugar al siguiente cuando no da para volver a casa (`tripPairs` y `missingPairs` en `places.ts`; `POST /api/travel` con `{ pairs }`). Un viaje que no se pudo calcular no se vuelve a pedir hasta que cambien sus lugares o se abra la app de nuevo. En Lugares, «Minutos en auto» está **cerrado por defecto** y lista solo los viajes en uso; adentro se corrige uno, se carga otro a mano («Cargar un tiempo a mano») o se recalculan.
   - **Eliminar una materia** (o una rutina) desde Materias: se va con sus silos, lo registrado y sus bloques, al toque y con Deshacer (§14).
   - **Roy más grande**: cada forma se escala a sus propias proporciones para llenar su caja (antes todas se achicaban como si fueran la escalera parada, y las anchas quedaban mínimas). Junto a una línea de texto, la escalera va acostada (una fila de tablitas que se dan vuelta por turno) y el acordeón deja su lugar a esa fila.
   - **Decisiones de la Bandeja**: «Decisiones que tomaste» muestra solo las de los últimos 7 días; las anteriores se archivan (los datos quedan, no se listan). Una decisión sobre una **rutina** vale solo por la semana en que se toma: «No hacer gym» la saltea hasta que termina la semana y a la siguiente el plan la vuelve a ubicar. Las rutinas que una decisión vieja había dejado afuera para siempre vuelven solas (`routinesBack`); una que el usuario terminó a mano no.

10. **Arreglos del 2026-11-18** (pedido del usuario, sobre 4 capturas del iPhone). Pendiente:

- ✅ **Eliminar materias que no se van** (causa: al borrar la materia se iban también sus silos, y el evento de parcial/entrega del calendario, al refrescar, volvía a crear la materia y su silo; ahora la app recuerda las materias eliminadas, `removedSubjects`, y esos eventos ya no las traen; Deshacer lo anula): algunas materias (por ejemplo «P2 PROG AV») muestran «… eliminada» con Deshacer pero no se eliminan. Averiguar por qué vuelven (¿la sincronización las vuelve a crear desde el calendario?) y que eliminar sea definitivo.
- ✅ **Avisos que no tapen nada**: el aviso de abajo (con «Deshacer») tapaba filas de la hoja abierta, por ejemplo la materia que se estaba por tocar. Va arriba de todo en la pantalla (o a la derecha, si arriba no entra), nunca encima de un elemento que impida seguir editando.
- ✅ **Roy más grande** donde hay lugar, sin ocupar nunca el espacio de un elemento que se usa: al doble en las opciones de «No llegás a todo · elegí» de la Bandeja (decisiones de la semana) y en el aviso de sincronización de Calendarios.
- ✅ **Silo ya creado**: cambiar su fecha u hora límite deja elegir la fecha pero no la guarda. Que se actualice. _Causa: un silo que viene de un evento del calendario recuperaba la fecha del evento en la siguiente sincronización. Ahora se recuerda la fecha del evento que reemplazó el usuario (`deadlineSyncedFrom`) y se la respeta mientras el evento no se mueva._
- ✅ **Lugares**: el botón «Editar» de un lugar sin alias ni dirección (por ejemplo «Abuela») queda desalineado del nombre. Se alinea con la primera línea, igual que en los demás.
- ✅ **Bloques seguidos de la misma actividad, en una sola píldora**: en la semana, los bloques de una misma actividad pegados uno al otro, sin tiempo entre medio, se dibujan como una sola píldora en vez de varias juntas. Al tocarla se ven sus bloques. Solo presentación (`runs.ts`): no mezcla niveles, fijados ni pasado/futuro; en el modo edición cada bloque vuelve a ir aparte (para moverlo), y la píldora junta no se arrastra. La hoja lista cada bloque con sus acciones.

**11. Decisiones del 2026-11-18** (respuestas del usuario a las preguntas pendientes):

- ✅ **Horarios válidos por rutina** (pedido nuevo; implementado, ver §5.4): cada rutina (gym, correr…) tiene una franja válida de inicio y fin, que puede cambiar según el día de la semana. Ejemplo: correr a más tardar a las 19:00 entre semana y a las 20:00 los sábados. El plan pone esa rutina solo dentro de su franja de ese día.
- ✅ **Rutina creada a mitad de semana**: la primera semana pide solo la parte proporcional a los días que quedan. Implementado (`sessionsThisWeek`, `AppTask.createdAt`, que va a `tasks.created_at` y al respaldo): las sesiones son las de la semana por los días que quedan (contando el día en que se creó) sobre 7, **redondeadas hacia arriba**, así nunca empieza sin nada que hacer y nunca pide más de lo que un día admite. Ejemplos con gym 3×: creado el sábado, 1 vez; el jueves, 2; de lunes a miércoles, las 3. Desde la semana siguiente, completa. Lo que ya se hizo esa semana se descuenta. Las rutinas de antes de este cambio (sin fecha de creación) y los silos de estudio piden la semana entera.
- ✅ **Comidas cuando te levantás muy tarde**: la comida que cae mientras dormís (o pasada la hora de dormir) se omite ese día; si te levantás a la hora del almuerzo o después, se saltea el desayuno. Reemplaza lo que decía §5.1 («aparece justo después de la anterior»); hecho en `availability.ts`.
- ✅ **Críticos por una tarea que no entra ni sola**: esa tarea se avisa sola y no marca como críticos los bloques de las demás entregas. Implementado en el motor (`schedule`): las tareas cuyo mínimo no entra ni con todo el tiempo para ellas quedan fuera de la demanda, la capacidad y la holgura de las demás, y de «alguien más podría usar este tiempo». Cómo se avisa la imposible (`selfShort`, Bandeja) no cambia.
- **«Quedarme con el mínimo» en una entrega con partes**: si no puede cumplir lo que dice, no se ofrece (como hoy).
- ✅ **Respaldo de otra cuenta o del modo demo**: al importarlo con cuenta, todo recibe ids nuevos, así entra sin chocar con otras cuentas. Implementado (`backupIds.ts`): materias, tareas, partes, registros y lugares reciben uuids nuevos y se reescriben todas las referencias (bloques `tarea@inicio`, registros, `travelTimes`, `applied`, `planHistory`, `pins`, propuestas). Se renuevan siempre que el `owner` del archivo no sea la cuenta o algún id no sea uuid; el respaldo de la propia cuenta conserva sus ids, así reimportarlo no duplica. Los eventos del calendario conservan su id (es el de afuera). Ya no se rechaza «ids no uuid» con cuenta. Además `isPermanent` reconoce toda la clase 22 y 23 de Postgres (con letras, como `22P02`) y `42501` (RLS): no se reintentan.
- ✅ **Respaldo con un dato extra mal formado** (calendarios, decisiones aplicadas, historial…): se descarta solo eso, se importa el resto y se avisa qué quedó afuera (en el aviso «Datos importados. Quedó afuera: …»).
- ✅ **Ajustes → Hoy**: «Me levanté» no puede ser una hora que todavía no pasó (el turno de noche se arma en Mi semana). Una hora posterior a la actual (del día de hoy, también después de medianoche) da el error «Todavía no son las HH:MM»; la hora de rutina sin tocar no se valida.
- ✅ **Tarjeta «¿A qué hora te levantaste?» de la Bandeja** (decidido el 2026-11-19): igual que Ajustes → Hoy, no deja poner una hora que todavía no pasó.
- ✅ **Hoja de bloques seguidos** (pedido el 2026-11-20, con captura): los datos de cada tarea (título, materia, entrega, «Faltan…») van una sola vez, en su primer bloque; los bloques siguientes de la misma tarea muestran solo su horario, grande, y su propio botón. «Soltar» ya no lleva la aclaración «(que el plan decida dónde va)». Si hay dos o más bloques fijados por soltar, abajo hay «Soltar todo», que los suelta juntos.
- **Seguridad**: CSP completa (`script-src`, `connect-src`…), primero en modo «solo reportar» y, cuando no reporte nada roto, obligatoria. Hoy está en modo reporte (`Content-Security-Policy-Report-Only` en `vercel.json`; los reportes llegan a `/api/csp-report`, que los reenvía a Sentry). Pasa a ✅ cuando sea obligatoria.
- **Se mantiene como está**: el bloqueo del zoom y del pellizco (decisión de #15, aunque no cumpla WCAG 1.4.4); «Nada de estudio desde» posterior a acostarse pasada la medianoche no se valida; partes de más de 24 h (hasta 1000 h); un cambio que la base rechaza se descarta y la pantalla vuelve a como estaba (ver «Respuesta optimista»).

**Orden** (decidido): primero los cortos (6 barra de arriba, 5 silos, 3 superpuestos, 4 eliminar lugar); después 2 comidas y 7 empezar más tarde; después 1 (camino infeliz y mascota) junto con el resto del §14; al final los ómnibus (§15) y 8 Bun y Rust.

**12. Decisiones del 2026-11-21** (respuestas del usuario antes de dejar trabajar solo de noche):

- **Ícono de critiCal**: queda relleno, como excepción a «íconos de línea» de §14 por ser la marca.
- **Avisos con letra grande**: con la letra del sistema grande (más de 150 %), los avisos van abajo, sobre la barra de pestañas, para no tapar la barra de arriba. Con letra normal siguen arriba.
- ✅ **Gestos**: deslizar a los costados en la Semana cambia de semana (las flechas siguen). Marcar un bloque deslizándolo **no** se hace en la grilla de la Semana (choca con deslizar de semana y con arrastrar): se hace en la Bandeja, en «¿Cómo te fue?», donde cada bloque es una tarjeta: a la derecha «Hecho», a la izquierda «No hecho», con el mismo aviso y «Deshacer» que sus botones (que siguen ahí, con su nombre). Hace falta un deslizar rápido (menos de 0,6 s), de 60 px o más y claramente horizontal; la tarjeta se inclina hacia el dedo salvo que se pida reducir movimiento (igual responde). Vibración de 10 ms al marcar donde exista `navigator.vibrate` (Android); en iPhone no hay nada.
- **«Fijar acá» en un bloque de hoy**: se ofrece si el bloque todavía no empezó; uno en curso o pasado, no.
- **Grilla con letra grande**: crecen los números de las horas y los nombres y números de los días, con tope; las píldoras siguen del ancho de su columna.
- **«No llegás a todo · elegí»**: Roy en miniatura junto al título de cada opción, en una pose distinta por opción (reemplaza a «Roy al doble» del punto 10); y cuando las opciones se van solas porque el plan ya alcanza, un aviso lo dice («Ya no hace falta elegir: el plan alcanza»). Elegir una opción avisa «Listo, reacomodé el plan» con «Deshacer», que deja el plan como estaba. «Deshacer» de un «Hecho» / «No hecho» deja el plan idéntico al de antes (se guarda el plan previo; si algo más lo movió entretanto, se recalcula). Dentro de una ventanita de un bloque (y de cualquier hoja) Tab y Shift+Tab dan la vuelta sin salir. «Planificación semanal» lista en «No llega al mínimo» solo lo que vence dentro de la semana que planifica (más las rutinas).
- **Orden de trabajo**: primero lo que queda de §14 (gestos, transiciones, primer uso guiado, espaciados) y las Bajas del atacante; después ómnibus (§15), datos y servidor primero.
- **CSP**: queda en «solo reportar» hasta que el usuario revise los reportes «CSP: …» en Better Stack.
