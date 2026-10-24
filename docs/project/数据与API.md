# V2 数据、API 与保护契约

> 技术定位与实现约束。当前业务以[项目需求](项目需求总览.md)为准，状态/未验以[项目现状](项目现状.md)为准；具体字段、接口参数和限值先查所列源码，不复制第二套 schema。

## 正式数据与装配

`server.ts` 仅调用 V2ProductionRuntime，目标配置不成立拒绝启动，不降级到 JSON 或旧 App。`v2ProductionTarget.ts` 固定并核验目标身份；不能把本次连接读到的 UUID 反过来当预置预期。正常启动只校验 schema，不擅自迁移或修复。

| 领域 | 当前代码依据 |
|---|---|
| 主数据表与结构契约 | server/product-master/schema.ts、schemaContract.ts、v2ProductionMigration.ts |
| 配色编号与迁移审查 | colorwayMigrationPreflight.ts、migrationLockRollbackPlan.ts；均在 server/product-master/ |
| 身份、会话、角色、owner | server/access/；成员DTO仅按当前接口，旧数据库授权列不是新业务开关 |
| 单据头、稳定明细及计算/输出 | server/order-v2/、src/lib/documentPrintModel.ts |
| 色卡、重印、扫码和人工选样 | server/customer-samples/；cardLibrary、scanRepository、sessionManual、sessionRead/Remove |
| 图片及公开分享 | server/image-assets/、server/customer-share/；引用与运维见[图片手册](../operations/image-asset-operations.md) |

## API 定位

正式业务通过 `server/product-master/v2ProductionHttp.ts` 装配，`v2CatalogAssembly.ts` 组合受认证的 V2 业务路由。主数据/单据/色卡/选样的具体方法与DTO取各领域Routes；公开分享由 `patternShareRuntime.ts` 单独装配受限投影。健康检查、匿名拒绝、旧API退役及静态资源合同需同时核对正式HTTP装配，不能按文件名或旧 `server.ts` 行号推断。

## 迁移与计数器

- 用真实 INFORMATION_SCHEMA 核列类型/可空、联合唯一顺序、FK/RESTRICT 和关键CHECK；fresh CREATE不能证明旧库已升级，缺列/漂移必须拒绝，禁止自动ALTER/REPAIR。
- 实际库名与DDL使用同一物理连接并始终释放；独立预置预期服务器身份，所有根连接/池/专用连接分别核验。隔离写测仍要求固定新空库、ACK和明确授权，不能沿用旧测试库名直接运行。
- 已保存数字配色永久锁号、删除不复用；持久计数器严格大于现存最大值，十进制大整数不得经不安全浮点转换。缺计数列或不认识的版本不能由CREATE IF NOT EXISTS掩盖；不自动修复历史计数。
- 离线迁移/锁回滚计划仅为 `executable:false` 审查合同。MySQL DDL隐式提交，事务ROLLBACK不能代替备份/异库恢复及前滚/回退；真实锁、并发、恢复和生产迁移分别验收。

## 单据事务与输出

- 锁当前有效用户/会话、订单owner和原行，在同一事务提交表头、明细、金额及关联；失败整笔回滚。按id AND order_id窄更新，原行ID保持，只有显式removeIds才删除，漏传不等于删除，不全删重插。
- 历史owner、产品来源及NULL快照原样保留，不猜测归属或伪造来源。管理员显式手工例外与旧合法手工行由服务器根据持久记录判断；不信任客户端legacyManual、owner或产品快照。
- 新选/更换产品由服务端重查当前有效关联后冻结产品和交易资料；取消只退出草稿。公司/条款/收款媒体等展示取当前统一设置，缺配置明确失败，不能从旧displaySnapshot静默补回。产品行冻结与公司展示是两种语义。
- 共享计算和打印模型服务保存、预览及XLSX；sales/bulk映射和样布/定金/销售各自金额含义按当前模型，不能把deposit一律当同一种单位。货币按整数分舍入，旧列长度/DECIMAL精度不足时拒绝而非截断；原值保护需逐原列比较，结构变化后不只比整表CHECKSUM。
- 列表、统计Top5/最近4单和导出共用服务端owner/日期范围，不从当前产品重写历史品名；不接受客户端owner，非法数值整份失败而非部分成功。SQL替身不证明真实BIGINT、日期、排序、性能或隔离。

## 色卡、扫码与选样

- 有效色卡身份、不可逆退役、新建新ID/新码、同事务撤令牌及历史FK共同保护旧来源；重建不复活旧码。重印用revision/CAS，旧确认不能清掉更新的待印提醒，不恢复已取消供样维护界面。
- 扫码锁与复核顺序不能由JOIN FOR UPDATE猜测：母版→面料→卡主键→按card_id读token，逐步重验退役、撤码、身份与当前关联；真实两连接InnoDB仍需验证，不能由替身断言无死锁。
- 人工补选只收当前卡及可选产品子集；非法/越卡/失效子集整笔拒绝，不恢复裸productId入口。整卡和子集同事务去重，软移除后恢复原行/来源；人工事件不伪造扫码，首次来源关联不改指。
- 选样展示读取当前主数据，保留选择事实和原卡来源；删除卡仅显示已失效，不删除已选产品。新主数据不自动增减已选集合，仍需主动重扫/补选；不引入已取消的寄样/跟进独立流程。
- 私有登录/会话授权、公开token许可和图片二次授权各自校验；公开字段白名单不暴露客户、价格、内部二维码或其它未获许可内容。

以上约束承接已替代的P0/P1/P2/P6及B2/B3阶段记录；原日期的计数、测试数字、环境及失败输出只在[恢复包](../maintenance/文档整合与恢复.md)追溯。迁移/恢复、真实权限、COS、微信扫码和实体输出的开放Gate仍只在项目现状维护，归档不构成签收。
