# 色卡级花型产品分享实施计划

> 2026-10-24 目录整理：本文部分历史路径对应的临时文件、已退役源码副本或旧发布证据已完整迁至仓库外；原路径作为历史定位保留，按[归档恢复索引](../../maintenance/2026-10-24-workspace-archives.json)中的范围和逐文件 SHA256 查找原件。未完成的业务 Gate 仍按当前进度保留。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution or superpowers:subagent-driven-development if the user selects delegated execution. Steps use checkbox syntax for tracking.

**Goal:** 将新分享入口从产品库移至色卡库，让客户通过独立稳定链接查看该卡所有有效配色产品的三类图片。

**Architecture:** 新增色卡发布记录，沿用现有令牌、只读展示和受控展示图流程。目录与每次图片读取都限定色卡的母版ID＋面料ID；旧单品、母版链接保持原范围。用户已确认计划并选择直接执行，本地实现与检查完成，迁移与发布分别验收。

**Tech Stack:** 现有React/TypeScript、Express、MySQL8、node:test；不新增依赖。

**Spec:** [已确认书面设计](../specs/2026-10-20-card-product-sharing-design.md)；[唯一需求](../../product-master/product-master-v2-requirements.md)1.5、9.1.7、AC-110～115。用户于2026-10-20 16:21（北京时间）确认设计。

## Global Constraints

- 新分享仅含同一母版ID并且同一面料ID的已建产品；产品、配色、母版、面料均须启用。供样开关不决定公开展示。
- 每个配色分别展示面料大图、细节图、效果图及完整产品货号；每类0～10张，缺图留空，图片延迟加载和点击放大。
- 不显示价格、成本、原图下载、内部备注、客户资料、数据库ID、图片资产ID及内部色卡二维码令牌。
- `/c/:token`与旧`/s/`、`/p/`独立；公开分享不得复用`qr_payload`。旧链接不扩容、不重定向。
- 色卡停用暂不可用，恢复可用；删除后原链接永久失效，同组合新卡使用新ID、新链接。
- 管理员/业务员签发时现场复核有效账号/会话；公开JSON与每次图片读取均复核范围和生命周期。
- 正常启动只读检查schema；只生成受控迁移入口，不自动迁移或部署，不改既有业务记录及旧发布证据。

## Review Focus

1. 同母版另一面料、同面料另一母版及兄弟配色的图片不得串入；任务2用真实SQL语义及HTTP验证。
2. 读取图片期间删卡、停用或改关联，读取结束不能返回已经失权的内容；任务2设置受控异步边界验证。
3. 停用恢复与删除重建不同：前者恢复原链接，后者旧链接永不复活；任务1/2覆盖同编号不同卡ID。
4. 首个配色无图、后续配色有图，客户仍能看到全部配色及三类独立占位；任务3覆盖实际组件。
5. 缺少新表、并发签发、响应丢失与无效迁移锁不可破坏旧分享或留下不确定连接；任务1/3分别验证。

---

### Task 1: 色卡发布身份、签发与迁移合同

**Files:**
- Create: `server/customer-share/cardSharing.ts`、`cardLinkSchemaContract.ts`、`cardShareMigration.ts`。
- Test: 对应三个`.test.ts`文件，沿用现有productSharing、productLinkSchemaContract及productShareMigration的测试模式。

**Interfaces:**
- Consumes: 现有`PatternShareLinkPool`、`AppPrincipal`、`hashPatternLinkToken`、配置的32字节密钥及公开HTTPS源。
- Produces: `deriveCardShareToken(cardId:unknown,secret:unknown):string`；`resolveCardShare(db,token):Promise<CardShare|null>`；`createCardShareIssueRouter({authDb,pool,secret,publicBase})`。
- `CardShare`内部包含`cardId/masterId/fabricId/cardNo/available`；公开响应不透出这些内部ID。
- Produces: `CARD_SHARE_SQL`；`verifyCardLinkRuntimeSchema(pool,{database,serverUuid}):Promise<void>`；`migrateCardShareLinks(pool,target,backupSha256,confirmation)`。

- [x] **1.1 编写并观察失败测试。** 稳定token为43字符，卡18重复签发相同、卡19不同，且与同ID的产品/母版token不同；匿名签发401、伪造body/query400、停用账号/会话无写入；首次201、复用200、并发最终仅一条发布记录。
- [x] **1.2 实现身份与私有签发。** 新表`card_share_links`含`card_id`和`token_hash`独立唯一键，同库外键关联`sample_cards.id`。POST `/sample-cards/:cardId/share`仅接受空JSON。事务锁顺序为账号/会话、母版、面料、卡、分享记录；现场验证卡未删除且父记录启用，禁止客户端指定展示范围。
- [x] **1.3 编写并观察迁移负向测试。** 缺表、错误数据库/UUID、跨库外键、前缀唯一索引、错误类型与撤销状态全部拒绝；迁移无确认/备份摘要不发DDL，GET_LOCK响应不确定销毁连接，RELEASE_LOCK失败不得归还连接池。
- [x] **1.4 实现只读合同和受控迁移。** 沿用现有operator-only迁移模板，迁移ID`20261020-card-share`、确认串`APPLY_CARD_SHARE`、同一物理连接持锁与验表，迁移账本记录计划摘要。重复执行不修改既有发布数据；正常启动不执行DDL。
- [x] **1.5 运行上述三份测试及原产品分享/迁移回归。** 预期新增用例通过，原产品和母版的稳定token及schema行为保持。

### Task 2: 精确色卡目录、公开JSON与图片权限

**Files:**
- Modify: `server/customer-share/patternShareCatalog.ts`。
- Create: `server/customer-share/cardShareCatalog.ts`、`cardPublicRoutes.ts`及对应`.test.ts`。
- Test: `server/customer-share/patternShareCatalog.test.ts`和旧公开JSON/媒体回归。

**Interfaces:**
- Consumes: 任务1的`resolveCardShare`；既有图片服务`readContent(id,'display',context)`；原目录加载器。
- Extend: `loadPatternShareCatalog(db,masterId,secret,productId?,fabricId?)`，两种范围参数互斥；旧调用结果保持。产品和图片SQL必须同时限定母版＋面料，排除空配色，不装入设计原图。
- Produces: `loadCardShareCatalog(db,share,secret)`，输出公开`card`摘要和受控`previews`映射；每个公开配色为`{colorwayNo,productNo,displayImages,detailImages,effectImages}`。
- `PublicCard`公开摘要为`{cardNo,fabricNo,fabricName,composition,weightValue,weightUnit,widthCm,colorways}`；成分/规格可空，单位仅`gsm/mm/null`；三类图片成员仅含既有格式的`previewRef`。JSON成功为`{available:true,card}`，不可用为`{available:false,message:'暂不可用'}`。
- Produces: `createPublicCardRouter({db,load,readDisplay})`，挂载`/api/public/cards`；不接受客户端范围覆盖参数。

- [x] **2.1 编写并观察失败测试。** 同卡两配色、同母版另一面料、另一母版同面料同时存在，JSON和图片仅包含本卡两产品；实际SQL使用隔离内存数据库验证过滤语义，MySQL专有锁/DDL不以其代替。
- [x] **2.2 扩展目录加载并实现色卡公开投影。** 使用存储的产品货号及当前面料规格，按数字配色排序；逐款三类图最多10张，缺图留空。公开对象按白名单重建，内部ID和资产信息只留服务器。
- [x] **2.3 编写并观察HTTP失效测试。** 未签发token、篡改ref、另一卡图片、scope查询参数均拒绝；图片读取过程中删卡/停用/移除图片，最终404且不返回字节。零产品暂不可用；新增第三配色自动出现，停用某配色只隐藏该配色，删除重建不能恢复旧链接。
- [x] **2.4 实现公开JSON及图片路由。** 每次解析发布记录和卡/父状态；加载目录后再复核身份及范围。图片读完后重查当前映射，不只依赖首次校验；沿用no-store、no-referrer和现有展示图MIME/大小限制。
- [x] **2.5 运行新目录/HTTP测试和旧`/s/`、`/p/`回归。** 单品仍只含一款，旧母版仍按旧范围，不能因新参数扩大旧链接。

### Task 3: 色卡入口、客户多配色展示及运行时接线

**Files:**
- Create: `src/components/customer-share/CardShareDialog.tsx`、`PublicCardGallery.tsx`及`.test.ts`。
- Modify: `SampleCardTable.tsx`、`SampleCardLibraryV2.tsx`、`V2App.tsx`、`useV2Company.ts`、`publicPatternClient.ts`、`PublicPatternPage.tsx`、`src/App.tsx`。
- Modify: `server/customer-share/patternShareRuntime.ts`、`server/product-master/v2ProductionRuntime.ts`、`server/frontendStatic.ts`及相关测试。

**Interfaces:**
- Consumes: 任务1/2的签发和公开路由；既有`copyPatternShareLink`、`PublicProductImage`、原生dialog与离开保护模式。
- Produces: `CardShareDialog({card:{id,cardNo},apiFetch,onClose})`；`PublicCardGallery({card:PublicCard|null,renderPreview})`；客户端`parsePublicCardResponse(raw:unknown):PublicCard|null`和严格的`/c/`链接/图片路径解析。
- Runtime adds: `cardsEnabled`、`cardPublicRouter`；私有能力接口返回新布尔值，新表合同未通过仅`cardsEnabled=false`。

- [x] **3.1 编写并观察组件失败测试。** 色卡操作有分享、产品实际入口无分享；复制链接/预览/失败重试正常；窗口Esc空闲可关闭，busy受保护，文件子事件不冒充关闭，晚响应不覆盖已关闭窗口。
- [x] **3.2 移动实际入口。** V2App移除产品分享回调，色卡列表注入分享回调及弹窗；能力读取用`cardsEnabled`。保留旧产品公开组件/API用于兼容，不把旧链接重定向。生产能力为false时不展示不可用的新入口。
- [x] **3.3 编写并观察客户展示测试。** 两配色完整呈现，各有三类标题/数量；首配色空图不隐藏下一配色；规格未知保留空值。点击各类图使用原大图组件，关闭返回焦点；严格拒绝伪造公开DTO和外域/错误类型链接。
- [x] **3.4 实现多配色页面与`/c/`接线。** 页头显示卡号和面料规格，按配色分区展示完整产品货号及三类图；懒加载、缺图占位，不增加设计原图或任何内部资料。
- [x] **3.5 接运行时与静态入口并测试降级。** 新表缺失仅关闭新分享；旧分享与登录/三库仍可用，公开静态路由只接受43字符token，后端bundle及环境文件继续404；现有内部扫码链接保持。
- [ ] **3.6 本机交互验收。** 用合成多配色数据核对宽/窄屏、复制、预览和大图；工具不可用时记录边界，不以SSR/模拟接口冒充浏览器或微信实机通过。

### Task 4: 全量核验与交付证据

**Files:**
- Update: 需求/进度/本设计及本计划状态，独立新源码清单与主目录活动指针。
- Evidence: `artifacts/card-product-share-20261020/`；保留已有导入修复和正式发布证据。

- [x] **4.1 自查需求映射并独立代码审查。** 逐项对照AC-110～115；重点检查双ID范围、图片读后撤权、卡删除重建、缺表降级、旧链接范围。修复实质问题后复跑受影响测试。
- [x] **4.2 冻结代码并串行运行。** `npm run test:unit`、`npm run lint`、`npm run build`、`npm run test:security`、`npm run test:image-assets:smoke`、交付脚本测试；记录真实通过/跳过数量和日志。
- [x] **4.3 更新源身份及文档核验。** 新清单覆盖全部新增/变更文件、HEAD和需求SHA；主目录check、7项来源负向检查、文档导航及`git diff --check`通过。规划时的652文件清单不能冒充开发后验收。
- [x] **4.4 提交可审查结果。** 列明已实现/已验证/未验证、迁移SQL和计划摘要。真实MySQL迁移演练、生产迁移/部署及实体微信验收分别记录，不自动改生产或推送脏工作树。

## 计划自审与执行方式

已映射书面设计全部七项验收：身份/迁移→任务1；范围/生命周期/媒体→任务2；入口/多配色/兼容/浏览器→任务3；独立审查与整体验证→任务4。接口名称、cardsEnabled、/c/和旧/p/、/s/保持一致，无占位条款。

用户于2026-10-20选择“直接实现”，任务1～4本地执行完成。独立审查两项Important已在一次修复中RED→GREEN，全量1463项（1462通过、1项环境条件跳过）及其余检查通过。3.6因无可调用浏览器工具仍未验收；真实MySQL迁移、生产发布和实体微信签收未执行。详见[实现验收记录](../../product-master/product-master-v2-card-sharing-20261020.md)。
