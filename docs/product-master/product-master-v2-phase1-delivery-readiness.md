# Fabric V2 一期交付检查与验收边界

> 现行检查入口，核对：2026-10-24。当前版本和剩余事项只查[项目现状](../project/项目现状.md)，业务以[现行需求](product-master-v2-requirements.md)为准。本页不重复发布流水，不授予生产操作权限。

## 当前源码与历史证据

唯一正式源码为 `D:/fabric`。`server.ts` 已启动 V2-only 运行时，`src/App.tsx` 已装配 V2App；旧内嵌工作区、“尚未接线”“正式旧登录仍运行”等早期结论不再适用。现有源码、本机测试、已记录的生产发布及本次真实环境验收分别判断。

10-19 的正式迁移、演练及签收 JSON 已[成套归档](../maintenance/文档整合与恢复.md#历史发布证明的使用)，只证明其原版本和环境。此前编辑后的正文与 proofSha256 失配，本轮已从 Git 历史恢复匹配全部 8 项摘要的原签收包；不重新计算摘要冒充原审核人重新签收。恢复原件与本页修改前历史在同一仓库外恢复索引中。

## 只读检查

```powershell
node scripts/check-fabric-v2-phase1-delivery.mjs --status
```

该命令只做源码接线及证据结构检查，不连接数据库、不启动服务、不读取历史签收 JSON。未显式提供外部证明时，八项验收可显示 pending，`readyForReview:false`；这不能推导当前生产未上线。正式接线结果由实际 AST 检查判定，不预写固定失败数。

显式 `--evidence docs/operations/<本次证明>.json` 才读取选定证据。必须是 `fabric-v2-phase1-evidence-v1`，每个 passed 项包含 reviewedBy、受约束 Markdown proof 路径及 SHA-256 proofSha256。检查器从磁盘读取原文，拒绝缺失、摘要失配、空审核人、越界路径、符号链接及过大文件。历史证据需在独立审查检出完整恢复后复核，不能拿原日期签收直接代签新版本。

## 八类验收范围

| Gate | 需要的真实证据 |
|---|---|
| P1_production_schema_and_migration | 目标 MySQL 身份与版本、DDL/约束、幂等迁移、历史原列保护 |
| P1_backup_restore_and_rollback | 同一冻结点的可恢复备份、隔离恢复、离机解密和回滚责任 |
| P2_live_identity_roles_and_legacy_cutover | 正式角色、跨账号/owner 拒绝、会话撤销、旧接口拒绝 |
| P3_real_catalog_CRUD_media_COS | 三库真实读写、图片授权、共享引用及 COS 生命周期 |
| P4_seven_pages_business_UI_acceptance | 对应版本实际页面与弹窗、浏览器交互及用户视觉接受；历史 Stitch 批准单独保留 |
| P5_real_XLSX_import_and_rollback | 仅 xlsx 的真实预览/提交、冲突、并发与失败回滚 |
| P6_old_and_new_three_document_roundtrip | 三单据保存回读、打印/导出、旧明细与共享图片保护 |
| P7_full_E2E_auth_and_P95 | 对应环境的全链路安全、适用性能目标及部署恢复演练 |

只按本次变更和约定验收范围补证据；不因日常小修重复全量业务测试，也不把 HTTP、恢复库、本机替身或浏览器模拟当作生产数据和微信真机验收。纸质输出、微信真机、库存等仍按项目现状和实际任务登记。

## 发布与资料处置

`readyForReview:true` 仅表示指定检查资料齐备可评审，`releaseAuthorized` 恒为 false；发布许可来自用户明确授权，不由检查器授予或撤销。真实 MySQL 写入、生产切流、COS 变更及旧库清退按各自授权执行。发布入口为[统一发布工具](../operations/统一发布工具.md)，失败只恢复受版本保护的程序，不覆盖 V2 新数据或启动旧可写 worker。

唯一状态仍为项目现状。本页维护检查契约和证据定位；旧逐日切片、静态失败数及远程时点记录只在仓库外恢复，不继续追加在本页。任务收尾按[知识维护规则](../maintenance/知识维护规则.md)处理独有约束、开放 Gate 和恢复备份，归档不是业务签收。
