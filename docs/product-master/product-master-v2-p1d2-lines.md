# P1 历史订单归属与稳定明细技术说明

用途：保护旧单据、owner及行ID。当前状态见[进度](product-master-v2-progress.md)，业务规则见[需求9.3](product-master-v2-requirements.md)。2026-10-15提炼，不构成生产迁移。

## 历史数据与兼容

2026-10-12只读现场记录119单/150明细，其中7张无明细订单有效；数量会变，迁移日重新快照。生产`order_date DATE`、公司打印字段、已有明细主键及字段长度可能与server.ts建表模板不同，必须核实际 INFORMATION_SCHEMA，不用源DDL代替现场。

`schema.ts`仅隔离演练过可空`created_by_user_id`、索引及到用户的 RESTRICT FK；历史owner不回填。`lineSchema.ts`只为隔离演练新增可空`v2_product_id/v2_source_kind/v2_product_snapshot`与索引、RESTRICT FK、来源 CHECK；旧行全部NULL，不伪造历史来源。部分迁移状态必须拒绝，不能静默修复。

## 稳定身份与来源

- `repository.ts`按订单owner及`id AND order_id`窄更新；`lines.ts`锁订单与原行，显式新增、显式removeIds、原ID更新，漏传不代表删除。
- 新选/更换产品时，服务端重查产品→配色→母版→面料四级启用，冻结货号/数字配色/品名/成分/gsm或mm/门幅；客户端不能自填产品快照。
- 管理员显式manual新行可用；销售即使双授权也不能新增/替换手工身份或伪造legacy。本人已有未关联历史行只允许授权业务字段编辑。
- 旧兼容列长度及DECIMAL精度不足时返回422，不能静默截断；V2货号160、品名255、成分500、克重3位与旧字段扩容须先评估。完整金额/表头/输出由[P6](product-master-v2-p6-document-write-read.md)统一保存，不能直接把低层对账当正式接口。

## 历史验证与未完成Gate

2026-10-12 MySQL8.0.46固定`fabric_v2_test_20261012_p1d`、`..._p1d2`至少两轮演练：加法迁移前后旧快照/行ID不变、owner/来源NULL、真实FK/CHECK拒绝非法关系、主数据改变不改已存单据、失败全回滚；合成业务最终归零。源码专项定位`schema.test.ts/repository.test.ts/lineSchema.test.ts/lines.test.ts`，脚本为`test-v2-order-owner-mysql.ts/test-v2-order-lines-mysql.ts`，本轮未执行。

正式旧PUT/owner及来源列迁移未切换；迁移锁、备份/回滚、旧进程停写、全接口本人范围、历史金额/匹数/公司打印兼容仍待验。不能让旧入口继续写NULL owner而同时开放新的销售写入口。
