# V2 质量修复与渐进重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 当前用户已批准按优先级全部执行；单执行者完成本计划，最后独立评审，不派发编码ACP，不自动提交/推送/部署。

**Goal:** 修复本轮两项P1及旧测试，统一数值/权限合同，收敛唯一开发来源，并按职责拆分活跃UI、登录导航和后端重复授权事务逻辑。

**Architecture:** 保持现行React/Express/MySQL结构、路由、DTO、UI和锁顺序。以今日发布源码及已验退役候选为基线，在Git隔离工作树逐文件核验增量；共享模块只承载纯规则和相同的账号/会话复核，业务行锁、引用与图片账本仍由领域服务负责。

**Tech Stack:** TypeScript、React、Express、MySQL、node:test、既有esbuild执行器。

**Spec:** 业务以`docs/product-master/product-master-v2-requirements.md`现行v1.50相关§8/9.3、AC-20/66/68/71/73为准；工程依据为`docs/product-master/product-master-v2-code-review-20261020.md`与用户2026-10-20“按优先级全部修复”授权。本计划不修改业务需求或补造上线验收。

## 全局约束

- 保留数字配色永久序号、gsm/mm不换算、null不补零、三类历史单据身份与冻结产品快照、当前公司输出设置。
- 两角色均可确认更新重复面料；账号管理/手工录单及owner例外维持服务端限制。
- 页面外观、公开导出签名、路由和旧分享链接保持；只做职责拆分与已批准缺陷修复。
- 授权事务保持user→session→领域行的原锁序，不将SQL移到事务外；身份目标校验、故障回滚/释放仍强制。
- 全量、tsc、build与HTTP测试串行；不读取/复制凭据，不访问生产DB/COS写入，不删除旧数据或知识文档。
- 原master脏改动不覆盖；原发布源保留作运行版本。新开发来源通过精确HEAD和内容清单明确，不把多个目录都标当前。

## 复核重点

1. 合法19.99/0.29/145.01、真正三位小数、非有限数和null规格。
2. admin/sales相同导入确认能力，未授权/无权限、文件内重复、过期预览和原值改变仍拒绝。
3. UI请求旧响应、取消/写入中/失败重试、跨Tab草稿和事件冒泡。
4. 登录切换的旧401、过期/跨页恢复、导航取消草稿及公司图片URL释放。
5. 事务锁序、账号/会话撤销、commit失败、回滚失败和释放；测试不得代替真实MySQL锁/FK验收。

### Task 1：P1与共享业务规则

**Files:** `src/lib/businessRules.ts`及测试、`server/order-v2/lines.ts`及测试、`server/product-master/fabrics.ts`、`server/access/policy.ts`、`src/components/product-master-v2/FabricImportV2.tsx`、`fabricImportModel.ts`及测试。

**Interfaces:** 纯函数`isDecimalValue(value,scale,integerDigits)`检验number的十进制表示、不改值；`isRegisteredBusinessRole(role)`只认可admin/sales。导入表使用实际canManage能力，角色不能额外限制覆盖；服务端仍最终授权。

- [x] 给既有导入/选品测试增加上述精度与两角色用例，删除固化旧规则的预期，观察正确RED。
- [x] 最小修复并提取纯规则，覆盖null/超精度/无权限/重复行等负例，专项GREEN。
- [x] 通过实际导入组件确认勾选和提交请求相同，记录证据。

### Task 2：活跃UI职责拆分

**Files:** `PatternLibraryV2.tsx`、`SampleCardLibraryV2.tsx`、`ProductEditorV2.tsx`及邻接新文件。

**Interfaces:** 原模块保留既有公开export作兼容；将花型行/标签/配色编辑、色卡二维码/创建对话框、产品身份/图片Tab/选取对话框分入独立模块；原父组件只编排业务状态。

- [x] 先运行既有行为测试取得基线，补跨拆分边界的取消/忙态/失败及实际渲染合同测试。
- [x] 按已有组件边界移动代码，明确所需types/import与共享样式，不改DOM/文案/API。
- [x] 每组专项通过再处理下一组，不批量替换旧无关组件。

### Task 3：登录、公司资源和导航拆分

**Files:** `V2App.tsx`及邻接`useV2Identity.ts`、`useV2Navigation.ts`、`useV2Company.ts`、相关测试。

**Interfaces:** 身份hook管理token/恢复/跨页同步/登录退出；公司hook持有读取与blob资源释放；导航hook持有历史索引/返回/草稿保护。外层V2App仅按view渲染既有工作区。

- [x] 以既有App、uiExperience、loginStorage、backGuard行为测试为先验，必要时补请求竞态用例。
- [x] 逐段抽取并保持callback依赖、清理时机和旧请求不能清新身份的约束。
- [x] 回归扫码直达、登录、保存/取消、返回及设置保存刷新。

### Task 4：后端重复授权事务收敛

**Files:** `server/access/catalogTransaction.ts`及测试、`server/product-master/fabrics.ts`、`productsV2.ts`及匹配的同合同模块。

**Interfaces:** 共享当前账号/会话复核与事务生命周期，注入领域错误factory；业务锁/查询参数、错误码及返回类型不变。

- [x] 新公共模块先写锁序/撤销/角色变化/提交故障/回滚释放测试并观察RED。
- [x] 接入已有重复模块并跑领域/图片/引用回归；不合并行为不同的单据/扫码锁过程。
- [x] 复核每个事务内检查未移出，无事务外新写、无默认重试与静默异常吞掉。

### Task 5：唯一来源、最终回归与交付

**Files:** 来源清单/检查脚本、原审查报告、当前进度、同题复盘与索引；Git工作树精确变更清单及证据。

- [x] 登记一个当前开发工作树和实际运行发布来源，源HEAD/需求SHA/逐文件摘要可检查；候选提升后旧review副本仅作为历史基线，避免两个当前入口。
- [x] 运行完整单测→lint→build→安全/图片/来源Gate，必要的真实恢复库/浏览器验证按实际可用环境补齐；未执行的独立Gate明确保留。
- [x] 对需求、行为及差异做最终复核；独立审查能力若仍受限，记录事实，不冒充通过。
- [x] 更新同题复盘和唯一状态，相关历史记录保留/归档候选不适用；不删除或迁走记录，不Git提交推送、不部署。

## 执行记录

详细任务进度、RED/GREEN、裁定和证据保存在本轮`artifacts/v2-quality-refactor-20261020/progress.md`，不是另一份业务需求或当前状态。


执行收尾：本地代码/专项/串行全量验证通过；具体结果与真实MySQL/COS/正式UI等外部Gate见唯一当前进度。无ACP编码派发、无Git提交推送、无生产操作。源码清单与日常命令路由防错已落地，开放Gate明确保留，不能据勾选宣称上线。
