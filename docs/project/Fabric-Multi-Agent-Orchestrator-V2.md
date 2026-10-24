# Fabric Multi-Agent Orchestrator V2｜第一阶段可运行任务队列

> 2026-10-24 目录整理：本文部分历史路径对应的临时文件、已退役源码副本或旧发布证据已完整迁至仓库外；原路径作为历史定位保留，按[归档恢复索引](../maintenance/2026-10-24-workspace-archives.json)中的范围和逐文件 SHA256 查找原件。未完成的业务 Gate 仍按当前进度保留。

> 文档类型：执行方案及当前代码能力。最新业务规则唯一源：[项目需求总览](项目需求总览.md)；功能及上线状态：[项目现状](项目现状.md)。本项目原有ACP隔离、安全合并与计量链：[Agent手册](../product-master/product-master-v2-agent-context-handbook.md)。**本模块不等于已形成两名或多名真实同时编码的ACP Agent。**

> **2026-10-24 新增日常 Git 工作树合并与退役门禁**：参见[并行开发与合并规范](../development/Fabric并行开发与合并规范.md)，在 `D:/fabric` 执行 `npm run parallel -- ...`。它管理独立 Git 工作树与主线集成，不替代本页业务队列、ACP 实际运行记录或业务验收。

## 已实现（2026-10-15）

- [任务清单](fabric-v2-agent-queue.json)：按**最新业务需求编号**标注5个待办：V2单据查询UI、经营统计Top5/最近4单、三库xlsx导出、销售单10匹输入、两角色扫码。提供优先级、领域Owner、准确的读/写文件、先行依赖和仍开放的真实验收Gate。与旧产品库AC-xx角色清单**分离**，不会错误套用旧角色/已取消需求。
- [调度器](../../scripts/fabric-v2-orchestrator.mjs)：校验需求编号确实出现在总览、任务没有环/重复、仅允许少量精确源码读写路径、禁止旧版正式入口和生产配置；检查依赖、已有文件占用及外部声明的席位上限。默认**只读、slots=0**。任务之间文件有交集时自动阻断同时派发，依赖任务必须完成独立验收。
- 显式`--reserve`才在`tmp/fabric-v2-agent-queue.state.json`写入**本机占位状态**，原子写入且文件锁使用`wx`；竞争时拒绝，锁被遗留时**禁止自动删除或过期抢占**。需求源及清单使用SHA-256绑定；源变动需要总控人工重新整理，不能基于过期计划自行执行。
- `--handoff`需真实格式的`wc_agent_run_*`标识，但只记“待复核”，工具并不能代替Runner证明这个ID的真实性；`--review`需总控显式提供所写验收清单并做摘要记录，**清单内容仅是总控签收声明，工具未对现实的测试日志/ACP调用验真**。下游仅在记录`reviewed`后可排队。受阻任务可标记`--block`，没有自动重试/清锁。
- 原脚本`fabric-v2-acp-task-intake.mjs`、`fabric-v2-safe-baseline.mjs`、`fabric-v2-acp-prepare.mjs`、`fabric-v2-workspace-freshness.mjs`、`fabric-v2-acp-merge-gate.mjs`、`fabric-v2-acp-efficiency.mjs`仍各自有效。本阶段**尚未自动调用这些工具、没有ACP编程代理自动派发、没有模型额度探针，也没有实际多ACP并发**。

## 使用方式（均不包含真实数据库与生产动作）

```powershell
cd D:\fabric
# 默认只读：展示等待、依赖、需求与真实登记状态；0表示未确认编码Agent容量
node scripts/fabric-v2-orchestrator.mjs --plan

# 仅假设Runner具有2个独立ACP编码席位进行模拟，不启动Agent/不改状态
node scripts/fabric-v2-orchestrator.mjs --plan 2

# 仅确认Runner ACP Provider/当前额度真实可用、评审任务范围及最新源码快照后，才允许显式占位
# 使用 --plan 输出的sourceSha256，示例以下占位符必须替换为本次最新哈希
node scripts/fabric-v2-orchestrator.mjs --reserve query-ui-v2 1 <sourceSha256>

# 接下来由总控单独执行SHA256可信基线、隔离Project注册、coding_agent_start/observe，
# 并记录真实efficiency begin/RED/GREEN/agent_done或blocked及测试证据。
# 真实run_id产生后才能执行（下例不是一个真实run_id）：
# node scripts/fabric-v2-orchestrator.mjs --handoff query-ui-v2 wc_agent_run_<真实值>
# 若ACP配额不足、超时或代码不合格：
# node scripts/fabric-v2-orchestrator.mjs --block query-ui-v2 provider-quota
# 总控独立验证全部Gate后才能签收证据：
# node scripts/fabric-v2-orchestrator.mjs --review query-ui-v2 docs/operations/真实任务评审.json
```

`--reserve`必须由总控在实际容量、权限及源码新鲜度确认后显式执行。**Runner普通Job并发=4并不证明ACP独立编程席位=4**。当前历史证据只有1次ACP正常完成、1次取消后接管、1次Quota受阻，计量见`node scripts/fabric-v2-acp-efficiency.mjs report`。该段为**第一阶段建队时点的历史记录**；第二阶段已完成一次真实ACP派发和受控合并，见下方`SCAN-01`闭环。模拟`--plan 2`仍只是并发容量假设。

## 第二阶段执行适配器：单次真实ACP探测（2026-10-15，已编码）

- `scripts/fabric-v2-acp-runner-bridge.mjs` 提供 **纯函数** `readRunnerCapability`、`buildAcpLaunchEnvelope`、`interpretAcpStart`、`interpretAcpObservation`。从 WebCodex `runtime_status`确认当前Runner在线且声明Codex ACP Provider；**不将普通Job数换算ACP席位，也没有额度查询API，因此`confirmedAcpSlots=null`、`quotaRemaining=null`、`canAutoFanOut=false`。** 只有明确单次人工认可`allowSingleProbe:true`才允许生成执行参数；模块自身完全不会调用ACP。
- 生成`coding_agent_start`参数前，必须先由总控核对最新任务来源、真实需求编号和安全任务白名单，检查新注册**独立**Project对应的工作区确实处于`.agent-workspaces/acp-*`，并核验可信基线manifest与工作区源码的SHA-256字节一致；路径或角色不符全部拒绝。返回确定性的`fabric-v2-acp-...`幂等键和严格只读/写范围指令，禁止凭空生成重复Key重试。
- 中央队列`scripts/fabric-v2-orchestrator.mjs` 新增`--started TASK run_id idempotency_key`和`--observed TASK run_id running|completed|failed|cancelled|quota`：占位`reserved_not_dispatched`→真实Runner启动回执`agent_running`→观察到同一run_id终态后`submitted_for_review`或`blocked`，只有独立总控验收才能`reviewed`。本地接收的ID/证据**不能自行证明远端结果真实**；必须通过同一次WebCodex可信工具回执和实际`coding_agent_observe`确认。
- **明确禁止自动多ACP启动**：当前只有Provider在线证明，额度与ACP并发席位未知。只做**一个真实小任务**的安全验证；如果Runner返回配额错误、超时或不确定结果，记录状态、使用原幂等键/Run ID查询，不自动再派发第二个新任务。
- 上游任务未reviewed时，下游不释放。任何协作交付只可向隔离工作区写代码；三方SHA-256、专项、全量、lint/build、独立验收由总控完成，阶段2不授权真实数据库、COS或发布。

示例总控工具流程（单次、非无人值守）：

```powershell
cd D:\fabric
node scripts/fabric-v2-orchestrator.mjs --plan
# 总控确认当前Runner的Codex ACP可连接、已授权单次尝试后：
# 1. node scripts/fabric-v2-safe-baseline.mjs --create
# 2. node scripts/fabric-v2-safe-baseline.mjs --verify <snapshot>
# 3. node scripts/fabric-v2-safe-baseline.mjs --restore-smoke <snapshot>
# 4. node scripts/fabric-v2-acp-prepare.mjs --prepare <snapshot> A
# 5. 通过WebCodex register_project注册隔离工作区，严格校验返回Project id和路径
# 6. 通过bridge纯函数为该任务构造coding_agent_start单次幂等参数
# 7. node scripts/fabric-v2-orchestrator.mjs --reserve <task> 1 <sourceSha256>
# 8. 由总控真实调用coding_agent_start；成功收到run_id后：
#    node scripts/fabric-v2-orchestrator.mjs --started <task> <real-run-id> <same-idempotency-key>
# 9. 同一个Run执行coding_agent_observe；终态才用--observed记录completed/failed/cancelled/quota
# 10. 完整三方Gate+回归/人工签收，才可--review；失败--block，不自动重试。
```

上述脚本占位符不是可直接复制的真实目标路径或授权。需要总控拥有运行工具访问权并明确决定是否启动，不能通过本地脚本绕过WebCodex审核。**能力到此属于“工具驱动的实际执行接线”，还不是常驻自动调度系统或多个ACP并行编码。**

## 2026-10-15 第二阶段首个真实 ACP 闭环：SCAN-01

**已经验证一次真实派发、正常终态和任务级受控合并；并未验证双ACP并发或无人值守自动调度。**

- 来源：最新[项目需求总览](项目需求总览.md#scan)的`SCAN-01`，任务队列`scan-admin-v2`，后端Agent A，两个严格可写文件：`scanRepository.ts`与`scanRepository.test.ts`。
- 可信执行：440文件SHA-256基线、隔离恢复演练、独立注册Project；派发前确定的幂等键、`--reserve`占位、真实`coding_agent_start`回执及`coding_agent_observe`同一Run ID正常`completed`。完成后只进入`submitted_for_review`，没有自动接受代码。
- 合并阻断及修复：旧ACP A角色Gate拒绝`server/customer-samples/`；新增`fabric-v2-acp-merge-gate.mjs --task scan-admin-v2`，只允许当前队列中精确授权的**两个源文件**、要求来源SHA256与队列占位一致及已记录同Run ID的完成结果。旧角色目录Gate保持原状。任务模式实测`blocked=[]`，其余所有文件不得合并，复制前后分别验SHA256。
- 代码切片：有效管理员与业务员均可使用已获授权的样品会话扫码；依然重验当前用户/登录及样品会话`can_manage=1`，未登录、会话撤销、无授权、失效QR或停用父产品继续拒绝。二维码原文不进入数据库查询/写入和响应。**这不是无需授权扫描所有样品会话的管理员后门**。
- 代码验收：Agent报告RED 4项（30项中26通过）、GREEN 30/30；总控主项目独立复测`scanRepository.test.ts` **30/30**，调度/ACP/白名单安全测试**31/31**，主项目全量**1004项：1003通过、1跳过、0失败**；串行`npm.cmd run lint`与`npm.cmd run build`通过。
- 效率问题：运行中最高观察到`used_tokens=62768`，**不是可确认的最终累计消耗**；无同类串行对照不可计算提速率。一次主项目全量测试与lint并发引发`tmp/tests-*`临时文件扫描竞态TS6053；在全量结束后串行重新lint通过，后续这两类检查不得盲目并发。
- 上线边界：尚未使用真实MySQL、物理二维码、B2完整用户授权和客户样品业务UAT；正式`server.ts`、`src/App.tsx`仍未切流，**一期No-Go**。审查归档**保留**，无远程MySQL/COS操作、生产部署、Git清理或提交。

### 需求变更期间的安全复核（本轮真实遇到）

同一`SCAN-01`任务派发后，最新`项目需求总览.md`发生更新，导致源哈希从派发时`df023a0b...`变为本次人工复核时`e72dc052...`；旧队列的`--review`因此**自动拒绝**，不能直接改写任务原始指纹。新增`--reconcile TASK docs/project/<审核证明>.json`，要求任务仍是完成待复核状态、保持原Run ID和旧源哈希、需求编号不变、审查人独立确认最新业务语义与源码范围，以及确切的新源/队列哈希。成功后分别保存`dispatchedSourceSha256`和`sourceSha256`，**仍须再单独--review**才可释放依赖。此操作不修改需求原文，不是SHA变更自动豁免。

本轮证据：`docs/project/scan-admin-v2-source-reconciliation.json`与`docs/project/scan-admin-v2-review.json`，最终`scan-admin-v2=reviewed`，`releaseAuthorized:false`。审核并非声称新旧需求文件字节或文字完全一致，而是针对当前`SCAN-01`语义重新签收这一**后端窄切片**；未登录扫码页面提示、实库、实码和业务UAT仍是开放Gate。

效率账本：`scan-01-dispatch-20261015`已被总控标记`verified`，30项专项/2文件/3次整合流程返工；总观测窗口约1293秒，其中Agent完成观测窗口约279秒、后续总控QA和需求变更复核约1014秒。**这不是证明ACP提速，相反提示当需求持续变化或旧所有权规则未兼容时，整合成本可能远高于编码时间。** 运行中观察到62768 tokens但没有可信终态总量，账本保持tokens null。下一轮应优先优化：用独立快照固定每条需求原文或规范化摘要；在派发前就应用任务级合并白名单；主项目全量测试/lint/build串行，避免临时目录竞态。

## 阶段2尚须补齐才能叫自动化多Agent协作

1. **容量/配额实时适配器**：读取真实Runner ACP provider状态和可用席位；Provider容量不足排队，执行额度拒绝进入blocked，不将普通Job计数映射为ACP容量。
2. **可信自动派发管线**：最新SHA256快照/还原演练→新工作区/新Project→单AC窄任务与`idempotency_key`→`coding_agent_start`返回真实run_id并观察终态；永远不在D:\fabric主项目直接允许子Agent编辑。
3. **受控自动合并/结果确认**：真实测试证据、需求/安全双审、三方SHA-256 Gate、逐文件人工或总控核验最小合并，再把reviewed证据与计量记录原子更新；发布仍由独立生产Go/No-Go决定。
4. **效果验证**：每轮计量正常完成/取消接管/额度受阻、实际耗时/Token（若可靠）、等待时间、测试和返工；有可靠同类串行对照才给“提升百分比”。

## 本阶段验收标准和边界

运行`node --test scripts/fabric-v2-orchestrator.test.mjs`，包含需求与危险路径校验、环/文件冲突、容量=0的只读退化、占位互斥、交接不能替代验证、取消阻断和源文件SHA变更拒绝。正式源码质量另跑项目全量测试、lint/build及文档导航。**不得把占位/规划计入ACP成功交付。**

**禁止**：真实生产MySQL/COS访问或写入、主项目现有Git清理/覆盖/commit、正式入口切流、清理旧客户/订单数据。隔离项目目录的文件白名单不是操作系统沙箱，权限还需总控检查。源需求或者任务定义变更后，必须人工协调已有状态，不能自动清除锁或覆盖占用。

归档判定：**保留**。真实ACP多实例、容量适配器、自动化合并与业务UAT均仍开放。
