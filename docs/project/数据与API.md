# V2 数据、API 与保护契约

三类单据（DOC-01 / AC-127）：GET /api/v2/documents/:id 返回服务端已保存业务内容的revision；PATCH同路径必传expectedRevision（64位小写SHA256）。服务端保留客户→单据锁顺序，单头、明细和关联均使用当前锁定读计算版本，避免已有REPEATABLE READ快照绕过校验。缺失/格式无效400，内容已变409，冲突事务回滚，客户端保留草稿；新建/复制不沿用旧单版本，成功回读返回新标识，原幂等重试维持有效。当前客户名称与全局公司展示资料不改变原单内容标识。人工补选POST /api/v2/customer-samples/sessions/:id/items/manual必须带cardId和明确非空productIds，不接受缺省整卡。

> 技术定位与实现约束。当前业务以[项目需求](项目需求总览.md)为准，状态/未验以[项目现状](项目现状.md)为准；具体字段、接口参数和限值先查所列源码，不复制第二套 schema。

## 正式数据与装配

`GET /api/v2/documents/:id/print-model?preview=1` 只为有权读取的样布码单追加 `patternThumbnailAssetIds`，顺序对应同一已读单据的明细行。按已保存的库内产品 ID 读取配色图资产，缺失返回 `null`，前端沿用受控缩略图签名，资产编号仅供屏幕预览。无参数的打印模型和各下载输出不带该字段。销售发货码单仅解析 Logo，单据收款码资源返回 404。

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

## 花型厘米尺寸

PAT-08：`pattern_masters.width_cm/height_cm` 使用可空 `DECIMAL(12,4)`，同母版只存一组。`patternMasters.ts` 的新增/更新复用 `src/lib/patternDimensions.ts` 校验成对正数或成对null；省略两字段保留原值。`pattern-catalog` 在母版DTO返回 `widthCm/heightCm`，`colorway-details` 同时读取母版最新尺寸；现有受认证主数据权限沿用，配色和产品身份不变，公开分享投影不增加字段。前端新增和编辑复用尺寸输入，列表在母版编号下显示一次；尺寸保存立即使旧列表请求失效，再重查，防止旧响应覆盖新值。

增量结构见 `server/product-master/patternDimensionsSchema.ts`，启动仅核验、不自动DDL；迁移ID `20261030-pattern-dimensions` 在发布迁移注册表中对应 `pattern-dimensions`。一次性操作入口 `scripts/import-pattern-dimensions.ts`：prepare按原表的`old/w_cm/h_cm`与人工确认表生成计划并绑定两份源文件SHA；inspect只读核对当前母版；rehearse只允许命名隔离库；apply要求预置库名/UUID、实际备份文件SHA及计划SHA。冲突必须全部人工核准；导入锁定当前未删母版、拒绝缺失/重复及已有不同值，整批事务内提交前回读；相同计划重跑仅核对、不重写。MySQL DDL隐式提交，先备份并同备份隔离恢复演练；业务数据导入回滚与DDL恢复分别处理，禁止用生产业务记录做测试。

## 模特图库图片替换

MODEL-01：有图库编辑权限的用户通过 `PATCH /api/v2/models/:id` 传入新图 `assetId` 和编辑时的 `expectedAssetId`。省略的资料字段保留当前值。事务锁定模特记录并校验旧图，检查新图已就绪且可关联，再在同一事务内更新图片和引用计数。编号、记录 ID 和导入排序不变。旧图只有在引用归零后才进入回收期。旧图已被其他操作替换或新图已关联其他模特时返回 409，无需迁移。

## 换装素材包契约

MODEL-03/04：`ProductTryOnDialog.tsx` 在本次弹窗维护显式目标及编辑草稿，`modelGalleryClient.ts#createTryOnPrompt` 只按调用方提供的 `TryOnTarget` 生成提示词，不从M编号或图库分类推断。部位及草稿不写入图库或产品表，无新增接口、DDL及权限。原图仍由受认证同源 `/api/image-assets/:id/content?variant=original` 读取。

ZIP包含 `01-{花型配色号}-pattern.*`、`02-{花型配色号}-{模特号}-model.*`、`03-prompt.txt`、`04-data.json`。默认提示词引用相同图片文件名主干，扩展名按原图字节识别。JSON增加 `targetGarment`（`dress/top/skirt/pants/set/other`）、`targetDescription`（去除首尾空白的操作者说明）、`prompt`（与文本文件/复制的最终编辑文字一致）；原有产品/模特编号、整图厘米尺寸、比例、参考长度不变。素材只在浏览器打包，不导出访问URL、签名或凭证。生成与真实图片质量验收仍在操作者的ChatGPT流程中完成。

## 关联产品查询

PRD-08 / AC-161：`pattern-catalog` 的 `productCount` 由服务端按母版全部配色对应的现存产品统计；面料列表沿用 `productCount`。内部弹窗复用受认证的 `GET /api/v2/products`，按 `masterId` 或 `fabricId`、`status=all`、`limit=20` 和 `offset` 查询；编号过滤与总数均在服务端分页前执行。产品DTO补充 `fabricRemark`（当前面料备注），与产品自身 `remark` 分开。此变更只读，不需要数据库迁移，不扩大公开分享投影。

## 迁移与计数器

- 用真实 INFORMATION_SCHEMA 核列类型/可空、联合唯一顺序、FK/RESTRICT 和关键CHECK；fresh CREATE不能证明旧库已升级，缺列/漂移必须拒绝，禁止自动ALTER/REPAIR。
- 实际库名与DDL使用同一物理连接并始终释放；独立预置预期服务器身份，所有根连接/池/专用连接分别核验。隔离写测仍要求固定新空库、ACK和明确授权，不能沿用旧测试库名直接运行。
- 已保存数字配色永久锁号、删除不复用；持久计数器严格大于现存最大值，十进制大整数不得经不安全浮点转换。缺计数列或不认识的版本不能由CREATE IF NOT EXISTS掩盖；不自动修复历史计数。
- 离线迁移/锁回滚计划仅为 `executable:false` 审查合同。MySQL DDL隐式提交，事务ROLLBACK不能代替备份/异库恢复及前滚/回退；真实锁、并发、恢复和生产迁移分别验收。

## 单据事务与输出

- 锁当前有效用户/会话、订单owner和原行，在同一事务提交表头、明细、金额及关联；失败整笔回滚。按id AND order_id窄更新，原行ID保持，只有显式removeIds才删除，漏传不等于删除，不全删重插。
- 历史owner、产品来源及NULL快照原样保留，不猜测归属或伪造来源。管理员显式手工例外与旧合法手工行由服务器根据持久记录判断；不信任客户端legacyManual、owner或产品快照。
- 新选/更换产品由服务端重查当前有效关联后冻结产品和交易资料；取消只退出草稿。公司、联系与收款媒体展示取当前统一设置；本单条款按保存内容，清空不回填，后续全局设置不覆盖本单条款；签字栏按当前需求固定展示。缺配置明确失败，不从旧displaySnapshot静默补回。产品行冻结与公司展示是两种语义。
- 共享计算和打印模型服务保存、预览及XLSX；sales/bulk映射和样布/定金/销售各自金额含义按当前模型，不能把deposit一律当同一种单位。货币按整数分舍入，旧列长度/DECIMAL精度不足时拒绝而非截断；原值保护需逐原列比较，结构变化后不只比整表CHECKSUM。
- 列表、统计Top5/最近4单和导出共用服务端owner/日期范围，不从当前产品重写历史品名；不接受客户端owner，非法数值整份失败而非部分成功。SQL替身不证明真实BIGINT、日期、排序、性能或隔离。

## 色卡公开分享的独立安全边界

色卡公开分享和内部员工实体扫码保留不同身份与令牌体系。公开 /c/ 链接绑定不可变的色卡ID，不复用内部二维码；实体扫码原网址仍是 #/samples?scan=...，首次无用途偏好显示“查看色卡/员工选样”，同浏览器可记住用途并切换，偏好不等于登录。查看色卡无需登录，经只读 GET /api/public/card-scans/:token 及 /:token/images/:ref 服务端逐次验证实体码哈希、撤销/退役状态、母版面料组合以及产品与图片归属，沿用 /c/ 公开数据白名单，不泄露内部二维码、客户和价格，也无需先签发分享链接；员工继续执行账号登录、首扫选客户、连续扫码入当前单，不根据使用偏好自动关联历史客户。重复分享同一有效色卡可复用稳定链接，删除旧卡后即使同组合新建也必须获得新链接，旧链接不得复活。对外只展示当前色卡母版与面料**两项同时匹配**的现行产品及各配色三类媒体；新增同组合产品可动态出现，缺图不得用另一配色的图填补。每次公开数据和图片读取重新检查色卡、授权发布、关联与令牌，不能凭前端过滤限制范围；旧单品链接不静默扩权。具体实现以 server/customer-share/、当前需求和测试为准，已取消的分享撤回/到期设置不恢复。

## 色卡、扫码与选样

- 选样目录按创建时间及ID倒序，返回现有createdOn和新增createdAt（UTC ISO，界面按上海时区显示日期）、selectedCardCount（当前有选配色的来源卡数）和 selectedProductCount（当前未移除的产品款数）；以 created_at、id 倒序分页，默认20单/页，客户搜索在服务端全量授权范围内筛选；新增选样单日均5～10条、年约1800～3650条，不向前端一次返回历史全量，排序与用户授权访问通过索引优化；无数据迁移。同一客户重复新建始终为独立单。
- GET /api/v2/products 新增可选sort=numberAsc|numberDesc，缺省保留原默认顺序；按母版数字、配色数字、产品ID排序后LIMIT/OFFSET，不用面料后缀作排序键。GET /api/v2/sample-cards 接受sort=newest|numberAsc|numberDesc，按母版数字及卡ID排序，缺省仍新增时间倒序；花型原numberAsc/numberDesc沿用。排序值严格白名单、重复/未知值拒绝，不影响导出字段或现有编号。
- DELETE /api/v2/customers/:id 在客户FOR UPDATE及版本检查后重新统计未删除选样；有记录返回409 {code:"customer_has_selections",selectionCount:N,error:先删选样提示}，审计/客户/选样均不写入。创建选样同样取得客户更新锁，与删除串行；GET deletion-info仍提供确认前数量，不替代DELETE实时校验。所有选样已逻辑删除时才可删客户，保留已存三类单据及所有原始历史。
- 客户profile.region字段和100字符上限保留，仅表单/详情文案改为“详细地址”；旧值读写不转换、不清空，无新增DB列或迁移。
- 已授权的选样列表与单单读取通过 `customerReference` 返回展示名称，列表在服务端按同一口径筛选后分页。关联的有效档案用当前名称，未关联及已删除/旧归档档案回退到 `customer_sample_sessions.customer_reference`。客户档案业务历史中的选样摘要沿用同一口径，原始快照与受控关联的版本比较字段保留。
- PATCH /api/v2/customers/:id 在鉴权与行版本校验后，于同一事务内校对变更后的名称。其他有效档案已使用该名称时返回 409 `customer_name_taken`，不返回匹配档案信息，前端保留草稿并显示专用提示。
- GET /api/v2/customer-samples/sessions 的摘要以 canManage 控制编辑、canDelete 控制独立删除；后者按当前管理员/客户负责人/编辑授权判定，不受客户 deletedAt 或旧 archived_at 限制。摘要 contactName 仅返回有权查看的本单联系人姓名快照，未关联或未指定为 null，客户端兼容旧响应缺字段。DELETE /api/v2/customer-samples/sessions/:sessionId 在有效登录、客户/授权共享锁、链接一致性及选样更新锁内复核同一删除权限，仅写选样删除标记和最小审计；不恢复客户、不删除明细/反馈，审计失败回滚。普通编辑写入口继续拒绝已删/归档客户，仅查看授权不能删除，未关联客户仍复核旧显式选样管理grant。
- GET /api/v2/customer-samples/sessions/:sessionId/cards/export.xlsx：不接收客户端卡ID，当前登录及该选样单读取权限复核后，在同一只读事务由有效选择项的扫码/人工来源求卡集合，去重后调用选样共用的 buildSelectionCardsWorkbook。旧已结束且未删除的选样单可读取导出；空集、卡失效/撤码整笔409，不静默漏导；响应no-store且不经JSON暴露二维码；单个和批量导出共用 V2-13 十列模板，选样日期从创建时间戳按北京时间生成。

- 内部聚焦扫码流程复用客户原子建档＋选样、`POST /api/v2/sample-cards/scan`、选样详情和移除/人工补选接口。`GET /api/v2/customer-samples/sessions/:sessionId/cards?selected=true` 仅列该已授权会话曾加入的有效卡（含当前全未选卡），不返回二维码；不传该参数保持原搜索语义，只接受字面量 `true`。重扫将已移除行视为已处理身份而不恢复；显式勾选复用人工补选恢复同一行，单项移除复用幂等DELETE。卡退役后仍按原来源保留已选产品。无需新增业务表；历史 closed 状态兼容为可继续增删补选，取消状态切换 API/按钮，鉴权仍复核登录、客户归属及删除标记；新增数据库索引在正式旧库须单独迁移验证，不由运行时自动DDL。

- 产品单建/批建/身份修改在原认证事务内自动保证母版＋面料的唯一有效卡。写入按排序后的母版→面料→组内全部配色→产品→色卡/令牌顺序加锁；图片变更前先按ID锁组内配色以避免共享图片与配色编辑的锁环；新增配色复用原卡，身份修改同时核对两侧，删除最后产品同事务作废旧卡及内部令牌，历史来源行不改写。公开读取逐次检查卡作废状态，故旧分享立即失效。独立删卡遇产品返回409及数量；手动建卡API仅兼容已有产品组合，不允许空卡。
- 已有产品补卡是显式数据操作：先只读盘点，核对数据库身份和可恢复备份后再执行；使用登记迁移 `product-auto-cards`，不在应用启动时执行、不改产品/图片、重复执行仍补齐后来缺卡的组合并复用有效卡，已退役卡永不恢复。统一发布器在旧服务切换前执行一次，新后端重启及认证读取成功后、切换首页前再次补齐并核对缺卡为0，保留两次独立日志。

- 有效色卡身份、不可逆退役、新建新ID/新码、同事务撤令牌及历史FK共同保护旧来源；重建不复活旧码。重印用revision/CAS，旧确认不能清掉更新的待印提醒，不恢复已取消供样维护界面。
- 扫码锁与复核顺序不能由JOIN FOR UPDATE猜测：母版→面料→卡主键→按card_id读token，逐步重验退役、撤码、身份与当前关联；真实两连接InnoDB仍需验证，不能由替身断言无死锁。
- 人工补选只收当前卡及可选产品子集；非法/越卡/失效子集整笔拒绝，不恢复裸productId入口。整卡和子集同事务去重，软移除后恢复原行/来源；人工事件不伪造扫码，首次来源关联不改指。
- 选样展示读取当前主数据，保留选择事实和原卡来源；删除卡仅显示已失效，不删除已选产品。新主数据不自动增减已选集合，仍需主动重扫/补选；不引入已取消的寄样/跟进独立流程。
- 私有登录/会话授权、公开token许可和图片二次授权各自校验；公开字段白名单不暴露客户、价格、内部二维码或其它未获许可内容。

以上约束承接已替代的P0/P1/P2/P6及B2/B3阶段记录；原日期的计数、测试数字、环境及失败输出只在[恢复包](../maintenance/文档整合与恢复.md)追溯。迁移/恢复、真实权限、COS、微信扫码和实体输出的开放Gate仍只在项目现状维护，归档不构成签收。

- 色卡库内部列表 `GET /api/v2/sample-cards?includeColorways=true` 可在既有鉴权后，为当前分页卡ID一次批量附带 `colorways[{productId,colorwayNo,patternImageAssetId}]`；按卡母版及面料共同匹配，不返回原图URL，不改变二维码/导出字段。缺省不附带，非布尔字面量参数拒绝；无需DDL。选样明细复用原100款分页读取接口取齐并核对单ID、总数及稳定条目，再按实际卡ID每20卡分页；普通选样首页仍严格服务端20单分页。人工补选复用会话私有 cards 查询，扫码复用内部 resolve；私有会话 404 仍清理访问。

- 选样明细授权读取在既有session投影中返回真实 `createdAt`（数据库created_at经UNIX_TIMESTAMP转换），供所有明细入口复用客户与上海日期命名Excel；不以当前日期补造。页内导出仍调用原整单六列接口，不传待移除勾选或分页范围，不新增业务写入/DDL。

- 选样明细内部hash路由为 `#/samples?sessionId=<单ID>`；地址仅携带身份，刷新调用既有私有 `GET /api/v2/customer-samples/sessions/:id?limit=1&offset=0` 重新校验会话后加载明细，不持久化客户内容，不新增API/DDL。缩略图仍用 `/api/image-assets/access-urls` 的 thumbnail 变体；客户端保留HTTP状态用于区分401、单资产403/404/409与瞬时错误，签名接口及存储权限不放宽。

- 选样联系人（V2-09 / AC-163、AC-164）：选择已有客户时，POST customers/with-sample-session 可带 contactChoice（档案内联系人索引和档案版本），服务端锁内绑定当前档案的稳定联系人 ID 并保存姓名备用值；也可改传 `newContact:{customerVersion,contact:{name,phone?,wechat?,address?}}`，锁内复核编辑权限及档案版本，追加联系人并绑定本单，和建单使用同一幂等事务。`GET /customers?query=…&preferExactName=true` 在授权范围内优先返回精确同名档案并返回 `exactNameMatch`；客户创建和更名在锁内拦截有效档案重名。联系人 JSON 的 `address` 可空或缺省，缺省沿用客户 `region`，无需列变更。客户档案保存后同步同一联系人名，已移除联系人保留历史名。GET /customer-samples/sessions/:id/contact 为可编辑且已关联客户的选样返回候选姓名、档案版本、关联版本及本单姓名；PATCH 同路径核对关联版本与选择，清除时 choice 为 null，只改本单姓名并递增关联版本。快照保存于 customer_sample_sessions.contact_name；sample-contact 登记迁移只增加可空列，旧单不回填，列表搜索与详情在同一授权范围内读取。
- POST /api/v2/customer-samples/sessions/cards/batch-export.xlsx 接收 sessionIds（1～50 个去重后的显式单号）。逐单鉴权及核对后返回一张汇总工作表，阻断时不发部分文件；BATCH_SELECTION_BLOCKED 指明有权访问的空单或待核对单。
- POST /api/v2/customer-samples/sessions/preparation（V2-16 / AC-177）：只接收 `{sessionIds:string[]}`（1～50个不同有效ID）；整批账号/客户/单据读取权限锁定后，在同一只读事务核对当前有效卡并汇总完整已选项。返回 `{rows:[{productId,cardId,cardNo,patternNo,patternImageAssetId,quantity,recipients:[{customerName,contactName}]}]}`，不返回二维码、原图地址、内部联系人标识或额外客户字段；客户端仅签名可见页去重后的thumbnail。按稳定客户/联系人聚合，旧无ID姓名仅在当前授权档案中唯一匹配时做本次只读身份归并，无业务写入或新迁移。无权返回403/404，空单及待核对关联沿用409 `BATCH_SELECTION_BLOCKED`（sessionId/reason），失败整批无结果，响应no-store。
- 选样导出核对实现约定（V2-13 / AC-176，已编码、待最终验收）：GET sessions/:id/cards/review 返回当前有效卡集合、逐项差异、快照及可编辑性；POST 同路径只接收当前快照和明确勾选的稳定选样条目ID，事务内重验后记录本单确认，保留历史来源及配色集合。customer_sample_sessions新增可空JSON card_review保存逐项当前卡指纹，采用独立sample-card-review登记迁移和只读启动检查，不在生产自动建列。GET export.xlsx逐次重新校验，未确认差异返回结构化409核对结果，不生成半份文件；最终仍复用原六列Workbook。首页/明细共用一个核对弹窗及下载流程；先完成服务端判定/确认/导出及事务测试，再接两处UI并覆盖取消、失败、只读、窄屏及并发变更。
