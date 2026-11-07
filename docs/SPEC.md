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
- **Hábito**: gym, etc. Frecuencia semanal, duración, franja preferida, mínimo.
- **Evento fijo**: viene del calendario (clases, cumpleaños, juntadas, familia).
- **Evento tentativo**: reserva el lugar; el motor mantiene un plan B.
- **Comidas**: desayuno, almuerzo y cena de cada día de la rutina, cada una con hora preferida y duración (0 = sin esa comida). Rutinas guardadas antes del desayuno (solo almuerzo y cena) toman un desayuno de 30 min al levantarse. Un evento cuyo título dice que es una comida («Almuerzo con la abuela») es esa comida ese día.
- **Registro (append-only)**: por bloque, ✓ / ✗ / parcial + unidades completadas + timestamp. Nunca se edita, solo se agregan correcciones.
- **Ajuste del día**: "me levanté a las X" / "me acuesto a las X".
- **Lugares guardados**: casa, facu, gym, familia… con tiempos de viaje fijados a mano.
- **Versiones del plan**: historial para "deshacer".

## 4. Parámetros fijos (configurables)

Sueño (hora de acostarse/levantarse), un rato para arreglarse y trasladarse al levantarse, desayuno, almuerzo y cena (hora y duración), traslados, **franja libre** (ej. después de 19:30, límite _blando_: solo se usa como opción explícita cuando algo crítico no entra; los eventos fijos como clases pasadas las 19:30 se respetan siempre).

## 5. Motor de planificación (sin IA, TypeScript puro)

Paquete independiente, determinista, que corre igual en el cliente y en Edge Functions.

1. **Capacidad**: grilla de bloques de 30 min (registro con granularidad de 15). Se restan sueño, comidas, eventos ocupados, traslados (+10 min de margen) y franja libre.
   - **Comidas fijas**: todos los días hay desayuno, almuerzo y cena (salvo que el usuario diga otra cosa, §18.2). Comer no es opcional: el plan **siempre** les deja lugar, aunque sea ineficiente o no llegue a los objetivos. El plan nunca pone estudio ni entregas encima de una comida. Lo único que puede quedar superpuesto con una comida es lo que el plan no mueve: eventos fijos, sus traslados y bloques 📌 que fijé yo; y, de forma transitoria, un bloque de hoy sin 📌 mientras su corrimiento espera mi OK o mientras está en curso (paso 1). Lo que el plan no mueve tiene prioridad y la comida se superpone con aviso (paso 3), sin que el plan sume estudio nuevo encima. Dos comidas nunca se superponen entre sí: si la anterior ya ocupa la hora preferida, la siguiente se superpone a continuación de ella. Siempre dentro de lo despierto: la «hora preferida» se toma a lo sumo desde que me levanto y hasta la hora de dormir (si el desayuno es a las 8 y me levanté a las 10, cuenta desde las 10). Si lo despierto no alcanza para todas las comidas sin superponerlas (por ejemplo, me levanté muy tarde), manda este orden: que la comida exista, que no pise otra comida, que quede dentro de lo despierto. La que no entra aparece justo después de la anterior, aunque pase la hora de dormir, y la bandeja avisa para que la mueva o use «Hoy no» (§18.2). Se ubican en orden (desayuno, almuerzo, cena):
     1. a su **hora preferida**; si ahí hay bloques que no son fijos, el plan los corre para dejarle lugar. Vale la estabilidad del §5.7: de mañana en adelante se corren solos; si el cambio toca hoy, llega como propuesta en la bandeja y, mientras no la acepte, la comida se muestra superpuesta como en el paso 3. El bloque en curso no se corre nunca: la comida empieza cuando termina, si cae dentro del rango; si no, va al paso 3;
     2. si a esa hora hay algo fijo (evento gris u «Ocupado», su traslado, un bloque 📌, también uno que acabo de soltar ahí, u otra comida ya ubicada): primero justo al salir de lo que la pisa, si termina cerca; si no, al hueco más cercano, antes o después, dentro de 1 h 30 de su hora (el desayuno, contado desde que me levanto si me levanté más tarde), corriendo también ahí lo que no sea fijo. Nunca antes de levantarme ni pasada la hora de dormir (tampoco en los pasos 1 y 3);
     3. si en ese rango no queda ningún hueco libre tan largo como la comida (todo ocupado por cosas fijas, o solo huecos más cortos), la comida **aparece igual a su hora preferida, superpuesta** con lo que haya, y la bandeja avisa («Sin lugar para almorzar · mar 10/11») para que yo decida: la dejo ahí o la arrastro a cualquier momento del día (a mano sí puedo ponerla a cualquier hora, incluso fuera de lo despierto), incluso encima de un evento fijo. Donde la suelto queda 📌 y el plan acomoda el resto alrededor.
        (Cambia la decisión anterior de solo avisar en la bandeja con un botón para ver el día.)
2. **Factibilidad (EDF)**: por deadline creciente, `demanda mínima acumulada ≤ capacidad acumulada`.
3. **Holgura** = tiempo libre hasta el deadline − mínimo restante.
   - 🟢 margen · 🟡 holgura < 1 día de capacidad · 🔴 si salteás este bloque no llegás al mínimo.
4. **Asignación**: menor holgura primero, luego mejora local con penalizaciones:
   - bloque mínimo por materia (ej. 60 min seguidos) y máximo de materias distintas por día (ej. 2), como reglas blandas;
   - duración máxima por materia con descansos implícitos (no se muestran en el calendario);
   - franja preferida por materia;
   - repaso espaciado antes de parciales, con opción de dedicar el día previo solo a esa materia.
5. **Recomendaciones**: compara el plan que respeta las reglas blandas con uno que las rompe; si romperlas ahorra algo (ej. no invadir la franja libre), lo sugiere con su costo ("salvo que quieras estudiar a las 20, hoy conviene 30 min de Mate y 30 de Física").
6. **Infactibilidad → opciones** (cada una con vista previa de la semana):
   abandonar X · bajar X a su mínimo · recorte proporcional · usar franja libre / extender hoy · mover un evento flexible · versión mínima viable de una entrega · priorizar temas por peso en un parcial.
7. **Estabilidad**: mover lo mínimo; el bloque en curso y lo ya visto de hoy quedan congelados. Cambios que afectan hoy → **propuesta** en la bandeja + push; no se aplican sin OK. De mañana en adelante se reorganiza solo.
8. **Aprendizaje estadístico**: ratio real/estimado por materia (ej. Física 1,3×) que ajusta estimaciones futuras.
9. **Ajuste por desvelo**: después de un evento nocturno, la bandeja pregunta a qué hora me levanté en vez de asumir el horario normal.

## 6. Traslados (auto)

- Origen: ubicación del evento anterior si terminó hace < 2 h; si no, casa. En huecos largos evalúa volver a casa.
- Prioridad: lugares guardados (tiempos manuales) → OpenRouteService perfil auto (plan gratis) con caché por par de lugares.
- Geocodificación: Nominatim (OSM), una vez por lugar, cacheada.
- Evento sin ubicación: se intenta por título contra lugares guardados; si no, pregunta en la bandeja.

## 7. Pantallas

- **Bandeja** (se abre al entrar): bloques por confirmar · cambios propuestos para hoy · decisiones de infactibilidad · eventos sin ubicación · entregas detectadas.
- **Calendario**: día/semana, colores por criticidad, tap en bloque → ✓ / ✗ / parcial con unidades. Las comidas se ven como bloques del mismo color ámbar las tres (`--meal`), a la hora en que quedaron; el tap dice si se corrieron y lleva a Ajustes para cambiar hora y duración. Se mueven solas (§5.1) y además, al tocarlas, se pueden **mover a cualquier hora** solo ese día («Mover a…», también encima de un evento fijo, y «A su hora» para volver) o sacar ese día («Hoy no almuerzo»), siempre con Deshacer. La que quedó encima de algo fijo se ve con borde punteado; las superpuestas van lado a lado (§18.3). Arrastrarlas como a los bloques queda para más adelante. No van a «📚 Plan» (sumarían 21 eventos por semana a Google sin decir nada nuevo).
- **Dashboard de silos**: un silo vertical por entrega/hábito, ordenados por urgencia; nombre abajo; horas totales arriba dentro del silo; lo que falta como "stock" adentro, abajo. Color por holgura.
- **Planificado vs. hecho**: vista semanal.
- **Planificación semanal** (domingo, ~5 min): semana, críticos y decisiones.
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
- Revisor IA: CodeRabbit en cada PR (check requerido por la regla de la rama `main`). Además, por práctica del equipo —no lo verifica GitHub—, se mergea recién con sus comentarios resueltos. (La prueba contra Macroscope se descartó.)
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
- **Repaso espaciado** antes de parciales (7, 3 y 1 días antes) y opción «día anterior solo para esta materia»; un bloque de otra materia en ese día pasa a propuesta.
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

- ✅ **Éxito**: un solo aviso para toda la app (toast, `components/Toast.tsx`), con el mismo tono y duración (2,5 s; 6 s si ofrece «Deshacer»), anunciado a VoiceOver y que no se va mientras tiene el puntero o el foco encima. Los errores siguen junto a su campo.
- ✅ **Errores específicos**: dicen qué pasó y **qué hacer ahora**, con el botón para hacerlo, como ya hace Calendarios con el botón «Reconectar Google». Nada de «Probá más tarde» sin más.
- ✅ **Esperas**: toda carga de más de ~1 s dice qué está haciendo («Leyendo el programa…», «Calculando traslados 3 de 8…»); si se conoce, muestra el progreso. Componente único `components/Loading.tsx` (`kind`: sync, ai, travel, generic; con hueco `mascot`), `Skeleton.tsx` y `Notice.tsx`; textos del camino infeliz en `friendly.ts` (tono seco y breve, humor solo en lo leve; decidido 2026-11-07).
- ✅ **Skeletons**: mientras carga una pantalla se muestra su forma en gris, en vez de un spinner o un hueco vacío.

### Formularios y botones

- Texto de ayuda debajo de los campos que no son obvios (formato, para qué sirve, ejemplo).
- Botones con un verbo concreto («Guardar reglas», «Conectar iCloud»), nunca «OK», «Listo» o «Aceptar» sueltos.
- Cada sección termina con una acción clara: el siguiente paso o el botón para crear lo primero.
- No pedir dos veces el mismo dato: lo que ya se sabe (lugares, materias, horarios) se propone precargado.
- **Estados vacíos útiles**: explican qué iría ahí y tienen el botón para crear lo primero.

### Privacidad y cuenta

- ✅ Link a la política de privacidad (`privacy.html`) en Ajustes y en la pantalla de login.
- Los permisos (notificaciones, ubicación, fotos, archivos) se piden solo al usar la función que los necesita y explicando para qué, nunca al abrir la app. (Hoy ya se cumple).
- ✅ **Revocar todo y borrar la cuenta** en Ajustes, en un solo lugar y con un paso de confirmación escribiendo «BORRAR»: revoca los tokens de Google, borra la contraseña de iCloud y la clave de Gemini del Vault, borra el calendario «📚 Plan» si el usuario quiere (viene marcado) y elimina la cuenta con todos sus datos y su invitación. Ofrece antes exportar el JSON. La cuenta dueña no se puede borrar (se quedaría la app sin quien maneje las invitaciones): solo revoca.

### Consistencia visual

- **Íconos**: todos de línea de 2px, con extremos redondeados y del mismo tamaño, desde `icons.tsx`; los emojis no se usan como íconos de interfaz (sí en los datos, como «📚 Plan» o `📝`). (Hoy el ícono de critiCal es relleno y quedan emojis en algunos componentes).
- **Escala de diseño**: espaciados múltiplos de 4/8, pocas medidas de texto y radios fijos, todo desde los tokens de `styles.css`, sin valores sueltos.
- **Toques y bordes de iPhone**: zonas táctiles de al menos 44pt y safe areas respetadas. La barra de pestañas queda pegada al borde de abajo, como está.
- **Números que se animan**: las horas de los silos y los totales cuentan hasta el valor nuevo al cambiar, con números tabulares para que no salten.
- **Filtros**: si alguna vez hay filtros, siempre con un botón «Limpiar filtros».

### Interacción y animaciones

- **Transiciones con resorte** (200–300 ms) en hojas, pestañas, bloques que cambian de lugar y avisos. Con «reducir movimiento» pasan a un fundido corto o a nada.
- **Respuesta optimista**: marcar ✓/✗, mover o editar se ve al instante; si el servidor falla, se revierte con un aviso que dice qué no se guardó.
- **Deshacer en vez de confirmar**: las acciones destructivas (borrar, abandonar una entrega, rechazar una propuesta) se hacen al toque y muestran un aviso con «Deshacer». El aviso se anuncia a VoiceOver, se alcanza con el teclado, no se va mientras tiene el foco o el puntero encima, y lo deshecho también se puede recuperar después desde el historial de «Deshacer» (§13). Solo borrar la cuenta pide confirmación.
- **Gestos**: deslizar un bloque para marcarlo hecho o salteado, y deslizar horizontalmente para cambiar de día o semana. Siempre con un botón equivalente.
- **Vibración háptica** al marcar un bloque y al soltar un arrastre, donde el navegador la soporte (Safari en iPhone casi no la soporta: es un extra, no puede ser la única señal).

### Accesibilidad

- Contraste AA en texto y en los colores de criticidad (además del color, un ícono o una palabra).
- Etiquetas para VoiceOver en todo lo que se toca, incluidos los bloques del calendario y los silos.
- El texto respeta el tamaño de letra del sistema sin romper la grilla.
- Foco visible y uso completo con teclado en la Mac.

### Primer uso guiado

- La primera vez, un recorrido corto con progreso visible: conectar Google → crear la primera materia o entrega → ver el primer plan. Se puede saltar y retomar desde Ajustes.

## 15. Traslados en ómnibus (Montevideo y Canelones) — pendiente

- Elegir por traslado (o por par de lugares) entre **auto** y **ómnibus**.
- Tiempos del sistema real: STM de Montevideo y líneas metropolitanas de Canelones — horarios y pasadas reales por parada, **esperas** y **transbordos**.
- Sugerir qué ómnibus tomar para minimizar el tiempo puerta a puerta.
- **Rutas habituales** (ej. casa → trabajo cada día de la semana) guardadas en los datos del usuario con los ómnibus y tiempos elegidos, para no recalcular a diario y tenerlas aunque el teléfono se haya apagado.
- Decisiones (noviembre 2026, tomadas por Claude a pedido del usuario; se pueden revisar):
  - **Fuentes**: GTFS del STM publicado en el catálogo de datos abiertos de la IM (incluye las líneas metropolitanas que entran a Canelones) y, si está disponible, el tiempo real de pasadas por parada de la API de la IM. Si alguna línea de Canelones no figura, se usa su horario publicado y se marca como «horario teórico».
  - **Caché**: el GTFS se descarga y procesa del lado del servidor una vez por semana (cron); las rutas habituales quedan guardadas en los datos del usuario y se recalculan si cambia el GTFS, si cambia la hora del evento o del traslado, si el horario guardado no corre ese día (feriado, fin de semana, horario de verano) o si el usuario lo pide. Antes de salir, si hay pasadas en tiempo real, se usan para avisar si el ómnibus elegido ya no llega y proponer otro.
  - **Interfaz**: un selector auto/ómnibus en cada lugar guardado (modo por defecto para llegar ahí) y en cada traslado (para cambiarlo esa vez); el bloque de traslado en ómnibus muestra la línea, la parada y la hora de pasada.
  - Para calcular el puerta a puerta, el tramo a pie hasta la parada y desde ella se estima con la distancia a pie (OpenRouteService, perfil a pie).

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
  - «Materias» y «Rutinas» son filas distintas (antes «Materias y rutinas» y «Rutinas» se pisaban).
  - La **búsqueda del mockup B** queda lista en una rama aparte, encima de A, para sumarla arriba de todo cuando las secciones crezcan mucho. No se mergea hasta que el usuario lo pida.

## 17. Hasta producción: orden de trabajo y ciclo de validación

Lo que falta y en qué orden, para retomar sin más contexto: [`TODO.md`](TODO.md).

Orden:

1. Terminar, mergear y desplegar lo que está en curso.
2. Hacer los mockups del §16.
3. Implementar todo lo que el proyecto tiene pendiente: las guías del §14 que no tienen ✅, los traslados en ómnibus del §15 y cualquier TODO que haya en el código. Un PR por tema.
4. Correr el ciclo de validación hasta que quede limpio.

**Cuenta de prueba local**: un usuario con email y contraseña inventados, creado por el seed de Supabase local (`supabase/seed.sql`, activado en `[db.seed]` de `config.toml`). La pantalla de login muestra un formulario de email y contraseña **solo** cuando la app corre en desarrollo (`import.meta.env.DEV`) contra el Supabase local (URL `127.0.0.1`/`localhost`); en staging y producción ese formulario no existe y el proveedor de email está apagado. Las credenciales quedan en el seed y en `.env.example`, nunca en el chat. Google e iCloud reales no se prueban con esta cuenta. Para que funcionen los traslados, la sync y el resto de `/api` en local, las funciones se sirven con `vercel dev` (o un proxy equivalente en Vite) con un `.env.local` que apunta al Supabase local; las claves de terceros (OpenRouteService, Gemini) son las de desarrollo y, si faltan, esas funciones se prueban con sus respuestas simuladas. La sincronización con Google e iCloud no se puede probar de punta a punta sin cuentas reales: se valida con los tests automáticos que simulan Google y CalDAV (`apps/web/api/*.test.ts`), y en el simulador se prueba con la **cuenta de prueba local** (no en modo demo, que no sincroniza): las funciones `/api` locales usan proveedores simulados de Google y CalDAV, activables solo en desarrollo, que devuelven eventos inventados. Desde la interfaz se comprueba la sync exitosa (aparecen los eventos, «✓ N eventos · hora» en Calendarios, se replanifica) y los estados de error y «Reconectar». Como «Reconectar Google» pasa por el OAuth de Supabase y no por `/api`, en desarrollo con el proveedor simulado ese botón usa un OAuth simulado que deja el permiso otra vez válido sin salir de la app; que el OAuth real pida los scopes correctos se cubre con un test unitario de la llamada. El modo demo queda exceptuado de las pruebas de sincronización. ✅ Hecho: `supabase db reset` crea la cuenta (dueña de la app, con un permiso de Google vencido para probar «Reconectar»); `npm run dev` sirve `/api` desde el mismo servidor de Vite (no hace falta `vercel dev`), y con `VITE_FAKE_PROVIDERS=1` contra el Supabase local Google, iCloud, los mapas y Gemini responden con datos inventados (`apps/web/api/_lib/fake-providers.ts`). Cómo prepararlo: `.env.example`.

**Ciclo de validación**: se valida **antes** de mergear, porque cada merge a `main` termina desplegado en producción. Se repite entero después de cada arreglo:

1. **Local**: Claude abre la app del PR en el simulador de iPhone (dev server y Supabase local en Docker) y prueba **todas** las funciones, con los caminos felices y los de error, en modo demo y con la cuenta de prueba local. Anota lo que falle.
2. **Agente atacante**: un agente sin contexto técnico de la app usa la interfaz de iPhone con un solo objetivo: encontrar todas las vulnerabilidades que pueda y romper todas las funciones posibles, y reportarlas. Ataca primero el entorno **local** y después repite en la **preview del PR** (con el Supabase de staging) solo las pruebas que no rompen datos. Nunca ataca producción. La preview la despliega `preview.yml` en cada push a un PR y comenta la URL; no corre las migraciones del PR, así que un PR con migraciones nuevas se prueba con ellas solo en local.
3. Todo lo reportado se arregla en el mismo PR y se vuelve al paso 1.
4. Con una vuelta limpia, el CI en verde y CodeRabbit sin pendientes, se mergea. Staging se despliega solo y, si su E2E pasa, producción también (no hay aprobación manual: por eso se valida antes de mergear).
5. **Producción**: Sentry sin errores nuevos ni problemas de seguridad abiertos después del deploy, más una prueba rápida de la app desplegada en el simulador (modo demo). Si algo falla, se abre un PR con el arreglo y vuelve al paso 1.

El ciclo termina cuando una vuelta completa no encuentra nada. Si la misma falla vuelve 3 veces, o pasan 5 vueltas seguidas con fallas nuevas, se frena y se avisa al usuario con el detalle.

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
   - Por defecto de Claude: el aviso de que no entra sale **al guardar**, con la vista previa del §5.6, y no recién cuando llega la fecha.
8. **Bun y Rust**: pasar el sistema a Bun y Rust para mejorar los tiempos de compilado y de ejecución. Decidido:
   - **Bun** como gestor de paquetes y para correr los scripts y el CI; Vite, Vitest y Vercel siguen como están.
   - Se **mide** el motor y, solo si una reescritura en Rust compilado a WASM da una mejora real, se hace.

**Orden** (decidido): primero los cortos (6 barra de arriba, 5 silos, 3 superpuestos, 4 eliminar lugar); después 2 comidas y 7 empezar más tarde; después 1 (camino infeliz y mascota) junto con el resto del §14; al final los ómnibus (§15) y 8 Bun y Rust.
