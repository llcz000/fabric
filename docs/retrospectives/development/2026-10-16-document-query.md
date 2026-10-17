# 2026-10-16：V2单据查询、命中明细与分页

> 文档定位：研发与验收复盘。业务依据：[QUERY-01～03](../../project/项目需求总览.md#query)；当前状态仅见[项目进度](../../project/项目现状.md)及[V2模块进度](../../product-master/product-master-v2-progress.md)。

- 日期/范围：2026-10-16，单主Agent本机实现`query-ui-v2`，附独立只读审查；未调用ACP。
- 交付物：`V2DocumentBrowser.tsx`、`documentSearchModel.ts`及测试；`orderQueries.ts/documentRoutes.ts`及HTTP测试；独立评审组件/内存API和`scripts/query-v2-browser-qa.mjs`。
- 状态：独立React页和配套只读API已编码，本机专项通过；最终检查见下表，正式环境与用户UI接受未验。

## 问题与触发条件

已有查询API只提供单头与合计，缺实际查询界面和按筛选展开明细的路径；列表仅按ID排序，结清筛选未排除定金，样布行未计匹数。现有编辑/打印组件生成`/api/v2/documents/documents/:id`，与真实独立装配的资源路径不一致。

## 根因与证据

补充行为用例后实际RED：日期/结清范围、样布计匹数、缺少受权明细读取。独立请求model、组件和评审初始测试因待建模块缺失失败，补齐后与HTTP专项共同通过。另写结清字段回归，观察列表原先不返回持久状态，再补SELECT和DTO，避免界面把所有非定金单显示未结清。

独立只读审查发现P2：保留组件时将50条页大小切到新角色/API，effect启动默认20条搜索，却保留旧50条分页状态，造成21～50条不可达。已在真实浏览器中保持组件实例并复现RED，再在同一重置处补`setLimit(20)`；回归必须检查角色切换后20条选择值及下一页可达。

## 处理与结果

- 服务端同范围单头检查、COUNT与明细页均绑定owner和全部明细条件，拒绝客户端owner参数，404隐藏不可见对象；明细分页最多50条。
- 独立页面将表单草稿和应用筛选分开；新查询/页大小从第一页起，列表与全匹配合计成对加载，错误清空旧数据。请求代次与abort防旧响应回填；展开明细的权限失效也清空主列表。
- 复用已存单据编辑及打印预览，修正集合/资源URL；整单值与命中值明确区分。当前综合合计按既有约定排除定金合同额/定金/预收，表中定金单显示本单合同额。
- 评审页为29张内存单据，销售28张、管理员29张；可验证跨行误匹配排除、全匹配合计、分页和错误重试。模拟API不执行保存或导出，不回退正式网络API。

## 验证

| 环境 / 实际命令 | 结果与证据 |
|---|---|
| `node scripts/run-ts-tests.mjs server/order-v2/orderQueries.test.ts src/components/document-product-selector src/product-master-v2-review/main.test.ts src/product-master-v2-review/documentQueryMockApi.test.ts` | 44/44通过，包含真实127.0.0.1 HTTP鉴权/owner/参数/404/no-store |
| `node scripts/query-v2-browser-qa.mjs` | 最终16项通过，分页保留实例回归已观察RED→GREEN；桌面/窄屏共4张截图，无浏览器运行错误 |
| `node scripts/run-ts-tests.mjs` | 最终1023项：1022通过、1按设计跳过、0失败；覆盖分页审查修复后源码 |
| `npm.cmd run lint` / `npm.cmd run build` | 最终均退出0；完整tsc、Vite前端及esbuild服务端通过，按顺序运行 |
| `node scripts/check-fabric-v2-doc-navigation.mjs` / `git diff --check` | 72份文档、570条链接通过；已有跟踪文件无差异空白错误，新任务文件另做逐文件检查 |

代码基线和逐次日志：本机`tmp/query-ui-v2-20261016/`。浏览器报告与截图：[report.json](../../../artifacts/product-master-ui/qa/query-v2/report.json)、[桌面](../../../artifacts/product-master-ui/qa/query-v2/desktop-matching.png)、[窄屏](../../../artifacts/product-master-ui/qa/query-v2/mobile-query.png)；1360×900和390×844，React静态构建+Edge headless+内存API。截图/脚本不构成用户视觉接受。

## 可复用经验与回流

账号/API重置要同时清筛选、偏移、每页大小及展开项；否则新请求与旧分页步长不一致。请求model测试不足以覆盖组件重渲染，需要实际保持实例切换角色的浏览器回归。现有[UI组件规范](../../ui-design/component-rules.md)已要求分页重置和旧响应保护，本轮补其实际行为证据，不新增重复规范。

## 剩余问题与待验证实验

- 用户UI接受、真实MySQL LIKE/JSON/排序与驱动解码、账号失效竞态和目标数据规模性能仍未验。SQL契约替身不证明真实数据库执行。
- 正式`App.tsx/server.ts`、旧DocumentList切换、三类单据完整业务操作及历史保护验收仍开放；销售分匹输入、资料xlsx导出、大盘前端接线另有待办。
- 无真实数据库/COS操作、Git提交推送、原应用重启、正式路由切流或部署；一期仍No-Go。

## 闭环

- [x] 进度、接口说明与复盘索引已更新。
- [x] 复用已有UI/开发规范，无需重复回流。
- [x] 最终浏览器、统一回归及文档检查已回填。

## 2026-10-17 单据查询预置品名与 V2 输出补齐（评审入口）

- **触发**：统计Top5需要导航到已有查询的品名条件，最近4单需要进入已有受权预览；独立V2打印预览仅有Excel/浏览器打印，缺PNG和JSON选项。
- **实现**：`V2DocumentBrowser`增加可选`initialFilters`，角色/API/初始筛选重置同一组草稿/应用条件/页码/展开/选中；隔离评审`DocumentQueryReview`提供统计/查询互跳、最近单据按ID打开`V2DocumentPrintView`，不以模拟页面替代正式App。预览从受权`print-model`生成固定展示DOM，新增`下载 PNG`（同屏DOM、html2canvas）与`下载打印 JSON`（**共享打印模型快照**，非单据数据备份），保留原Excel和浏览器打印。错误显示、资源URL回收和旧数据清理维持；模拟API明确不提供真实下载/保存。
- **RED→GREEN与范围**：查询预置品名新增回归先失败，改动后含V2统计11/11；输出按钮/JSON专项先失败后3/3通过；统计评审模拟/入口先失败后5/5通过。统一全量`npm.cmd run test:unit`1062项（1061通过/1按设计跳过/0失败），lint/build均退出0。所证明的是静态组件、请求接口和模型语义，不包括真实浏览器PNG/Excel下载、图片/Logo/收款码/签字完整显示或真实纸张打印。
- **Gate及文档判定**：OUTPUT-01完整四类实体导出、COMPANY-01当前配置全链、生产App连接、正式MySQL/COS/账号与用户UI接受仍未验；本篇**保留**，当前状态由`docs/project/项目现状.md`统一维护。归档候选**不适用**，不做历史资料清理、不切生产服务。

## 本任务历史文档归档判定

- **保留**：本篇及`docs/product-master/product-master-v2-p6-document-write-read.md`，查询UI/HTTP证据及接口约束仍需用于正式接线/真库验收。
- **保留**：`docs/retrospectives/development/2026-10-13-p4-edge-browser-review.md`，浏览器与模拟/真实业务验收边界仍适用。
- **不适用**：本轮无已满足归档条件的被替代过程文件，无归档候选、删除或移动，未运行文档归档移动前Gate。
- **唯一状态入口**：项目范围`docs/project/项目现状.md`，V2阶段范围`docs/product-master/product-master-v2-progress.md`；本篇仅是过程证据。


## 2026-10-17销售逐匹输入DOC-06

日期/范围：2026-10-17，当前核对，复用V2DocumentWorkspace而非重建单据列表。旧销售框以逗号录入且前后端各有200匹上限；改为10个初始位置、每次可追加10位，输入位置与非空保存值分离。按分值合计毛米数，只有已填位置计匹，清空不移动其他值；已存无分匹记录保持原米数直至实际填写。扣损和金额仍由后端计算，内部产品/行身份保护不改；单据明细行数量和HTTP体积防护是另一层限制，未取消。

235匹回归先RED后GREEN。独立审查P1：type=number原生浏览器把未完成1e的value变为空串，导致误删一匹；实际按键复现RED，改用保留原文的decimal键盘/小数格式输入，父草稿保留无效串，保存映射明确拒绝，不能把它当清空。单元覆盖分值精度、空位、无效/未完成文本、旧无分匹显示和235匹映射/后端计算，专项与EX共19/19；浏览器81项/30图含实际按键、合计/追加/清空及360px布局。全量1038项1037通过/1跳过、lint/build通过。

边界：本机查询评审仍明确不模拟保存，浏览器不能冒称真库保存/重读/打印已验；真实完整单据链、DOC-05/07 UI与当前公司设置/签字等Gate仍开放。当前唯一状态见V2进度；本篇、P6技术说明及本轮计划保留，无归档候选或删除。复盘索引新增逐匹/导出检索词，UI规范回流“原始未完成输入不可当空值保存”。日志tmp/remaining-v2-20261017/，截图与导出文件artifacts/product-master-ui/qa/p4-6/。

## 2026-10-17单据类型与金额DOC-0507

**触发**：用户已验收紧凑色卡补选并要求继续剩余任务。核对DOC-05/07与实际源码后，发现V2编辑仍给样布提供预收、给定金提供结清，样布汇总仍减旧deposit、定金仍计匹数；编辑回读按未舍入比例直接算应收，与0.01×50%先舍入定金金额的规则不一致，定金输出缺应收。复用现有编辑/服务/打印/XLSX，不新建查询页或切换旧App。

**根因与处理**：历史三个类型共用deposit和settled字段，没有区分类型投影和写入语义。引入纯`calculateDocumentPayment`供汇总、编辑映射和共享打印使用；先算并按分舍入定金金额，再扣减。样布应收=合计、匹数按明细行数，定金匹数0且无结清。新建/编辑在服务端按当前锁定类型拒绝非法字段，整笔事务回滚。定金输入保留原始文本，未完成1e、超100比例、超精度均在提交前拒绝，不把它们当0。共享打印增加定金应收，XLSX仍直接使用同一模型；产品快照和原行ID保持不变。

**独立复核与历史保护**：只读审查发现两项P2：旧样布total_pieces可能过期；普通编辑会用0/false覆盖已隐藏的历史字段。均补行为RED后修正：服务读取/编辑映射/共享打印按实际明细行数派生样布匹数；创建仍明确0/false，普通样布PATCH省略deposit、定金PATCH省略settled。历史原值留在数据库，读取/展示投影遵循当前类型规则，不借此次任务做批量DML。实际HTTP夹具模拟旧deposit=33或settled=1，普通修改开单人后原值、产品快照保留。审查随后只读复核确认两项闭环，无新增已确认问题。

**实际验证**：最初类型/金额测试观察RED，修正后相关100/100；另演示比例样例RED→GREEN。新增本机真实Express+鉴权+事务SQL内存替身，三类创建→重读→打印→实际XLSX字节读取一致，非法PATCH回滚、正常编辑保留隐藏旧值通过。全量初次4项失败来自P7生命周期夹具仍向样布写20元定金，按新规则改为0，未弱化业务约束；生命周期4/4恢复。最终全量1046项：1045通过、1按设计跳过、0失败。真实Edge13项/6截图核对既有编辑/预览和1e/101保留纠正，无运行错误，图片在`artifacts/product-master-ui/qa/document-types/`。日志`tmp/document-types-*.log`。一次tsc发现条件spread推导丢失可选settled，明确复用服务端EditDocument类型契约后修正；最终类型/构建记录见当前进度。

**范围与剩余Gate**：DOC-05/07及这部分DOC-08只通过本机源码、HTTP内存事务、真实XLSX字节和React浏览器验收。查询演示页继续明确不模拟保存/导出；HTTP测试的完整保存链不是生产MySQL。正式App/旧单据入口、真实账号/数据库/并发/历史迁移、完整当前设置/Logo/收款码/签字/JSON/PNG仍开放，本次未部署、未Git提交/推送、未触碰真实DB/COS。新财务界面尚待用户实际查看，不继承色卡UI接受。

**收尾与归档判定**：唯一状态为`docs/product-master/product-master-v2-progress.md`，全项目摘要为`docs/project/项目现状.md`。本篇、P6技术说明`product-master-v2-p6-document-write-read.md`、本轮计划`2026-10-17-document-type-financials.md`逐文件判定**保留**，各自仍承载正式接线/实库Gate及独有证据；无归档候选、删除或移动。复盘索引/原UI规范已更新，仅回流已验证的原始输入保护与隐藏字段省略，不维护第二套业务需求。
