# ADR-0013 — MVP implementation notes

Status: accepted
Date: 6 October 2026

## Identity and storage

Email and password sessions are implemented behind `src/server/identity.ts` and `src/server/session.ts`. The domain does not call a vendor SDK. Object storage defaults to the filesystem adapter in `src/server/object-store.ts`. Set `OBJECT_STORE=s3` to use the S3-compatible adapter. Logical object keys, not provider URLs, are the source of truth.

## Template injection

The generic kidswear channel copies a pristine `.xlsx` and writes validated rows from row 4. ExcelJS preserves the instruction sheet, metadata rows, and headers for this `.xlsx` asset. Macro-enabled `.xlsm` workbooks and VBA projects are not retained. That part of ADR-11 stays deferred until a pilot template requires it.

## Import atomicity and batch size

Atomic mode refuses to start a commit while any row has an error. It does not wrap a 5,000-row file in one database transaction. Commits run in batches of 250–500 rows (ADR-08) and upsert on style code and SKU, so a retry does not duplicate sellable records. File parsing and image HTTP checks run outside those transactions.

## Tax schedule

The architecture draft listed GST at 5% up to and including ₹1,000 and 12% above, with HSN 6111, 6209, 6104, and 6204. A build-time review on 6 October 2026 of secondary summaries of CBIC GST 2.0 (effective 22 September 2025) describes a different candidate: baby headings at 5% with no value cap, and other apparel at 5% up to ₹2,500 per piece and 18% above. Both versions live in `packs/kidswear/v1.json`. Only `in-gst-apparel-candidate-2025-09-22` is installed, and its `reviewStatus` is `candidate`. The resolver in `src/domain/quality/tax.ts` reads the schedule it is given. These figures are not filing advice.

Boys' headings 6103 and 6203 were added as sibling candidates because a kidswear catalog includes boys. Confirm classification before production use.

## Queue process

`JOB_MODE=inline` kicks the same handlers inside the web process after a job is enqueued. `JOB_MODE=external` leaves claiming to `npm run worker`. Handlers, batch size, and `FOR UPDATE SKIP LOCKED` claiming are shared.

## Still out of scope

Shopify push, marketplace API push, advanced DAM, supplier portal, multi-language content, and AI copy generation.
