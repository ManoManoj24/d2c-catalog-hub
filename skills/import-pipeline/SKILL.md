# Import pipeline

Use this when changing upload, mapping, staging, validation, or commit.

1. Read the import state machine in the architecture notes: uploaded → inspecting → mapping_required → validating → review_required → committing → completed.
2. Keep parsing and HTTP image checks outside database transactions.
3. Write catalog rows in batches of 250–500. Match styles on `style_code` and SKUs on `sku`.
4. Repeating a completed job must not create a second variant. Prove it with the integration test.
5. Every error includes row, attribute, rule, and a proposed fix.
