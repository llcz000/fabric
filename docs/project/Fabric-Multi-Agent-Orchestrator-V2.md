# Fabric 多 Agent 任务队列与执行边界

> 当前工具入口。业务以[项目需求总览](项目需求总览.md)为准；进度与开放验收见[项目现状](项目现状.md)。执行纪律遵守[并行开发规范](../development/Fabric并行开发与合并规范.md)和[Agent 手册](../product-master/product-master-v2-agent-context-handbook.md)。旧阶段派发、计量和单次案例不再保留于 docs；必要时依据[恢复索引](../maintenance/文档整合与恢复.md)核对原件。

## 当前组成

- **任务定义**：fabric-v2-agent-queue.json 维护需求编号、依赖、领域、精确可写路径。每次派发前重查当前需求、源码和文件占用，旧列表不是当前完成率。
- **调度**：scripts/fabric-v2-orchestrator.mjs 默认只读，--plan 2 只是模拟两个席位，不代表确认存在两个 ACP 可编码席位。--reserve 必须先核真实容量和 SHA256 基线。
- **隔离与合并**：fabric-v2-acp-task-intake.mjs、fabric-v2-safe-baseline.mjs、fabric-v2-acp-prepare.mjs、fabric-v2-workspace-freshness.mjs、fabric-v2-acp-merge-gate.mjs 共同处理单AC范围、独立工作树、源码新鲜度、白名单、审查和安全合并。
- **执行与收益**：fabric-v2-acp-runner-bridge.mjs 构建/解释单次执行参数，不直接启动 Agent；fabric-v2-acp-efficiency.mjs 用真实结果记账，没有同类对照不得宣称加速。

## 使用方式

在 D:/fabric 运行以下只读命令：

    node scripts/fabric-v2-orchestrator.mjs --plan
    node scripts/fabric-v2-orchestrator.mjs --plan 2

经总控明确核对 Runner 容量、权限、需求版本、工作区隔离、文件白名单、源哈希并获授权后，才使用以下操作（占位符须替换为本次实际结果）：

    node scripts/fabric-v2-orchestrator.mjs --reserve <task> 1 <sourceSha256>
    node scripts/fabric-v2-orchestrator.mjs --started <task> <real-run-id> <same-idempotency-key>
    node scripts/fabric-v2-orchestrator.mjs --observed <task> <real-run-id> completed
    node scripts/fabric-v2-orchestrator.mjs --review <task> <verified-proof-json>

真实 ACP Runner 启动、观察终态与本地登记是不同步骤。派发后需求发生变化，用 --reconcile <task> <review-proof-json> 记录原摘要与新摘要，经独立语义复核后才能继续。配额拒绝、失败、取消及结果未知时阻断并核原 Run，不自动清锁或重复派发。

**尚未自动调用**上述安全工具形成无人值守多 Agent 派发；普通 Runner Job 容量不能代替真实 ACP 席位数。隔离 Agent 不能直接写 D:/fabric 主线。

## 验证与禁区

    node --test scripts/fabric-v2-orchestrator.test.mjs

此测试只覆盖调度状态机，不代表业务、真实 MySQL、浏览器或生产验收。不得未经授权迁移或修改生产 MySQL/COS、客户数据、正式部署，也不得跳过 Git 安全复核直接合并。对已完成任务只更新当前[项目现状](项目现状.md)与已有规范，不再新建日期命名的派发历史文档。
