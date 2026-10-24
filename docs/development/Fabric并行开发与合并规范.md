# Fabric 并行开发、验收与 Git 合并规范

> 文档类型：开发与版本管理操作规范（2026-10-24）。正式业务需求以 `docs/project/项目需求总览.md` 为准。本规范不替代 [ACP 协作流程](../project/Fabric-Multi-Agent-Orchestrator-V2.md) 中的真实 Agent 运行记录、任务队列或业务验收；并行能力、额度仍由 Runner 实际观测确认。

## 固定原则

**一个正式集成主线 + 临时独立任务工作树 + 一个合并总控。** 当前正式集成工作树为 `D:\fabric\.agent-workspaces\v2-quality-20261020`，`D:\fabric` 是唯一命令/规范入口。并行任务使用 `D:\fabric\.agent-workspaces\parallel-tasks\<任务ID>` 的独立分支，不能让两个 Agent 共用一个可写目录。历史 Git worktree 属于独立归档，不参与当前任务分配。

总控的任务登记、代码合并、完整测试与发布串行；仅文件不重叠、需求没有依赖且 ACP 真正有空余席位时才允许并行编码。禁止把 WebCodex 普通 Job 并发上限当作 ACP 额度。每个任务一份目标、负责人、验收范围和 **精确文件白名单**，不允许目录通配、共享入口或隐式修改。共享 `src/App.tsx`、`server.ts`、聚合器、发布器、数据库迁移、正式业务需求及任务队列必须由总控单独处理。

工具：`npm run parallel -- <子命令>`，实现为 `scripts/fabric-parallel-git.mjs`。状态记录为忽略提交的 `.local/parallel-tasks/<任务ID>.json`，受本地独占锁 `.local/parallel-tasks/.lock` 保护。旧锁不自动抢占或移除；需要确认前一次进程确实终止并独立调查。Git 分支及工作树保留独立恢复能力。

## 生命周期和门禁

| 阶段 | 命令 | 必须满足 |
|---|---|---|
| 盘点 | `npm run parallel -- audit` | 只读；分别报告主控与活动源码是否干净、任务、历史树数量 |
| 分配 | `npm run parallel -- start TASK OWNER FILE...` | 主控和活动源码均干净；任务ID唯一、精确文件、无其他活动任务所有权交叉；冻结主线 HEAD 和需求 SHA |
| 编码 | 在任务目录操作 | 独立 Git 工作树，独立提交；遵循 TDD、专项测试和代码审查；禁止改共享主线 |
| 合并预检 | `npm run parallel -- gate TASK REVIEW` | 任务已提交且干净；所有提交仅触及白名单；冻结需求未变；主线未改动授权文件；Git 三方无冲突；独立规格、质量复核及测试日志 SHA 校验通过 |
| 合并 | `npm run parallel -- integrate TASK REVIEW` | 再次核对任务/主线 HEAD、独占锁和预检证据；主线串行 `--no-ff` 合并；记录合并提交并刷新本地开发源码清单；进入“待集成回归” |
| 集成验收 | `npm run parallel -- finish TASK POSTCHECK` | 针对合并提交的专项/受影响范围测试和源码检查通过，独立验收记录及原始日志完整；仍无新的主线提交 |
| 退役 | `npm run parallel -- retire TASK` | 已集成验收、分支是主线祖先、工作树干净、没有任何未跟踪/忽略原始文件；用安全 Git worktree remove 和 branch -d，绝不 --force |

**任何阻断都不自动重置、重试或丢弃源码。** 如果合并中断，登记的 `integrating` 状态会阻断后续合并；总控先审查 `git status` 和差异，恢复代码/任务状态后再继续。测试失败或需要人工确认时保持 `awaiting-postcheck`，禁止把未验收的合并当作已经完成。所有真实生产环境、数据库、COS、微信验收及发布授权仍独立。

## 例子（均在 D:\fabric 执行）

```powershell
npm run workspace:status
npm run parallel -- audit

# 仅允许这两个精确业务文件由同一个 Agent 写；其他任务分配不重叠文件
npm run parallel -- start colorway-search Agent-A src/components/product-master-v2/ColorwayPicker.tsx src/components/product-master-v2/ColorwayPicker.test.tsx

# 之后在 .agent-workspaces/parallel-tasks/colorway-search 中编码
# 首次检出运行 npm ci、npm run workspace:init，并在任务 Git 分支提交
# 总控先调用现有 ACP intake/隔离与真实运行流程（如使用 ACP）

npm run parallel -- gate colorway-search .local/parallel-tasks/colorway-search-review.json
npm run parallel -- integrate colorway-search .local/parallel-tasks/colorway-search-review.json

# 集成主线需要串行运行受影响的测试、必要的 lint/build，并记录原始日志
npm run parallel -- finish colorway-search .local/parallel-tasks/colorway-search-postcheck.json
npm run parallel -- retire colorway-search
npm run workspace:status
```

### 审核证据格式

`REVIEW` 是 `.local/parallel-tasks` 下的 JSON，字段如下。这里的 SHA256 必须通过对**实际测试日志文件**计算得到；日志不得为空，不允许把 `passed:true` 当作工具已经自动运行测试。实际验收由独立总控负责。

```json
{
  "format":"fabric-parallel-review-v1",
  "taskId":"colorway-search",
  "baseHead":"<冻结的40位Git HEAD>",
  "taskHead":"<任务分支当前40位Git HEAD>",
  "mainHead":"<预检时主线40位Git HEAD>",
  "reviewer":"独立审查人",
  "specReviewed":true,
  "qualityReviewed":true,
  "checks":[{
    "command":"npm run test:unit -- src/components/product-master-v2/ColorwayPicker.test.tsx",
    "passed":true,
    "logPath":".local/parallel-tasks/logs/colorway-search-unit.log",
    "sha256":"<日志文件SHA256>"
  }]
}
```

`POSTCHECK` 采用 `fabric-parallel-postcheck-v1`，需 `taskId`、`mergedHead`、`reviewer`、`accepted:true` 和同格式的 `checks`，绑定**合并后的 HEAD** 和真实集成日志。若集成后出现其他变更，旧验收自动过期。任务日志、本地状态存储在忽略目录，不进入产品仓库，也不得包含密钥或客户数据；正式验收摘要可在该专题进度中引用。

## 与原 ACP / Orchestrator 的接口

现有 ACP `fabric-v2-acp-task-intake.mjs` 和 `fabric-v2-acp-merge-gate.mjs` 管理业务需求、单 AC、可信 SHA256 快照、实际 run_id、Agent 的文件级对照；本工具负责**Git 工作树、分支、提交与主线集成的第二层门禁**。两者互不豁免：ACP 三方 Gate 通过 ≠ Git 合并批准，Git 无冲突 ≠ 业务测试通过。不能把旧工作树直接改造成新任务，也不能修改旧归档而声称已合入。

批次容量建议：默认一次最多两项互不相依、文件完全不交叉的编码任务；每任务尽量 1–5 个文件。根本身的管理代码、需求/方案更新由总控独占。合并按任务顺序，前一任务进入 `awaiting-postcheck` 后必须先做集成验收才能合并下一个任务。不在多个 Agent 并行运行全量测试与 lint/build（历史已有临时测试缓存竞态）。

## 验收与清理的实际边界

退役前遍历任务目录所有文件，任何不属于 Git 跟踪的文件（包含被忽略的 `node_modules`、`.local`、图片/客户输入）都会阻止退役；必须另行审查、备份后由所有者处置，严禁无条件 `git clean -fdx` / `git reset --hard` / `worktree remove --force`。退役不自动删除 `.local/parallel-tasks` 中的恢复记录，可随定期知识维护归档。单次任务的效率只记录实际耗时、测试与返工，无可靠串行基线不得宣称提速比例。

此工具已覆盖的范围是本机 Git 生命周期，并未自动调用真实 ACP、执行浏览器或远端业务验收，也不代表已有历史任务已经全部集成。本机管理员仍应通过 `npm run workspace:status` 及 `npm run parallel -- audit` 分别查看正式开发状态与遗留工作树状态。
