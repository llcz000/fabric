# P1 结构初始化与版本迁移技术说明

用途：核对 schema 引导、漂移拒绝和迁移边界。业务以[唯一需求](product-master-v2-requirements.md)为准，状态只看[进度](product-master-v2-progress.md)。2026-10-15提炼，以下实库证据发生于2026-10-12，本轮未重跑。

## 代码与安全契约

- `server/image-assets/schema.ts`区分 legacy/v2；`bootstrapTarget.ts`与`bootstrap.ts`只供固定测试库，先核共享`company_config(id)`，未知模式或目标在DDL前拒绝。核实际库名与全部DDL必须使用同一物理连接，异常也释放连接；默认启动不自动执行V2 DDL。
- `server/product-master/schemaContract.ts`读取 INFORMATION_SCHEMA 的列类型/可空、联合唯一顺序、FK及删除规则、关键 CHECK；缺失或漂移拒绝，不自动 ALTER/REPAIR。
- 已有母版但缺`next_colorway_no`视为早期V1，禁止用 CREATE IF NOT EXISTS 掩盖；`planV2SchemaUpgrade`只对已证实空数据的受支持V1生成固定升级计划，不认识版本或V1含数据均拒绝。
- `scripts/test-v2-image-bootstrap-mysql.ts`、`test-v2-version-migration-mysql.ts`是隔离演练入口；同一远程MySQL实例的独立数据库，不是独立服务器，更不是生产命令。

## 历史验收证据

2026-10-12 MySQL8.0.46：`fabric_v2_test_20261012_p1c`两次初始化，1张公司配置桩、5张共享图片基础表、8张V2表共14张且0业务行，未建旧产品表；`fabric_v2_test_20261012_p1c2`完成V1→固定ALTER→版本2账本→全结构复核，重跑不重复ALTER。原输出`P1C_IMAGE_V2_ISOLATED_PASS`、`P1C2_VERSIONED_REHEARSAL_PASS`。详细原文、时间及哈希由[维护记录](../maintenance/2026-10-15-项目内容清理.md)定位。

**2026-10-15新增AC-71锁/备份恢复离线审查合同**：`migrationLockRollbackPlan.ts`复用已存配色永久编号快照检验，要求沙箱目标/观察身份一致、备份/异库恢复及审核引用一致、显式认知MySQL DDL隐式提交无法靠事务ROLLBACK撤销；只生成`executable:false`审查步骤。ACP执行终态取消，总控独立复验23/23及双文件安全合并。真实锁、事务、备份、恢复与迁移批准仍需独立验收，不能据离线合同宣称正式迁移安全。

## 未完成Gate

**2026-10-15新增AC-71离线安全前置**：`server/product-master/colorwayMigrationPreflight.ts`与30项测试验证当前持久计数器严格大于现存配色序号最大值、接受删除留空号与超安全整数范围的十进制字符串、拒绝反向/重复/溢出；不自动修复，也不证明历史删号及实时数据库快照可信。只有得到可信一致性读取、真正锁/事务、备份和回滚授权后才能用于迁移准备。生产迁移器、迁移锁、DDL隐式提交后的前滚/回退、备份恢复、启动接线和真实COS未验；关键契约检查不代表逐字核验所有默认值/表达式。默认legacy与旧产品/订单/图片链保留，正式切流和旧数据退出分别授权。
