# 产品主数据：需求、进度与开发定位

本领域入口是[V2唯一需求v1.50](product-master-v2-requirements.md)和[V2设计开发验收进度](product-master-v2-progress.md)，仅覆盖该模块及关联增量。全项目已有业务见[项目需求总览](../project/项目需求总览.md)，总体状态见[项目进度](../project/项目现状.md)。业务规则不在本页重复；资料、状态、历史证据和线上完成不能相互替代。

现行权限已按**2026-10-15用户最新确认**简化，统一见[项目总览2.1](../project/项目需求总览.md#roles)。旧技术说明中的双授权、管理员独占导入覆盖/导出、业务员独占扫码描述属于旧实现；整改与验收见当前进度，不据此恢复旧需求。

## 业务需求按主题看

需求第2节范围；第3/10节人员权限；第4节三库与永久数字配色；第5/6节图片与录入；第7节启停删除；第8节检索；第9节三单据、分享、色卡/客户选样；第12节搜索对应AC。批准依据保留[色卡决定](product-master-v2-b2-5-approved-decisions.md)，与现行正文冲突按最新需求处理。

## 当前状态只看一处

[设计、开发、验收与待上线清单](product-master-v2-progress.md)。一期正式交付判断见[交付门槛](product-master-v2-phase1-delivery-readiness.md)；历史测试数字不能继承为本轮通过。

## 阶段任务快速定位

| 阶段 | 只读对应主题 | 源码及专项入口 | 未完成事项 |
|---|---|---|---|
| P0 需求/基线 | [技术基线](product-master-v2-p0-technical-baseline.md)、[历史审计](product-master-v2-remote-db-audit.md) | `docs/product-master/product-master-v2-requirements.md`、`scripts/check-product-master-v2-p0.mjs` | [进度P0](product-master-v2-progress.md) |
| P1 schema/历史 | [结构版本](product-master-v2-p1c2-schema-versioning.md)、[历史保护](product-master-v2-p1d2-lines.md) | `server/product-master/schema.ts`、`server/product-master/colorwayMigrationPreflight.ts`、`server/product-master/migrationLockRollbackPlan.ts`、`server/product-master/migrationLockRollbackPlan.test.ts`、`server/order-v2/lines.ts` | [进度P1](product-master-v2-progress.md)；真库迁移另行授权 |
| P2 登录权限 | [认证与成员](product-master-v2-p2-access-foundation.md)、[旧入口切流](product-master-v2-p2-legacy-cutover-gate.md) | `server/access/`、`server/access/routes.ts`、`server/access/members.test.ts` | [进度P2](product-master-v2-progress.md)；正式认证未接线 |
| P3 三库媒体 | [三库服务](product-master-v2-p3-real-mysql-gate.md) | `server/product-master/`、`server/product-master/productsV2.test.ts` | [进度P3](product-master-v2-progress.md)；COS/实库另验 |
| P4 React三库 | [交互与浏览器](product-master-v2-p4-browser-qa.md)、[设计登记](product-master-v2-stitch-design-review.md) | `src/components/product-master-v2/`、`src/components/product-master-v2/ProductCatalogV2.test.ts` | [进度P4](product-master-v2-progress.md)；正式账号/媒体/视觉 |
| P5 xlsx导入 | [导入技术说明](product-master-v2-p5-browser-and-mysql-gate.md) | `server/product-master/fabricExcelImport.ts`、`server/product-master/fabricExcelImport.test.ts` | [进度P5](product-master-v2-progress.md)；真实写链 |
| P6 三单据 | [选品保存计算输出](product-master-v2-p6-document-write-read.md) | `server/order-v2/`、`server/order-v2/documents.test.ts`、`src/components/document-product-selector/` | [进度P6](product-master-v2-progress.md)；历史/库存/打印接线 |
| P7 联调交付 | [统一HTTP与目标身份](product-master-v2-p7-local-http-assembly.md)、[独立沙箱启动](product-master-v2-p7-sandbox-preview.md)、[交付门槛](product-master-v2-phase1-delivery-readiness.md) | `server/product-master/v2CatalogAssembly.ts`、`server/product-master/v2SandboxPreview.ts`、`server/product-master/v2SandboxPreview.test.ts`、`scripts/run-v2-sandbox-preview.ts`、`scripts/check-fabric-v2-phase1-delivery.mjs`、`scripts/check-fabric-v2-phase1-delivery.test.mjs`、`scripts/run-ts-tests.mjs` | [进度P7](product-master-v2-progress.md)；TEST-ONLY不可直接生产复用 |
| B1 花型分享 | [B1交付评审](../retrospectives/development/2026-10-15-phase1-b1-release-review.md)、[只读库表预检与DBA门禁](product-master-v2-b1-link-schema-review.md) | `server/customer-share/`、`server/customer-share/patternLinkStore.test.ts` | [进度B1](product-master-v2-progress.md)；持久化/公开路由/H5 |
| B2 色卡扫码 | [色卡技术说明](product-master-v2-b2-5h-scan-lock-order.md)、[批准决定](product-master-v2-b2-5-approved-decisions.md) | `server/customer-samples/scanRepository.ts`、`server/customer-samples/scanRepository.test.ts` | [进度B2](product-master-v2-progress.md)；真实锁/FK/手机扫码 |
| B3 选样寄样 | [当前选样说明](product-master-v2-b3-history-ui-review.md) | `server/customer-samples/sessionManual.ts`、`src/components/product-master-v2/SampleSelectionWorkspaceV2.tsx`、`src/components/product-master-v2/manualSelectionPrivateHttp.test.ts` | [进度B3](product-master-v2-progress.md)；正式接线/真库/寄样持久化 |
| Agent 任务交接 | [精简上下文及ACP链](product-master-v2-agent-context-handbook.md)、[跨模块中央任务队列](../project/Fabric-Multi-Agent-Orchestrator-V2.md)、[分工边界](product-master-v2-parallel-agents-plan.md) | `scripts/fabric-v2-orchestrator.mjs`、`scripts/fabric-v2-orchestrator.test.mjs`、`scripts/fabric-v2-acp-runner-bridge.mjs`、`scripts/fabric-v2-acp-runner-bridge.test.mjs`、`scripts/fabric-v2-acp-task-intake.mjs`、`scripts/fabric-v2-acp-efficiency.mjs`、`scripts/fabric-v2-workspace-freshness.mjs` | 第一阶段仅规划/占位，无真实双ACP运行；新基线/隔离Project/实际run_id/双审/三方SHA256尚需总控执行 |

## 开发与验收按专题看

上表每阶段只保留一份对应技术说明；详细过程原文在[外部可恢复备份](../maintenance/2026-10-15-项目内容清理.md)定位。先加载[产品主数据项目技能](../../.agents/skills/fabric-product-master-v2/SKILL.md)，UI再按[UI规范](../ui-design/README.md)，同类故障按[经验检索](../retrospectives/README.md)选择1～2篇；不把方案当完成记录，不从备份重新展开整库。
