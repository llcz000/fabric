# Fabric 历史 Git 工作树逐文件审查（2026-10-24）
## 最终 Git 工作树收敛（2026-10-24，最新状态）

用户再次明确要求清理全部历史工作树。本轮已对剩余 4 个注册目录执行原生 `git worktree remove`，并在退出前验证旧 HEAD 是正式应用祖先、141 个历史未提交文件在原有审计清单中的 SHA256 双份副本完整。旧产品导入检出另外与此前 274 个文件的全量备份逐文件核对一致。保全旧 B3 的 15 个下载目录、旧部署验收的 3 个下载目录和旧发布审查的 1 个下载目录，实际共 **23 个下载文件 SHA256 校验通过**，外部归档路径为 `D:/fabric-knowledge-backups/historical-worktree-audit-20261024050527/qa-downloads-before-retirement/`。通常可重建的编译结果、依赖和浏览器 Profile 不另做多 GB 备份。

最终退出的 4 个注册工作树：`b3-fulfillment`（118 项）、`v2-deployment-completion`（11 项）、`product-library-images-import`（4 项）、`release-review-20261017`（8 项）。已验证前三个目录的原路径消失；第四个目录只残留一个指向 `D:/fabric/node_modules` 的 junction 链接及空父目录，**不是 Git 工作树**。安全检查阻止移除该残留链接，未绕过执行限制，也未触碰共享依赖目标。

最终 Git 审计：`registeredWorktrees: 2`、`legacyWorktrees: []`、`projectClean: true`、`allRegisteredClean: true`、活动并行任务 0。两个保留工作树分别是 `D:/fabric`（控制入口）和 `D:/fabric/.agent-workspaces/v2-quality-20261020`（正式应用）。所有 10 个历史工作树均已退役，历史未提交记录在已注册历史工作树中降至 0。退出操作没有合入历史源码，也没有部署线上。

已删除旧 B3 及部署分支引用 `codex/v2-phase2-completion-20261017`、`codex/v2-production-deploy-20261017`（历史 HEAD 均属正式应用祖先）。`codex/fabric-v2-integration-review-20261017` 与 `codex/product-schema-init` 两个不再附着工作树的**旧本地分支引用**仍存在；分支清除遇到执行限制，未进行变通操作。这两个引用不影响 worktree 清单或两个正式工作区的 Git clean 状态。

历史审计章节保留原始 12 个工作树、395 项变更的时点快照，不再代表当前项目状态；任何未来版本检查均以运行时 `npm run parallel -- audit` 为准。恢复凭证在 `docs/maintenance/2026-10-24-workspace-archives.json` 中登记。


> 范围：只审查旧工作树，不更改当前业务实现或线上数据。正式控制目录为 `D:/fabric`；唯一正式应用工作树为 `D:/fabric/.agent-workspaces/v2-quality-20261020`。本文与[并行开发与合并规范](../development/Fabric并行开发与合并规范.md)配合使用；业务价值判定以[项目需求总览](../project/项目需求总览.md)为准。
## 最新处理决定及实际清理结果（2026-10-24，以此节为准）

用户明确批准废弃旧权限分支中的单据所有者旧实现、`canManageOwnOrders` 旧授权开关测试以及伪造创建人/跨用户旧 HTTP 测试；**完全以正式活动应用的现行实现为准，不再立项移植旧测试，也不回迁历史代码**。本文后续表格中“保留待审/补测试”等描述仅反映历史审查时点，不再构成待办。

**已真正退出 Git 工作树注册的历史目录（6 个）：**

- `multi-user-order-product-permissions`：旧权限独有文件的 217 个文件全量归档副本及 3 个变更文件的双份 SHA256 快照均核验；历史分支 5 个独有提交打包为已通过 `git bundle verify` 的 `discarded-permissions-history.bundle` 后，删除了旧分支引用。
- `stats-20261017`：2 项历史改动，已核验双份备份；退出旧工作树。
- `fabric-v2-core-merge-20261017`：先用 Git 工作树移动到外部归档，再对 5 项已暂存历史代码核验双份备份并退出工作树，已合并的旧分支引用已删除。
- `product-share-release`：103 项变更双份快照核验，另外保全忽略日志与资料，退出旧工作树；遗留两个符号链接及空目录已删除，实际链接目标未删除。
- `ui-experience-20261019`：79 项变更双份快照核验，另外保全忽略日志与 tmp，退出工作树。
- `ui-release-20261019`：62 项变更双份快照核验，另外保全忽略日志与 tmp，退出工作树；旧已合并分支引用已删除。

**本轮还将** `D:/fabric-v2-release-review-20261017` **通过原生 `git worktree move` 迁入** `D:/fabric-knowledge-backups/historical-worktree-audit-20261024050527/release-review-20261017`。其 8 项未提交改动、Git HEAD 和被忽略的原始目录仍完整保留；这是归档迁移，不是退出 Git 注册。

**备份与恢复：**历史 395 项变更的两份 SHA256 文件快照继续保存在 `D:/fabric-knowledge-backups/historical-worktree-audit-20261024050527/`；被清理的产品分享/UI 工作树另有 `ignored-before-retirement/manifest.json`（SHA256: `cf0a3a5404d0eeb7f6ea4ea641aa0dfb500564984b0ad96061bf45ce4bf50a82`）。旧权限唯一 Git 提交历史 bundle 位于同目录，SHA256: `bfaf2933dabc8f2ba0fa356522c2c7bd9b246afcd35ddef39cf0f201412ee10d`。普通可重新安装的依赖和编译产物未作为重要原件保存。

**实际剩余状态：**正式控制目录和活动应用仍各 1 个干净 Git 工作树；总注册工作树由 12 降至 **6**，历史工作树由 10 降至 **4**，剩余历史未提交记录由 395 降至 **141**。四个剩余工作树是 `b3-fulfillment`（118 项，旧目录含约 2.3GB 忽略数据）、`v2-deployment-completion`（11 项，含旧浏览器/测试资料）、`product-library-images-import`（4 项，存在导入原始备份/报告）及已经迁移的 `release-review-20261017`（8 项，含旧浏览器/测试资料）。它们暂不做危险的强制物理清除；日常开发只以正式应用工作树为准，旧目录不参与版本开发和合并。

此处 `git worktree remove --force` 仅用于**用户明确废弃且经过双份哈希核对、忽略资料备份确认的历史目录**；不应用于常规并行任务的 `retire` 门禁。原始审查文档下文所述“本轮未删除”是第一次审查的历史记录，并非上述最新状态。


## 实测范围与证据

Git 注册工作树共 **12 个**：正式控制目录、正式活动应用各 1 个，历史工作树 **10 个**。10 个历史树共 **395 项未提交记录**；其中两份独立归档已有早前保全记录，但并不等于 Git 状态干净。

本轮逐一读取 Git HEAD/分支/暂存/未跟踪状态，将 395 项改动及被删除文件在原 HEAD 中的内容按相对路径写入仓库外两份独立备份，再对 **790 份文件副本逐一核验 SHA256**。每项记录原工作树位置、原 Git 状态、文件哈希、正式应用对应文件哈希及“完全一致/内容不同/不存在/旧树删除”，并列出没有被快照覆盖的忽略路径。

- 审计路径：`D:/fabric-knowledge-backups/historical-worktree-audit-20261024050527/`
- 完整清单：`audit-manifest.json`、`inventory/*.json`
- 逐文件原件快照：`primary/<工作树ID>/changes/`、`independent/<工作树ID>/changes/`
- **审计清单 SHA256**：`0c45249b3dc85b97f3aae8bdac9104cbd86d2048d3c5c20b711285d308e06a04`
- 两份文件副本合计 **35,708,710 字节**。这只是 Git 变更文件快照，**不是整个旧检出、所有忽略目录或远端数据库的完整备份**。原 Git 提交与各旧工作树继续保持原位，不允许仅凭本快照直接执行全目录删除。

## 分类审核

| 历史工作树 | 未提交项 | 发现与当前应用的关系 | 处置判断 |
|---|---:|---|---|
| Codex / b3-fulfillment | 118 | 43 项代码、72 项 QA 产物；与下方旧 UI 体验树有 **46 个同路径文件字节相同**；旧 HEAD 已包含于活动应用历史，但当前代码有后续修改 | 旧 UI 变更候选；保留待复核不同之处，不能直接整体合并 |
| Codex / product-share-release | 103 | 57 项代码、46 项 QA 产物；与下方 ui-release 有 **35 个同路径文件字节相同**；存在旧实现与现行实现差异 | 产品分享历史实现与审查证据；按功能差异复核，不回滚当前分享页 |
| Codex / ui-experience-20261019 | 79 | 46 项代码、29 项 QA 产物；另有 3 个仅用于 `src/product-master-v2-review` 的旧预览模块，在正式应用不存在 | 旧 UI 样板与 B3 重复度高；候选归档，保留样板的可恢复副本 |
| Codex / v2-deployment-completion | 11 | **全部为 QA 截图/PDF/结果 JSON**，无未提交源码；该历史 HEAD 不领先正式应用 | 优先退役候选；须额外核对并处置被忽略的 `dist/`、`node_modules/`、`tmp/`，不得误删原始数据 |
| archive / multi-user-order-product-permissions | 3 | 3 个 `server/access/orderScope*.ts` / `orderApiScope.test.ts` 文件在正式应用不存在；其历史分支另有 **5 个正式应用未包含的提交** | **高优先保留**；先审查当前权限/单据业务是否仍需这些契约，未经需求核实不得合并或退役 |
| archive / product-library-images-import | 4 | 全部为 `.local/` 下的历史产品导入/Schema 演练脚本；还有被忽略的导入报告与备份资料 | **保留私有输入和演练记录**；不进入正式源码，不自动移动或删除这些资料 |
| archive / stats-20261017 | 2 | `StatsDashboard.tsx` 与正式应用完全一致，旧测试文件内容有差异；旧 HEAD 是正式应用祖先；未发现被忽略文件 | **优先退役候选**；不同测试已双份备份、仍可单文件复核 |
| archive / ui-release-20261019 | 62 | 52 项代码、7 项产物及其他文件；其中 9 项是针对旧组件的删除记录；与 product-share-release 的部分代码完全相同 | 旧 UI/分享混合树；需确保独有的业务测试或规则没有丢失，不直接执行历史删除清单 |
| D:/fabric-v2-core-merge-20261017 | 5 | 5 项均为**已暂存的旧代码/测试/CI**；对应文件正式应用中均存在，现行 `calculations.ts` 还新增 `normalizeStoredPieceMeters`，主要导出名称可对应；历史 HEAD 为正式应用祖先 | **优先退役候选**；逐文件原件、暂存状态已记录，禁止用旧版本覆盖当前服务 |
| D:/fabric-v2-release-review-20261017 | 8 | 3 项旧源码不同于现行实现，另 5 项旧打包站点资源；历史 HEAD 为正式应用祖先；有 11 个被忽略文件/目录（含生成产物、依赖） | 可做发布审查证据归档；须单独确认忽略资料的保存，不能只凭 8 项快照直接删除目录 |

上表“旧 HEAD 已纳入正式应用历史”仅说明提交祖先关系；**不证明工作树里未提交的业务代码已经合并，也不证明功能等价**。哈希完全相同可确认字节相同；哈希不同需要根据现行业务要求逐项确认，不能拿旧代码直接覆盖新代码。

## 退役优先级与前置条件

1. **先审查独有业务内容**：权限分支 5 个独有提交与 3 个源码/测试文件优先确认；产品分享、UI 体验、统计测试、核心计算的差异优先判断是否有尚未实现的有效规则。
2. **优先处理低风险历史树**：stats-20261017、v2-core-merge-20261017 和仅有 QA 产物的 v2-deployment-completion；其文件已快照，但退役前仍需确认全部被忽略内容、外部 Agent 或本机工具是否仍引用该路径。
3. **归并重复历史证据**：B3 ↔ UI 体验、产品分享 ↔ UI 发布的相同哈希文件不必重复人工审查；不相同的代码及独有截图仍要保留。
4. **操作门禁**：冻结原 HEAD、Git 状态及 SHA256；确认无并发进程、无未备份原始数据与唯一提交；使用可恢复 Git 工作树迁移/正常退役操作，完成后登记前后 Git 注册列表、恢复路径及哈希。不使用 `reset --hard`、`git clean -fdx`、`git worktree remove --force` 或直接整目录删除。
5. **分离发布授权**：历史代码补入正式应用要另建精确任务白名单，经现有 ACP/并行合并 Gate、受影响业务测试、最终集成验收；这轮审计绝不改生产系统。

## 本轮实际结论

本轮 **未删除、未迁移、未清空任何历史工作树**。两个低风险候选的“正常退出旧检出”操作和随后非破坏性迁移操作均未取得执行许可，均已停止，未重试等价绕过；原始 Git 工作树仍在原路径，HEAD/分支和未提交状态未变。

截至复核时，`npm run parallel -- audit` 应显示：`projectClean: true`，`registeredWorktrees: 12`，`allRegisteredClean: false`，历史未提交共 395 项。**当前两个正式工作区干净，全部历史树尚未退役**。是否完成退役应以实际 Git 注册状态而非文档计划为准。
## 2026-10-24 业务兼容性与退役阻断复审

### 独有权限分支：历史保留、禁止直接合并

旧权限分支有 5 个正式应用未包含的历史提交（adf4143、0031a6c、d44fcde、fe5bea4、2ccb0e8）以及 orderScope.ts、orderScope.test.ts、orderApiScope.test.ts 三个独有文件。旧代码使用 created_by_user_id 的 SQL/内存范围限制；正式应用当前已由 server/access/policy.ts、sessions.ts、server/order-v2/orderQueries.ts、documentRoutes.ts 等执行后台 owner 范围约束。最新 CUSTOMER-05 同样明确不能突破单据 owner 权限，不能因为业务员目前只有一个人就取消后台隔离。

重要不兼容：旧 orderApiScope.test.ts 假定 canManageOwnOrders 关闭后业务员开单/编辑/删除返回 403；现行角色规则明确该旧授权字段仅作兼容，有效 admin/sales 角色有对应业务权限。因此**不能 cherry-pick 旧分支或移植旧断言**。旧测试中的伪造创建人、跨业务员读/写/导出应保留作为将来按当前接口重写 HTTP 回归的参考。

在正式活动应用进行只读业务检验，运行指定现有测试文件 server/access/policy.test.ts、server/order-v2/orderQueries.test.ts、server/order-v2/documentDelete.test.ts，**28/28 PASS**。覆盖账号/owner 权限、删除其他人单据的 404、列表和统计 SQL owner 范围。此专项验证不等于完整端到端或正式 MySQL 验收。

### 旧分享与 UI：主要功能已覆盖，历史差异保持可查

product-share-release 的 57 项未提交代码文件路径在当前应用全部存在，其中 28 项内容与现行不同；与旧 ui-release-20261019 存在 35 个内容完全一致的同路径文件。b3-fulfillment 与 ui-experience-20261019 有 46 个字节一致的同路径文件。旧 ui-experience 独有三个 src/product-master-v2-review 的早期预览/样板模块，旧 ui-release 另有 currentShellAcceptance.tsx；均不属于现行正式业务代码，不能为了清除旧目录而重新接线。

正式应用已运行 server/customer-share/patternShareCatalog.test.ts、server/customer-share/productSharing.test.ts、src/components/product-master-v2/PatternLibraryV2.test.ts，**33/33 PASS**，包括现行公开产品信息白名单、产品/花型分享入口边界、16 种题材、列表创建产品。旧分享/页面源码**不整体覆盖当前实现**；如果后续发现独有业务场景缺失，必须单独立项复核具体文件。

### 忽略文件风险复核（不能把 Git ignored 当垃圾）

| 候选树 | 变更文件保全 | 额外忽略目录 | 结论 |
|---|---|---|---|
| stats-20261017 | 2 项、双份 SHA256 已核验，旧 HEAD 为正式应用祖先 | 0 | 技术上优先退出候选；本轮未退役 |
| fabric-v2-core-merge-20261017 | 5 项已暂存计算/查询/CI 文件，双份 SHA256 已核验，旧 HEAD 为正式应用祖先；正式代码有后续扩展 | 0 | 技术上优先退出候选；禁止用旧实现覆盖新代码 |
| v2-deployment-completion | 11 项纯 QA 截图/PDF/结果文件已保全 | dist/node_modules/tmp 共约 402 MB，tmp 2,376 文件约 143 MB，包含浏览器 Profile 和测试 XLSX 下载 | 不可直接删除；先区分 QA 原件与可重建缓存 |
| fabric-v2-release-review-20261017 | 8 项旧源码及打包页面已保全 | dist/node_modules/tmp/.agents 共约 303 MB，tmp 2,420 文件约 53 MB，含浏览器 Profile 与临时安装 | 不可直接删除；先审查本地原件 |
| product-library-images-import | 4 个 .local 导入/Schema 辅助脚本已保全 | 另有导入报告及备份资料 | 保留，不自动清理 |
| multi-user-order-product-permissions | 3 个独有文件已保全 | 有 5 个独有 Git 提交 | 保留审查证据，不直接合并旧权限方案 |

Codex 托管的 B3、分享、UI 旧工作树及已归档的 ui-release 仍保留差异，未归零的未提交状态不是正式开发工作区的脏文件。历史工作树退役需同时确认原 HEAD、未提交字节内容、忽略文件、独有提交、外部 Agent 是否使用，再安全执行正常 Git 退役并以注册列表验证；本轮未移动、未删除任意旧树。

**实测结论**：两个正式工作目录 Git 干净；旧树仍为 10 个、395 项未提交。下一次优先处理 stats 与 core-merge 两项零 ignored 目录的候选，然后单独审查部署/发布的临时下载与浏览器 Profile，不得对 400MB/300MB 目录执行一键清理。
