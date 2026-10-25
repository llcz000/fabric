# Fabric 项目知识维护
**2026-10-24 单一正式检出规范**：`D:/fabric` 同时是唯一控制入口与正式应用源码工作树，源码 `src/`、`server/`、`server.ts`、`scripts/`、`docs/` 在同一根目录。不得再从 `.agent-workspaces/v2-quality-20261020` 读取或写入现行业务代码，旧 Controller/Active 双工作树模式已废弃。临时并行任务另建 `fabric/parallel/*` worktree，审查合并后退役。开发、源码身份、构建、测试及发布预检均从 `D:/fabric` 运行，生产部署仍需独立授权。


## 知识治理强制前置 Gate

**唯一业务事实**是 `docs/project/项目需求总览.md` 按ID维护的规则；`docs/product-master/product-master-v2-requirements.md` 已改为只含AC验收，不再作为第二份业务需求。每次改需求先运行 `npm run knowledge:impact -- 需求ID`，改 AC 则使用 `npm run knowledge:impact -- AC-编号`；每条 AC 的第二列必须列出有效当前需求 ID；修改后执行 `npm run knowledge:changed` 和 `npm run knowledge:check`，按影响域人工核对代码、测试与权限/数据迁移风险。知识图谱可用 `npm run knowledge:map`、`node scripts/fabric-knowledge-graph.mjs map --mermaid` 或 `--json` 动态查看，图谱候选关系不是已验证的代码覆盖。

**绝不新建阶段过程文档**：需求迭代直接修改唯一需求条目、现行设计/API与项目现状，不产生新计划/评审/复盘/交付结果Markdown或过程JSON。`scripts/fabric-knowledge-registry.json` 是文档准入及影响域登记，CI阻断未登记文档、日期过程文件、重复业务需求与缺失的需求域映射；即使想登记新文档，也必须先获得用户明确批准且证明现有文件无法承载。详细根因与维护协议统一见 `docs/maintenance/知识维护规则.md`，不单独新增知识治理总结文件。

## 工作空间命令位置（2026-10-24）

D:/fabric 为唯一正式应用、规范和命令入口；src/server/scripts/docs 均位于根目录，所有常用 npm、业务与专项检查命令在根目录执行。docs/project/fabric-v2-active-workspace.json 的 application 角色指向本根目录；不再使用已退役的 Controller/Active 路由。全新检出先运行 workspace:init 建立本地清单；初始化不授予发布权限。

## 工程目录与 HTML 入口强制规则
根目录只保留正式应用入口 `index.html`；禁止把 UI 样板、评审、验收、V2 沙箱/联调 HTML 放回根目录。对应入口分别归档到 `tools/ui-preview/entries/`、`tools/ui-review/entries/`、`tools/v2-sandbox/entries/`，实际组件仍放在 `src/` 或 `tools/ui-preview/`。新增/移动入口必须同步 Vite 配置、浏览器测试、QA 脚本、CI 和文档引用；不得通过删除验收测试或放宽沙箱门禁使检查变绿。运行 `npm run structure:check` 验证根目录与生产 `dist/` 只含正式 HTML；该检查纳入 `test:all` 和 CI。隔离评审构建只能输出到 `artifacts/` 或 `tmp/`，绝不进入生产 `dist/`。


## 开发前

## 产品主数据 V2 项目技能

进行花型库（含数字配色版本）、面料库、产品库、图片、Excel导入或三种单据选品的实现/评审/验收时，先加载 `.agents/skills/fabric-product-master-v2/SKILL.md`。该技能负责路由现行需求、P0～P7计划、已批准/待审边界和验收证据；具体业务事实始终以 `docs/product-master/README.md` 所指的当前需求为准。若运行时未发现Superpowers通用技能，必须据实说明并执行对应检查，不得声称已调用；项目技能不代表允许部署。

**Fabric跨模块Orchestrator V2（中央队列与ACP执行适配阶段）**：最新业务队列参见[项目任务调度说明](docs/project/Fabric-Multi-Agent-Orchestrator-V2.md)。`node scripts/fabric-v2-orchestrator.mjs --plan`默认只读，零确认席位、零自动派发；`--plan 2`仅假设容量。显式占位与交接不得冒充真实ACP执行，旧单AC intake、可信基线、ACP实际run_id、SHA256 Gate和总控验收仍分别强制执行；新跨模块任务合并时须传`fabric-v2-acp-merge-gate.mjs ... --task QUEUE_TASK_ID`核对实际任务精确edit白名单。全量测试与tsc lint不能在主项目并行（临时测试文件清理竞态）；任务派发后最新需求文件SHA变化则禁止直接--review，必须提供独立审查证据并显式`--reconcile TASK evidence.json`，保留派发旧SHA和当前新SHA；禁止将Runner普通Job并发上限当作ACP容量。

**ACP实测收益强制记账**：每次新编码任务在真正调用ACP之前启动`node scripts/fabric-v2-acp-efficiency.mjs begin RUN ROLE AC`，仅观察到RED/GREEN时记录，收到run终态再记agent_done，总控合并及全量质量Gate通过才记verified；`report`查看实际墙钟窗口、返工/测试、token缺失与无串行基线限制，严禁虚报提速。参见[协作手册](docs/product-master/product-master-v2-agent-context-handbook.md#持续衡量-acp-收益)。

多Agent拆分任务先使用只读`node scripts/fabric-v2-acp-task-intake.mjs --audit`核实当前角色上下文与所有权，使用`--task tmp/one-ac.json`验证**单AC、单剩余Gate、精确改动/只读文件和当前哈希**；之后可用`node scripts/fabric-v2-agent-brief.mjs A|B|C|D|E`查询角色边界；一次只读取任务相关AC、小段源码及1～2条复盘，不将整份需求或历史记录复制给子Agent。**ACP协作强制执行：新源码哈希基线→全新隔离Project/新鲜度Gate→实际ACP run_id及观察→TDD与需求/质量双审→三方SHA256冲突Gate→总控最小合并及串行质量检查。** 禁止多个Agent共享编辑`D:\\fabric`、整目录覆盖、使用过期489文件基线/旧HEAD派发，C/E选样组件严格区分所有权。工具`fabric-v2-acp-prepare.mjs`与`fabric-v2-acp-merge-gate.mjs`的执行边界见[并行开发与合并规范](docs/development/Fabric并行开发与合并规范.md#生命周期和门禁)；此简报或规则不代替当前需求、skill加载或OS级写权限沙箱。

本仓库已放置官方Superpowers的项目级离线核心技能副本：`writing-plans`、`executing-plans`、`test-driven-development`、`systematic-debugging`、`requesting-code-review`、`verification-before-completion`。如有相关任务，先以当前WebCodex技能列表/实际加载结果为准；来源和MIT许可见 `.agents/skills/SUPERPOWERS-UPSTREAM.md`。未确认可用的多Agent子任务调度不得擅自宣称。

**一期P0–P7交付判定强制Go/No-Go Gate**：在宣称“正式交付”“可上线”或开始接正式server/App前，必须运行只读`node scripts/check-fabric-v2-phase1-delivery.mjs --status`并查看[交付检查说明](docs/operations/运行与部署.md#交付检查与证据边界)。检查出的正式入口、生产MySQL/备份回滚、权限、COS、七页UI、xlsx与三单据、P7 E2E等Gate需要独立真实证据；全量单测、lint、build或隔离沙箱绿色不得充当生产上线许可。即使预检变成`readyForReview:true`，`releaseAuthorized`仍恒为false，真实DB DDL/DML、正式路由切流、旧库清退和部署另行取得用户批准。

项目知识库唯一入口为 `docs/00-首页.md`；按读者、文档类型及关键词查 `docs/文档分类与检索.md`。业务要求只读唯一需求对应小节，任务状态只查当前进度，过程证据/相关复盘按任务最多先读1～2篇，禁止默认展开整库。阅读对应领域当前说明及 `docs/retrospectives/README.md` 中最近相关经验；区分当前源码、历史方案和线上验证，不能把实施计划当完成记录。

## UI Design 项目规范

**Fabric UI 新会话强制启动门禁（2026-10-22）**：无论从根目录还是活动工作区进入，只要任务涉及 Fabric Web UI/弹窗/组件/交互/视觉设计、修复或评审，**在改代码之前**先执行 `npm run ui:preflight`，按结果读取 `docs/ui-design/ux-delivery-gate.md`、`ui-page-visual-review.md` 和 `ui-review-checklist.md`。启动检查不通过则不能将任务当作 UI 规范已就绪；如果提示规范版本不一致，先经用户授权的 `npm run ui:preflight -- --sync` 从根目录唯一权威规范同步到活动工作区，再重试。必须实际加载/核对 fabric-ui-design、fabric-ui-ux-qa；重大视觉重排按需使用 ui-ux-pro-max、frontend-design、web-design-guidelines，未能加载须记「未验证」而不得宣称使用。活动工作区以 `docs/project/fabric-v2-active-workspace.json` 为准，不允许修改旧根源码冒充上线代码。

**单轮 UI 交付强制收尾**：同轮完成真实组件和正式 CSS 的桌面/窄屏及所有受影响弹窗视觉审查、主路径/错误/取消/Esc/焦点浏览器交互、定向工程测试，分别记录 PASS/FAIL/未验证；不能把浏览器 PASS 当作视觉 PASS。更新候选源码清单后用 `npm run ui:template -- --page 页面名称 --file src/...` 生成初始未验证报告，补齐实际视觉、浏览器、工程证据，再执行 `npm run ui:verify`；有 NO-GO 或缺少证据不得宣称「UI 质量验收通过」「可发布」。用户视觉接受、模拟联调、真库验收与正式发布分别登记。普通小修按影响范围精简测试，无需重复全站视觉检查、Stitch 或 A/B。正式发布仍须用户明确授权并使用现有统一发布器（其原 UI 质量门禁继续有效）。


**2026-10-21 用户明确定位：全 Fabric 系统仅内部业务人员使用；只有通过色卡分享链接打开的页面面向客户。** 内部工作台以操作效率、表单与筛选稳定、少跳转和快速迭代为首要目标；客户分享页面才强调大图及面料/细节/效果图展示。优先复用现有 React 组件与业务模型，普通改动不强制 A/B、Stitch、Figma 或全量测试。开发前读取 `docs/ui-design/product-positioning.md`，区分客户分享操作与客户可见内容，不要用展示型页面改造全部内部工作台。色卡分享客户页面 `/c/` 以**手机微信 H5**为主，读取 `docs/ui-design/wechat-card-share.md`；浏览器模拟与微信真机验收必须分开记录。

进行UI设计、组件交互、视觉评审或WebCodex/Codex ACP UI交接时，读取 `.agents/skills/fabric-ui-design/SKILL.md`，按需查阅 `docs/ui-design/`。业务事实仍以当前产品主数据需求为准，规范不构成应用实施或部署授权。
新建或显著修改 UI 的验收以 `docs/ui-design/ux-delivery-gate.md` 为强制入口，并加载 `.agents/skills/fabric-ui-ux-qa/SKILL.md` 执行门禁；加载 `ui-ux-pro-max` / `web-design-guidelines` 按需核查，运行与页面相关的真实浏览器交互测试并保存截图、错误和焦点/窄屏证据。失败、未测或仅静态截图不能标记 UX PASS；独立样板不自动构成正式接线或生产发布批准。

2026-10-14用户允许效率低时弃用Stitch：默认复用现有React组件并交付可交互预览，Stitch按需使用，取消新页面/大布局必须先进入Stitch的要求。新方案UI接受、应用接线与部署分别登记；已有授权范围内的修订继续推进。已有Stitch稿及用户修改保留作参考，不自行删除。

## Stitch UI 设计与交付（使用该工具时）

用户指定Stitch或实际操作其远程页面时，先读`docs/product-master/product-master-v2-ui-iteration-workflow.md`第8节及相关交付复盘。开工前按已授权范围列出预期页面，不能只登记已生成页面。

修改前读取目标页最新远程HTML/截图并核对画布，与上次同步稿和本轮要求对照；保留用户独立修改。产品列表的列数与备注位置按最新需求、正式当前页面核对，不能沿用历史12列模板；交付清单声明当前受保护列。

远程Stitch交付时逐页核对真实画布、屏幕身份、HTML/截图及知识库登记，并使用最新读取快照运行`scripts/check-stitch-review-delivery.mjs`；脚本不替代实时工具和视觉核验。仅本地有稿不能声称远程交付；未采用Stitch的React预览任务不要求生成画布或运行Stitch专项。清理远程旧稿只在已授权范围内，先验证新稿与登记。

## 开发结束后

实质开发或故障处理只将可复用教训合并到已有 `docs/development/开发与验证规范.md`、`docs/retrospectives/README.md` 或对应运维规则；不要按每轮日期新建复盘。视频制作内容已移出本应用项目，不再维护相关工作流或复盘入口。同主题优先更新已有复盘，不以每轮测试数量拆新篇；使用 `docs/Templates/开发复盘模板.md`，记录触发条件、根因、处理、实际验证与剩余问题，并更新复盘索引。只有已验证且有适用条件的经验才能回流开发或运维规范。

**强制任务收尾 Gate：验收后历史文档治理。** 每个P0～P7、B1～B3或其他开发任务在报告“完成”前，必须记录：验收范围/证据、未完成Gate、当前唯一状态文档、对应过程/复盘的`保留｜归档候选｜不适用`判定。只有**该任务所需验收全部通过**，或**旧记录已被正式新专题替代且独有约束与未完成Gate完整转移**，才能列入候选。先提炼规则并修复入口，取得仓库外逐文件SHA256可恢复备份，然后使用`node scripts/check-fabric-v2-doc-archive.mjs <review-plan.json>`只读核验；不通过不得移出。实际删除/移动仍受本次清理白名单与权限约束，不能因单测绿、无人引用或时间久自动删文档。详情见[知识维护规则](docs/maintenance/知识维护规则.md#任务完成后的强制归档-gate)。

## 清理与更新

更新现有文档，不复制第二套知识库。删除被替代文档前提取独有约束、更新引用并记录替代位置；保留仍未实现的独有批准方案。运行数据、客户数据、媒体成片、本机配置不属于旧知识，禁止随知识库清理删除。不得在文档保存密钥或敏感数据。详见 `docs/maintenance/知识维护规则.md`。
