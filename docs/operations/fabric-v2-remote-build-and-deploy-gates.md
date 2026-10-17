# Fabric V2：GitHub 远端构建与安全部署门禁

更新：2026-10-17。本文说明可重复的 **CI 构建** 和将来可审批的 **CD 部署**；两者是独立动作。当前仅实现远端 CI，不代表构建结果已在 GitHub 成功运行，更不代表线上已部署。

## 已纳入审查分支的远端 CI

工作流：.github/workflows/fabric-v2-review-build.yml，运行环境 ubuntu-24.04 / Node 24。

- 推送 codex/fabric-v2-integration-review-20261017 或 master、发起目标为 master 的 PR 后触发。
- npm ci 安装 package-lock.json 精确依赖，运行离线安全契约检查、npm run test:unit、后端/前端/脚本三个分片 TypeScript 检查、B1/B3 边界 TypeScript 检查、文档导航与 npm run build。
- 成功时发布短期（7天） dist 审查制品，不上传 sourcemap、.env、数据库、上传文件或其他本机配置。
- Token 仅 contents: read；Checkout 不持久化凭据。**没有 SSH/COS/MySQL 凭据、环境声明或部署任务**，远端构建不会修改 /opt/fabric、PM2 或现有 fabric_db。
- 本地与 GitHub Ubuntu 的行为可能不同；必须以 GitHub Actions 实际 run 的日志和可下载产物确认远端成功，不能把本地绿色伪装成 GitHub 绿色。

操作：推送对应分支之后，打开 [GitHub Actions](https://github.com/llcz000/fabric/actions) 检查 Fabric V2 review build (no deploy) 的 run/日志/制品。工作流只存在于开发分支时，自动推送触发是首选；手动 workflow_dispatch 要求工作流先存在于默认分支，故当前未配置手动触发。

## 将来直接从远端构建并部署：推荐路径

真实 Linux 服务器已有历史核查的项目路径 /opt/fabric、PM2 fabric 及 MySQL 8.0；可选择在 GitHub runner 先编译并校验制品，再将**同一精确 Git SHA** 的版本传至服务器受控版本目录，执行依赖安装和健康/业务回归，通过原子切换目录或 PM2 reload 更新版本。生产环境仍要有原 .env 与持久 uploads、Excel 模板、COS 配置的独立保护；不得随制品覆盖。

部署前必须获得实际目标的独立审查与签收：

1. **代码门禁**：PR 审核通过，远端 CI 实际全绿，分片 TypeScript 的资源限制有正式说明，精确 Git SHA 与制品哈希可核对；最好补齐原始单一 lint OOM 问题。
2. **P1 数据与回滚**：核实目标数据库身份/当前 schema、只读差异清单；先做可恢复的生产备份和实际恢复演练，得到迁移、回退负责人批准。禁止把 CI 当成任何生产数据库 DDL 许可证。
3. **P2–P6 业务**：在经批准的**隔离预发布**服务/独立测试 MySQL 实测角色、三库真实 CRUD/COS、七页 UI、xlsx 事务、三个单据的历史回读/打印；不允许在当前业务库测试破坏性场景。
4. **P7 切换**：真实账号端到端/P95 验收通过，准备旧 API、PM2、静态资源、数据库、媒体各自回滚路径；使用 GitHub production 环境的人工审批与分支限制（仓库套餐可能影响规则能力），且应禁止自助审批/管理员绕过。
5. **上线与复核**：仅在业务负责人明确签收后的独立部署执行中更新 /opt/fabric；检查 /api/health 的 storage=mysql、账号隔离、实际业务 API、附件、打印与关键性能，并能立即回切原版本。

当前 GitHub 工作流**刻意没有** deploy job、生产 Secret、workflow_dispatch、SSH、PM2 指令或数据库初始化；后续不得仅添加一次 SSH 远端命令就称作安全自动部署。

## 当前明确的阻断
**远端实际成功证据（2026-10-17）**：修复Git未跟踪UI技能后，草稿PR #1的Actions run [38996817370](https://github.com/llcz000/fabric/actions/runs/38996817370)全部完成（success）；包括1103项测试、四组类型检查、文档校验、Vite/esbuild构建和GitHub artifact上传。制品ID 12086584571，ZIP为258700字节/19个文件，哈希SHA-256为55f0b389c9302c6aaf260bcc1f6ac9ac21087f874010070d2ac99a20d48b20dc，文件检验未见sourcemap/.env/密钥。注意该制品绑定PR测试合并SHA 8178cd7d90b16b38203d5bdb95ce35e84b3ac3fa，只用于审查，**绝不据此自动部署生产**；另需审定真实发布Git SHA、生产环境门禁与可回滚部署设计。下方早期首次失败记录保留，反映实际修复链路。


**2026-10-17 CI 验证记录（需继续复核）**：首次 GitHub PR #1 Linux run 38996348748 的 npm ci、1103项单测和四组 TypeScript 检查全部通过，文档导航因 Git 忽略的 .agents/skills/fabric-ui-design/SKILL.md 不在 checkout 内而失败，构建及制品步骤跳过。现已在审查分支精确增补该项目 UI 技能，CI 预检增加对“文档相对链接的目标是否已被 Git 追踪”的验证；本地单测/构建与新增4项契约测试通过，远端最终运行结论仍以新日志为准。首轮 npm ci 输出 **29 项依赖漏洞警告（13 moderate、11 high、5 critical）**，并非本轮修复范围；正式发布前须对依赖来源、影响范围、实际暴露面与升级/缓解路线人工核查，不得把“CI 绿灯”当作漏洞风险已消除。

一期 node scripts/check-fabric-v2-phase1-delivery.mjs --status 必须如实报告 readyForReview:false、releaseAuthorized:false，因为正式 server.ts / src/App.tsx 接线及八项外部真实验收仍未完成。B1 外网花型图片网关和稳定分享实际实现、B3 寄样/跟进表的真实隔离 MySQL 与工作 UI 也不能由 CI 替代。早期远端 MySQL/SSH 文档是**历史只读核查**，不能直接证明现时线上状态。

源依据：[一期发布门禁](../product-master/product-master-v2-phase1-delivery-readiness.md)、[V2当前进度](../product-master/product-master-v2-progress.md)、[运行与部署](运行与部署.md)。
