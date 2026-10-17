> 2026-10-15整理：本文保留原始设计/执行步骤与未完成约束，不是当前状态表。部分任务已有独立代码和历史验收；现行业务以[唯一需求](../../product-master/product-master-v2-requirements.md)为准，最新实现与开放Gate只查[当前进度](../../product-master/product-master-v2-progress.md)。

# B2-3 色卡库实现计划（2026-10-14）

> 文档定位：中间过程｜主要读者：当前任务的开发/评审、Agent。用途：查实现/计划、历史证据和未完成Gate；不是业务新需求。

**Goal:** 按用户已批准v1.48色卡稿实现两项建卡、组合唯一、稳定码和六列文本Excel，并提供独立React页面及真实HTTP测试。
**Architecture:** 独立customer-samples模块；不挂正式server.ts、不覆盖在途一期装配。数据库事务锁母版/面料并以组合唯一约束保证幂等；qr_payload为随机不可猜测base64url原文，仅识别卡，不授予权限；页面和Excel均读取这一字段。管理权限使用显式回调，内部服务缺省拒绝；用户已批准管理员和业务员均可查看、管理、导出，路由明确按这两角色校验。既有扫码的hash与会话授权继续生效。
**Tech Stack:** TypeScript / Express / MySQL8 DDL / React19 / ExcelJS / 现有esbuild单测执行器。
**Spec:** docs/product-master/product-master-v2-requirements.md v1.48 4.6、9.1.4、9.1.8.1、AC-87至94；用户2026-10-14“可以，继续”为本张UI批准。
**Global Constraints:** 通过WebCodex编辑；保留既有dirty工作；禁止提交、部署、迁移/远端写入/重启及绕过先前被拦的实库入口。单页批准不扩大到其余二期五页。先失败测试再实现。管理角色已批准admin/sales；扫码仍sales+明确会话授权。
**Review Focus:** 并发重复不换码、未知/停用输入、数据单位/前导0、所选与Excel顺序对应、旧多母版数据拒绝、扫码无权限拒绝、异步候选旧响应不污染、编辑清除校对绑定、真实二维码编码同源。

## Contract
Card DTO: {id:string,masterId:string,masterNo:string,fabricId:string,fabricNo:string,cardNo:string,description:string,composition:string|null,weightValue:number|null,weightUnit:'gsm'|'mm'|null,widthValue:number|null,qrPayload:string,isActive:boolean}.
POST /api/v2/sample-cards body exactly {masterId,fabricId}; response {card:CardDTO,created:boolean}.
GET /api/v2/sample-cards?query=&limit=50&offset=0 -> {items,total,limit,offset}.
POST /api/v2/sample-cards/export body {cardIds:string[]} -> .xlsx; explicit selection only; selection order preserved; unknown selection fails, no partial silent export.
Management authorization callback(principal, action:'read'|'create'|'export'):boolean|Promise<boolean>; default deny; server fresh principal middleware plus transaction recheck for create.
Existing pattern/fabric catalog endpoints may feed selection with injected authenticated fetch; candidate labels only numbers. Protected pattern assets supplied by resolver callback; no temporary URL stored.
buildSampleCardsWorkbook(cards):Promise<Buffer> in cardExcel.ts; exactly6columns, string qrPayload, no embedded images/formulas.

## Tasks
- [x] 1. 后端身份/稳定码：cardLibrary.ts/.test.ts，schema.ts/.test.ts，scanRepository.ts/.test.ts。createSampleCard(pool,actor,input,authorize)、listSampleCards(db,query)、getSelectedSampleCards(db,ids)。只修改本模块；actor事务内重查有效登录/角色，combo unique及rawpayload与hash同事务。旧schema不可静默兼容；未执行DDL。
- [x] 2. Excel/React：cardExcel.ts/.test.ts；src/components/product-master-v2/{sampleCardModel.ts,SampleCardLibraryV2.tsx,SampleCardLibraryV2.test.ts}。真实ExcelJS回读；page绑定qrPayload与可注入二维码绘制组件，候选清空/乱序请求/多选导出。
- [x] 3. HTTP：cardLibraryRoutes.ts/.test.ts。只挂独立测试Express；鉴权每次重读、显式角色回调、错误安全、请求体限额、401/403/400/409及真实XLSX响应。
- [x] 4. 验证/交付：全量测试、lint/build/diff，独立审查；更新现行需求/UI签收/进度与B2-3报告和复盘。真MySQL、正式App、浏览器视觉另记未验。

## Ledger

## B3选样历史读取切片（2026-10-14继续）
- 目标：读取扫码选中的产品、首次冻结资料和色卡来源；新增配色不改旧快照。沿用sales+显式customer_sample_session_access.can_manage，不新建授权，不默认开放管理员。
- 文件：sessionRead.ts/sessionReadRoutes.ts/sessionRead.test.ts及统一隔离v2CatalogAssembly；GET /api/v2/customer-samples/sessions/:id?limit=&offset=。
- 用户/登录/会话/授权同一事务复查；授权前不读取客户资料；关闭会话保留历史读取，不赋扫码写权限；冻结资料不JOIN当前主数据；退役卡和同号新卡来源按ID区分。
- 验证：匿名/管理员/账号失效/撤权/未知会话拒绝，分页/坏快照安全失败、统计及历史来源、真实HTTP和目标漂移保护。只做必要专项及收尾统一验证。
- 无新UI、实库写入、生产App接线或部署；B3寄样/跟进及UI另推进。


## 2026-10-14 用户继续后的接线任务
- [ ] 5. 色卡引用保护：在已锁母版/面料的事务内检查所有色卡（含停用）引用；有卡拒绝改号/删除409，其它属性可更新。只在明确ER_NO_SUCH_TABLE且查询单一sample_cards时兼容未装二期的纯一期库；其它错误安全拒绝。补两服务/HTTP行为红绿测试，保持父→卡锁顺序。
- [ ] 6. 隔离V2接线：统一测试HTTP装配加sample-cards管理/scan，使用已验证checkedDatabase/checkedPool；显式客户会话授权仍在扫码服务。已有React评审入口加色卡页与纯内存API，不改正式App/server.ts、不改已批准Stitch布局。真实HTTP/前端mock/QR-Excel串联验收，浏览器不得绕过先前被拒的本地页面路径。
- [ ] 7. 全量验证/独立审查/进度与复盘，实库与正式部署仍分开。
- 归属：引用保护worker拥有fabrics.ts/.test.ts、patternMasters.ts/.test.ts及独立sampleCardReferences.ts/.test.ts；页面worker拥有src/product-master-v2-review/main.tsx和独立sampleCardMockApi.ts/.test.ts；root独占v2CatalogAssembly.ts/.test.ts与docs。已核对最新读取，保留其它源码和未提交改动。
- Ruling: 继续执行是在已批准B2-3下完成保护/接线，不改色卡业务、UI布局和管理角色；未上线的测试装配/内存评审不触生产，也不替代真MySQL。

- Preflight: 1与2共享CardDTO契约；接口已列出；Excel模块归2，服务schema/scan归1，routes/docs归root，不共享编辑文件。
- Task1/Task3共享create函数与授权回调；函数签名已列出，root后接线。
- Task2自身：测试真实xlsx字串和UI状态；前端QR可注入，真实渲染验证不得以占位PASS代替。
- Ruling: raw payload允许持久保存用于稳定重导出，但不记录日志；其仅识别卡，读取仍必须登录+管理授权，扫码仍销售+会话显式授权。旧“raw永不存储”注释应改为此边界。
- Ruling: 不新建worktree（需现有大量未提交V2依赖）；按独立文件归属在已授权checkout推进，禁止clean/reset。
- Ruling: root独占package.json/package-lock依赖变更，加入已registry核验qrcode1.5.4、@types/qrcode1.5.6及仅测试jsqr1.4.0，页面直接编码保存payload；不从第三方QR图片服务泄露文本。
- Root HTTP RED: 新增4组真实Express测试，在路由缺失时预期失败。
- Task2 complete: 21/21专项、实际SVG/真实Excel逐字同源解码、TypeScript及diff通过。
- Task3 complete: 6/6真实HTTP和1/1真实service串联（SQL替身）通过；明确admin/sales管理授权与sales+session扫码隔离。
- First broad verification: 703/703、build和静态Gate通过；review发现create/scan锁反序P2，Task1追加统一父→卡锁序，修复后必须回归。
- Final: Task1 26/26，新增锁序3项先红后绿；最终706/706、lint/build和静态/diff通过。独立审查P2关闭，无剩余本轮实质缺陷；真实MySQL/正式App/一期改号引用保护/浏览器Gate保留。
- B3读取历史收尾（2026-10-14 v1.49，仅追溯）：当时实现按旧快照读取，专项34/34、全量799项798通过/1跳过。**当前v1.50已改为读取最新主数据，禁止沿用冻结属性**；最新实现/验收与待验Gate查[10月15日交付](../../product-master/product-master-v2-b3-history-ui-review.md)及[当前进度](../../product-master/product-master-v2-progress.md)。原B3快照过程记录已在知识归档中可恢复。
