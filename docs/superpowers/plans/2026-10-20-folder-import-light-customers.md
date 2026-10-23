# 文件夹导入与轻量客户档案实施计划

> **For agentic workers:** Use superpowers:executing-plans; independent import and UI units may use dispatching-parallel-agents with exact file ownership. Steps use checkbox syntax.

**Goal:** 完成本轮文件夹/多文件花型导入和轻量客户档案闭环。
**Architecture:** 现有导入共用规划与保存；客户采用独立资料、ACL、选样关联、历史和跟进待办服务，旧选样入口统一接入当前客户权限。运行时仅验schema，缺表隔离新功能。
**Tech Stack:** React、TypeScript、Express、MySQL8、node:test；不增加依赖。
**Spec:** 主入口`docs/project/项目需求总览.md`2.4/2.11；`docs/superpowers/specs/2026-10-20-folder-import-light-customers-design.md`。

用户17:08确认“可以，继续，一次性都实现好”，本会话连续执行，保留先前直接实施方式，不重复业务确认。沿用现有隔离工作树及只读Git元数据；以源码清单交付，不提交/推送、不部署、不执行生产迁移。依据用户16:56要求不运行全量测试。

## Global Constraints

最少客户名称＋电话/微信；其他资料可后补。客户权限不扩大三单据owner权限。已关联选样全部入口受当前客户ACL约束；旧单不按同名合并。价格小数/原币种单位保留，未知不补零。正常启动无DDL。保留此前分享、导入修复和历史证据。

## Review Focus

目录跨层同号不得静默选图；客户撤权不能借旧session_access访问；客户关联不能改变选样历史；幂等键同请求复用、异内容冲突；关闭/归档与view协作不能写；未知价格不变0；草稿/晚响应/账号切换不能泄漏资料。

### Task 1: 目录与多文件导入

Files: `PatternBulkImportDialog.tsx/.test.ts`、`patternBulkImportModel.ts/.test.ts`。
Interfaces: 保留`planPatternImageImports`和保存接口，两个选择入口共用批次。
- [x] 写选择目录、多文件、取消、跨目录冲突测试并观察RED。
- [x] 实现目录选择和能力降级，沿用已有暂停/草稿保护。
- [x] 跑四份导入专项，确认GREEN。

### Task 2: 客户资料、权限与持久化服务

Files: 新`server/customers/{model,access,schema,service,routes,sessionBridge}.ts`及对应测试。
Interfaces: 客户DTO、`/customers`资料与原子建档选样、`/customer-tasks`、`/customer-samples/sessions/:id/link-customer`；关联客户查询/锁为统一服务，旧单沿用旧grant。
- [x] 先写资料/价格、ACL/撤权、事务幂等和日期待办测试并观察RED。
- [x] 实现新表/迁移合同、独立客户API和历史聚合；不复制既有选样/寄样事实。
- [x] 接入选样目录/扫码/读写/图片授权，锁客户后锁选样并再次校验关联，避免并发换关联绕过。
- [x] 跑客户服务、HTTP、选样与寄样/跟进受影响专项，确认GREEN。

### Task 3: 客户界面与选样接线

Files: 新`src/components/customers/`；修改V2导航/实际V2App及SampleBusinessWorkspaceV2。
Interfaces: 与任务2同一DTO；GET `/customers/capability`控制新流程；快速建档/已有客户走`/customers/with-sample-session`；详情可打开已有选样实际Session组件。
- [x] 先写整页建档/复用、权限只读和验证草稿测试并观察RED。
- [x] 实现资料/历史/授权/跟进任务和旧单关联入口，导航真实挂载。
- [x] 跑组件与客户端专项，确认GREEN。

### Task 4: 整合审查与交付

- [x] 一次独立代码审查，修复实际问题并跑覆盖回归。
- [x] 仅受影响专项测试；收尾一次TypeScript和build，不运行全量。
- [x] 冻结新源码清单、主需求及详细规格SHA，核对入口/文档，导出迁移SQL及摘要，登记真实MySQL/浏览器未验证边界。

本计划自审：目录独立；客户服务产生DTO→UI消费；桥接产生ACL→旧选样读写消费。单元边界和文件所有权分别交接。若原型揭露接口矛盾，记录最小决定并继续，不扩大CRM范围。

本地实施和专项验证完成；真实MySQL/浏览器/生产验收未执行，见实现记录。全部记录保留，不提交/推送或删除共享工作树。
