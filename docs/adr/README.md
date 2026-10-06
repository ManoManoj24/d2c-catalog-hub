# Architecture decisions

ADR-01 through ADR-12 are accepted for this repository. They follow the 29 September 2026 architecture draft: modular monolith, PostgreSQL JSONB, versioned packs, staged imports, exports before API push, shared database with tenant checks, Postgres queue with pooled connections and 250–500 row batches, style → colorway → size SKU, basic media resolution, template-preserving injection, and one narrow port per external dependency.

Deviations and build-time notes are in [0013-mvp-deviations.md](./0013-mvp-deviations.md). Do not reopen an accepted ADR inside a feature change. Write a new ADR when a binding decision no longer holds.
