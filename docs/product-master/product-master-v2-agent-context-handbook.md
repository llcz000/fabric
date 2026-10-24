# Fabric V2 多Agent精简上下文与交接规范（2026-10-14）

> 文档定位：规范与手册｜主要读者：设计/开发/测试/运维及Agent。用途：按当前任务选择对应规范或运行方法。

> 本文件是**执行方法**，不替代现行业务需求。先从[阶段任务快速定位](README.md#阶段任务快速定位)进入，现行规则见[唯一需求](product-master-v2-requirements.md)，是否完成见[当前进度](product-master-v2-progress.md)；已有Git未提交/未跟踪文件必须保留。

**2026-10-15新增项目级只读中央任务调度**：先看[跨模块Orchestrator V2第一阶段](../project/Fabric-Multi-Agent-Orchestrator-V2.md)。它按当前[全项目需求](../project/项目需求总览.md)校验QUERY/STATS/DOC/EX/SCAN任务、依赖及文件冲突。该调度器**尚不启动ACP**，容量=0为默认；即使模拟两席位，也不能宣称两个ACP正在运行。原A～E业务领域intake、哈希快照、独立Project和合并Gate保持独立，不允许省略。

**第二阶段首个实测SCAN-01（2026-10-15）**：已完成一次真实ACP单任务派发、同Run终态观测和任务级两文件SHA256合并，非真实双ACP并发。旧角色Owner合并门禁须使用新`--task QUEUE_TASK_ID`精确文件清单，不能绕过；用户授权仍按业务权限独立判断。全量1004项1003通过/1跳过，lint/build串行通过。Agent中间token观测不得当最终用量。

**最新业务源并发变更控制**：若Agent执行期间`docs/project/项目需求总览.md`发生变化，队列必须拒绝直接`--review`。须由总控核对最新需求语义、明确签收新旧两个来源SHA并调用`node scripts/fabric-v2-orchestrator.mjs --reconcile TASK evidence.json`，再单独`--review`；严禁覆盖旧来源SHA或直接修改state文件。见[具体经过](../project/Fabric-Multi-Agent-Orchestrator-V2.md)。

**第二阶段桥接（2026-10-15）**：`scripts/fabric-v2-acp-runner-bridge.mjs`对可信来源、快照SHA256、角色工作区和独立Project的派发参数做严格核验；新增`agent_running`及同Run终态落账。默认仍不调用编码Agent，Provider在线不等于额度和ACP并发可用。完整执行步骤见[中央调度手册](../project/Fabric-Multi-Agent-Orchestrator-V2.md)。

## 现行 ACP 协作交付链（2026-10-15）

**真实能力边界：** Runner 已有 Codex ACP provider，但之前两个 ACP 同时请求出现过 `coding_agent_capacity_full`；默认单 Agent；明确获准使用 ACP 时按实际容量串行或隔离执行，不能默认并行。另开Codex窗口可能不列在WebCodex Jobs，必须协调外部任务所有权。

1. **任务与责任冻结**：总控为每个Agent限定一个AC、最新需求片段及精确修改白名单（`node scripts/fabric-v2-agent-brief.mjs E --json`）。C只能修改P4/P5显式文件；E独占B3选样组件和人工补选指定文件。共享`server.ts`、`src/App.tsx`、`server/product-master/v2CatalogAssembly.ts`、当前进度由总控独占；公共schema/迁移需单独核定责任。不得将两个Agent派给同一文件。
2. **新版本冻结**：在`D:\\fabric`执行`node scripts/fabric-v2-safe-baseline.mjs --dry-run`和`--create`，记录本轮返回的实际`SNAPSHOT`；运行`--verify SNAPSHOT`、`--restore-smoke SNAPSHOT`。旧489文件快照缺少后续B3源码，**不得直接派发**。基线在仓库外、不含凭据/COS/客户数据/Git，不是生产备份。
3. **隔离工作区与注册**：`node scripts/fabric-v2-acp-prepare.mjs --prepare SNAPSHOT E`，得到全新、逐文件校验的`WORKSPACE`，不会覆盖旧工作区。通过Runner的`register_project`将`WORKSPACE`注册为单独WebCodex Project。派发前运行`node scripts/fabric-v2-workspace-freshness.mjs SNAPSHOT WORKSPACE`及`node scripts/fabric-v2-workspace-freshness.mjs SNAPSHOT D:\\fabric --main`，必须`ready:true`、`missing=changed=extra=0`。有漂移先重新取最新基线，禁止覆盖正在开发的工作区。
4. **真正启动和观察ACP**：使用`coding_agent_start`，明确`provider_id=codex`、独立`project`、单AC提示和固定`idempotency_key`；不确定启动结果要**复用相同key**，不得重复派发。使用`coding_agent_observe`观察返回的`run_id`直至终态。ACP容量拒绝就排队串行，不能把已登记/ready任务说成正在执行。提示词不是OS级沙箱，Agent不能操作主工作区。
5. **Superpowers双重审查**：Agent按Superpowers TDD（`test-driven-development`）先RED后GREEN；交回`DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED`、精确改动清单、测试证据、风险、文档归档判定。总控先做AC**需求规格复核**，再独立做**代码质量/安全复核**（允许串行ACP复核），不能仅凭Agent口头声明完成。
6. **SHA256三方检查与受控合并**：`node scripts/fabric-v2-acp-merge-gate.mjs SNAPSHOT WORKSPACE D:\\fabric E`必须`ready:true`且`blocked=[]`；逐条核对`changed/added`。工具对照基线、子Agent和当前主项目，拒绝越权路径、主项目同文件新修改、同名新增、删除、敏感额外文件及篡改快照；**只读，不自动合并**。审核实际差异后按白名单、目标当前版本最小化合并，合并前再复核一次；不能整目录覆盖或按旧HEAD覆盖未跟踪源码。
7. **唯一总控验收**：子任务专项→按实际影响选择统一HTTP/类型检查/构建→文档/技能Gate与`git diff --check`；只有变更范围或明确交付门禁要求时运行全量测试，重负载测试不与其他Agent并发；lint的OOM要明确标为未通过。进度唯一回写，按`保留/归档候选/不适用`处理历史过程记录；真实MySQL/COS/部署始终另行授权。

以上链路**可复用但不自动授权**：工作区准备只在新目录复制源码；快照新鲜度/合并检查始终只读；注册Project、ACP实际开始、最终逐文件合并及业务验收是分离的步骤。

## 为什么改变
第一次ACP B1试运行通过8项专项、全量806/807及lint/build，但代理花大量时间重复读取知识库和历史记录。多Agent协作中将所有开发经验原文复制给每个代理不仅慢，还容易读入过期方案。目标是让总控存储完整索引、任务只读必需片段、评审只读差异与结果。

## 三层上下文（谁负责什么）
1. **固定基础层（所有Agent）**：只看`AGENTS.md`、`docs/product-master/README.md`、`docs/product-master/product-master-v2-requirements.md`的**对应小节**。读取文档索引，不要无差别展开整篇。
2. **按需任务层（Agent A～E）**：总控先运行`node scripts/fabric-v2-acp-task-intake.mjs --audit`，再将每个单AC任务校验成聚焦简报；角色宽简报仅用于确定允许写入的边界。ACP隔离源码目录通常**没有.git**，不可要求子Agent在其中运行`git status`当做版本检查；由总控用基线新鲜度和SHA256 Gate验源文件，子Agent只读指定函数、测试和最多1份相关复盘。遇到`NEEDS_CONTEXT`才增补具体几行，**不要把原文件全文贴进总控上下文**。
3. **最短交接层（Agent→总控→评审）**：输出`DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED`、精确文件路径、测试命令和实际结果、独立未审风险、未执行的数据库/COS/浏览器与部署范围；不复制工具日志或大段全文。评审通过Diff+任务brief核验规格，另一次代码质量复核；**每轮改动只运行必要的专项，最终全量测试由总控串行执行**。

## 更新后资料的 ACP 单AC派发检查（2026-10-15）

**不要把 A～E 固定角色简报直接当工作指令。** 当前设计状态见[唯一进度](product-master-v2-progress.md)；例如B3 AC-84的人工补选React界面已被业务接受，**不可重新提案UI或重复开发**，只对明确剩余的正式接线/数据库/验收AC另建单切片。C角色只允许读单页源码，不再把整套组件目录交给ACP。A～E职责的固定宽清单仅用于定位文件所有权。

派发前由总控创建一次性的`tmp/acp-one-ac-task.json`（任务结束后无需把它归入知识库）：
```json
{
  "format":"fabric-v2-acp-task-v1",
  "agent":"E",
  "ac":"AC-84",
  "task":"补充已批准人工补选的特定安全回归测试",
  "remainingGate":"仅本机服务端测试；UI已接受，真库及正式App未验",
  "edit":["server/customer-samples/sessionManual.test.ts"],
  "read":["server/customer-samples/sessionManual.ts","docs/product-master/product-master-v2-b3-history-ui-review.md"]
}
```

```powershell
node scripts/fabric-v2-acp-task-intake.mjs --audit
node scripts/fabric-v2-acp-task-intake.mjs --task tmp/acp-one-ac-task.json
node --test scripts/fabric-v2-acp-task-intake.test.mjs scripts/fabric-v2-agent-brief.test.mjs
```

检查只读，拒绝非本角色AC、超出精确所有权文件、把整个目录作为修改对象、缺失只读文件、跨目录/私有路径、重复文件及未声明剩余Gate；返回只含目标路径、SHA256指纹、明确任务说明，不携带整篇需求或历史正文。**新文件指纹标NEW，现有文件记录真实SHA256。** 它不代替`fabric-v2-safe-baseline.mjs`快照核验、不启动ACP、不自动合并，也不提供OS级权限沙箱。

合格后仅将**这份聚焦任务 + 已核实当前AC小节**交给独立ACP Project；总控同步推进不同Owner文件的其他任务。高频微修复留给总控，ACP优先分配能独立TDD的中等规模业务切片；避免因单AC规格复核增加重复全量构建。记录`TTFR`、agent实际读文件数/Token、独立专项与合并返工、总控并发有效交付AC；**没有同任务串行基线时不宣称百分比提速**。

## 持续衡量 ACP 收益（本轮开始强制，2026-10-15）

**只记录亲自观察到的里程碑，不让Agent自报实际耗时。** 采样账本是 `docs/product-master/fabric-v2-acp-efficiency-events.jsonl`（无提示词/凭据/客户信息）；工具 `scripts/fabric-v2-acp-efficiency.mjs` 记录观察时间、RED/GREEN测试计数、Agent结束、总控验收文件数与返工次数；`report` 汇总经过复验的任务。历史没有准确事件时允许跳过RED/GREEN，TTFR记为`null`，不能补造时间。没有受控串行对照时`speedupPercent=null`；token没得到实际用量源时也记`null`。

```powershell
# 在真正调用 coding_agent_start 之前执行；RUN使用短的无个人信息标识
node scripts/fabric-v2-acp-efficiency.mjs begin p1-ac71-next A AC-71
# 只有真实观察到时才记录，不能回填猜测
node scripts/fabric-v2-acp-efficiency.mjs mark p1-ac71-next red 5
node scripts/fabric-v2-acp-efficiency.mjs mark p1-ac71-next green 30
# 收到 coding_agent_observe 终态后
node scripts/fabric-v2-acp-efficiency.mjs mark p1-ac71-next agent_done
# 三方合并、专项/全量/lint/build过关后；若失败以blocked结束而不计入交付
node scripts/fabric-v2-acp-efficiency.mjs verify p1-ac71-next 30 2 0
node scripts/fabric-v2-acp-efficiency.mjs report
```

核心比较指标是 **已复验业务/安全切片数、端到端墙钟窗口、到首次RED时间、Agent执行窗口、总控集成时长、返工次数、实际读取量/token（缺证据显示未知）**。需要同时记录不同Owner的总控产出，比较同类任务的真实串行基线，才能判断提速；不以提示词缩短61%等同生产力加速。单ACP＋总控并行的执行路径已验证，**双ACP并发容量仍未知**。日志采取单写入者串行追加，避免多Agent同时写账本引发竞态。

**ACP任务粒度与成本建议**：连续两轮P1 AC-71试验显示第二轮即使源码可接管，ACP仍可能因超时取消，导致总控额外复核。未来优先发可以独立完成的中等规模单AC任务，每轮仅2份修改文件、至多3份必读资料，避免读取整库/重复加载所有技能；观察到RED后尽快GREEN，并将**3～4分钟运行窗口**作为复核是否继续的建议，不是执行成功的保证或时限承诺。正式效率判断看`report`中的`verified`与`salvaged`分类、真实墙钟、token、返工和串行对照，不能用测试数或源码行数冒充提速。

**ACP取消任务的准确计量与接管规则**：`coding_agent_observe`若终态为`cancelled`，记录`mark RUN agent_cancelled`，不伪造`agent_done`。工作区若有完整文件，须经总控独立测试、双重审查、三方SHA256、全量/lint/build及文档门禁全通过，才能`salvage RUN TESTS FILES REWORK [OBSERVED_USED_TOKENS]`；否则标`blocked`。`report`单列`agentSuccessfulDeliveries`与`salvagedDeliveries`，避免虚报ACP成功率。token只有取得最终客观观测时才填写，中途`used_tokens`不是最终用量。

## CLI及可复验示例
```powershell
cd D:\fabric
node scripts/fabric-v2-agent-brief.mjs E
node scripts/fabric-v2-agent-brief.mjs D --json
node --test scripts/fabric-v2-agent-brief.test.mjs
node scripts/fabric-v2-agent-preflight.mjs
# 在自动派发工作树前使用严格闸门；blocked时返回退出码2
node scripts/fabric-v2-agent-preflight.mjs --require-safe
# 对独立源码工作区进行SHA256一致性检查；缺文件或源码陈旧时退出码2
node scripts/fabric-v2-workspace-freshness.mjs <本轮最新SNAPSHOT> <该Agent的全新WORKSPACE>
```
当前角色宽简报与单AC intake 均只读，输出无密码/SSH配置/原始需求正文，五个角色的单独所有权和敏感规则由专项测试校验。输出**不是**对文件的操作系统沙箱；WebCodex代理仍须限制允许写入的文件，差异需人工或总控检查。

**2026-10-15补充强制源码版本Gate**：代理所在隔离Workspace应与预定可信基线逐文件SHA256匹配再派发，禁止只凭“目录存在”判定就绪。`scripts/fabric-v2-workspace-freshness.mjs SNAPSHOT WORKSPACE`只读比对，返回`checked/matched/missing/changed/ready`，任一缺失/不匹配即退出2；实际旧B隔离目录对489文件基线匹配467、缺11、异11，严格拒绝。新建`pilot-b-v150-20261015`单独目录验证489/489通过、React B3专项4/4通过，旧目录不覆盖或清理。此项仍不改变Runner ACP并发限制。

## 原子任务与节奏
- 每次子任务**一个业务AC/一个缺陷**；高风险涉及数据库、历史单据、权限、图片公开权限时拆为独立审查和受控实现。
- **每项子任务收尾须给文档判定**`保留｜归档候选｜不适用`：若涉及未关闭业务/API/MySQL/UI/回滚Gate，保留其唯一过程证据；旧记录被新专题替代时必须提炼独有经验/未完成Gate后按[强制归档Gate](../maintenance/知识维护规则.md#任务完成后的强制归档-gate)备份并验证。子Agent只提出候选及精确文件清单，实际移出由总控负责索引、SHA256备份与预检；不将删除权限交给无隔离的并行Agent。
- 子Agent先描述将读哪些路径，验证当前代码/业务文档后先RED再GREEN；测试输出仅保留`tests/pass/fail/skipped`与失败原因。总代码评审只读修改的两个或数个文件和独立`git diff`，不重新读取整个仓库。
- 总控独占`server.ts`、`src/App.tsx`、`server/product-master/v2CatalogAssembly.ts`和统一进度；不并行跑全量`scripts/run-ts-tests.mjs`与`npm.cmd run lint`（临时目录竞态）。
- 如Agent反复遍历知识库、运行无关命令或读大文件，优先中止并**重发窄任务brief**。上下文缓存不能代替现行业务稿；默认复用React预览，**只有实际使用Stitch远程稿时**才执行实时画布/截图核对。
- 双ACP同时启动的历史尝试曾返回`coding_agent_capacity_full`；**并发容量应在每次派发前动态确认**，不能把两个已登记任务写成“同时执行”。任何历史489/448/443文件快照均只对应创建时点；每次派发使用当前源码新快照及独立工作区，并先运行`fabric-v2-workspace-freshness.mjs`，禁止从旧Git HEAD直接创建缺失V2的worktree。
- 工作区Git变更数量随开发而变，不把历史统计写成实时状态。已有可信源码基线见[阶段交付记录](product-master-v2-b3-history-ui-review.md)，它不是Git提交或生产数据备份；新改动须重新生成/校验新基线再隔离。不得贸然`git add -A`、stash、reset、clean、复制.env或删除旧数据库。

## 结果度量（每个Agent交接记录）
`brief_characters`、`read_file_count`、`read_lines_or_bytes`、`TTFR（任务到首次RED测试）`、`RED/GREEN秒数`、`retry_count`、`cross_owner_edits`、`tests/failures`。最终关注：单位验收AC的执行时长和复测通过率，不追求最高token或Agent数量。

## GitHub项目可借鉴的做法（参考，不等于要替换WebCodex）
- [OpenAI Codex Workflow Cookbook](https://github.com/openai/openai-cookbook/blob/main/examples/codex/iterating-development-workflows-with-codex.md)：AGENTS.md + 阶段日志/上下文记录，按阶段回收任务。
- [obra/superpowers](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md)：**新的独立子Agent + 规格检查 + 代码质量复核**；高风险的权限/SQL保留独立评审。Fabric项目已有相关Superpowers离线技能，无需整套重装。
- [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)：子Agent上下文隔离、文件系统记忆和按需任务分配；适合学习压缩上下文的模式，但现在不需要重建编排平台。
- [microsoft/agent-framework](https://github.com/microsoft/agent-framework)：多Agent协调、长流程与企业级托管；目前不是小团队Fabric研发的优先基础设施。原[microsoft/autogen](https://github.com/microsoft/autogen)已进入维护模式，不建议新项目从它开始。
