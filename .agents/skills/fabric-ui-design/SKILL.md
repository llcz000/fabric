---
name: fabric-ui-design
description: Design, refine and review Fabric UI pages and components using project visual conventions, interaction rules and evidence-based review; use for Fabric UI work and WebCodex or Codex ACP UI handoffs.
---

# Fabric UI Design
**最高优先级**：按 `docs/ui-design/product-positioning.md` 区分内部工作台与色卡分享链接页面。内部以操作效率、复用、维护/迭代成本为先；客户链接才以媒体展示为先。无需为普通字段/表单修改做两版 UI 或启动所有设计工具。

适用于本仓库的 UI设计、组件交互、视觉评审和交接。业务需求沿用现行文档；本技能不授权数据库操作、部署或范围扩张。

## 按需读取

先读 [UI规范入口](../../../docs/ui-design/README.md)，再按当前任务读取：
- 页面/样式：[design-system](../../../docs/ui-design/design-system.md)。
- 组件/交互：[component-rules](../../../docs/ui-design/component-rules.md)。
- 验收：[ui-review-checklist](../../../docs/ui-design/ui-review-checklist.md)。
- 新交互页面强制 UX 门禁：[ux-delivery-gate](../../../docs/ui-design/ux-delivery-gate.md)。UI UX Pro Max / Web Interface Guidelines 按领域实用规则检索；隔离样板执行真实 Playwright 交互回归并明确用户 UI 接受状态。
- WebCodex / ACP交接：[collaboration-workflow](../../../docs/ui-design/collaboration-workflow.md)。
- 路径或现状不明：[项目设计](../../../docs/project/项目设计.md)。

涉及三库、图片、色卡或单据业务时，同时遵循 [V2项目技能](../fabric-product-master-v2/SKILL.md)，按 [产品主数据入口](../../../docs/product-master/README.md) 读取最新需求的相关小节。不要全文重复展开所有参考资料。

## 执行
**用户已明确要求提高交付效率**：页面视觉审查与相关组件优化在同一轮完成，按照 `docs/ui-design/ui-page-visual-review.md` 实施和验收。对真实业务组件先看正式 CSS 与操作全态截图；同批精简文案、统一查看/分享弹窗、做桌面/窄屏复查和 Playwright 回归。不得只修功能后称 UI 已验收，更不能拿少按钮/未加载正式样式的样板当成生产视觉。

检查目标路径的实际源码和未提交改动，明确本次允许修改的文件。默认单 Agent、复用当前 React组件/model，新页面优先展示有审美质量的实际视觉方案（业务后台不应单纯复制旧蓝灰表格）；提供可交互预览，视觉评审与浏览器行为测试分别验证，不将历史A/B探索稿当作已批准风格；按当前效率优先原则设计。新页面或明显新布局的 UI接受与正式应用接线分开；已有明确批准范围继续执行。

Stitch为可选工具，效率低时可省略；不要求先做画布或同步每个页面。已有批准稿和用户修改仍是依据。实际修改 Stitch时先读取远程最新HTML/截图并核对画布，不覆盖独立修改；未操作远程页就不声明实时视觉通过。

当前V2局部样式与全局品牌蓝共存，不自行批量统一。业务数值和规则随最新需求核对，尤其永久配色序号、现行10列产品备注、图片归属、权限、色卡生命周期、选样实时资料与已保存单据的区别。

## 交付

提供可打开结果、改动路径、实际验证、用户UI接受状态和剩余事项。文档任务验证引用和技能元数据；代码任务执行对应行为测试及项目要求，真实浏览器/API/数据库未测则注明。静态PASS不代表视觉批准或正式集成。

WebCodex需以实际加载结果确认技能可用；ACP任务显式传入此技能路径和相关规范，不假定继承聊天内容。文件读取可作为加载失败时的回退，须据实说明。禁止把工具连通、任务登记或截图当完成证据。
