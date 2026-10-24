> 历史参考：本文日期内的版本、角色/任务、列数、格式、部署状态和风险只对应原记录；已取消的范围不恢复为待办。现行依据为[项目需求](../project/项目需求总览.md)及[项目现状](../project/项目现状.md)；原始批准与证据保留，不作为今天的操作指令。

# Fabric 产品主数据 V2｜P0 技术基线与首个实施切片

> 文档定位：中间过程｜主要读者：当前任务的开发/评审、Agent。用途：查实现/计划、历史证据和未完成Gate；不是业务新需求。

> 2026-10-12，P0 源码及远程SSH/MySQL只读核查证据；当前需求基线是 [v1.36](product-master-v2-requirements.md)，本文件为**技术执行准备**而非需求批准、真实数据库审计或生产验收。技术设计：[架构0.1](../superpowers/specs/2026-10-12-product-master-v2-architecture.md)；执行框架：[P0～P7](../superpowers/plans/2026-10-12-product-master-v2-implementation.md)。
>
> **最新P0进度（2026-10-12远程检查后）**：P0-1源码/工作区盘点、P0-2远程MySQL实际表/索引/外键/准确计数已核实，证据见[远程数据库审计](product-master-v2-remote-db-audit.md)；P0-3依据用户v1.36已转为V2独立新表并行建设、旧产品域正式切换后安全清退（表名/释放资产生命周期技术方案须编制）；P0-4自动配色分配/UI/Excel仍未批准；P0-5 DTO/API仍为草案。整体P0 Gate尚未通过，尚未编码/执行迁移。
> **v1.36 最新业务决策，替代下文兼容旧库选型章节的旧判断**：用户2026-10-12明确授权清理旧产品库及旧产品专用引用，并彻底废弃旧产品API，不再为旧产品表/旧编号/旧图片角色做兼容。V2采用原生三库和全新产品主数据；P1应先隔离/停用旧产品域schema初始化，再建立V2原生表。下文A/B兼容扩列论证仅保留为旧阶段源代码分析，不能用于当前施工。仍需只读查实际FK、列及依赖并验证安全清退顺序，且历史三类单据、库存/客户、公司和共用image_assets必须保全。远程MySQL已通过SSH只读查验（8.0.46，fabric_db）；未执行DROP/DELETE，正式切换仍须保全历史单据及全局图片。

## 1. 检查口径与环境边界

| 项 | 本次实证 | 含义 |
| --- | --- | --- |
| 项目、版本 | `D:\fabric`，Git `master`，HEAD `33f1da44be5a38b26496c8c55abea7eda7693adb`；工作区有大量先前未提交/被删除/新建的资料 | 不重置、不自动暂存/提交；设计文件只附加现行知识库 |
| 运行应用 | 本地 `http://127.0.0.1:3000/api/health` 与 `http://127.0.0.1:2026/api/health` 本次不可访问 | **未**启动服务、未验证当前远程环境 |
| 本机依赖 | 根目录没有 `node_modules`；无mysql命令行工具和MySQL ODBC驱动；Python不存在pymysql/mysql connector | `lint`、`build`、真实MySQL演练**未执行** |
| 配置 | `.env` 中 DB_HOST、DB_USER、DB_PASSWORD、DB_DATABASE 这四项存在（仅检查键是否存在，未输出值） | 配置存在不意味着数据库在线、或配置指向安全测试库 |
| 连接性 | 对配置中的数据库端点仅做TCP握手（未发送MySQL认证或SQL）；配置目标为本机loopback，默认端口3306，结果 `ECONNREFUSED` | 真实MySQL不可访问，P0-2继续待办；不外显主机/账号/密码 |
| DB初始化风险 | `server.ts:459-649` 的 `getMySQLPool()` 建连会自动执行建表/ALTER、`initializeImageAssetSchema()`，并在 `:618-632`尝试重新汇总历史订单金额/米数 | **禁止通过直接启动app来做只读审计**，会潜在改写业务库；须分离只读客户端 |
| 读DB脚本 | `scripts/product-master-v2-p0-inspect-readonly.sql` | 只含元数据SELECT，**文件未执行**；InnoDB的TABLE_ROWS仅估算，精确COUNT待隔离凭据核验 |
| **2026-10-12远程更正** | **MySQL位于远程Ubuntu服务器**，现有SSH密钥登录成功；远程MySQL **8.0.46**/PM2 online，`fabric_db` 实际SELECT正常，`/api/health`为`storage=mysql`，已核对真实表/索引/FK/精确行数 | 上述Windows本地3306拒绝仅是本机无服务，**无需本机安装MySQL**；见[SSH只读审计](product-master-v2-remote-db-audit.md)，P0-2可结项 |

开发工具侧本轮加载了 `fabric-product-master-v2`、`writing-plans`、`executing-plans` 和 `verification-before-completion`。这是工具可加载证据，不是独立Agent/生产测试的通过证据。

## 2. 代码责任图与精确风险

| 区域 | 现有代码/观察 | P1～P6处理方向 |
| --- | --- | --- |
| MySQL产品表 | `server.ts:550-578` 旧 `products`（`item_no,product_name,composition,weight,width`），`product_images`；`server/image-assets/schema.ts:106-127` `product_image_assets` FK指向旧 `products.id` | 保留旧表/旧ID/FK；优先兼容扩列而不是Drop+建同名表 |
| 产品其他引用 | `server/products/schema.ts:20-110` `product_pattern_tags`、`product_issues`、`product_import_sources` 均FK引用 `products`；`server/products/mysqlImportRepository.ts:100-119` 可回滚删除产品 | 各产品删除入口、历史产品导入回滚路径都须在V2引用保护上统一收口 |
| 关键DDL事故 | `server/products/schema.ts:5-18` 包含 `ADD COLUMN IF NOT EXISTS`、`ADD KEY IF NOT EXISTS`；`server/image-assets/schema.ts:127` 每次初始化会调用此函数 | 先用 `INFORMATION_SCHEMA` 判断列/索引；MySQL目标版本做空库、半完成、二次运行三种真实演练 |
| DDL旧单据 | `server.ts:506-546` `orders` 与 `order_items` 目前无 `created_by_user_id`、`product_id` 或明细来源标记 | 以加法方式补稳定ID归属及版本快照，禁止自动清洗/覆盖历史订单 |
| 删除链路 | `server/products/mysqlRepository.ts:157-166` 和 `server/image-assets/mysqlRepository.ts:568-582` 直接 `DELETE FROM products`（没有按三类保存单据校验引用） | 使用产品业务服务统一事务禁删，历史兼容删除入口不能绕过守卫 |
| 旧API路由 | `server.ts:1583+` 仍有旧产品CRUD及导出；`server/appAssembly.ts:43-80`、`server/image-assets/productServer.ts:17-40` 依据产品图片特性开关抢占相同 `/api/products` 路由 | 不可直接替换旧路由并假定只有一套API；先提供隔离V2路由/DTO，再显式切换调用方 |
| 认证 | `server.ts:67-162` 单管理员密码、进程内token；`server.ts:176-203` 产品principal为固定 `admin`；现有图片API仅检查登录，不检查角色 | 建立持久用户+会话、两个独立权限开关，所有新旧产品、媒体、导出、导入后台保护 |
| 搜索 | `server/products/routes.ts:56-72` 旧查询一个 `q`、tagMode='all'；`src/lib/products.ts:18-84` 同口径 | V2独立 `productNo`、`fabricName`，二者AND；题材和颜色各自OR、维度间AND，SQL后分页 |
| 图片归属 | `server/products/types.ts:1-47` 当前`pattern_original`是产品图片角色，单产品20图；`server/products/validation.ts:4-44` | 版本原图归配色，产品三类每类0～10，独立排序、统一保存、共享ref_count正确 |
| 订单业务 | `server.ts:768-800` 对克重/门幅强制数值与0；`server.ts:1138-1163` 更新时删全部明细重插，含历史手工行；`server.ts:903-1009` GET列表/详情有独立路径 | 保留原订单行真实身份；服务端核对旧行ID/来源，库内关联属性只读、订单快照保持原值，gsm/mm和空克重不伪造成0 |
| 打印 | `src/lib/documentPrintModel.ts`、`server/documentPrintAdapter.ts`、`server/documentExcel.ts` | 复用相同打印模型，保留sample/deposit/sales(bulk)业务栏位和运算，不因V2新增物理字段而变更输出结构 |

**特别注意**：旧 `order_items.product_no` 字符串不是稳定FK。仅凭相同货号无法准确判断历史单据一定关联哪条产品；一期不能自行回填/推断历史产品ID，也不能以此为由忽略V2保存后`order_items.product_id`引用禁删。

## 3. P0-3 历史兼容路线分析（已被v1.36新决定废弃，勿按本章A/B施工）
> **远程库的实际表名冲突：**`fabrics` 已存在但0条记录，其列包含订单号/金额等，**并不是V2面料主数据表**，不能直接占用。远程旧`products`有1,211条记录且被5个子表FK引用。建议在在线服务运行期间使用`v2_fabrics`、`v2_products`分别建设纯新表，业务切换之后再安全清退旧产品表；这不要求兼容旧产品数据，避免在开发期破坏在线服务。

### A. 优先：保留 `products` 并兼容扩列（建议进入P1验证）

- 原 `products.id` 保留，`product_image_assets`、`product_pattern_tags`、`product_issues`、历史导入来源原FK不失效；新 `pattern_masters`、`pattern_colorways`、`fabrics` 等独立表，`products` 增加 `pattern_colorway_id`、`fabric_id`、`v2_product_no`、`remark`、`is_active` 和必要版本号等字段。
- 新V2记录只存身份FK和自身备注、启用/时间；旧表必须填写的 `item_no` 使用后端生成货号以兼容旧约束；`product_name` 在老表仅保留兼容占位，新读模型通过JOIN面料取得**唯一真源**；不可把 `composition/weight/width`双写为新主数据。若旧路由仍可能读取新记录，必须选择**隔离读取/只读适配**而不是错误展示。
- `UNIQUE(pattern_colorway_id,fabric_id)` 保护V2组合；`v2_product_no` 唯一且只给V2记录写入，旧行NULL允许保留（正式DDL须核对字符集/collation及真实已有索引）。
- 优点：兼容现有多个FK和图片资产回收，改动相对局部；缺点：旧表里旧字段与V2字段共存，所有旧API/导出/删除都需排除/适配V2，需针对混合状态设Gate。

### B. 备选：独立 `v2_products` + 兼容桥

- 清晰的V2物理模型但不再直接共用现有 `product_image_assets.product_id → products.id` FK，所有旧/新图片、导入、导出、订单保存链需桥接或增新FK/新关联表；回收时容易出现双计数。
- 在确认原物理表不宜扩列、或旧产品与V2记录隔离需求远强于复用时再考虑；**不是**「新三库空库」即可直接跳选B。

**本次结论**：推荐A，仅作为技术提案；在 P0-2 取得实际 `INFORMATION_SCHEMA` 和**各表存在情况/字段/索引/FK/记录量**之后才冻结。不删除旧表、不迁移旧产品、不更新客户行、不自行调整旧编号。

### 路由切换建议（为避免覆盖现有同路径路由）

- P1～P3初期优先新增 **`/api/v2/pattern-masters`、`/api/v2/pattern-colorways`、`/api/v2/fabrics`、`/api/v2/products`、`/api/v2/tags`**；V2服务强制MySQL模式，不允许不可见的JSON降级假成功。
- 暂保留旧 `/api/products` 供历史界面使用并从V2入口隔离；明确迁移时机后才让三库页面及单据选品使用新的V2 API。两个路由都必须具备相应服务端权限和V2数据隔离，否则切换不安全。
- 实体/DTO优先冻结，具体URL前缀是**技术候选**，不是客户已确认UI或对外接口承诺；升级交接时不得在 `app.use('/api', exceptProductApi(...))` 后意外落入旧路由。
- 上线环境健康检查必须展示 `storage=mysql` 且能真实读写对应隔离业务API；HTTP 200与 `storage=json` 不足以通过P1/P7 Gate。
- 重要：现有 `/api/products/export` 的旧管理员约束仍待权限改造；不能因新V2路由已保护就允许旧导出绕开限制。

## 4. P0-5 可冻结的业务DTO字段（仅契约草案，未编码）

稳定内部关联与对象最小类型，字段名在P1实现前统一审查：

```ts
type Actor = { userId: number; role: 'admin' | 'sales';
  permissions: { manageOwnOrders: boolean; manageProducts: boolean } };
// server derives actor from session; client must not pass a trusted role

type PatternMasterDraft = { masterNo: string; topicTagIds: number[]; isActive: boolean };
type PatternColorwayDraft = {
  masterId: number; colorwayNo: number; patternImageAssetId?: string | null;
  colorTagIds: number[]; remark: string; isActive: boolean;
};
type FabricDraft = {
  fabricNo: string; fabricName: string; composition: string | null;
  weightValue: number | null; weightUnit: 'gsm' | 'mm' | null;
  widthValue: number | null; remark: string; isActive: boolean;
};
type ProductDraft = {
  patternColorwayId: number; fabricId: number; remark: string; isActive: boolean;
  images: Array<{ assetId: string; role: 'fabric_display' | 'detail' | 'ai_effect'; sortOrder: number }>;
};
type ProductListFilter = { productNo?: string; fabricName?: string;
  topicTagIds?: number[]; colorTagIds?: number[]; isActive?: boolean;
  limit: number; offset: number };
type LibraryOrderLineWrite = { productId: number; meters: number;
  unitPrice: number; remark?: string; /* existing doc-specific business fields */ };
type LegacyOrderLinePatch = { lineId: number; /* business fields ONLY */ };
```

注意：这是**候选请求字段**，不是鼓励全量PUT覆盖。更新优先PATCH或显式版本字段，服务端读取已保存原行；`colorwayNo` 正整数/身份唯一已定，但它是由用户输入还是后台连续分配仍待 R-23，接口将依据批准规则调整。面料克重有值须提供合法单位；缺省时值/单位均null，零不是「未知」。产品编号和完整花型编号都是响应派生字段，**不可由客户端自写入**。

### 4.1 事务行为与防绕过契约

| 动作 | 锁定/核验 | 失败语义 |
| --- | --- | --- |
| 创建配色 | 母版存在启用/有写权限；同母版数字序号唯一，R-23待批准分配方式；图片所有权 | 409重复、422非法序号 |
| 创建/改配色产品 | 按稳定ID确认存在、权限、启停，禁重组合、生成货号，按实际引用锁定组合 | 409重组合/身份被引用、422数据错误 |
| 删除产品 | 锁产品和关联/单据引用，在**任意已保存三类单据**有FK时409；无引用再安全解除图片关联 | 403无权、409引用、404不可见或不存在 |
| 管理图片 | 验证actor + 资产owner/可用性、分类分别0～10、无重复、排序规范，增/减真实引用计数 | 403或422、409并发 |
| 更新旧单据 | 锁订单与原行，scope本人; `legacy_manual` 只能基于数据库原行ID及未关联历史来源；库内快照服务端生成且只读 | 403/404越权；422伪造只读字段；409并发 |
| Excel面料提交 | preview只读；commit重校验文件哈希、预览规则、数据库并发冲突和actor；覆盖已有仅管理员显式批准 | 403、409预览过期或冲突、422错误行 |

全接口按 `401` 无凭据、`403` 已登录无动作权、`404` 无权发现非本人单据或不存在、`409` 业务冲突、`422` 参数不合法分类；服务端必须验证，并且客户端不可将产品库主数据字段夹带到单据业务字段更新里绕过。

## 5. 未批准业务与技术决策表

| 编号 | 当前状态 | 推荐处理 | 禁止提前固化 |
| --- | --- | --- | --- |
| R-23 / D-01 | **2026-10-12用户已确认** | 后端母版内正整数从1递增并持久计数、成功保存后任何版本永久锁号、删除不复用、取消草稿不占号，允许历史跳号 | 仍须FOR UPDATE/事务、回滚/并发与唯一约束实测；当前DDL未有next_colorway_no |
| R-04 / D-02 | **当前Stitch七页UI已获用户确认（2026-10-12）** | 按[最新七页ID登记](product-master-v2-stitch-design-review.md)作为前端交付基准；正式编码/修订时取远程最新HTML/截图/画布，保护产品12列和备注 | UI已批准≠React、API、权限或验收完成 |
| R-03 / D-03 | **2026-10-12用户已确认** | 同时支持.xlsx和.xls，标准七列、工作表/表头行选择、别名与人工映射、gsm/mm规范化、缺单位人工确认和cm门幅 | 技术需通过真实.xls解析样本和错误文件测试，不能把业务批准视为已实现 |
| D-04 | **业务选择已确认；技术清理尚待DB元数据** | 废弃旧产品库数据/API，V2原生三库及产品schema，无兼容扩列 | 受控清理旧产品专用FK及关联；不能删历史单据/客户/库存/共用图片 |

**2026-10-12 D-04 SSH补充：**已获得真实表/外键/准确计数证据；建议生产并行V2新表 `v2_fabrics`、`v2_products`；线上旧产品专用表清退计划必须处理1,008活跃图片关联的`ref_count`及默认回收生命周期，不能在未切换时删旧表。详情见[远程数据库审计](product-master-v2-remote-db-audit.md)。
| D-05 | **技术待设计定稿** | order_items加稳定product_id+快照可空规格+来源约束；先确保旧行ID不再被整表重建 | 不依靠客户端legacyManual标志 |
| R-13 | **性能环境待定** | 目标仍2,000条、常见查询P95≤1s，采样环境和分布需记录 | 不把静态SQL索引计划写成实测性能 |

以上为2026-10-12最新分项状态；**P0-4的D-01/D-02/D-03业务决策均已确认**，但P0-3清退/回退及P0-5契约等工程门槛仍开放。唯一需求基线见[需求v1.38](product-master-v2-requirements.md)。

## 6. P1 可开始的最小工程切片与Gate

**v1.36修订后的首个切片（此段优先于下列旧切片说明）**：将旧产品域路由、旧导入与 `server/products/schema.ts` 的失效DDL从当前启动链路解除，避免修补已经废弃的旧产品接口；新建V2原生schema及独立初始化契约，先做无副作用的单元测试；待MySQL可用并读出FK元数据后，在隔离库验证旧产品专用关联表的有序清退、图片引用保全和V2建表重复执行。下列旧切片只作为此前兼容方案的技术证据，不再决定实现路线。

**切片 P1-A：先修历史DDL幂等问题（无需固化R-23）。**

- **作用域**：`server/products/schema.ts` 和 `server/products/schema.test.ts`（必要时新增 `server/products/schemaIntrospection.ts`），隔离 `server/image-assets/schema.ts` 中通过image schema链路调用产品域DDL的耦合；`server.ts` 只允许整合负责人改。
- **接口候选**：`ensureColumn(connection, tableName, columnName, columnDdl)` 和 `ensureIndex(connection, tableName, indexName, indexDdl)`，允许使用受控白名单标识符，严格拒绝任意拼接；检查 `INFORMATION_SCHEMA.COLUMNS/STATISTICS` 再执行只含 `ADD COLUMN` / `ADD INDEX` 的ALTER，遇现有定义不匹配应**阻断**而非吞错。初始化步骤成功前不可标记schema ready。
- **TDD失败用例**：①旧SQL不能包含`ADD COLUMN IF NOT EXISTS`；②新库缺字段索引时分别创建；③已有全部字段索引无变更；④只缺索引/只缺某字段；⑤重复/中途断点重跑收敛；⑥不同字段定义检测并失败；⑦初始化异常时健康接口不冒充mysql；⑧保留已有旧表及数据。
- **真实MySQL Gate**：目标版本8.0.x、空库、旧表、半迁移三种隔离测试环境均通过，启动真实业务API返回预期；不能用mock记录SQL取代真实引擎验证。任何生产数据库 DDL/服务重启/发布独立授权。
- **重要补充**：`server.ts:618-632` 还有启动时订单汇总写操作；P1连通性/迁移测试必须使用隔离数据库/显式安全环境，生产迁移前应评估从启动流程移除或显式运维化旧数据修复。

**切片 P1-B**：在P0-2真实DB元数据确认及D-04确定后，新增四逻辑对象的表结构和最小只读关联查询，在隔离数据库建立 `1234`／`1234-1`／`S23`／`1234-1-S23` 测试链，验证唯一FK/启停/缺图片；开发前先锁权限actor接口，避免匿名V2写入。

**不能越过的Gate**：P1完整阶段仍依赖DB元数据、旧路由访问范围、角色权限边界和目标MySQL引擎实测。未获批准的配色自动分配、UI版式与Excel兼容范围不能在P1偷渡为事实。

## 7. 本轮实际验证与交付登记

- 本轮只读：Git、TypeScript/SQL源文件、API路由、脚本及环境键存在性；没有调用实际数据库、没有安装依赖、没有执行`npm run test:all`。
- 本轮新增：本P0技术记录、`scripts/product-master-v2-p0-inspect-readonly.sql`；同步README与P0～P7计划的状态说明；不改变需求批准状态。
- 下一次代码开发前：在可控MySQL 8测试实例安装/使用**只读客户端**执行元数据检查；保留检查日期、版本、环境类型、表存在情况、索引/外键及行数（不记录服务器连接密钥和业务明细）。**未取得数据前，P0-2保持未完成。**
