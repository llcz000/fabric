# 设计、决策与保留计划

> 文档定位：导航｜主要读者：按问题选读的所有人。用途：定位其他文件，不维护另一套正文。

核对：2026-10-15，本地源码及文档。需求、代码、历史验收和线上状态分别判断；总体范围查[项目需求总览](../project/项目需求总览.md)，当前状态查[项目进度](../project/项目现状.md)，V2阶段明细再查[V2进度](../product-master/product-master-v2-progress.md)。

| 领域 | 当前入口 / 保留原因 |
|---|---|
| 产品主数据V2 | [唯一需求](../product-master/product-master-v2-requirements.md)、[架构](../superpowers/specs/2026-10-12-product-master-v2-architecture.md)、[P0～P7计划](../superpowers/plans/2026-10-12-product-master-v2-implementation.md)；保留尚未完成的正式接线、迁移及验收约束 |
| 色卡生命周期 | [已批准决定](../product-master/product-master-v2-b2-5-approved-decisions.md)、[B2-5计划](../superpowers/plans/2026-10-14-b2-5-card-lifecycle-reprint.md)；本机已有实现，存量库迁移/真实并发及上线仍待验 |
| 单母版色卡 | [B2-3计划](../superpowers/plans/2026-10-14-b2-3-sample-card-library.md)；保留未完成联调与授权边界，原始执行步骤不表示仍未编码 |
| 统一图片资产 | [设计](../superpowers/specs/2026-08-22-unified-image-asset-system-design.md)、[计划](../superpowers/plans/2026-08-22-unified-image-asset-system.md)、[运维](../operations/image-asset-operations.md)；源码存在，开关/迁移/正式运行未在本轮验收，保留独有发布与回收约束 |
| 多用户与订单权限 | [原计划](../superpowers/plans/2026-08-31-fabric-dms-multi-user-order-product-permissions.md)；V2独立账号/权限模块已有代码，正式入口仍旧管理员会话；未完成集成约束保留，以V2现行规则覆盖冲突项 |
| 共享打印模型 | [合并记录与固定约束](../retrospectives/development/2026-10-09-document-output-source-review.md)；已落实设计与执行步骤已合并，后续直接维护源码及相关测试 |

## 旧产品方案的替代边界

2026-09-20/21的四类产品图片、标签/异常审核和WPS历史产品导入三份方案退出当前目录，替代依据为[V2唯一需求](../product-master/product-master-v2-requirements.md)：花型原图属于配色，产品三类图各0～10；题材/颜色词表分别归属母版/配色；不恢复旧20图总限额、12标签、异常审核或历史产品导入验收。当前面料导入只支持xlsx，与已取消的WPS历史产品导入不同。

仍须保留的独有保护：原始工作簿只读；输入/权限/上传检查保留；查询先在服务端过滤再分页；编辑失败保留草稿且不部分保存；共享图片有引用不能清除。旧导入工具源码仍存在，不能因旧计划被删就执行或清除工具、原素材、客户数据。若另行获准操作旧导入，须先恢复其原始计划，保持逐产品事务、SHA/来源幂等、已编辑或开单记录禁止自动回滚、WPS DISPIMG关系解析及有界逐图处理等边界，不能复用为V2新需求。

旧产品功能虽已批准退场，当前src/App.tsx仍引用ProductLibrary、server.ts仍装配旧产品路由；正式切换前不得删除模块、表或共享资产。历史单据、客户/库存/公司、共享image_assets持续保护。

新决策使用[决策模板](../Templates/决策记录模板.md)。原件与替代关系见[维护记录](../maintenance/2026-10-15-项目内容清理.md)。
