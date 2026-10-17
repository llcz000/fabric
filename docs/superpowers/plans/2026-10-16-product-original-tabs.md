# Product original image tabs implementation plan

Goal: Existing product image dialog uses three tabs, requests original images only for the selected category, and retains loaded images while open. Pattern/product list thumbnails remain thumbnails and clicking fetches the same colorway original.

Spec: product-master-v2-requirements.md IMG-05/07/10, AC-60; 2026-10-16 user approval. Inline execution; no deployment, production DB/COS mutations or App/server changes.

- [x] Write browser RED for three tabs, category-only original requests, reuse, empty/error states and list thumbnail/original identity. Keep prior tests.
- [x] Add focused ProductImageTabs component; existing metadata API stays in catalog; inject existing resolver only for local review. Abort stale loads; allow retry; no global or persistent private image cache.
- [x] Run focused unit/browser checks and inspect desktop/mobile screenshots; independent final review.
- [x] Serial full unit -> lint -> build; refresh existing52985 static preview.
- [x] Update current requirement/status/P4 guide and same-topic retrospective/index, record remaining real-COS/auth/App gates and retain historical docs.

Verification: browser RED -> GREEN; focused39/39, final browser71/30screens, full1029 (1028pass/1skip/0fail), lint/build0, documentation73files582links, diffcheck0. Independent review P2 focus trap reproduced and fixed. Retain process docs; real COS/auth/App gates remain open.
