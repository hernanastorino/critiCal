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

| Fuente | Acceso | Sincronización |
|---|---|---|
| Google Calendar | API oficial, lectura y escritura | Push notifications (webhooks) → reorganización inmediata |
| iCloud | CalDAV con contraseña de app (cifrada en Vault) | Consulta cada 5–10 min con sync tokens + al abrir la app + botón "sincronizar ahora" |
| "📚 Plan" (Google) | Solo lo escribe la app | Salida del planificador |

- Recomendación: Google como calendario por defecto en el iPhone, para que los eventos nuevos impacten al instante.
- **"Mostrar como: Disponible"** → el evento es compatible con bloques planificados (paralelo). "Ocupado" → bloquea.
- **Detección de entregas**: eventos con emoji/tag (`📝`, `#entrega`, `#parcial`) se proponen como Entrega en la bandeja para estimar.
- OAuth de Google en modo **Production** (no verificado) para que los refresh tokens no venzan a los 7 días.

## 3. Modelo de datos (fuente de verdad)

El plan es **dato derivado**: se puede recalcular entero en cualquier momento desde lo siguiente.

- **Entrega**: materia, fecha límite, unidades (cada una con estimación) u horas totales, mínimo total, prioridad, flexibilidad. Un parcial es un objetivo propio, distinto del mínimo semanal de la materia.
- **Materia / Actividad**: color, mínimo semanal opcional, duración máxima de sesión, descanso tras sesión (por defecto 50/10), franja preferida (ej. Mate a la mañana).
- **Hábito**: gym, etc. Frecuencia semanal, duración, franja preferida, mínimo.
- **Evento fijo**: viene del calendario (clases, cumpleaños, juntadas, familia).
- **Evento tentativo**: reserva el lugar; el motor mantiene un plan B.
- **Registro (append-only)**: por bloque, ✓ / ✗ / parcial + unidades completadas + timestamp. Nunca se edita, solo se agregan correcciones.
- **Ajuste del día**: "me levanté a las X" / "me acuesto a las X".
- **Lugares guardados**: casa, facu, gym, familia… con tiempos de viaje fijados a mano.
- **Versiones del plan**: historial para "deshacer".

## 4. Parámetros fijos (configurables)

Sueño (hora de acostarse/levantarse), almuerzo y cena, traslados, **franja libre** (ej. después de 19:30, límite *blando*: solo se usa como opción explícita cuando algo crítico no entra; los eventos fijos como clases pasadas las 19:30 se respetan siempre).

## 5. Motor de planificación (sin IA, TypeScript puro)

Paquete independiente, determinista, que corre igual en el cliente y en Edge Functions.

1. **Capacidad**: grilla de bloques de 30 min (registro con granularidad de 15). Se restan sueño, comidas, eventos ocupados, traslados (+10 min de margen) y franja libre.
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
- **Calendario**: día/semana, colores por criticidad, tap en bloque → ✓ / ✗ / parcial con unidades.
- **Dashboard de silos**: un silo vertical por entrega/hábito, ordenados por urgencia; nombre abajo; horas totales arriba dentro del silo; lo que falta como "stock" adentro, abajo. Color por holgura.
- **Planificado vs. hecho**: vista semanal.
- **Planificación semanal** (domingo, ~5 min): semana, críticos y decisiones.
- **Inicio de cuatrimestre**: materias, fechas, feriados.
- **Ajustes**: parámetros fijos, reglas, lugares, conexiones, exportar/importar JSON.
- Diseño visual: lo provee el usuario.

## 8. IA (opcional, v2)

Solo al cargar datos: proponer unidades y estimaciones a partir de un PDF de programa. Nunca interviene en la reorganización.

## 9. Infraestructura (todo gratis)

| Pieza | Elección |
|---|---|
| Repo | GitHub público `critiCal` |
| Hosting | Vercel Hobby (`*.vercel.app`), preview por PR |
| Backend | Supabase (cuenta personal nueva): proyecto **prod** + proyecto **staging**; dev con Supabase local en Docker |
| Cron | pg_cron: sync iCloud, recálculo nocturno, push de críticos, keep-alive |
| Errores | Sentry free |
| Backups | GitHub Action nocturna: `pg_dump` cifrado como artefacto/repo privado + exportar JSON desde la app |

## 10. CI/CD y calidad

- PR: Biome (lint/format), `tsc`, Vitest con cobertura (motor ≥ 90 %, global ≥ 80 %), property-based tests con fast-check sobre invariantes del motor (nunca sobre eventos fijos, nunca bajo mínimos, nunca en franja libre sin permiso).
- Playwright E2E contra la preview, con emulación iPhone (WebKit) y desktop.
- Merge a `main` → deploy a staging + migraciones → E2E → deploy a prod con **aprobación manual** (GitHub Environment).
- Migraciones versionadas (Supabase CLI), Dependabot, CodeQL, rollback a un clic en Vercel.
- Revisor IA: prueba controlada CodeRabbit vs. Macroscope (PR con bugs plantados); queda el ganador, empate → CodeRabbit.

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
