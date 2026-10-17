# Remaining V2 export and sales piece input plan

Goal: implement EX-01/02 filtered metadata XLSX export in each existing library and DOC-06 expandable numeric piece inputs in the existing V2 document editor.
Architecture: reuse existing catalog query parsers/pagination/auth; whitelist visible data fields in workbook. One export action downloads all matching rows, never only the current page. Standalone routes/components only. Sales piece drafts keep input slots separate from serialized nonempty numeric values and derive gross meters.
Spec: docs/project/项目需求总览.md EX-01/02, DOC-05-08. User authorized continuing incomplete requirements 2026-10-17.
Execution: inline single implementer; focused tests RED/GREEN, one independent review; final serial unit/lint/build. No ACP dispatch, no production server/App, DB/COS, migrations or deployment.
- [x] Finish Chinese card header verification and current docs.
- [x] RED -> shared whitelist workbook/filtered paging export service, protected routes; existing UI buttons/client and local mock.
- [x] RED -> ten initial sales piece inputs with append, no arbitrary piece-count business cap; preserve server calculation/identity rules.
- [x] Actual browser download + file parsing, sales interaction and original-image regression; review.
- [x] Serial quality gate, preview refresh, current status/retrospective/index and retention decisions.
Review focus: concurrent export data changes fail safely; string cells cannot become formulas; nulls/units/leading zeros; no images/paths/URLs; active role auth; partial decimal input/clearing slots/legacy null piece rows; totals remain server authoritative.


Actual evidence: Chinese card headers39/39 + Edge33/17, EX/DOC focused19/19, combined browser81/30 with real downloaded files, full1038(1037pass1skip0fail), serial lint/build0. Read-only review P1 partial-number sanitization fixed via native-key RED->GREEN. No snapshot guarantee for equal-count concurrent export replacements; real MySQL/App/COS and remaining DOC/STATS/settings gates retained. No archive/delete/deployment.

Preview verification: rebuilt current site, restored only local static52985 serve-built process after prior process ended; HTTP200 and current hashed assets confirmed.
