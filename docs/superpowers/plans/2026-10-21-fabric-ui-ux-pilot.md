# Fabric UI/UX Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install and verify focused UI skills, establish repeatable UI acceptance, and deliver a review-only sample-card UX pilot.
**Architecture:** Project-scoped skill registration; separate React review tab with mock data and accessible dialogs; Playwright builds an isolated Vite review site, serves it locally and uses system Edge. Existing production App remains untouched.
**Tech Stack:** React 19, Tailwind 4, Radix Dialog, Playwright/Edge, TypeScript.
**Spec:** `docs/superpowers/specs/2026-10-21-fabric-ui-ux-pilot-design.md`

## Global Constraints
- Preserve dirty checkout and existing project skills; edit only named pilot, docs and test plumbing.
- Never call production DB/API/COS or publish sample links as customer-facing.
- Existing latest requirement wins; sample is a behavior proposal, not approved live integration.
- No production release, no destructive cleanup, no git add -A.

## Review Focus
- Fast search updates and empty results must not leave stale rows.
- Dialog close by Escape/overlay returns focus to the original row button.
- Screen reader dialog labeling and keyboard focus must work.
- Link copy must explicitly remain within localhost and never represent a real share token.
- 360px screen retains access to search, table operations and close buttons.

### Task 1: Skills and project validation
- [x] Install `ui-ux-pro-max` in `.agents/skills` and verify WebCodex `skill_load`.
- [x] Validate Python design/UX searches.
- [x] Document skills map, new UX Gate, scope and safeguards.

### Task 2: Browser test runtime
- [x] Install Playwright as dev dependency and Radix Dialog as scoped runtime dependency.
- [x] Create `playwright.ui.config.ts` with local Vite review only and Edge.
- [x] Add `test:ui:ux` npm command (without replacing existing tests).

### Task 3: Accessible card sample
- [x] Add `src/product-master-v2-review/SampleCardUxPilot.tsx` with scoped review-only data.
- [x] Add `cardUx` route option to review main; keep existing review tabs.
- [x] Test search, reset, view colorways, product sharing preview, QR and keyboard/focus.
- [x] Verify 360/1440 screenshots and error-free interaction.

### Task 4: Delivery evidence
- [x] Run targeted unit/browser test, lint or TS/build as appropriate.
- [x] Record evidence and remaining production integration gap under `docs/ui-design/`.
- [x] No merge or deploy until sample approval and separate integration authorization.

**Verification note:** `npm run test:ui:ux` 5/5 PASSED; scoped TypeScript passed. Overall `npm run lint` attempted but failed with Node heap OOM in the existing isolated quality workspace; pending global Gate, not a PASS. See `docs/ui-design/pilot-2026-10-21-result.md`.
