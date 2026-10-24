# 产品主数据｜需求与代码速查

**现行唯一基线**：[项目需求总览](../project/项目需求总览.md) + [V2唯一需求v1.53](product-master-v2-requirements.md)。项目正式运行状态只看[项目现状](../project/项目现状.md)，V2阶段汇总看[模块进度](product-master-v2-progress.md)，P1～P7/B1～B3在本页按源码入口查；旧阶段实施计划不再作为开发任务。

## 业务功能直达

| 功能 | 最新需求 / 代码 |
|---|---|
| 花型、数字配色、面料、产品与图片 | [V2需求](product-master-v2-requirements.md)、`server/product-master/` |
| 花型文件夹/多文件导入与面料xlsx | [需求EX-03～06](../project/项目需求总览.md#import-export) |
| 三种单据与选品、计算/打印 | [需求DOC/OUTPUT](../project/项目需求总览.md#documents)、`server/order-v2/` |
| 色卡、选样、扫码、公开H5 | [需求V2-08～15](../project/项目需求总览.md#v2-selection)、`server/customer-samples/`、`server/customer-share/` |
| 轻量客户、偏好、回访与历史 | [需求CUSTOMER-01～08](../project/项目需求总览.md#customers) |
| 多Agent与并行Git工作树 | [并行开发规范](../development/Fabric并行开发与合并规范.md)、[交接规范](product-master-v2-agent-context-handbook.md) |

## 阶段任务快速定位

下列为**代码定位**，不是旧阶段“待上线”清单。真实环境迁移、纸质打印、微信实机及权限回归均按本次影响范围独立验收，不继承历史测试数字。

| 阶段 | 关键源码/测试入口 | 当前判断 |
|---|---|---|
| P1 schema/历史 | `server/product-master/schema.ts`、`server/product-master/colorwayMigrationPreflight.ts`、`server/product-master/migrationLockRollbackPlan.ts`、`server/product-master/migrationLockRollbackPlan.test.ts`、`server/order-v2/lines.ts` | 真库迁移需授权及可恢复性证据 |
| P2 登录权限 | `server/access/`、`server/access/routes.ts`、`server/access/members.test.ts` | 后端有效角色/owner 为准，不复活双授权 |
| P3 三库媒体 | `server/product-master/`、`server/product-master/productsV2.test.ts` | 产品引用与共享图回收按当前业务验证 |
| P4 React三库 | `src/components/product-master-v2/`、`src/components/product-master-v2/ProductCatalogV2.test.ts` | UI与浏览器真交互独立验收 |
| P5 xlsx导入 | `server/product-master/fabricExcelImport.ts`、`server/product-master/fabricExcelImport.test.ts` | 仅当前xlsx模板/品号空校验 |
| P6 三单据 | `server/order-v2/`、`server/order-v2/documents.test.ts`、`src/components/document-product-selector/` | 三类型金额/输出/事务一致性 |
| P7 联调交付 | `server/product-master/v2CatalogAssembly.ts`、`server/product-master/v2SandboxPreview.ts`、`server/product-master/v2SandboxPreview.test.ts`、`scripts/run-v2-sandbox-preview.ts`、`scripts/check-fabric-v2-phase1-delivery.mjs`、`scripts/check-fabric-v2-phase1-delivery.test.mjs`、`scripts/run-ts-tests.mjs` | V2现行正式代码优先，沙箱只供验证 |
| B1 花型分享 | `server/customer-share/`、`server/customer-share/patternLinkStore.test.ts` | 公共投影严格白名单 |
| B2 色卡扫码 | `server/customer-samples/scanRepository.ts`、`server/customer-samples/scanRepository.test.ts` | 手机、稳定映射与历史二维码 |
| B3 选样客户 | `server/customer-samples/sessionManual.ts`、`src/components/product-master-v2/SampleSelectionWorkspaceV2.tsx`、`src/components/product-master-v2/manualSelectionPrivateHttp.test.ts` | 已取消独立寄样流程 |
| Agent 协作 | `scripts/fabric-v2-orchestrator.mjs`、`scripts/fabric-v2-orchestrator.test.mjs`、`scripts/fabric-v2-acp-runner-bridge.mjs`、`scripts/fabric-v2-acp-runner-bridge.test.mjs`、`scripts/fabric-v2-acp-task-intake.mjs`、`scripts/fabric-v2-acp-efficiency.mjs`、`scripts/fabric-v2-workspace-freshness.mjs` | `npm run parallel -- audit`；ACP按真实run_id、SHA256和双重审查 |

## 开发与验收按专题看

统一从 `D:/fabric` 运行，开发前执行 `npm run v2:source`；涉及UI执行 `npm run ui:preflight`。导入、订单和共享安全的最低测试要求见[开发与验证](../development/开发与验证规范.md)。详细历史实验原件已有外部可恢复备份，现行入口不再列出旧过程；仓库内原件的物理删除尚待通过安全检查，不能重新引入已取消的旧业务规则。备份索引见[恢复说明](../maintenance/文档整合与恢复.md)。

任务交接时用 `scripts/fabric-v2-acp-task-intake.mjs`，收益实测记账用 `scripts/fabric-v2-acp-efficiency.mjs`；只读中央队列见 `scripts/fabric-v2-orchestrator.mjs`。
