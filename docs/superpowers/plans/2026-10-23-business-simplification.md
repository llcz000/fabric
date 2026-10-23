# 小规模业务状态与删除精简 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans；本会话原生执行，用户已确认完整简版并要求继续实现。

**Goal:** 取消资料状态维护，统一最小删除事件，保留直接删除及关联保护。
**Architecture:** 复用React表格/弹窗和既有MySQL事务；新增独立最小事件表，不建管理页。显式登记迁移统一未删除资料旧状态；保留字段和安全校验，API禁止新停用。无本轮生产部署。
**Tech Stack:** React / TypeScript / Node / MySQL / node:test / Playwright Edge。
**Spec:** docs/project/项目需求总览.md §2.3.1 LITE-01～06（用户本会话确认）。

## Global Constraints
- 单据直接删除，不存全文/明细快照，不加作废或回收站。
- 客户/色卡/选样历史、账号启停、权限、共享媒体和引用保护不变。
- 最小事件和删除同一事务，记录失败整体回滚；迁移必须备份/身份/锁/摘要保护且可重入，不能在启动执行。
- 取消状态控件，不新建页面；保留待回访、重点客户、重新打印标记。

## Review Focus
- 旧停用资料统一可用但已删除对象/旧码不复活；迁移测试负责。
- 删除失败/重复/权限撤销不产生成功事件；事务行为测试负责。
- 单据owner/admin各路径均留痕且删除明细/关联；documentLifecycle测试负责。
- 停用false和暂不可选样false不能经旧客户端重新写入；输入校验测试负责。
- 表格列、colspan、编辑提交、取消/Esc/窄屏与产品建卡入口一致；组件及浏览器测试负责。

### Task 1: 事务删除事件及登记迁移
**Files:** server/audit/deletionAudit.ts、businessSimplificationSchema.ts及测试；七类删除服务；scripts/release/migrations.ts、core.mjs与rehearsal。
**Interfaces:** recordDeletion(db,actor,{type,id,label}):Promise<void>；迁移migrateBusinessSimplification(db,target,backupSha):结果含planSha256/alreadyApplied与旧状态盘点。
- [x] 先补最小字段、失败回滚、所有单据删除记录及迁移幂等/拒绝错误身份测试，运行观察失败。
- [x] 实现共用事务事件；连接各删除路径及SQLite/模拟测试夹具。
- [x] 实现只对未删除资料的状态归一迁移、元数据验证与统一发布登记/隔离演练。
- [x] 运行删除/迁移/权限专项，记录证据。

### Task 2: 取消资料启停与不可选样
**Files:** patternMasters、colorwayIdentity、fabrics、productsV2；正式库组件/模型/样板及测试。
**Interfaces:** 兼容true和旧字段读取，拒绝false；界面不发送状态补丁，旧停用由Task1登记迁移转换。
- [x] 补API拒绝新停用、表格无状态/筛选、编辑不带状态的失败测试。
- [x] 删除正式UI状态及重复提示，收敛API状态校验，保留引用/删除保护。
- [x] 定向模型/服务/组件验证，实际桌面/360px表格和弹窗浏览器测试。

### Task 3: 验收与交付
- [x] 定向类型、相关单测、正式前后端build、UI浏览器套件串行；独立代码审查后处理重要问题。
- [x] 更新候选源码、生成实际截图/交互/工程UI报告并通过ui:verify。
- [x] 需求/当前状态/同主题复盘登记；生产迁移/真实MySQL/用户视觉/部署分别记录待验；旧证据保留。


完成证据：R2 `20261023t085615057-b2ac7559`：229项定向、发布器19项、专项Edge13项、完整UI35项、面料46项、定向类型、正式构建/HTTP合同通过。真实MySQL隔离恢复56表、41个产品旧状态归一、迁移幂等及日志回滚通过；生产index/backend/starter/nginx与基线一致，未部署。独立审查额度中断，作者单独源码复核完成，未记独立PASS。用户新增客户/开单三项反馈继续实现，最终候选须更新。
