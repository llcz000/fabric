# P6 三种单据选品、保存、计算与输出技术说明

用途：单据端到端实现和历史保护。**公司设置动态展示新规则以[项目需求总览2.2及2.4](../project/项目需求总览.md#output)为准**，产品资料冻结仍按[详细需求9.3](product-master-v2-requirements.md)。状态见[进度](product-master-v2-progress.md)；底层身份见[P1历史保护](product-master-v2-p1d2-lines.md)。2026-10-15更新，不授权旧入口切换。

## 选品与草稿

`server/product-master/selector.ts/selectorRoutes.ts`仅查询V2四级启用产品；双框货号/品名在服务器AND过滤、稳定分页，默认20上限50。权限是已登录的管理员或业务员（业务员只能操作本人单据）；旧`canManageOwnOrders/canManageProducts`授权位不再阻止有效角色。花型图短期签名可注入，缺签名/缺图返回NULL，不拼公开COS地址。

`ProductSelectorDialog.tsx/selection.ts`复用于新增/替换：八列，Esc/Tab焦点及返回触发处；选品只改当前草稿身份，保留原行ID、业务字段，取消不保存；只有管理员可明确切手工。`documentAdapter.ts`新增/更换发送稳定productId，未更换旧行不重发selection；服务端重新选品并冻结资料，不信任客户端快照或owner。旧mapDocToBackendPayload不认识V2关联，不能把新选择器直接塞进旧保存链。

## 完整事务与表头

`documents.ts/lines.ts/calculatedSave.ts/headerFields.ts/displaySchema.ts`在同一connection/transaction内重新锁定有效用户、会话、owner、原行：创建头/行、显式增删/替换、金额与表头一笔提交，任何失败全回滚。未改行不重写历史金额；原行ID保持，不能漏传暗删或全部DELETE重插。`sales`明确映射物理bulk，日期标准YYYY-MM-DD。

新单继续冻结**产品资料和本单交易字段**，包括货号、品名、规格、价格、数量、客户和收货业务字段。数据库历史`v2_display_snapshot`仍原样存储/读取以保护旧数据，但**公司名称/地址/电话、条款等展示不再以这份快照为准**，必须取当前统一开单设置；GET原始持久记录与打印展示属于不同语义。历史owner、产品来源和NULL快照均保留，不能虚构录入人。`V2DocumentWorkspace.tsx`是独立React工作区，保存后采用服务器回读身份，继续编辑用PATCH，失败不冒充保存。

## 数值和输出

`calculations.ts`数量/价格/扣损有限非负且最多2位小数，各匹米数正数且总和匹配，2026-10-17已取消200匹业务上限；HTTP体积/明细行数量限制仍独立存在。整数分/BigInt逐行舍入再汇总。样布不设定金，应收等于合计且匹数按明细行数；销售deposit为金额，销售金额=max(0,毛米−扣损)×单价，无匹米数组时V2匹数为0；定金单deposit为0～100百分比且total_amount存全额，不设匹数/结清。

2026-10-17 DOC-05/07本机修订：`calculateDocumentPayment`共用于计算、编辑回读和共享打印，按分先舍入定金金额再相减（0.01×50%得到0.01定金、0应收）。样布旧预收只在展示投影归零，定金旧匹数/结清投影为0/false，不批量改数据库。新建拒绝样布非零定金及定金已结清；编辑在原事务内锁定真实类型重检。普通样布PATCH省略deposit、定金PATCH省略settled，保留隐藏历史原值；样布匹数在读取/编辑/打印按实际行数派生，不依赖过期total_pieces。产品快照和原行身份保护不变。

原`V2DocumentWorkspace`按类型显示金额/比例/结清/分匹，类型切换重置不适用草稿字段；定金输入保留原始文本，1e、超100百分比等在提交前拒绝并保留纠正。定金打印与XLSX补应收金额，共用模型，不新增模板或列表。真实浏览器13项/6截图、本机HTTP三类创建→重读→非法PATCH回滚→保留历史字段的普通编辑→打印→实际XLSX验证通过；SQL为内存事务替身，不是MySQL验收。最新状态及证据见[进度](product-master-v2-progress.md)。

`print.ts`与`documentPrintModel.ts`生成同一DocumentPrintModel供预览/Excel；gsm/mm和NULL按**冻结产品字段**保留、不杜撰规格。**2026-10-15修改**：`documentRoutes.ts`每次获取有权查看的已存单据后，均从`company_config`重新读取公司名/地址/电话/默认及定金条款；`print-model`和`export.xlsx`共享当次当前公司设置。`print.ts`不再使用历史公司快照兜底；缺少当前设置返回安全失败，不将旧公司信息误作最新。该工作不修改历史单据的产品/金额快照。`documentExcel.ts`保留240×140mm/AK-820、边距/字体/签字布局；`V2DocumentPrintView.tsx`使用授权print-model/export.xlsx，跨人404、无身份401，不回退旧JSON。销售每段十个匹槽；旧打印的无匹1匹fallback只保留原旧链行为，不能暗改历史。

## 产品引用与本人范围

`productProtection.ts`及受控产品核心在事务内重验有效登录角色/会话的共享products.manage、锁产品，真实订单引用/FK竞态409，拒删前不解绑共享媒体；安全停用不改历史快照。`orderQueries.ts`的COUNT、列表、LIKE搜索、统计共用服务端owner谓词，销售不能读NULL owner，SQL失败不退JSON。打印、Excel、图片、公司、库存、统计及旧路径均需纳入正式权限覆盖，前置middleware不能独自防TOCTOU。

## 历史验收与未完成Gate

### 单据查询与命中明细（2026-10-16）

`V2DocumentBrowser.tsx`复用现有编辑/打印组件，`documentSearchModel.ts`负责精确筛选、分页及list/totals成对加载。所有筛选发给V2 API；输入草稿与已应用筛选分离，翻页保持已应用条件，提交新筛选从第一页开始。请求代次及AbortController共同阻止旧响应回填；列表或合计任一失败清空成对数据，明细401/403也清空查询数据。角色/API变化重置查询及每页20条，不能保留旧50条分页步长跳过记录。

`GET /api/v2/documents/:id/matching-items`接受与列表相同筛选、默认20/最多50，返回`{orderId,total,limit,offset,items}`。每条items为`{id,productNo,colorNo,productName,meters,amount,pieces}`；先检查同范围单头存在且满足筛选，再在COUNT和明细页重复同一owner/明细条件，无权限或不命中返回404。多个明细条件始终在同一条`i`上AND。列表按`order_date DESC,id DESC`，返回持久`settled`；结清过滤仅样布/销售。合计与明细的样布行计1匹、销售计保存的分匹JSON条数、定金不计匹数；已有综合明细合计仍排除定金合同额。

编辑、保存、预览和Excel统一使用实际V2集合`/api/v2/documents`及单据资源`/:id`，不再生成重复`/documents/documents`。独立评审`?view=documents`提供29张内存单据、sales/admin范围及一次失败演示，不回退原生fetch、不模拟保存/文件导出。浏览器证据与开放Gate见[查询复盘](../retrospectives/development/2026-10-16-document-query.md)。

### 经营统计接口补充（2026-10-16）

独立V2装配的`GET /api/v2/documents/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`要求当前有效Bearer登录，仅接受起止日期，拒绝客户端owner、limit和其他筛选参数。既有`orderCount/amountTotal/metersTotal/byType`保持兼容，新增：

- `topProducts: {productName, meters}[]`：直接按已存`order_items.product_name`去首尾空格并归并空名为「未命名的面料」，累计三类单据明细米数；米数倒序、品名升序、数据库`LIMIT 5`。不连接当前产品库追写历史品名，不汇总定金金额。
- `recentOrders: {id, orderNo, date, receivingUnit, type, totalMeters, totalAmount}[]`：开单日期倒序、同日ID倒序、数据库`LIMIT 4`，ID保持字符串。`type`沿用持久值`sample/bulk/deposit`，`totalAmount`为本单金额，定金单对应合同额；这是单据摘要，不是定金收款合计。

汇总、排名、最近单据共用同一服务端owner/日期谓词；空数据返回零汇总和两个空数组。异常或非法数值使整份HTTP响应安全失败，不返回部分成功。该接口未接旧大盘，SQL契约替身不证明真实MySQL聚合/排序、驱动BIGINT/日期解码或性能；[本轮复盘](../retrospectives/development/2026-10-16-order-statistics.md)记录验收范围与开放Gate。

**本轮局部回归**：历史公司快照非NULL的已存样布单据重读后使用最新公司信息；更新公司资料再次重读反映新值，Excel一致，定金单取当前定金条款，产品行与金额保持冻结，当前设置缺失则明确失败。**未覆盖**：V2 `/documents/:id` 返回对象如何呈现最新公司设置、旧版React/PNG/JSON界面、收款码/品牌Logo/签名等扩展公司字段、真实持久MySQL，以及正式纸张人工签收。以上均不得宣称完成。

2026-10-12 MySQL8.0.46固定隔离库的`test-v2-order-calculations-mysql.ts`、`test-v2-document-selector-mysql.ts`、`test-v2-document-api-mysql.ts`验证三单据真实登录→创建/回读/PATCH→打印模型/实际XLSX重读、四角色范围、停用/手工拒绝、来源及公司冻结、整体回滚、真实FK拒删；重跑合成行归零。选择器44条合成产品中四级停用4条，40条启用无分页重复；COS签名仅仿真。历史ExcelJS打包曾污染URL构造器，仅测试脚本恢复node:url，未改生产全局。本轮不重复执行这些演练。

正式App/server、旧PUT/JSON兜底退场、真实库存/结清联动、订单并发版本/编号冲突、历史金额与匹数兼容、短列及DECIMAL精度扩容、真实COS、Excel图片二进制注入、浏览器/PDF/实体AK-820打印、备份迁移/回滚及上线仍待验；不把独立API或SQL替身当生产业务闭环。
