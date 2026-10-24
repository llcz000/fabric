# B3 客户选样：当前交互与实现说明

用途：当前实现、用户确认与剩余接线定位。业务以[需求9.1.3及AC-84](product-master-v2-requirements.md)为准，唯一当前状态看[进度](product-master-v2-progress.md)。2026-10-17更新；旧稿不作当前入口。

## 最新可操作候选（2026-10-17）

新独立工作台已接列表/新建与创建者显式授权、原色卡补选/扫码、分批寄样及跟进。真实恢复库元数据/事务和浏览器均有独立证据，见[当前候选](../operations/统一发布工具.md)。以下早期隔离过程的未完成描述保留其时点；不代表正式生产已升级，实体扫码和人工UI仍开放。

## 用户确认及预览

2026-10-17用户确认并追加紧凑修订：首列色卡编号直接点击展开/收起，不附额外文案；展开显示花型缩略图＋花型编号的勾选列表，默认全选当前可供样配色。每卡只留一个“加入”按钮，按当前勾选提交，全选加入整卡、部分勾选只加入子集，零勾选禁用；移除独立“加入勾选”。仅搜索已建有效色卡，去掉按货号补选，未建卡产品不能候选或绕过接口。停用卡/花型/面料、撤码或无可供样产品的卡不候选，卡内停用/暂不供样配色不勾选。最新紧凑补选规则与实际预览已于2026-10-17获用户“都检查过，可以”确认。

入口：`product-master-v2-review.html?view=sampleSelection`；本机静态预览`http://127.0.0.1:52985/product-master-v2-review.html?view=sampleSelection`仅回环且依赖进程。代码`src/product-master-v2-review/ManualSelectionReview.tsx`，最新截图/结果在`artifacts/product-master-ui/qa/card-selection/`。旧`manual-selection-preview.png`为历史资产，不代表最新页面。演示数据和操作仅保存在内存，刷新复位，不读取生产MySQL/COS。

2026-10-15按产品检索的人工补选UI曾获接受，现由本次色卡流程取代；当日用户移除撤销/恢复本单授权模拟按钮的决定继续有效，不新增业务授权管理页面。

## 当前服务与前端契约

- `sessionCardSearch.ts/sessionManualRoutes.ts`私有GET `/sessions/:id/cards`在登录/显式会话授权核对后检索色卡；前端每页20张、服务上限100。按色卡编号/花型编号/面料品号/品名服务端模糊检索，字面转义通配符；只返回卡内可供样产品，不返回二维码原文。
- `sessionManual.ts`私有POST只收`cardId`及可选`productIds`子集。省略子集解析整卡当前集合；显式子集任一不属于卡或已不可供样则整笔拒绝。拒绝旧裸productId；账号→登录→会话/授权→母版→面料→卡→token→产品/选样项逐步锁定复核；不建单产品二维码/H5或第二套选样业务。
- 整卡/子集同事务写入，按session/product去重、移除后恢复原行及原操作者；`added/already_selected/restored`均追加人工事件及真实card_id，不伪造扫码。fresh DDL及只读契约新增人工事件可空card_id和RESTRICT FK，NULL只容纳历史无卡审计。未执行真实存量迁移，也不重写历史无卡来源。
- `sessionRead.ts`按当前主数据读取品名/成分/克重/门幅，不冻结选样属性。色卡编号首列，删除旧卡仅标已失效，保留原卡身份。扫描和人工色卡来源合并去重；人工保留firstManualEventId、firstScanEventId为NULL，原首次扫码事件不改指。`sessionRemove.ts/scanRepository.ts`继续保留软移除/重扫恢复和原来源，不因新增主数据自动选入。
- `SampleSelectionPanel.tsx/WorkspaceV2.tsx/manualSelectionModel.ts/ManualSelectionPane.tsx/sampleSelectionClient.ts`提供卡搜索、展开默认全选/部分勾选、零勾选禁写、成功重读及新增/恢复/已选数量反馈；失败保留勾选，检索失败清除过期候选而保留搜索词；pending/closed禁写、失权清除资料。
- 候选产品携带服务端花型编号`patternNo`及图片资产引用，不带原图地址；复用图片访问resolver，展开后每批最多100个ID仅请求thumbnail，关闭/换卡中止请求，失权清除资料，无图/失败用占位。评审页使用明确本地模拟图（320像素缩略图），正式图片鉴权/COS接线仍为独立Gate。最新紧凑截图在`artifacts/product-master-ui/qa/card-selection-compact/`，上轮`card-selection/`保留历史证据。
- `createV2SelectionFetch`由调用者注入已有V2会话，不存凭据、不复用旧App令牌、不创建账户；可选getV2SessionToken不代表已接正式入口。
- `shipmentBatch.ts`仅AC-81寄样批次数据准备及已选/已寄/待寄统计；2026-10-17新增`followupDraft.ts`纯校验客户确认、反馈/结果、下次跟进日期及有效选样产品关联，两者都不是持久化服务。无寄样/跟进DDL、事务、路由或实际业务页面。

## 验收证据

2026-10-15历史人工补选RED→GREEN、定向21/21和局部tsc通过；真实本机HTTP＋内存SQL替身、浏览器新增/重复/移除/恢复、停用隐藏、最新资料和异常恢复已验证。该记录只证明当时按产品补选，不证明当前色卡流程。

2026-10-17当前证据与最终回归见[唯一进度](product-master-v2-progress.md)和[同题复盘](../retrospectives/README.md)。专项代码包括`sessionCardSelection.test.ts/sessionCardSearch.test.ts`、统一HTTP `v2CatalogAssembly.test.ts`、真实client/model及review harness测试；浏览器脚本`scripts/card-selection-browser-qa.mjs`。

## 未完成Gate与保留

正式App/server接线、真实V2账号/媒体、现存schema去快照和人工色卡/移除审计无损迁移、真实MySQL外键/两连接并发/回滚、手机扫码、寄样持久化/跟进、部署均未验。新选卡、读历史、单款软移除均已在独立V2切片支持两角色并保留显式会话授权；2026-10-17增量见同题复盘，私有统一HTTP/事务替身已测试。真实账号/授权、实库及正式集成仍需验收，不宣称B3整体交付。只读schema Gate不代表存量表已升级。

本说明、关联复盘和本次计划均**保留**：未达到正式集成/实库验收；未删除、归档或移动历史资料。
