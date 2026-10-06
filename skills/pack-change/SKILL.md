# Pack changes

Use this when an attribute, picklist, tax rate, or channel column needs to change.

1. Read `packs/kidswear/v1.json` and `docs/adr/0013-mvp-deviations.md`.
2. Change the pack file. Do not put statutory values, HSN codes, or GST percents in TypeScript.
3. Bump `version` when installed catalogs must see a diff. A new version is data, not a migration of business logic.
4. Cover the change with a unit test that passes two schedules or two packs through `mergePackDefinitions` or `resolveGstRate`.
5. Tenant label overrides win. A type or scope change is blocked while values exist.
