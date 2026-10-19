# Fabric V2｜多 Agent 执行分工及集成 Gate（2026-10-14）

> 文档定位：中间过程｜主要读者：当前任务的开发/评审、Agent。用途：查实现/计划、历史证据和未完成Gate；不是业务新需求。

> **现行派发要求（2026-10-15文档更新后）**：先看[唯一进度](product-master-v2-progress.md)、[一期交付Gate](product-master-v2-phase1-delivery-readiness.md)与[聚焦单AC派发检查](product-master-v2-agent-context-handbook.md#更新后资料的-acp-单ac派发检查2026-10-15)。A～E旧任务ID和旧489文件基线均为历史数据，不能代替当轮实际Runner状态、新版源码SHA256及一AC精确文件归属。只验证过**单ACP＋WebCodex总控**的真实非重叠并行；双ACP同时执行仍不能声称可用。

> **2026-10-14历史里程碑（仅追溯）**：Codex ACP 2.2.2已与Runner连通，B1公开资料纯投影的首个单Agent试运行曾通过8/8专项与当时的806/807全量（1跳过）。A～E五个大任务在当时登记为ready，不等于实际同时运行；任务最新状态须查询WebCodex，不能从本历史段推断。真实MySQL与生产部署尚未批准。

> **历史登记，不作为当前状态**：A～E五个持久Agent身份及任务已经创建；原`coding_agent_providers=[]`是ACP配置前的历史快照，如今不适用。任务是否仍ready应实时查询，而不是沿用旧计划上的文字。
>
> **2026-10-14旧故障追溯**：早期CLI模型不可用或网络超时曾使两次只读任务在读取源码前退出；后续 ACP provider 已恢复。现在的主要阻断是双ACP并发容量和隔离源码新鲜度，具体实测见[10月15日阶段记录](product-master-v2-b3-history-ui-review.md)，不要沿用旧CLI失败来解释新任务。
>
> **2026-10-14历史基线，不代表当前代码结果**：旧v1.49及当时B2-5h测试记录仅作追溯。最新现行需求为v1.50，阶段质量证据以[最新交付](product-master-v2-b3-history-ui-review.md)为准。正式`server.ts`/`src/App.tsx`仍未切V2；MySQL迁移与部署须单独授权。旧HEAD不可作为包含未跟踪V2源码的完整隔离基线。

**2026-10-15 ACP交付Gate已实测**：按[ACP协作交付链](product-master-v2-agent-context-handbook.md#现行-acp-协作交付链2026-10-15)真实执行「最新快照SHA256→独立Project→ACP E B1投影TDD RED/GREEN→规格及安全复核→三方SHA256→主控对2文件版本保护真实合并→全量874项873通过/1跳过、完整lint/build通过」，证据见[ACP真实合并记录](../maintenance/2026-10-15-ACP-协作闭环.md)。工具`fabric-v2-acp-prepare.mjs`与`fabric-v2-acp-merge-gate.mjs`已具备安全防护，**不等于已解除双ACP编码容量上限**。两个独立Codex窗口共享主目录的任务仍须协调；旧489/后续443文件快照均只对应生成时点，最新合并后下一批必须另建快照与Project。

## 任务划分

| Agent | 当前任务 | 独立文件范围 | 本批成果/Gate |
| --- | --- | --- | --- |
| A 数据库 | `wc_agent_task_BQvfUyYzHQs9vv51` | P1/B2-5 schema、专用隔离测试脚本；其他代码只读 | 迁移差异/AC96～99 真库两连接并发方案及本机测试；真实 SQL 写测单独获批 |
| B 主数据/媒体 | `wc_agent_task_QcjQWkeapLU5Y73G` | P3 CRUD、图片服务；不改 A 的 schema 或 C 的 XLSX | COS/图片共享引用合同、测试及修复 |
| C React/XLSX | `wc_agent_task_wEy5ij0_SHCzPBNE` | 仅P4/P5 React明确文件及P5导入（以`fabric-v2-agent-brief.mjs C`的`ownedPaths`为准）；**不再拥有整个`product-master-v2/`目录** | Stitch七页差距/仅xlsx七列/产品12列、局部Edge验证 |
| D 三单据 | `wc_agent_task_4lGHfF50poYk9Cby` | `server/order-v2`、共用选品、打印/导出模型 | 三单据金额、旧明细稳定ID、快照与禁删本地HTTP回归 |
| E 客户选样 | `wc_agent_task_8sgJO4RXzU9KUXZc` | `server/customer-share/`、指定`sessionManual*`、`SampleSelection*`及`sampleSelectionClient*`；公共card/扫码schema/路由另向总控申请 | B1安全花型分享、B3人工补选/寄样跟进；优先React交互预览，Stitch按需使用 |

## 总控规则

1. 总控独占 `server.ts`、`src/App.tsx`、统一 `v2CatalogAssembly.ts`、本任务总进度表，集成时逐项接线；子 Agent 严禁提交生产部署、更换数据库及 Git commit/reset/clean/push。
2. 派发前先创建与验证**新快照**，执行`node scripts/fabric-v2-acp-prepare.mjs --prepare SNAPSHOT ROLE`建立全新工作区，确认`node scripts/fabric-v2-workspace-freshness.mjs SNAPSHOT WORKSPACE`和同一`SNAPSHOT D:\\fabric --main`的`missing/changed/extra`均为0；旧489文件快照不包含后续B3源码，不再作为最新派发输入。旧`git HEAD`不可直接作为V2工作树；工作区必须注册独立Project，所有者不能交叠。
3. 每任务先读 `AGENTS.md`、最新需求与复盘，TDD RED→GREEN，并交付修改清单、测试/日志、风险、独立复盘。不得复制或改动 SSH/数据库密钥文件，不清理他人文件。
4. 在共享checkout内不并行运行全量测试、lint或build（Windows可能`spawn ENOMEM`/Node Zone Allocation OOM）；测试器已默认限制为2并发文件子进程。总控按**局部测试→合并三方SHA256 Gate→统一HTTP→全量测试→lint→build→项目规范检查→Edge**顺序统一验收。跨Agent完成结果只有经过规格/代码复核和该Gate才能合入主项目。
5. B1面向客户的花型链接和B2业务员专属色卡码不同；不得暴露内部选样权限或客户数据。实体卡退役后旧二维码永不可恢复；停用/不供样产品不再纳入新扫码；印刷字段变更令相关有效卡待重印。
6. A～E Agent Task ID仅是**持久的任务登记**，不等于已运行。ACP启动需`coding_agent_start`返回实际run_id后使用`coding_agent_observe`确认；遇`coding_agent_capacity_full`只可串行。WebCodex Runner的普通Job并发上限不代表ACP并发可用，提示词不是OS沙箱；其他窗口独立Codex客户端不能被WebCodex Job清单完整反映。

## 现实优先级

当前按唯一进度优先解决**一期P1–P7正式集成/交付No-Go**：A负责只读schema/迁移评审，B负责媒体/COS安全合同，C负责已批准七页React验收与P5，D负责三单据兼容验收；E仅在文件不重叠时继续B1/B3二期独立切片。**每个ACP任务必须先通过单AC intake、最新基线和隔离Project Gate**；总控合并与全量测试串行。真实MySQL/COS、正式App切流、清退与部署均另行授权，自动测试绿不等于上线。
