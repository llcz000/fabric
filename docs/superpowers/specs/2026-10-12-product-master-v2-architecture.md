> 历史参考：本文日期内的版本、角色/任务、列数、格式、部署状态和风险只对应原记录；已取消的范围不恢复为待办。现行依据为[项目需求](../../project/项目需求总览.md)及[项目现状](../../project/项目现状.md)；原始批准与证据保留，不作为今天的操作指令。

> 2026-10-15整理：本文保留原始设计/执行步骤与未完成约束，不是当前状态表。部分任务已有独立代码和历史验收；现行业务以[唯一需求](../../product-master/product-master-v2-requirements.md)为准，最新实现与开放Gate只查[当前进度](../../product-master/product-master-v2-progress.md)。

# Fabric Product Master V2｜一期技术架构与接口设计（评审稿）

> 文档定位：中间过程｜主要读者：当前任务的开发/评审、Agent。用途：查实现/计划、历史证据和未完成Gate；不是业务新需求。

> 版本：技术设计草案 0.1（2026-10-12）；**不是已批准的实现、不是上线状态**。需求唯一权威：[Product Master V2 v1.36](../../product-master/product-master-v2-requirements.md)。对应[分阶段实施计划](../plans/2026-10-12-product-master-v2-implementation.md)。
>
> 本文只覆盖一期。凡标记「待审」为工程建议或仍需业务/UI评审，未被自动批准；二维码/扫码/画册/以图搜图/客户合集全部二期。

## 1. 已核对的现有源码与不变量

- 现有技术栈：React/Vite/TypeScript → Express → MySQL（并存在 JSON fallback 和浏览器 IndexedDB 路径）；图片资产由 server/image-assets/* 提供隔离上传、派生图、受控访问、引用/回收能力；不自行创建第二套图片存储。
- server.ts:507-578 定义 orders、order_items、products、product_images 旧物理结构；server.ts:148-203 是单密码+内存token及产品路由装配（静态 principalId=admin）；server/appAssembly.ts 按图片资产开关决定新旧 /api/products 的路由优先级，迁移时要逐种开关测试。
- server/products/types.ts、routes.ts、mysqlRepository.ts 当前产品写入 itemNo/productName/composition/weight/width、总图20张和产品标签；不符合「具体花型版本＋面料」关联。server/products/schema.ts:5-18 的 ALTER ... ADD ... IF NOT EXISTS 在目标 MySQL 8.0 不兼容，见[部署失败复盘](../../retrospectives/README.md)。
- server.ts:768-800 的订单校验把 weight/width 转为数值且缺省为0；server.ts:1046-1069、1138-1163 的订单明细新增/编辑为插入、编辑时先全部 DELETE 再 INSERT；旧明细 ID 不能在当前 PUT 链路里稳定存活。
- src/types.ts、src/components/DocumentEditor.tsx 为三类前端单据的不同字段；src/lib/documentPrintModel.ts 和 server/documentPrintAdapter.ts、server/documentExcel.ts 共享打印模型；sales/bulk 映射不得改变、既有定金和销售计算口径不得改变。
- 当前 Git 工作区有大量**已有**文档/设计变更；本设计不得触发业务表删除、历史数据迁移、源素材清理、部署或自动提交。

## 2. 分层目标与责任边界

1. **认证/授权边界**：请求上下文包含真实 actorId、role（admin/sales）、orders.manage_own、products.manage；三库读共享、写受 products.manage；单据按创建人隔离。所有接口与图片/导入/删除路径在服务端做动作级鉴权。
2. **主数据层**：花型母版（题材）→ 花型配色版本（数字身份、独立原图、颜色标签）＋面料（成分与规格）→ 产品（关联这两个内部ID、三类产品图片、备注、状态）；三库是业务入口而非物理表数。
3. **业务校验与事务层**：唯一性、启停、身份锁定、引用禁删、编号生成及图片关联的同一事务内校验；接口仅返回明确成功或冲突，不做无提示覆盖。
4. **应用查询层**：服务器先查询全库并过滤再分页，批量关联标签和图片缩略图；按需读取原图。
5. **单据适配层**：library（库内）、admin_manual（管理员临时手工）、legacy_manual（历史保存）三种**由服务端判定**的来源；库内资料只读并以保存时值写单据资料，已有单据不自动刷新。
6. **前端呈现层**：以 Stitch 当前7个页面为视觉来源、正式需求为业务依据；只实现已确认一期功能，不把本地UI示例测试等同于真实验收。

## 3. 数据库候选设计（物理结构待技术评审，DDL尚未执行）

| 建议对象/表 | 主要字段与约束 | 备注 |
| --- | --- | --- |
| pattern_masters | id、master_no（规范化后唯一）、is_active、created_at/updated_at、**next_colorway_no（D-01已批准必需持久计数）** | 母版无业务备注；编号字母数字，无内部横杠；删除配色后计数不回退 |
| pattern_colorways | id、master_id FK、colorway_no正整数、pattern_no生成/受控存储、pattern_image_asset_id可空、remark、is_active、timestamps；UNIQUE(master_id,colorway_no)及pattern_no唯一 | 一版一图；无配色名称/颜色代码；仅单版身份ID用于产品 |
| v2_fabrics（实际远程已有旧fabrics表，不可覆盖） | id、fabric_no唯一、fabric_name必填、composition可空、weight_value可空、weight_unit(gsm/mm)可空、width_value(cm)可空、remark、is_active、timestamps | 有克重值须合法单位；没有克重不得写假零 |
| shared_tags | id、dimension(topic/color)、name、normalized_name、is_archived；UNIQUE(dimension,normalized_name) | 同维度名称NFKC/忽略大小写判重，1～32字符；归档可追溯 |
| pattern_master_tag_links | master_id、tag_id，主键组合 | 题材仅母版，0～10个 |
| pattern_colorway_tag_links | colorway_id、tag_id，主键组合 | 颜色仅版本原图，0～10个 |
| v2_products（V2原生目标表，与线上旧products隔离） | id、pattern_colorway_id FK、fabric_id FK、product_no唯一、remark、is_active、row_version；UNIQUE(pattern_colorway_id,fabric_id) | 不保留旧item_no/product_name/composition/weight/width冗余列作为兼容负担；面料属性仅JOIN读取 |
| v2_product_image_assets（V2独立关联表；复用全局image_assets内容服务） | product_id＋asset_id＋role(fabric_display/detail/ai_effect)＋sort_order＋soft delete | 旧产品关联可清退，需安全递减引用；三类分别0～10、首图按当前顺序 |
| order_items（兼容扩展候选） | 沿用已有明细ID，新增 product_id可空、source_mode、可空的克重数值/单位快照字段及必要的版本标记；现有业务值继续保留 | 历史行识别依赖数据库原记录，不能听信前端source_mode；只扩展不清空已有行 |
| orders / access_users / access_sessions | orders增加创建人稳定ID；持久化用户、授权及会话（具体结构可复用原多用户计划，经源码再审） | 默认本人范围，历史订单归属数据不作未授权批处理 |

**v1.36已确认的数据与兼容边界**：用户明确允许清空旧版产品库并淘汰旧产品CRUD/导入，不需要V2读取旧产品数据、保持旧产品ID或在V2表上扩列兼容。因此不再选择「旧products扩列」路线，目标是**V2原生products及三库独立关系**。物理是否复用products表名、旧产品关联表的移除次序，仍需先以只读INFORMATION_SCHEMA确认FK及关联范围，在隔离库验证。清理仅覆盖旧产品专用表及其引用，不能误删orders/order_items、库存/客户/公司资料、共用image_assets及仍在其他资源使用的COS对象；若旧订单无product_id FK，保留其快照文本，不强制建立历史产品映射。**本技术授权范围已明确，但真实数据库尚未连接，未执行删除或迁移。**

**2026-10-12 实际远程数据库核验更新**：SSH已访问生产`fabric_db`，MySQL 8.0.46、PM2 online、health.storage=mysql。线上旧`products`1,211条、5条外键引用；`product_image_assets`1,008条使用944个全局图片资产；历史订单118单/148明细不引用旧产品ID。**远程`fabrics`虽0行却是旧订单业务结构而不是V2面料表**，故冻结优先物理命名建议为`v2_fabrics`、`v2_products`和独立V2图片关联表；在线并行开发，不要求旧产品数据兼容。图片引用回收需先做事务与安全留存策略，绝不在开发期直接DROP旧域。详见[远程只读审计](../../product-master/product-master-v2-remote-db-audit.md)。

### 3.1 数字配色顺序分配（D-01业务规则已批准，事务实现待验收）

**已批准D-01**：母版持久保存`next_colorway_no`（首值1），创建版本时BEGIN→SELECT母版FOR UPDATE→锁定当前序号→母版计数+1→INSERT版本→COMMIT；发生失败回滚时计数及版本一致回退，前端取消未提交草稿不占号。后端唯一索引兜底并发冲突，不从剩余版本数量或MAX(现存序号)重新分配；已保存任何版本的序号永久只读，不论是否被引用；删除、停用、排序不重排、不复用，允许历史空号。例：1/2/3删除2后新建应为4；同步测试并发创建、失败回滚与重试；MySQL DDL必须新增持久计数列并实测，不把批准冒充已实现。不得默认把1～4设成硬上限。

### 3.2 编号与引用

- 完整花型编号 = normalized(master_no) + '-' + colorway_no；产品货号 = pattern_no + '-' + normalized(fabric_no)。
- 母版编号/面料品号仅允许字母数字、去首尾空格并转大写；完整编号允许系统分隔横杠，花型/产品编号不能手填。
- 通过内部稳定ID关联；一对具体版本+一种面料对应唯一产品。数据库唯一索引加事务检查防重入。
- **任何已保存配色序号永久锁定**；母版号与面料品号已被产品引用时锁定；产品被任一已保存三类单据引用时锁定身份且禁删；产品未开单时允许重选版本/面料并提示货号变化。
- 启用链为母版、版本、面料、产品四个节点全为 active 才可用于新产品选择/开单；停用不级联改写历史记录。
- 删除/停用/规格更新中后端必须重查权限和引用；规格更新后**当前产品查询**读取关联面料最新值，但历史单据快照不自动变。

### 3.3 共享图片引用与生命周期

版本图的资产关联归 pattern_colorways；产品三类的资产关联归 products。上传单张、同类排序、替换、单张及选中批量解除关联；产品图库一次读取三类0～10张并保序；花型缩略图与原图使用**不同的按需读取动作**。释放关联不能直接删除仍在其他记录中使用的 image_assets，必须复用现有资产回收/引用检查。关联所有权、软删除/硬删除的精确时序在实施时基于现有服务契约补充分支测试。

## 4. API 候选契约（路径仅设计建议，实施前冻结 OpenAPI/TS DTO）

| 接口族 | 候选动作 | 服务端保障 |
| --- | --- | --- |
| /api/pattern-masters | GET 列表、POST、GET/PATCH/DELETE :id | 母版去重、题材关联、引用锁定、分页 |
| /api/pattern-masters/:id/colorways | GET、POST；/api/pattern-colorways/:id 的 PATCH/DELETE | 分配数字身份、每版独立图及标签、并发、引用 |
| /api/fabrics | GET、POST、GET/PATCH/DELETE :id | 品号/品名、gsm/mm、可空字段与成分筛选 |
| /api/tags | GET、POST、PATCH/merge/archive | 维度隔离、归一化、授权、归档追溯 |
| /api/products（V2契约替代旧契约） | GET列表/详情、POST、PATCH、DELETE；图片布局操作 | 选择版本ID+面料ID，货号生成，三类图顺序、禁删、备注、全库组合查询 |
| /api/fabrics/import/preview | POST Excel文件和显式映射参数，返回预览token/行明细 | 不写业务数据、行号/冲突/单位/错误分类、原始文件唯一标识 |
| /api/fabrics/import/commit | POST 预览token和管理员更新选择 | 重新校验权限、版本/映射及冲突；差异变化拒绝旧确认 |
| /api/orders 与 :id | 按现有三类型 create/update/read | 请求含库内产品ID或管理员临时字段；旧行由服务端按持久ID识别 |
| /api/access/* | 登录、当前用户、管理员账号管理与两权限开关 | 服务端会话、停用撤销、最后管理员保护 |

所有接口需约定统一DTO/错误码：400/422格式校验、401未登录、403动作越权、404不存在或跨人范围不可见、409唯一/版本冲突、500不可恢复错误。保存前端草稿不能作为权限/并发判断；服务端使用事务、行锁/乐观版本与唯一索引。

### 4.1 查询约束

- 花型支持母版号、完整花型号、数字配色序号、题材、原图颜色标签、启停；面料支持品号、品名、成分、启停；产品按**货号/品名独立双框 AND**，再与题材/颜色/状态组合。
- 同维度选多个标签用OR，跨维度 AND，全部在SQL筛选后分页；列表批量JOIN关联，只读当前页缩略图，大图按需；改查询条件从第一页加载并防旧请求覆盖新结果。
- 产品列表必须12列且有**产品自身remark**：花型图、货号、品名、成分、克重、门幅/cm、题材、颜色标签、图片数量、备注、启用状态、操作；不恢复面料主图首列/旧11列。
- 花型和产品约2,000条；正式验收在目标设备/网络上常用查询端到端P95 ≤1秒（目标，不是已有实测）。数据分布涵盖1母版多配色、1配色多面料、缺图和多标签。

## 5. 单据持久化、旧行保护与输出兼容

### 5.1 三种来源必须由后端区分

1. library：有效 product_id，由后台当次JOIN读取产品、版本、面料，生成完整货号、数字配色序号（写入现有色号栏）、品名/成分/克重/门幅只读快照。任何角色都不能在提交时篡改这些字段。
2. admin_manual：仅当前角色admin经明确切换允许无产品ID的临时明细；不自动入库，不伪造关联。
3. legacy_manual：**仅**更新原已保存订单中的原有无关联明细可保留原产品资料。服务端依据 order_id + 当前数据库明细主键确认原始行，且仅允许本人有授权业务员修改业务字段；删除/新增/替换不能伪装旧行。复制形成新订单时全部遵守新选择规则。

### 5.2 保存改造关键点

- 现有 PUT /api/orders/:id 为「删光旧明细再插入」，V2需先锁订单与原明细，按稳定明细ID比对来源、归属和内容，再在同一事务中执行差异更新/插入/移除；不能仅通过前端 oldFlag 或字段原值判断。
- 保存 library 新行先确认产品及上游链启用，再由服务端生成只读快照；更换产品保留米数、单价、分匹、扣损等原业务字段；已停用的**原保存**库内产品允许保留在旧单据，重新选择则受启用校验。
- 旧数据库 order_items.weight DECIMAL且订单解析将缺项归零；需要可空**V2数值+单位快照**（或等价兼容结构）。旧行保留原weight读法；新行若克重缺失则展示空，不伪造0；gsm与mm保持原单位，不换算。
- 三种单据既有计算/模板列不得随V2重排。转换层统一把存储值适配到 buildDocumentPrintModel 的文本字段；样布克重列显示数值+单位，定金与销售不擅自增加打印列；打印/Excel/预览读取同一已保存快照。
- 文档来源和旧行身份应可通过审计性单元测试重复证明；提交前服务端基于当前 actor 进行权限/归属/数据一致性校验。

## 6. 身份权限与安全

- 角色仅管理员/业务员；业务员默认看全部三库，但不能写；orders.manage_own 控制本人单据增删改；products.manage 控制三库维护、标签/图片及面料导入新增。
- **例外**：Excel重复品号的「明确更新已有面料」仅管理员；产品资料导出与账号权限配置仅管理员；管理员手工开单仅管理员。业务员两权限无继承，不能访问别人单据。
- 账号停用立即失效，权限撤销后已持会话写请求不能再获授权；至少一个有效管理员。复用[历史多用户权限实施计划](../../project/项目设计.md)中的已适用设计，不能把该历史计划视为已完成。
- 图片上传、访问和解除关联均校验产品/配色资源权限；API客户端不提交真实文件存储路径；不可把已签名COS URL持久化或公开图片源图给外部（外部扫码二期）。

## 7. 渐进迁移、风险与上线 Gate

| 风险 | 当前证据 | 对策/Gate |
| --- | --- | --- |
| MySQL DDL不兼容及静默JSON降级 | server/products/schema.ts；2026-09-26复盘 | INFORMATION_SCHEMA检查列/索引；全新、部分完成、重复启动实库演练；health.storage=mysql并验证真API |
| 旧产品数据获准废弃但FK/共用图片仍存在 | server.ts旧products、server/image-assets/schema.ts | 先只读盘点关联，验证受控清退旧产品专用表与V2原生重建次序，绝不级联删除历史单据/共用image_assets |
| 订单旧行伪造与整行重建 | server.ts PUT DELETE+INSERT | 原行锁+来源判定、稳定明细ID、越权/旧行回归 |
| 规格单位和空值误写 | order_items.weight DECIMAL，OrderItemSchema默认0 | 新单据独立nullable快照/显示适配，旧值保留，gsm/mm不混算 |
| 废弃旧产品路由但仍被app装配 | server/appAssembly.ts | 移除或明确阻断旧产品CRUD/导入，不保留双写兼容；所有三库入口统一V2 API并在后台做权限验证 |
| 性能/图像压力 | 2,000条目标；现有图片服务 | SQL索引/批量查询、缩略图分页、原图懒加载、P95采样 |
| 用户独立Stitch改动被覆盖 | [2026-10-12复盘](../../retrospectives/README.md) | 远程HTML/截图/画布三方差异核对，保护产品备注列 |
| 已有库存、单据与数据回退 | 项目既有传统业务及fallback | 隔离测试库、正式备份、灰度/回滚方案；业务数据不随部署或文档清理删除 |

发布前强制：①需求/UI剩余项确认；②目标数据库结构、备份及回滚复核；③ lint/build/相关单测/安全/图片/打印Excel回归；④三单据真实权限及历史行测试；⑤2,000条查询与图片加载压测；⑥目标commit、PM2、storage=mysql、业务API与数据一致性检查。**提交/推送/部署/导入真实数据需另行明确授权**。

## 8. 待确认与下一轮冻结点

- D-01（**2026-10-12业务已批准**）：自动递增、保存后任何配色永久锁号、删除不复用、取消草稿不占号；持久计数器/锁与AC-71真实MySQL及并发验收仍待实施。
- D-02（**UI已获用户批准，2026-10-12**）：当前Stitch七页，包括花型与数字配色、面料维护、产品列表12列（含备注）、产品维护、Excel预览、三种单据选品，按[Stitch当前设计登记](../../product-master/product-master-v2-stitch-design-review.md)实施；正式落地前核对最新远程画布并保留用户编辑，UI批准不代表业务后台已经交付。
- D-03（**2026-10-12业务已批准，后于 v1.47 修订为仅.xlsx**）：按现行需求只支持.xlsx，不再支持.xls；七列表头、允许工作表/表头行选择、常用别名与人工映射、克重gsm/g/m²/克/平方米同类与mm/姆米同类规范化、单位缺失人工确认、冲突失败、标准门幅cm无自动换算保持。**技术须实测真实.xlsx解析、公式单元格/错误文件与权限**；不因ExcelJS存在推断解析已验证。
- D-04（业务范围已确认，技术清理顺序待DB核验）：旧产品数据/旧API可淘汰，不实施旧products扩列或兼容桥；新建V2原生结构。实际表名、FK删除/重建顺序及共享image_assets保全须先完成实际数据库元数据检查。
- D-05（技术待审）：订单快照字段最终DDL与旧打印适配、历史归属字段填充方式；只保护并兼容原始单据，不做二期快照自动刷新。
- D-06（测试待定参数）：模拟母版/配色/面料数量分布、设备网络、P95采样方法；目标仍为95%≤1秒。

## 9. 对应文件与测试追踪

- 业务依据：需求第4～8、9.3、10、12、14节及AC-01～12、AC-19～72。二期AC-13～18不进入一期Gate。
- 当前设计/交互：docs/product-master/product-master-v2-stitch-design-review.md、numeric-colorway-ui-review.md、fabric-import-ui-review.md、document-product-ui-review.md；本地Stitch当前七页登记。
- 预计代码影响：server.ts、server/appAssembly.ts、server/products/*、server/image-assets/*、server/documentPrintAdapter.ts、src/types.ts、src/lib/products.ts、src/components/{ProductLibrary,DocumentEditor}.tsx、src/lib/documentPrintModel.ts；新增主数据与访问领域模块；精确改动位置由每阶段工作包确定。
- 验证口径：docs/development/开发与验证规范.md、项目现有 test:unit/test:image-assets/test:security/test:image-export/test:all；不能把脚本存在写成已测试。

**结论**：本文件是把已批准业务规则落实成可审查的技术候选，并明确未批准项与数据兼容防线。实施须按对应计划逐阶段执行与记录真实测试。
