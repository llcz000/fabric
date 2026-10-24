> 历史参考：本文日期内的版本、角色/任务、列数、格式、部署状态和风险只对应原记录；已取消的范围不恢复为待办。现行依据为[项目需求](../project/项目需求总览.md)及[项目现状](../project/项目现状.md)；原始批准与证据保留，不作为今天的操作指令。

# Fabric Product Master V2｜远程 MySQL 只读核查与清退边界

> 文档定位：中间过程｜主要读者：当前任务的开发/评审、Agent。用途：查实现/计划、历史证据和未完成Gate；不是业务新需求。

> 2026-10-12。经项目本机私有 SSH 配置 `.local/server/_config/ssh.local.json` + 已授权 SSH 密钥，以**只读 Linux/MySQL 命令和 SELECT**核查远程生产环境。所有 SQL 均为 SELECT，未执行数据删除、DDL、导出客户数据、重启、部署或改写凭据。本文件不包含连接 IP/SSH 密码/密钥内容。当前业务基线：[v1.36](product-master-v2-requirements.md)；[P0 技术记录](product-master-v2-p0-technical-baseline.md)。

## 1. 远程连接和应用运行事实

- 远程项目：`/opt/fabric`；部署 Git revision（短）：`c743742`；本地开发 HEAD（短）：`33f1da4`，**版本不同**，不可用本地源码替代线上运行验收。
- SSH 密钥身份验证非交互成功。SSH 设置在被 Git 忽略的本地私有配置内；开发环境无需创建新的 SSH 配置。
- 远程 MySQL **8.0.46-0ubuntu0.22.04.3**，Ubuntu；`systemctl is-active mysql` = `active`；3306监听；MySQL local socket只读SQL执行成功，`@@read_only=0`（服务器本身非只读，**本次命令无写操作**）。
- 应用使用数据库 `fabric_db`，PM2 进程 `fabric` = `online`，`http://127.0.0.1:3000/api/health` = `{"status":"ok","storage":"mysql",...}`。
- **结论**：之前「要在 Windows 安装 MySQL Server 8.4」的建议针对错误前提，现已撤销。无需安装本地MySQL、无需变更线上版本/SSH/MySQL连接配置。

## 2. 真实数据库表与精确记录数

`COUNT(*)` 是精确统计，不是 `INFORMATION_SCHEMA.TABLE_ROWS` 的InnoDB近似值。

| 表 | 记录数 | V2数据边界 |
| --- | ---: | --- |
| `products` | 1,211 | 旧产品资料；**获准弃用/有序清退** |
| `product_images` | 0 | 旧产品专用图片路径表，仍存在FK |
| `product_image_assets` | 1,008 | 旧产品图片关联，**清退前需处理全局资产引用计数** |
| `product_pattern_tags` | 0 | 旧产品专用标签关联 |
| `pattern_tags` | 0 | 旧产品域标签 |
| `product_issues` | 1,778 | 旧产品质量/导入诊断 |
| `product_import_batches` | 1 | 旧产品历史导入批次 |
| `product_import_sources` | 1,218 | 旧产品导入明细 |
| `orders` | 118 | **保留**：历史单据 |
| `order_items` | 148 | **保留**：历史单据明细 |
| `image_assets` | 977 | **保留**：全局图片资产（非旧产品专用物理库） |
| `inventory_entries` | 0 | 保留库存结构 |
| `company_config` | 1（近似表元数据，未单独COUNT） | 保留公司配置 |

另有名为 `fabrics` 的表：**0行，但并非V2面料主数据表**。实际字段包括 `receiving_unit,style_no,order_no,product_no,product_name,composition,weight,width,meters,unit_price,amount,record_date,images` 等，与V2目标 `fabric_no/fabric_name/weight_unit` 不一致；只有ID主键。**不能直接复用表名或按V2表结构修改该旧表**。本地应用源码未找到直接对 `fabrics` 读写的静态匹配，但不证明远程当前版本没有使用，故保持原表不动；建议新建 `v2_fabrics`。

目前未发现 `pattern_masters`、`pattern_colorways`、`shared_tags`、`v2_products` 等目标新表。V2可从空业务数据开始。

## 3. 真实外键关系

远程 `information_schema.KEY_COLUMN_USAGE` 查询：指向旧 `products.id` 的子表为：

1. `product_image_assets.product_id`
2. `product_images.product_id`
3. `product_import_sources.product_id`
4. `product_issues.product_id`
5. `product_pattern_tags.product_id`

此外 `product_issues.product_image_asset_id → product_image_assets.id`；`product_image_assets.asset_id → image_assets.id`，`product_image_assets.legacy_product_image_id → product_images.id`。全局 `image_assets` 还被 `image_asset_variants`、`image_upload_sessions`、`image_processing_jobs`、`company_image_assets` 等表引用。

**远程外键元数据未发现历史 `orders` / `order_items` 对 `products` 的外键**。`order_items.product_no` 是历史文本，不应在清退旧产品后据货号进行自动产品关联或覆盖；118份单据/148条明细继续保留。产品新建单据关联在V2正式应用切换后新增全新字段与服务端校验。

## 4. 图片共享与回收风险：必须先设计清退事务

- `product_image_assets` 共1,008行，**全为活跃关联**（deleted_at IS NULL）；其中 `pattern_original` 992、`unclassified` 16。它们实际指向**944个不同的全局图片资产**。
- `image_assets` 共有977行，其中 `product_image ready` 944、`product_image recycled` 33；正引用计数的资产数=944。全局 `SUM(image_assets.ref_count)=1008`，与活跃产品图片关联数一致。
- `company_image_assets` 当前0行、与产品资产交集为0；但**这不意味着可无条件删除全局资产或其原始COS对象**。
- `image_asset_variants` 2931行、已指向资产的`image_upload_sessions` 3334行、`image_processing_jobs` 977行：都是全局图片基础设施，不能随旧产品库DROP/DELETE。
- **危险**：直接删除产品/子关联表会绕过已有服务中的 `ref_count` 维护；若减计数后资产变为0，可能触发定期回收甚至删除COS对象。V2切换前先设计资产留存/回收策略和真实事务测试；目前不触碰任何媒体数据库记录或存储对象。

## 5. 工程选型与安全顺序（设计决策，不是已实施）

1. **在线运行与开发隔离**：远程现有应用仍在服务旧 `/api/products`、使用真实MySQL；不能在当前生产进程运行未经测试的新DDL、旧schema初始化、删除脚本。先在隔离测试库演练，不需要保留旧产品数据兼容API。
2. **V2原生新表优先并行建模**：建议 `pattern_masters`、`pattern_colorways`、`v2_fabrics`（避开旧`fabrics`）、`shared_tags`、`v2_products`（避开仍在线旧`products`）、新产品/版本图片关联表；共用 `image_assets` 服务时须正确维护资产关系。路径统一V2 API，旧导入/产品API仅在正式切换时退出，**不做旧数据字段映射与兼容展示**。
3. **数据检查与备份**：生产清退前对照五条products FK、全局图片引用/回收状态、现有单据及项目版本；留可校验的恢复机制。备份目标是防止误删非授权业务数据，并非要求迁入V2旧产品。
4. **切换后受控清退**：待V2权限/图片/订单联调通过且完成切换后，基于明确的旧产品专用子表名单、依赖次序、回收策略逐步解除引用并清退旧域；历史订单/明细、库存、公司数据及全局图片资产绝不连带清库。
5. **安全 Gate**：MySQL 8.0.46实库幂等初始化、历史118单/148明细不变、旧产品数据范围复核、图片`ref_count`一致、权限/三单据快照测试、`storage=mysql`和真实V2 API、恢复路径。失败则不得发布。

**截至本次审计**：远程数据库真实查验已完成（表/字段/索引/外键/计数）；清退与V2业务建表**均未执行**。P0-2的远程数据盘点前置项不再阻塞；整体P0仍有UI、数字配色自动分配、Excel格式待审项。后续需继续P1代码与隔离测试环境准备，不需要用户安装本地MySQL。
