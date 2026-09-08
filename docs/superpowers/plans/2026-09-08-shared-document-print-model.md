# Shared Document Print Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser preview and printable Excel export render the same normalized document content and type-specific structure.

**Architecture:** A pure shared model owns document semantics and renderer-neutral layout metadata. Thin frontend and backend adapters normalize their existing data shapes, while React and ExcelJS retain their native rendering responsibilities.

**Tech Stack:** TypeScript, React 19, ExcelJS 4, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-08-shared-document-print-model-design.md`

## Global Constraints

- Preserve the 240x140mm custom printer form selected through the AK-820 driver.
- Keep left and right Excel margins at 0.56 inch and print scale at 100%.
- Do not reintroduce PDF generation or `pdf-lib`.
- Keep logo and both payment QR images in Excel output.
- Do not commit or push until the user explicitly requests it.

---

### Task 1: Shared print model

**Files:**
- Create: `src/lib/documentPrintModel.ts`
- Test: `src/lib/documentPrintModel.test.ts`

**Interfaces:**
- Consumes: canonical `DocumentPrintInput` with normalized company, document, item, and total fields.
- Produces: `normalizeDocumentPrintType(value)`, `buildDocumentPrintModel(input)`, and exported model types.

- [x] **Step 1: Write failing model tests**

Cover literal expected titles, column labels, row values, summary text, terms, and signature fields for sample, deposit, sales, and backend `bulk` values. Include a sales fixture with more than ten roll values to verify row chunking.

- [x] **Step 2: Run the model test and verify RED**

Run: `node scripts/run-ts-tests.mjs src/lib/documentPrintModel.test.ts`

Expected: failure because `documentPrintModel.ts` does not exist.

- [x] **Step 3: Implement the pure model**

Define literal schemas for all document types, normalize `bulk` to `sales`, format dates/numbers/currency consistently, build type-specific rows and summaries, and resolve document terms before company defaults.

- [x] **Step 4: Run the model test and verify GREEN**

Run: `node scripts/run-ts-tests.mjs src/lib/documentPrintModel.test.ts`

Expected: all shared-model tests pass.

### Task 2: Frontend adapter and preview renderer

**Files:**
- Create: `src/lib/documentPrintAdapters.ts`
- Test: `src/lib/documentPrintAdapters.test.ts`
- Modify: `src/components/DocumentPreview.tsx`
- Test: `src/components/DocumentPreview.test.ts`

**Interfaces:**
- Consumes: `DocumentData`, `CompanyProfile`, and `buildDocumentPrintModel`.
- Produces: `buildFrontendDocumentPrintModel(document, companyProfile)`.

- [x] **Step 1: Write failing adapter and preview tests**

Assert the frontend adapter maps signature phone, per-document terms, all three types, and sales roll values into the shared model. Assert rendered headings and signature text come from that model.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node scripts/run-ts-tests.mjs src/lib/documentPrintAdapters.test.ts src/components/DocumentPreview.test.ts`

Expected: failure because the adapter is missing and preview still selects fields directly.

- [x] **Step 3: Implement adapter and consume the model**

Move type normalization, title, date, table header labels, relative widths, terms, signature display, roll parsing, and uppercase currency formatting behind the shared model. Keep specialized data-row DOM needed for sales row spans, plus the existing company images, controls, and capture behavior.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node scripts/run-ts-tests.mjs src/lib/documentPrintModel.test.ts src/lib/documentPrintAdapters.test.ts src/components/DocumentPreview.test.ts`

Expected: all frontend-focused tests pass.

### Task 3: Backend adapter and Excel renderer

**Files:**
- Create: `server/documentPrintAdapter.ts`
- Test: `server/documentPrintAdapter.test.ts`
- Modify: `server/documentExcel.ts`
- Test: `server/documentExcel.test.ts`
- Modify: `server.ts`

**Interfaces:**
- Consumes: database order/item/company records and `buildDocumentPrintModel`.
- Produces: `buildBackendDocumentPrintModel(order, items, company)` and a model-driven `buildDocumentWorkbook`.

- [x] **Step 1: Write failing backend parity tests**

Assert equivalent frontend and backend fixtures produce equal semantic models. Assert `bulk` produces the sales title and roll-slot columns, deposit omits remark, and empty receiver phone remains empty.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node scripts/run-ts-tests.mjs server/documentPrintAdapter.test.ts server/documentExcel.test.ts`

Expected: failure because the backend adapter is missing and Excel owns independent schemas.

- [x] **Step 3: Implement backend adapter and model-driven Excel output**

Map snake-case rows into canonical inputs, pass the resulting model into the workbook renderer, and remove independent Excel title/column/business-field selection. Preserve native Excel formatting, images, margins, and scale.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node scripts/run-ts-tests.mjs src/lib/documentPrintModel.test.ts src/lib/documentPrintAdapters.test.ts server/documentPrintAdapter.test.ts server/documentExcel.test.ts src/components/DocumentPreview.test.ts`

Expected: all cross-renderer focused tests pass.

### Task 4: Full verification

**Files:**
- Modify only files needed to correct failures caused by Tasks 1-3.

**Interfaces:**
- Consumes: completed shared model and both renderers.
- Produces: a verified clean implementation ready for user print testing.

- [x] **Step 1: Run the full verification suite**

Run: `npm.cmd run test:all`

Expected: lint, unit tests, Vite and server builds, security smoke tests, and image-asset smoke tests all pass.

- [x] **Step 2: Check patch integrity**

Run: `git diff --check`

Expected: exit code 0 with no whitespace errors.

- [x] **Step 3: Inspect the final working tree**

Run: `git status --short --branch`

Expected: only the approved shared-model, renderer, test, spec, and plan files are modified or added.
