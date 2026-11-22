# critiCal

[![CI](https://github.com/hernanastorino/critiCal/actions/workflows/ci.yml/badge.svg)](https://github.com/hernanastorino/critiCal/actions/workflows/ci.yml) [![codecov](https://codecov.io/gh/hernanastorino/critiCal/graph/badge.svg)](https://codecov.io/gh/hernanastorino/critiCal)

Calendario personal que planifica automáticamente el tiempo de estudio y hábitos alrededor de Google Calendar e iCloud, se reorganiza según lo que realmente hice y marca qué es crítico.

Ver [docs/SPEC.md](docs/SPEC.md).

## Desarrollo

Gestor de paquetes y scripts: [Bun](https://bun.sh) (versión fijada en `packageManager`). Node 24 sigue haciendo falta: Vitest y Playwright corren sobre él.

```sh
bun install          # instala (usa bun.lock)
bun run dev          # http://localhost:5173
bun run check        # biome
bun run typecheck
bun run test         # vitest
bun run e2e          # playwright
bun run bench        # mide schedule() con Bun; bun run bench:node lo mide con Node
```
