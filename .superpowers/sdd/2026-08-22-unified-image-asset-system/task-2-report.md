# Task 2 Report: Additive Schema and Transactional MySQL Repository

## Status

Implemented Task 2 on `codex/unified-image-assets`.

Commit: `e359e5a feat: add image asset repository`

## Implementation

- Added additive InnoDB schema initialization for `image_assets`, `image_asset_variants`, `image_upload_sessions`, `image_processing_jobs`, `company_image_assets`, and `product_image_assets`.
- Added every required unique key, foreign key, worker-facing status/expiry indexes, asset lifecycle timestamps, variant object metadata, upload-session final asset ID, and processing-job retry/lock/error fields.
- Added `AssetRepository`, `AssetTransaction`, upload/finalization inputs, variants, and processing-job contracts. Repository creator and principal IDs are strings.
- Added `MySqlAssetRepository` with transaction helpers, SHA/session row locks, idempotent finalization/job creation, queue claiming, processing completion/failure, expiry/purge helpers, reference reconciliation, and locked company/product link mutations.
- Corrected `UploadSessionRecord.createdBy` from `number` to `string`; its behavioral/type-compatible test ensures the repository input and returned session creator cannot diverge.
- Wired `initializeImageAssetSchema(conn)` into the existing MySQL startup directly after legacy product tables. The JSON fallback branch is unchanged and receives no new asset writes.

## Files

- Modified: `server.ts`, `server/image-assets/types.ts`
- Added: `server/image-assets/schema.ts`, `server/image-assets/repository.ts`, `server/image-assets/mysqlRepository.ts`, `server/image-assets/mysqlRepository.test.ts`

## TDD evidence

### RED 1

Command:

```powershell
npm.cmd run test:image-assets
```

Result: exit 1. Esbuild reported the expected missing modules: `Could not resolve "./schema"` and `Could not resolve "./mysqlRepository"` from `mysqlRepository.test.ts`.

### GREEN 1

Command:

```powershell
npm.cmd run test:image-assets
```

Result: exit 0; 8 tests passed. The recording connection verified all six emitted DDL table statements and keys, string creator compatibility, `FOR UPDATE` SHA lookup during finalization, and a single transaction for company link/count replacement.

### RED 2

Command:

```powershell
npm.cmd run test:image-assets
```

Result: exit 1; the new bulk product-link test failed with `Missing expected rejection`, proving a later non-ready target was not rejected.

### GREEN 2 and required checks

Commands:

```powershell
npm.cmd run test:image-assets
npm.cmd run lint
git diff --check
```

Results: `test:image-assets` exit 0 with 9 passing tests; `lint` exit 0 (`tsc --noEmit`); `git diff --check` exit 0.

## Self-review

- All required repository methods are present in `AssetRepository` and implemented in `MySqlAssetRepository`.
- Link mutations obtain asset locks; every newly attached/replaced target must be `ready`; reference/link changes occur inside one MySQL transaction; a final reference removal sets `recycled`, `recycled_at`, and `purge_after = NOW() + 30 days` together.
- Purge marking remains guarded by zero references and no remaining variant records.
- Only Task 2 code and this requested Task 2 report are staged for commit; no JSON fallback behavior, legacy image tables, or unrelated files changed.

## Concern

No live MySQL server is configured in this worktree, so DDL and transaction behavior are verified with the requested recording connection rather than a database integration run. The schema depends on the pre-existing `company_config`, `products`, and `product_images` tables, which are created before its MySQL startup call.

## Fix Round 1

### Implementation

- `finalizeUploadSession()` now checks an open session expiry against transaction time, persists `expired` in the same transaction, commits that state transition, and rejects before any SHA lookup or asset write.
- Verified SHA re-upload now restores a recycled asset under the current string principal, resets `created_at` as the new 24-hour attachment-window timestamp, clears recycle/purge timestamps, and returns to `ready` only when every policy-required variant remains registered. Otherwise it returns to `processing` and queues work.
- Added `recycleExpiredUnlinkedAssets(now, limit)` to `AssetRepository` and `MySqlAssetRepository`. Its single guarded update only recycles `ready`, zero-reference assets after the 24-hour attachment window and assigns a 30-day purge deadline.
- `markPurged()` now requires locked `recycled`, zero-reference, due-for-purge state, repeats those predicates in the update, requires no remaining variants, checks `affectedRows`, and accepts an already-purged retry as idempotent.
- `completeProcessing()` rejects an empty variant list or one without `original` before opening a transaction, so no partial variant rows can be written.
- `createUploadSession()` now uses insert-or-read retry semantics. It returns a compatible stored session and rejects a mismatched immutable field or creator without overwriting the row.

### Covering recording-connection tests

- Expired open finalize records `status = 'expired'`, commits, rejects `UPLOAD_SESSION_EXPIRED`, and never performs the SHA lookup.
- Recycled re-upload tests cover a full usable variant set restoring `ready`, a missing required variant returning to `processing` and queuing work, creator reset, attachment-window reset, and lifecycle timestamp clearing.
- The unlinked-recycle test asserts the atomic `status = 'ready'`, `ref_count = 0`, and 24-hour `created_at` predicates.
- Purge tests cover eligible SQL predicates, zero affected rows rejection, and idempotent already-purged retry behavior.
- Processing tests assert empty/original-less input has zero database statements.
- Create-session tests cover compatible retry return and conflicting retry rejection without an overwrite.

### TDD evidence

Each RED/GREEN cycle used:

```powershell
npm.cmd run test:image-assets
```

RED results:

- expiry test: exit 1, `Missing expected rejection`;
- recycled recovery tests: exit 1, missing variant lookup and `jobCreated: false` instead of `true`;
- expired-unlinked operation: exit 1, `recycleExpiredUnlinkedAssets is not a function`;
- purge tests: exit 1, missing locked eligibility query and non-idempotent already-purged update;
- processing validation: exit 1, `ASSET_NOT_FOUND` instead of the required precondition rejection;
- create retry tests: exit 1, missing `ON DUPLICATE KEY UPDATE` and `Missing expected rejection`;
- required-variant recovery refinement: exit 1, `jobCreated: false` instead of `true`.

GREEN command/output:

```powershell
npm.cmd run test:image-assets
npm.cmd run lint
git diff --check
```

All exited 0. The focused suite reported 18 passing tests, lint reported `tsc --noEmit`, and `git diff --check` reported no whitespace errors.

### Scope and review note

Changed only `server/image-assets/repository.ts`, `server/image-assets/mysqlRepository.ts`, `server/image-assets/mysqlRepository.test.ts`, and this Task 2 report. The review's `failJob` expected-state predicate remains intentionally unchanged, as directed. Live MySQL verification remains deferred to Task 12.

## Fix Round 2

### Implementation

- Replaced `ON DUPLICATE KEY UPDATE id = id` session creation with read-by-ID, plain insert, and duplicate-key recovery.
- A pre-existing same ID is read and compatibility-checked before any insert, so a different `createdBy` principal is rejected without touching the stored row.
- On a duplicate insert race, the repository re-reads the input ID; if absent, it reads `quarantine_key`. A row belonging to another ID now deterministically raises `IMAGE_CONTENT_INVALID` instead of returning a fictional open session.
- A successful insert returns only the inserted input record; every retry result is read from the database and validated.

### Covering tests and TDD evidence

Added recording-connection tests for:

- same ID with a different creator principal: rejects before any insert;
- duplicate `quarantine_key` owned by another session ID: performs the key lookup and rejects without `ON DUPLICATE KEY UPDATE`;
- compatible same-ID retry and immutable-field conflict remain covered under the new read-first flow.

RED command:

```powershell
npm.cmd run test:image-assets
```

RED result: exit 1 with the expected failures: the principal-conflict path still emitted an insert, and the quarantine-key collision surfaced raw `Error: Duplicate entry` rather than the structured rejection.

GREEN commands:

```powershell
npm.cmd run test:image-assets
npm.cmd run lint
git diff --check
```

GREEN results: all commands exited 0; `test:image-assets` reported 20 passing tests and lint reported `tsc --noEmit`.
