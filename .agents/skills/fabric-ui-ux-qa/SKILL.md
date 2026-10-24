---
name: fabric-ui-ux-qa
description: Use for Fabric UI feature implementation, interaction quality reviews and pre-merge checks; validate desktop/mobile/keyboard and real-browser evidence against existing requirements.
---

# Fabric UI/UX QA Gate
Start by classifying the screen against `docs/ui-design/product-positioning-2026-10-21.md`: all Fabric business workspaces are **internal productivity UI**; only a color-card public share link is **customer presentation UI**. For internal changes prioritize task steps, density, continuity and minimal regression scope. A/B visual prototypes are optional for major redesigns, not mandatory for routine feature work.

Read `docs/ui-design/ux-delivery-gate.md` and `docs/ui-design/ui-review-checklist.md` plus current related business requirements. The UI UX Pro Max, Web Interface Guidelines and Fabric UI Design skills provide guidance; passing a lint/build alone does not prove UX.

For any new or significantly changed UI, first evaluate a real rendered desktop/mobile page for visual hierarchy, typography, color contrast, content/image priority, action clarity and appropriate professional brand quality. For a major layout redesign with an unresolved visual direction, optionally compare A/B layouts and submit evidence for user approval; passing a browser test is NOT visual acceptance. Then add an applicable Playwright case with real browser interactions, check main task, empty/error/cancel/focus behavior and 360px layout. Run `npm run test:ui:ux`, inspect screenshots/traces and record Pass/Fail/Not Verified. Failing or missing evidence is UX NO-GO. Mock preview and live production/API verification remain separate.

Sample command: `node scripts/serve-ui-ux-pilot.mjs`, open `http://127.0.0.1:52991/ui-ux-pilot.html`, or run `npm run test:ui:ux` for ephemeral automated server. This Skill does not authorize production release, clean dirty repositories or invent public share links.
