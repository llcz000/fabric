# 产品主数据 V2｜阶段状态索引

> 2026-10-24 文档收敛。阶段 P1～P7、B1～B3 是**检索定位**，不再堆叠每日开发日志。当前唯一项目级状态看[项目现状](../project/项目现状.md)，需求看[V2唯一需求v1.53](product-master-v2-requirements.md)。

| 阶段 | 业务主题 | 当前入口 / 开放验收 |
|---|---|---|
| P0 | 需求/源码基线 | [项目需求](../project/项目需求总览.md)、[设计](../project/项目设计.md)；不恢复旧候选 |
| P1 | Schema和历史明细 | `server/product-master/schema.ts`、`server/order-v2/lines.ts`；实际MySQL迁移/回滚另验 |
| P2 | 认证、权限及成员 | `server/access/`；管理员/业务员服务端角色与owner保护，历史授权开关已废弃 |
| P3 | 花型、面料、产品和图片 | `server/product-master/`；组合、引用、删除及共享图片依真实数据核验 |
| P4 | 正式React界面 | `src/components/product-master-v2/`；当前工作台按UI规范验收，历史沙箱不作为正式入口 |
| P5 | xlsx导入 | `server/product-master/fabricExcelImport.ts`；无列映射配置、品号仅空校验 |
| P6 | 三类单据/输出 | `server/order-v2/`；金额/条款/打印/Excel保持真实数据一致 |
| P7 | 正式HTTP与部署 | 当前 `server.ts` 只运行V2；部署/迁移/回滚验收独立于本地代码 |
| B1 | 公开分享 | `server/customer-share/`；受控公开字段，不泄漏内部客户/价格 |
| B2 | 色卡身份/扫码/重印 | `server/customer-samples/`；实体码和历史来源保护，微信真机按需验收 |
| B3 | 客户选样/轻量档案 | `src/components/customers/`、`server/customer-samples/`；按最新简化范围，无独立寄样管理 |

## 开放事项

当前**没有因为资料归档而关闭任何业务验收 Gate**：正式生产目标/实库恢复、COS、真实跨账号、实体扫码微信、纸质输出、UI人工视觉和库存后续开发只在实际需求涉及时逐项验证。现行功能已在V2主应用中呈现，但不等于本次全部端到端重测。

## 代码与规范定位

按[P0～P7/B1～B3源码表](README.md#阶段任务快速定位)，开发遵守[并行Git工作树验收规范](../development/Fabric并行开发与合并规范.md)、[开发验证规则](../development/开发与验证规范.md)；界面遵守[UI Gate](../ui-design/ux-delivery-gate.md)。历史阶段实现与测试记录按[仓库外归档](../maintenance/文档整合与恢复.md)恢复。
