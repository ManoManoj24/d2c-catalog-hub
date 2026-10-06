# PIM-lite — agent instructions

PIM-lite is a governed catalog pipeline for Indian D2C brands. The first vertical is the kidswear velocity pack. The product turns a messy CSV or XLSX file into style, colorway, and size-SKU records, then a channel file.

This file is the working agreement for coding agents. It borrows the shape of a project harness (instructions, skills, rules, research before edits) and applies it to this catalog domain. It is not a general agent framework.

## Read before editing

1. `README.md` for how to run the app.
2. `docs/domain.md` for the hierarchy.
3. `docs/adr/README.md` and `docs/adr/0013-mvp-deviations.md`.
4. `packs/kidswear/v1.json` before touching fields, tax, or channel columns.
5. The skill that matches the change: `skills/pack-change`, `skills/import-pipeline`, or `skills/tenant-isolation`.
6. `rules/security.md` before auth, uploads, SQL, or exports.

Research the current pack data and tests before inventing a rule. Statutory and tax values are versioned pack data. Do not hard-code HSN codes or GST percents in TypeScript.

## Modules

| Module | Owns | Entry |
| --- | --- | --- |
| Identity & tenant | Users, memberships, roles, session | `src/server/identity.ts`, `src/server/context.ts` |
| Catalog | Styles, colorways, size SKUs | `src/server/catalog.ts` |
| Schema | Attribute definitions, picklists, tax schedules | `src/server/schema.ts` |
| Packs | Install and merge | `src/server/packs.ts`, `src/domain/pack/merge.ts` |
| Import | Upload, map, stage, validate, commit | `src/server/importer.ts` |
| Quality | Rules, completeness, channel readiness | `src/domain/quality/` |
| Publishing | Generic marketplace CSV and XLSX injection | `src/server/publisher.ts` |
| Media | URL checks and capped upload | `src/domain/media/`, `src/app/api/media/` |
| Audit | Append-only change events | `src/server/audit.ts` |
| Jobs | Postgres queue, batches of 250–500 | `src/server/jobs.ts` |

Ports live at the edge: `identity` (password sessions), `object-store` (filesystem or S3), and the job table (claim / finish functions). Domain code under `src/domain` does not import `pg` or Next.js.

## How to change the system

- New business behavior goes into pack metadata or a pure function with a test.
- Do not add a tenant-specific code path.
- Do not add a networked service. Extract a module only when it is already a bottleneck behind its current interface.
- UI routes check `can(role, action)` in `src/domain/authz.ts`. The database still enforces tenant membership.
- Imports stay staged until a person confirms the mapping and the commit.
- Explain failures with row, attribute, rule, and a proposed fix.

## Verification

```bash
npm test
npm run build
```

Unit tests cover pack merge, tax-schedule resolution, validation, and template injection. Integration tests need PostgreSQL (`pim_test`) and cover tenant isolation plus the sample kidswear import.

## Out of scope

Marketplace API push, Shopify push, advanced DAM, supplier portal, multi-language content, and AI copy generation.
