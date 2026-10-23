# Fabric UI Design 规范库

> 文档定位：导航｜主要读者：按问题选读的所有人。用途：定位其他文件，不维护另一套正文。

版本：0.1｜核对日期：2026-10-14｜范围：第一阶段规范与技能入口。

此目录是 [Fabric 知识库](../00-首页.md) 的 UI 领域规范，不另建需求库。当前业务以 [产品主数据入口](../product-master/README.md) 指向的最新 [需求](../product-master/product-master-v2-requirements.md) 为准；本次核对为 v1.50。文档中的建议值不等于用户已批准的新 UI，也不代表应用已完成集成或部署。

## 从任务选择文档

**新会话 UI 开工前必做**：先运行 `npm run ui:preflight`，核对活动工作区与根目录权威规范；完整执行流程见 [UI/UX Gate](ux-delivery-gate.md#新会话强制检查与单轮完成门禁2026-10-22)。规范过期可显式 `npm run ui:preflight -- --sync` 同步，结束前运行 `npm run ui:verify`，结果 NO-GO 时不可宣称 UI 完成。

**最新定位（2026-10-21）**：整个系统为内部工作台，只有色卡分享链接打开的内容面向客户。内部 UI 以效率和快速版本迭代为先；客户分享页才以图片展示为先。详见 [内部/客户 UI 边界与迭代原则](product-positioning-2026-10-21.md)。

| 任务 | 必读规范 | 输出 |
|---|---|---|
| 页面设计、样式对齐 | [design-system](design-system.md) | 现有样式依据、页面预览、变化说明 |
| 组件设计与交互实现 | [component-rules](component-rules.md) | 复用位置、交互状态、权限与数据边界 |
| UI 验收 | [ui-review-checklist](ui-review-checklist.md) | 逐项结果、实际证据、剩余问题 |
| 新 UI 强制验收与浏览器门禁 | [ux-delivery-gate](ux-delivery-gate.md) | 必要路径、Edge/Playwright 交互证据和 Go/No-Go |
| 内部工作台与客户分享分离样板 | [internal-customer-2026-10-21](internal-customer-2026-10-21.md) | 内部效率列表与客户版边界 |
| 微信 H5 实际色卡分享 UI | [wechat-card-share-2026-10-21](wechat-card-share-2026-10-21.md) | 活动源码、手机交互测试及仍待微信真机验收 |
| 微信 H5 发布前真实素材验收 | [wechat-share-release-readiness-2026-10-21](wechat-share-release-readiness-2026-10-21.md) | 真实图片本机测试、接口负向检查及17项浏览器回归 |
| 微信 H5 正式发布记录 | [wechat-share-release-result-2026-10-21](wechat-share-release-result-2026-10-21.md) | 上一版发布、备份演练、公网验证 |
| 微信 H5 四项体验调整 | [wechat-share-four-fixes-release-2026-10-21](wechat-share-four-fixes-release-2026-10-21.md) | 线上用户验收通过，发布与测试证据 |
| 内部工作台第二批效率改进（历史候选） | [internal-ui-efficiency-2026-10-21](internal-ui-efficiency-2026-10-21.md) | 共用列设置/搜索改进，原视觉演示已被替代 |
| 色卡列表真实组件纠偏版（历史候选） | [card-library-correction-2026-10-21](card-library-correction-2026-10-21.md) | 去表头排序、合理列宽的上一候选 |
| UI 单轮交付与色卡视觉更新 | [one-pass-ui-review-2026-10-21](one-pass-ui-review-2026-10-21.md) | 同轮组件、文案、视觉、弹窗和浏览器验收的设计依据 |
| 实体色卡库当前线上发布 | [card-library-one-pass-release-2026-10-21](card-library-one-pass-release-2026-10-21.md) | 当前生产版本、已完成发布保护与未完成的已登录 UI 人工复核 |
| 下一页：面料库 UI 联合优化 | [fabric-library-next-2026-10-21](fabric-library-next-2026-10-21.md) | 正式组件局部设计、页面与弹窗截图、浏览器回归及新 UI 发布门禁证据 |
| 面料库行内编辑克重单位修复 | [fabric-weight-unit-fix-2026-10-21](fabric-weight-unit-fix-2026-10-21.md) | 编辑态控件不压缩、gsm/mm/空状态、30项综合测试、最新本地候选 |
| 面料库当前线上正式发布 | [fabric-weight-unit-release-2026-10-21](fabric-weight-unit-release-2026-10-21.md) | 面料库优化及克重单位修复、UI Gate 首次发布生效、备份和公网验证 |
| 已替代的历史视觉探索 | [visual-ab-2026-10-21](visual-ab-2026-10-21.md) | 仅作方案对比归档，不能当内部 UI 默认模板 |
| WebCodex / Codex ACP 交接 | [collaboration-workflow](collaboration-workflow.md) | 小任务简报与可恢复交接 |
| 判断结构与现状 | [project-structure-audit](project-structure-audit.md) | 本次实际核对范围与未验证事项 |

项目技能入口：[fabric-ui-design](../../.agents/skills/fabric-ui-design/SKILL.md)；新 UI 验收加载 [fabric-ui-ux-qa](../../.agents/skills/fabric-ui-ux-qa/SKILL.md)。Codex 可按项目技能发现；WebCodex 必须用实际技能列表/加载结果确认，不把文件存在等同于自动注入成功。

## 工具选择与批准边界

用户于 2026-10-14明确：如果 Stitch 流程效率不高，可以弃用。默认使用现有 React 组件与本地可交互预览，直接评审业务、状态和视觉；Stitch 按需使用，取消所有页面必须先进入 Stitch 的要求。Figma、v0 或其他工具也没有本阶段接入要求。

- 已有 Stitch 稿、用户修改、批准记录继续作为设计依据，不删除、不用旧本地稿覆盖。
- 确实修改远程 Stitch 页面时仍执行实时读取、差异比较和画布核对。此工具内的保护要求见 [既有流程第8节](../product-master/product-master-v2-ui-iteration-workflow.md)；若标题锚点变化，直接查找第8节。
- 新页面或明显布局变化需要可审查预览和用户 UI 接受；已有明确批准范围内的修订持续执行，不重复发起批准。
- UI 接受、应用编码、接线验证、真实数据库验收和部署各自登记。本规范不扩大任何已有授权。

## 维护

同一规则只在一个位置维护：业务规则在需求、视觉约定在 design-system、组件行为在 component-rules、证据在评审记录。需求变更时按最新小节校对引用，避免把历史编号规则或选样快照规则重新引入。发现冲突先标明来源/日期，按照用户最新明确决定和当前需求处理。规范更新使用小范围差异，不覆盖其他任务的未提交内容。
