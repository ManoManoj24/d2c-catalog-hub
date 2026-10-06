# Tenant isolation

Use this when adding a table, query, or route.

1. Put `tenant_id` on the table and enable row-level security with `FORCE`.
2. Composite foreign keys include `tenant_id` so a row cannot point at another brand's parent.
3. Application code uses `withTenant`, which sets `app.tenant_id` and `app.user_id` for the transaction. Do not trust a tenant id from the client unless membership is checked.
4. The web role is `pim_app` (no superuser, no bypass). Migrations use the superuser URL.
5. Add or extend `tests/integration/tenant-and-import.test.ts` when a new table holds brand data.
