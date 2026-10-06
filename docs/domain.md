# Domain model

A tenant is a brand. A user can belong to several tenants through `memberships`. Each request picks a membership; the database then enforces that tenant.

Catalog hierarchy for kidswear:

- Style → `products` (style code, name, variation theme, style-level values)
- Colorway → `product_color_groups` (color, fabric, care, shared media)
- Size SKU → `variants` (SKU, size, MRP, measurements)

`variation_theme` defaults to `SizeColor`. A size SKU inherits colorway media unless a size-specific upload overrides that role.

Flexible attributes live in JSONB `values` and are interpreted through `attribute_definitions` installed from a pack. Picklists and the GST schedule are rows copied from the pack at install time, so a running catalog does not read tax rates from application code.

Completeness counts required pack fields (including fields a relationship rule adds for the chosen variation theme). Channel readiness asks whether the generic marketplace file can accept the sellable row and whether the main image check succeeded. A complete style can still be blocked for a channel.
