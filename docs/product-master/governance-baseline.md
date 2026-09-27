# Product Master Governance Baseline

Captured: 2026-09-27

This document records the pre-governance state before order-to-product linking is redesigned. It is a baseline for reconciliation and must not be silently rewritten.

## Current counts

| Metric | Count |
| --- | ---: |
| Product master rows | 1,211 |
| Order item rows | 138 |
| Order items with a non-empty product number | 134 |
| Order items currently matching a product by item number | 30 |
| Order items with a product number but no current product match | 104 |
| Order items without a product number | 4 |
| Duplicate product item-number groups | 53 |

## Interpretation

The 104 unmatched rows and 4 rows without product numbers are historical manual-maintenance debt, not evidence that the imported product master is empty or unusable.

Until a formal product-link migration is approved:

- Preserve all existing order records.
- Do not auto-delete or auto-rewrite unmatched order item numbers.
- Treat the 104 unmatched rows and 4 missing-number rows as an explicit human-governance queue.
- Future linking should use a stable product ID while retaining compatibility with existing order data.
- Duplicate item numbers require human resolution before deterministic linking.

## Next governance decisions

The project must define the permanent item-number rule, pattern-number rule, compatibility policy for legacy item numbers, and the order-to-product linking workflow before automated reconciliation.
