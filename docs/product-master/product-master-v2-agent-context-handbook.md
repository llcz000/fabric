# Fabric Agent 上下文与交接规范

## 来源和边界

开发前先读唯一业务需求 docs/project/项目需求总览.md 的相关编号；[当前产品验收清单](product-master-v2-requirements.md)只提供AC用例、[项目状态](../project/项目现状.md)和[代码定位](README.md)。按[并行开发与合并规范](../development/Fabric并行开发与合并规范.md)确定任务所有权。不要全文读取旧过程记录，也不要让隔离 Agent 擅自修改 D:/fabric 主工作树。

## 更新后资料的 ACP 单AC派发检查

1. 总控先用 fabric-v2-acp-task-intake.mjs --audit 和单 AC task JSON 生成最小任务简报；限制可读/可写文件、任务ID、未验 Gate，交接只传当前需求片段与对应代码。禁止把角色宽简报或旧测试统计当作实时任务来源。
2. 对本轮源码生成可信 SHA256 基线，经 fabric-v2-safe-baseline.mjs verify 与 restore-smoke 校验。隔离工作区用 fabric-v2-acp-prepare.mjs 单独创建/注册独立 Project；执行 fabric-v2-workspace-freshness.mjs，任何 missing/changed/extra 拒绝派发，不能复用过时快照。
3. 真实 Codex ACP 执行由总控通过 coding_agent_start 启动并使用固定 idempotency_key，随后 coding_agent_observe 观察同一个 run_id。容量或配额未知时默认单 Agent；任务取消/超时/不确定状态不得新键重复派发。
4. 代理对一个独立 AC/缺陷按 TDD 先RED后GREEN，交付准确文件清单、测试命令、结果和未验项。总控完成业务规格和安全/代码**双重审查**，只复验本次影响范围及必要端到端测试。
5. 使用 fabric-v2-acp-merge-gate.mjs 做**SHA256三方检查**，对照基线、子项目和最新主项目。公共入口、Schema、数据库迁移和正式发布由唯一总控负责，不自动合并、不覆盖已有 Git 修改、不删除未知文件。
6. 若任务启动后需求源变化，用调度器 --reconcile 核实原/新哈希和业务语义，之后重新独立 --review。不得自行更新运行状态或抹除旧指纹。

## 持续衡量 ACP 收益

使用 fabric-v2-acp-efficiency.mjs 记录真实 RED/GREEN、run 观察、合并、返工、验证结果。只有观察到的耗时与 Token 可入账；没有同类串行基线就不计算效率提升百分比。测试失败/被接管结果需与实际 Agent 成功分别统计。

## 提交与知识清理

交付格式包含 DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED、需求编号、实际改动、测试和剩余 Gate。**每项子任务收尾须给文档判定**：保留 / 归档候选 / 不适用。重复经验直接更新[开发与验证](../development/开发与验证规范.md)，状态只更新[项目现状](../project/项目现状.md)；不得创建阶段试验日志或新的日期复盘来代替旧文档。删除需由总控按[知识维护规则](../maintenance/知识维护规则.md)做独立 SHA256 备份、引用审查和归档预检；普通 Agent 不得独自清理文件。

只读工具入口：

    node scripts/fabric-v2-acp-task-intake.mjs --audit
    node scripts/fabric-v2-orchestrator.mjs --plan
    node --test scripts/fabric-v2-acp-task-intake.test.mjs scripts/fabric-v2-agent-brief.test.mjs
    node scripts/fabric-v2-acp-efficiency.mjs report
