---
name: fabric-dms-expert-review
description: Use when the user explicitly requests expert review or when a substantial Fabric DMS change affects product master data, documents, inventory, customers, sales analytics, media assets, QR workflows, data migration, or cross-module contracts. Skip the full flow for explicitly scoped trivial UI/copy changes unless the user asks for it.
---

# Fabric DMS Expert Review

## Purpose

Treat Fabric DMS core entities as long-lived business assets, not isolated screens. Use this full review before implementation when the change can alter master data, historical records, cross-module references, reporting, media assets, or operational workflows.

The user may explicitly invoke this skill with phrases such as “调用专家流程 / 专家审核 / 架构审计”. The user may also explicitly choose a lightweight path for a trivial change.

## Full Review Gate

**REQUIRED SUB-SKILL:** Use superpowers:brainstorming before implementation.

Before writing production code, inspect the current frontend, backend, schema, tests, and relevant production-data shape read-only. Produce:

1. Current-state map: source of truth, API, UI, persistence, downstream consumers.
2. Data-integrity review: identity, uniqueness, units/types, references, deletion/disable semantics, audit state.
3. Historical-compatibility review: existing records, migration, aliases, unmatched data, rollback.
4. Frontend review: information hierarchy, labels/units/help text, view/edit/delete discoverability, bulk-review efficiency, accessibility/error feedback.
5. Backend review: API contracts, transactions, idempotency, concurrency/versioning, validation, stable error codes.
6. Cross-module review: orders, inventory, customers, sales analytics, media assets, QR/selection workflows.
7. Options: 2–3 viable approaches with complexity, risk, migration cost, and recommended default.
8. Explicit decisions needed from the user.

Do not modify production code until the design is confirmed.

## Implementation Gate

After confirmation:

**REQUIRED SUB-SKILL:** Use superpowers:writing-plans.  
**REQUIRED SUB-SKILL:** Use superpowers:test-driven-development.  
**REQUIRED SUB-SKILL:** Use superpowers:requesting-code-review before merge.  
**REQUIRED SUB-SKILL:** Use superpowers:verification-before-completion before claiming success.

Preserve backward compatibility unless the approved plan explicitly migrates or removes it. For core assets, prefer stable IDs plus human-readable business codes; do not encode mutable business attributes into identifiers.

## Lightweight Path

The full flow is not required when the user explicitly requests a very small, isolated change such as wording, spacing, icon choice, or an obvious one-file cosmetic correction that does not alter schema, API, business rules, data meaning, permissions, reporting, or cross-module behavior.

If a “small” request actually touches a core data contract, explain the hidden impact and ask whether to invoke the expert flow rather than silently broadening the change.
