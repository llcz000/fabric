# 数据与 API

> 文档定位：规范与手册｜主要读者：设计/开发/测试/运维及Agent。用途：按当前任务选择对应规范或运行方法。

核对：2026-10-15，本地源码入口；未连远程或运行API。本页给出领域与代码入口；完整存储字段/实际约束以源码为准，业务目标查[项目需求总览](项目需求总览.md)及其模块细则。以下 API 是否走新链路取决于功能开关和路由装配；API存在不代表当前默认页面已有操作入口。

本页前半部分描述正式旧入口。V2独立权限、三库、单据与客户选样模块已有实现，尚未挂正式server.ts；当前业务规则及接线状态见[领域入口](../product-master/README.md)和[当前进度](../product-master/product-master-v2-progress.md)，不能把下面旧产品图片角色用作V2规则。

## 数据实体与源文件

| 领域 | 实体 / 表 | 依据 |
|---|---|---|
| 公司、单据、库存、传统产品图片 | company_config、orders、order_items、inventory_entries、products、product_images | server.ts 建表与业务路由 |
| 图片资产 | image_assets、image_asset_variants、image_upload_sessions、image_processing_jobs、company_image_assets、product_image_assets | server/image-assets/schema.ts |
| 产品分类与导入 | pattern_tags、product_pattern_tags、product_issues、product_import_batches、product_import_sources | server/products/schema.ts |
| 前端单据口径 | DocumentData、单据项、共享打印模型 | src/types.ts、src/lib/documentPrintModel.ts |

正式旧产品图片角色以 `server/products/types.ts` 为准：pattern_original（花型原图）、fabric_display（面料展示）、detail（细节）、ai_effect（效果图）、unclassified（待分类）。旧 gallery/swatch 仅作为迁移兼容输入。公司图片角色为 brand_logo / wechat_qr / alipay_qr。

## API 地图

| 路径 / 领域 | 代码入口与注意事项 |
|---|---|
| GET /api/health；POST /api/login、/api/logout | server.ts；健康检查公开，其他业务须按路由鉴权 |
| /api/company、/api/orders、/api/inventory/entries、/api/inventory/ledger | server.ts；业务数据与 JSON 降级逻辑 |
| /api/upload、/api/template/upload、/api/template/config、/api/export_template/:id | server.ts；上传校验和模板导出 |
| /api/products | server.ts + server/products/routes.ts + server/appAssembly.ts；新旧路由共存 |
| /api/products/:id/images、/:id/image-layout、/:id/issues/:issueId/ignore 或 reopen | server/products/routes.ts；关联资产、图片排序及异常处理 |
| /api/products/batch-pattern-tags、/api/product-pattern-tags | 产品路由；标签批处理和字典管理 |
| /api/image-assets/upload-sessions、/:id/finalize、/access-urls、/:id/content、/:id | server/image-assets/routes.ts；隔离上传与受控读取 |
| /api/company/images | server/image-assets/companyImages.ts；Logo/二维码关联与导出内容 |

改变路由时同时核对 HTTP 方法、body parser 的所属层、功能开关与鉴权。仅按路由名称搜索不足以确认实际装配行为。

## 业务口径

- 前端 `sales` 与传统后端 `bulk` 是销售单据类型映射，共享打印模型会归一化类型。
- 定金比例与销售预收金额须按单据类型解释，不能将名为 deposit 的字段一律当金额或比例；修改前核对历史数据与计算路径。
- 分匹米数与真实匹号不同；库存的匹数、米数和出库聚合口径应对照领域类型及业务规则。
- 门幅是面料宽度；克重是单位面积重量；成分是材料比例；花型原图与实拍/成衣效果图不能互相冒称。
- 签名 URL 是临时访问凭证，数据库存资产 ID/object key；不存永久签名链接，不在知识库记录 token、真实客户或连接密钥。

相关：[图片资产运维](../operations/image-asset-operations.md)、[V2唯一需求](../product-master/product-master-v2-requirements.md)。
