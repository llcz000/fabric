---
name: fabric-product-master-v2
description: Use when implementing, reviewing, testing or handing off Fabric's pattern master, numeric colorway, fabric or product libraries, shared labels, image assets, fabric Excel imports, or product selection in the three document types.
---

# Fabric Product Master V2 — development routing

Applies only to `D:\fabric` product-master V2. This is a **workflow entrypoint**, not a second set of business requirements. Read the current files; do not infer that a plan or Stitch mockup is implemented.

## Read the relevant source of truth

1. Read **sole business authority** `docs/project/项目需求总览.md` and routing `docs/product-master/README.md`. The `docs/product-master/product-master-v2-requirements.md` is only an AC acceptance list, never a second source of business rules. Before cross-module changes run `npm run knowledge:impact -- REQUIREMENT-ID`.
2. Start with the stage task locator in `docs/product-master/README.md` and read only the relevant P0–P7/B1–B3 acceptance criteria (AC) and source/test files. Consult `docs/project/项目设计.md` and `docs/project/数据与API.md` for architecture and safety constraints; retired implementation plans are not task sources.
3. Read only applicable parts of `docs/development/开发与验证规范.md` and at most 1–2 relevant incidents from `docs/retrospectives/README.md`; follow `AGENTS.md`, preserve unrelated Git changes and verify isolated workspace freshness. Only the project-wide requirement table grants current business scope; the AC list is subordinate and `npm run knowledge:check` is mandatory before handoff. Parallel tasks require proven capacity and disjoint file ownership.

## Choose the execution discipline

Use local discoverable Superpowers skills if present: `writing-plans` or `executing-plans` for planned tasks, `test-driven-development` before feature/bug code, `systematic-debugging` on failures, `requesting-code-review` for independent review when supported, and `verification-before-completion` before reporting success. **Do not claim a named skill or multi-agent capability was invoked unless an actual load/execution succeeded.** Without subagent support, run the plan inline and do explicit separate spec/code review; never claim parallel review occurred.

For each task: record baseline and exact AC → write a failing behavior test → minimal implementation → rerun relevant tests → review against approved spec/permissions → run integration checks → report evidence and remaining gaps. Shared `server.ts`, database initialization and app assembly have one integration owner; parallel agents may edit only disjoint files. Never use tests or migration commands against customer data by default.

## Mandatory Fabric gates (non-exhaustive)

- **Identity**: pattern master → numeric colorway **plus** independently managed fabric → unique product. Positive numeric colorway, unlimited versions; current subject tags are search metadata, not ID; retired color tags must not be restored; 3 libraries/4 logical objects. D-01 is approved: allocate from 1 with a persistent master counter and transactional lock; every saved number is immutable, ordinary allocation never reuses it; deleted numbers may be explicitly reused by approved image import while preserving unique current identity. Real database verification remains required.
- **UI**: follow [UI conventions](../../../docs/ui-design/README.md) and the [UI skill](../fabric-ui-design/SKILL.md). Default to React interactive previews; Stitch is optional under the user's 2026-10-14 instruction. When actually modifying a Stitch page, fetch its live HTML/screenshots/canvas first and preserve the user's independent edits. 产品列数和顺序以最新需求及正式组件为准，不复制旧固定列数；保护产品自身**备注**和关联色卡，保留独立货号/品名 AND 筛选。
- **Images**: original image belongs to colorway; product asset roles are fabric display/detail/effect, each 0–10. Share assets safely; no deletion while referenced. Staged media work != persisted API integration.
- **MySQL**: no unsupported `ADD ... IF NOT EXISTS` DDL; test idempotency against the target MySQL version; API `200` is insufficient—check `/api/health` reports `storage=mysql` and business reads/writes use the intended database.
- **权限 / Permissions**: follow the user's **2026-10-15 role simplification** in `docs/project/项目需求总览.md` §2.1 and the current V2 amendment. Only admin adds accounts or uses new manual document entries; sales view/edit their own documents and admin can view all. Both roles import fabrics and must explicitly reconfirm duplicate handling; both registered, authenticated roles scan cards. Other business capabilities are equal. The former independent `orders.manage_own` / `products.manage` switches and admin-only import-update/export restrictions are superseded requirements, even if old code still enforces them. Keep server identity, ownership, reference and data-safety checks; do not claim the old implementation meets this amendment.
- **三种单据**: protect saved legacy/manual detail identity by checking original persistent rows, not client flags; new or replacement entries must select a library product unless admin explicitly chooses manual. Freeze linked **product** attributes when saved; 公司/联系/收款展示用当前统一设置；本单条款按保存内容，清空不回填，后续全局配置不覆盖；签字栏按当前需求固定展示。 Protect 历史明细, preserve `gsm`/`mm` and nullable values without inventing zeros; any of three saved document references blocks product deletion.
- **Scope/safety**: do not restore retired public or customer flows from a historical phase plan; image-similarity search remains out of present scope. Preserve historical and user data. No unapproved migration/import, deletion, Git commit/push, server restart, **不得自行部署**.

## Report and exit

Each P0–P7 handoff must distinguish: designed / coded / tested / reviewed / deployed, and cite exact AC, modified paths, test command + outcome, database mode, UI status, unresolved approvals and rollback. **测试/验证证据** is required before saying “完成”; UI demo checks do not prove backend/security/real DB completion. For substantive work update the appropriate development retrospective and index.

**Mandatory doc-lifecycle handoff:** for every P0–P7/B1–B3/bug delivery classify related historical process notes as `保留` / `归档候选` / `不适用`, explain remaining acceptance Gates, and record the decision in the relevant existing retrospective. Archival eligibility means either fully accepted at the required business/integration level or explicitly superseded with all unique constraints and open Gates preserved. Before any scoped removal require an external SHA256 verified source backup, current references repaired, and a passing read-only `node scripts/check-fabric-v2-doc-archive.mjs <review-plan.json>`; never infer permission to delete from a passing test or an old file date. Follow `docs/maintenance/知识维护规则.md`.

For skill-entry checks: `node scripts/check-fabric-v2-skill.mjs`. This is static metadata/reference verification only; it does not replace behavioral agent trials or project tests. Security/behavior decisions must be tested against current requirements and the active code; retired scenario exercises are not current authority.
