# 客户档案、选样关联与客户维系设计

状态：原业务方案已批准；2026-10-20 16:55用户明确客户轻量档案本轮实现，唯一需求更新为v1.53。本轮具体范围及专项验证策略见[本轮交付设计](2026-10-20-folder-import-light-customers-design.md)，本地实现已完成，真实客户表迁移及上线尚未执行。本文保留原工程提案；最终七表实现、JSON子项及选样关联旁表见[实现记录](../../product-master/README.md)，不以原表草案替代实际代码。

## 目标与方案选择

用户希望从产品查到色卡、筛出未建卡产品，并在客户选样时积累可长期维护的客户档案，支持重点客户维系。已批准管理员全量、业务员本人/获授权，负责人＋协作人。

可选方式：只给选样单加字段实现快但重复建档且难汇总；轻量客户主档案能关联多次业务并复用寄样/跟进；完整CRM需要额外商机、营销与财务体系。本轮选第二种。只实现服务此目标的客户资料、历史汇总与待办，不追加公开客户门户或黑盒评分。

## 现状与边界

- 已发布源码位于 `D:/fabric/.agent-workspaces/v2-quality-20261020`，真实Git工作树HEAD4f56b15叠加发布增量。12:02已部署的包保留独立不可变摘要；本轮开发不能冒充已上线。
- 产品由具体配色＋面料确定；sample_cards对未删除母版/面料组合唯一。第一步无需改表，只补API投影、过滤、UI及建卡预填。
- customer_sample_sessions现只有customer_reference和创建者；已有session_access、选样产品、扫码/人工来源、寄样批次和sample_followups。不会为客户模块重造这些业务事实。
- 现有订单只有保存时客户文本等资料，未形成客户稳定身份。客户档案不能按名称直接拼订单金额，也不能绕过单据owner权限。

## 实施切片

1. 产品色卡：显示卡号与停用/需重印，全部/已关联/未关联；查看或预填建卡；后端全库过滤、同条件计数/导出、保留历史卡。独立测试和交付。
2. 客户主档案：资料、负责人/协作ACL、列表与详情；已有客户选择/快速建档并建选样，旧单显式关联；复用选样/寄样/跟进读视图。
3. 客户维系：客户级跟进、明确的待办状态、今日/逾期/待反馈视图、人工等级及阶段看板。订单显式关联与成交/复购指标属于后续可独立验收切片，未关联前隐藏指标。

## 数据模型（工程提案）

所有ID由服务端生成，BIGINT按字符串传输；时间存UTC，页面按业务时区Asia/Shanghai计算“今日”。新增FK统一RESTRICT，档案仅归档，不物理清除历史。row_version用于并发写入。

| 表/改动 | 责任与关键字段 |
|---|---|
| customers | id、display_name、subject_type(company/individual/unknown)、invoice_title可空、region、sales_channel(online/offline/both/unknown)、owner_user_id、created_by_user_id、tier(A/B/C/unrated)、tier_reason、relationship_stage(prospect/sampling/trading/repeat/unknown)、stage_reason、archived_at、row_version、timestamps |
| customer_contacts | customer_id、name、phone可空、wechat可空、is_primary、row_version；至少保留一种非空联系方式；仅做可见字符/长度校验，不把国际手机号强制按中国11位规则拒绝 |
| customer_brands | customer_id、name；同客户规范化重名去重，不强迫品牌名称全库唯一 |
| customer_price_preferences | customer_id、fabric_category文本、min_price/max_price可空、currency、unit(metre/yard)、tax_basis(included/excluded/unknown)、remark、row_version；至少一个区间端点，非负定点小数，下限≤上限；按原口径展示不自动换算 |
| customer_access | customer_id、user_id、permission(view/edit)、granted_by、granted_at；客户/用户唯一；只允许有效账号 |
| customer_sample_sessions追加 | customer_id NULL外键＋关联版本/关联操作者，保留customer_reference原文与既有来源记录；旧数据不自动填customer_id |
| customer_profile_events | 客户资料关键变更、归属/授权、旧单关联/撤销的追加审计；不记录密码、会话令牌或整份敏感请求 |
| customer_followups（切片3） | 客户级联系记录、操作者、联系日期、反馈/结果、可选session_id；关联选样必须属于同一客户；不重复写入已有sample_followups |
| customer_followup_tasks（切片3） | customer_id、负责人、due_on、next_action、status(open/done/cancelled)、可选来源跟进ID、row_version；来源唯一/请求幂等，完成留历史 |

快速建档的必填工程提案为“客户名称＋主联系人至少一种电话/微信”；主体类型未知、开票抬头、品牌、预算、评级均可后补。该必填细节随书面设计审阅确认，不能把完整开票/税号/银行信息作为选样前置。首次只维护一个主要开票抬头，额外开票主体以后扩展为子表，不将客户与某个品牌/抬头强行设全库一一对应。

## 权限与归属（统一服务端谓词）

- 每次请求验证当前账号与会话。管理员可读全部；业务员仅owner或明确ACL。view可查资料/有权历史，edit可改资料和开展开放状态的业务；协作人不能自行扩散授权。
- 新档案默认当前账号负责；只有负责人或管理员可授予/撤销协作。转移负责人仅管理员执行并留审计，不把owner变更混同created_by。
- 链接客户后的选样/寄样/跟进以客户权限为访问上限；customer owner/edit可管理开放单，view仅只读，关闭单继续拒绝写入。旧session_access不得绕过已关联客户的撤权。
- 未关联旧选样单维持原session_access范围；管理员整合视图与新客户规则通过新服务显式实现，不把旧服务现状假定为管理员已有全量访问。
- 新权限不改变orders的原owner规则。客户详情里的“相关订单”只能返回该账号原本可见且已显式关联的订单，客户view/edit不能访问别人单据。
- 列表、搜索建议、重复提示、分页总数、历史/待办同一范围。无权ID统一404，错误/日志不透露其他业务员的客户名称与联系方式。重复提示仅针对可见档案，管理员可做全量人工核查；姓名/电话不作为未经确认的全库自动合并键。
- 撤权、停用立即失效；同事务持账号/会话与客户权限锁，再锁客户/选样，防止检查后撤权。不会只靠UI过滤。

## 工作流与接口（工程提案）

- 客户页：检索名称/联系人/品牌、本人/授权范围、经营渠道、等级/阶段、归档状态；详情有资料、选样与寄样、跟进时间线、待办四块。价格信息仅内部可见，未知显示“未填写”。
- 新建选样：选择客户或快速建档。`POST /api/v2/customer-samples/sessions`接受customerId；快速新建走专用`POST /api/v2/customers/with-sample-session`，档案/联系人/负责人/选样及授权同事务创建，携带幂等请求ID。取消不提交；异常全部回滚；重试返回同一结果。
- `GET/POST /api/v2/customers`，`GET/PATCH /api/v2/customers/:id`；更新要求expectedRowVersion，不匹配409并保留草稿，不静默覆盖。
- `PUT /api/v2/customers/:id/access/:userId`、`DELETE ...`、`POST .../transfer-owner`；权限与目标账号均现场复核。`POST .../archive`只停止正常新业务，不物理删除历史。
- `POST /api/v2/customer-samples/sessions/:id/link-customer`须同时有旧单管理权及目标客户edit，确认expectedCustomerId和旧名称；冲突409。重复同目标幂等；改关联/撤销有明确确认及审计，不能静默拖动客户名批量归并。
- `GET /api/v2/customers/:id/activity`在数据库限定客户及账号范围，分页汇总现有选样/寄样/sample_followups与新客户级跟进；返回记录种类及原始ID，避免跨表ID碰撞和重复计数。样品数量不按多次扫码重复累计。
- `POST .../:id/followups`保存真实联系事实；安排下次跟进在同事务创建任务，不双写sample_followups。`GET /api/v2/customer-tasks?status=open&due=today|overdue`按Asia/Shanghai日期分桶。完成/取消任务使用预期版本，保持审计。
- 旧sample_followups的历史“下次跟进日期”先作为原记录展示，不自动把已被后续跟进替代的旧日期全部变成逾期任务；需显式确认才补建待办。

## 迁移与兼容

扩展式迁移：先新表及可空customer_id，验证目标MySQL身份、DDL合同和可恢复备份，在恢复的隔离库重复执行/回滚演练；生产启动始终只读schema，不自行建表。旧选样可继续按原范围读取；新客户功能在schema未准备好时明确不可用，不退回无权限筛选的字符串接口。

迁移不猜客户身份、不按同名合并、不改历史客户文本、不重写产品快照或现有寄样跟进。降级程序可忽略新增表/字段，不能为了回滚删客户或已关联记录。新功能部署/真实迁移属于后续独立操作，不因开发完成自动执行。

## 验收与测试设计

- AC-101～103：同组合多配色、错组合、停用/删除/重建、过滤分页计数与导出、URL恢复、预填建卡取消/重复/失效，实际组件与HTTP回归。
- AC-104～107：真实MySQL快速建档＋选样原子性、幂等重试、同名不合并、旧单关联与版本冲突；管理员/本人/协作view/edit/无权/撤权/停用矩阵，列表总数和ID直访均拒越权；借客户权限读取他人订单必须失败。
- AC-105：空预算与0不同；上下限/小数/币种/单位/含税组合、多个品牌和联系方式校验。
- AC-108～109：多次选样汇总无重复、寄样不算成交、普通历史跟进不产生伪逾期；跨UTC/上海日期边界、今日/逾期、任务完成/取消与并发；人工等级理由及阶段原因。
- 适量有代表性的隔离/脱敏资料验证索引与分页，不用生产客户写入测试；代码、迁移、浏览器、正式环境验收分别记录。

## 本次设计自审

已检查：单客户/多品牌与开票主体不混同；关联而非同名拼接；客户ACL与旧单/订单权限边界明确；新旧跟进不双写；历史下次日期不冒充未完成任务；不许预算推定成交/价值；旧发布证据不可变。切片2/3书面设计待审，切片1按已批准小范围方案独立开发；没有把业务批准写成客户模块已实现。
