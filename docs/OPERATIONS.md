# critiCal — Operación

## Instalar en un celular nuevo

1. Abrí https://critical-cal.vercel.app en **Safari**.
2. Compartir → **Agregar a inicio**.
3. Entrá con Google. Todo lo demás está en Supabase, no hay nada que migrar.

En la Mac: Safari → Archivo → **Agregar al Dock**.

## Entornos

|            | Web                                   | Base                             | Deploy                            |
| ---------- | ------------------------------------- | -------------------------------- | --------------------------------- |
| Local      | `npm run dev` (http://localhost:5173) | `supabase start` (puertos 553xx) | —                                 |
| Staging    | preview de Vercel (protegida)         | `critical-staging`               | cada merge a `main`               |
| Producción | https://critical-cal.vercel.app       | `critical-prod`                  | automático si staging + E2E pasan |

Pipeline: PR → CI (Biome, tsc, Vitest con cobertura, E2E iPhone/Safari, gitleaks, pgTAP/RLS, CodeQL, CodeRabbit) → merge → staging (migraciones + edge functions + E2E contra el deploy) → producción.

## Secretos

Nunca en el repo. Dónde vive cada uno:

| Secreto                                    | Dónde                                                 | Para qué                         |
| ------------------------------------------ | ----------------------------------------------------- | -------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                    | GitHub (repo)                                         | migraciones y funciones desde CI |
| `VERCEL_TOKEN`                             | GitHub (repo)                                         | deploys                          |
| `SUPABASE_DB_PASSWORD`                     | GitHub (staging / production) + Llavero               | `supabase link`                  |
| `VERCEL_AUTOMATION_BYPASS_SECRET`          | GitHub (staging)                                      | E2E contra la preview protegida  |
| `BACKUP_PASSPHRASE`                        | GitHub (production) + Llavero                         | cifrar backups                   |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Supabase → Edge Functions → Secrets (ambos proyectos) | refrescar tokens de Google       |

La clave publicable de Supabase (`sb_publishable_…`) es pública por diseño; la seguridad la dan las políticas RLS (testeadas en `supabase/tests`).

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
