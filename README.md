# PIM-lite

Governed catalog pipeline for Indian D2C brands. A brand uploads a messy kidswear file, maps columns, fixes validation errors, and exports a channel file in the first session.

Hierarchy: **style → colorway → size SKU**. The kidswear pack supplies attribute groups for variation, Legal Metrology, business identity, taxation, consumer sizing, and media. GST and HSN values are versioned pack data (`packs/kidswear/v1.json`), not constants in the app. The active schedule is a **candidate** reviewed on 6 October 2026 against secondary summaries of GST 2.0. Confirm it with CBIC before anyone files a return. See `docs/adr/0013-mvp-deviations.md`.

## Stack

- Next.js (App Router) and TypeScript
- PostgreSQL 16, shared database, `tenant_id` plus row-level security
- Postgres job queue (`FOR UPDATE SKIP LOCKED`, batches of 250–500)
- Filesystem object storage by default, S3-compatible adapter when `OBJECT_STORE=s3`
- Email and password sessions behind the identity helpers in `src/server`

## Run locally

Node.js 22+.

```bash
docker compose up -d
cp .env.example .env
npm install
npm run template:build
npm run db:setup
npm run dev
```

Open http://127.0.0.1:3000.

`db:setup` applies `db/migrations` and installs Kidswear Pack v1 for the demo brand.

Demo login:

- Email: `demo@tinynest.example`
- Password: `tiny-nest-demo`

The web process claims queue jobs when `JOB_MODE=inline`. For a separate worker:

```bash
JOB_MODE=external npm run dev
npm run worker
```

### Without Docker

Create a superuser `pim` / `pim` and databases `pim` and `pim_test`, then use the same `.env` and commands. Migrations create the non-superuser role `pim_app` / `pim_app` used by the app. Row-level security applies to that role.

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Superuser connection for migrations and seed |
| `APP_DATABASE_URL` | `pim_app` connection used by the app and worker |
| `SESSION_SECRET` | Signs the session cookie and media links |
| `APP_ORIGIN` | Public origin for sample image checks (`http://127.0.0.1:3000`) |
| `OBJECT_STORE` | `fs` (default) or `s3` |
| `OBJECT_STORE_PATH` | Filesystem root when `OBJECT_STORE=fs` |
| `ALLOW_LOCAL_MEDIA_URLS` | Allow `127.0.0.1` image URLs for the local demo |
| `JOB_MODE` | `inline` or `external` |
| `JOB_BATCH_SIZE` | 250–500 rows per transaction |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Used only when `OBJECT_STORE=s3` |

## Happy path

1. Sign in as the demo owner (or register a new brand — registration installs the kidswear pack).
2. Import `samples/kidswear-catalog.csv`.
3. Confirm the suggested mapping. Headers already match pack keys.
4. Review the staged rows. Commit is blocked while any error remains in atomic mode.
5. Open Products. Completeness lists missing required fields. Channel readiness stays blocked until image checks finish.
6. With the app running, image URLs point at `http://127.0.0.1:3000/media/…`. The media job records HTTP status and content type.
7. Channels → Build channel files. Download CSV or XLSX. The workbook keeps the instruction sheet and the first three rows of the data sheet. Parent rows come from the style; child rows are size SKUs.

Two sizes in the same color share one colorway and one pair of images.

## Tests

```bash
npm test
npm run build
npm run demo:pipeline
```

`demo:pipeline` imports `samples/kidswear-catalog.csv` into the seeded Tiny Nest catalog and writes a channel CSV. It is idempotent on style code and SKU.

Integration tests migrate `pim_test`. Create that database before `npm test` if it is not already there.

## What this slice includes

- Tenants, memberships, roles, catalogs, audit events
- Kidswear pack install, label overrides, style / colorway / SKU edit
- CSV and XLSX import, mapping, staged validation, bulk fix, commit preview
- URL image checks and a capped upload fallback
- Product grid with completeness, filters, and status bulk edit
- One generic marketplace export (CSV and template-injected XLSX)

## Known gaps

- No Shopify or marketplace API push
- No `.xlsm` / VBA preservation
- No pack-upgrade screen beyond reinstall with explicit label overrides
- No catalog switcher when a brand has more than one catalog
- No malware scanner on uploads
- Tax schedule is an unverified candidate, not a compliance engine
- Export runs as a queued job, but there is no operator dead-letter UI yet

## Layout

`src/domain` is pure catalog logic. `src/server` is the Postgres and storage edge. `src/app` is the workbench. `packs/` holds installable configuration. `skills/` and `rules/` tell agents how to change this repo. See `AGENTS.md`.
