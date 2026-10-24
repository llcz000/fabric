# Fabric V2：GitHub 远端构建与安全部署门禁

核对：2026-10-24。本页只说明仓库中现存 GitHub CI 与部署边界；当前应用已发布，状态见[项目现状](../project/项目现状.md)。CI 工作流没有自动部署任务，不代表应用尚未上线。

## 已纳入审查分支的远端 CI

工作流：.github/workflows/fabric-v2-review-build.yml，运行环境 ubuntu-24.04 / Node 24。

- 推送 codex/fabric-v2-integration-review-20261017 或 master、发起目标为 master 的 PR 后触发。
- npm ci 安装 package-lock.json 精确依赖，运行离线安全契约检查、npm run test:unit、后端/前端/脚本三个分片 TypeScript 检查、B1/B3 边界 TypeScript 检查、文档导航与 npm run build。
- 成功时发布短期（7天） dist 审查制品，不上传 sourcemap、.env、数据库、上传文件或其他本机配置。
- Token 仅 contents: read；Checkout 不持久化凭据。**没有 SSH/COS/MySQL 凭据、环境声明或部署任务**，远端构建不会修改 /opt/fabric、PM2 或现有 fabric_db。
- 本地与 GitHub Ubuntu 的行为可能不同；必须以 GitHub Actions 实际 run 的日志和可下载产物确认远端成功，不能把本地绿色伪装成 GitHub 绿色。

操作：推送对应分支之后，打开 [GitHub Actions](https://github.com/llcz000/fabric/actions) 检查 Fabric V2 review build (no deploy) 的 run/日志/制品。工作流只存在于开发分支时，自动推送触发是首选；手动 workflow_dispatch 要求工作流先存在于默认分支，故当前未配置手动触发。

## 如需引入 GitHub CD

真实 Linux 服务器已有历史核查的项目路径 /opt/fabric、PM2 fabric 及 MySQL 8.0；可选择在 GitHub runner 先编译并校验制品，再将**同一精确 Git SHA** 的版本传至服务器受控版本目录，执行依赖安装和健康/业务回归，通过原子切换目录或 PM2 reload 更新版本。生产环境仍要有原 .env 与持久 uploads、Excel 模板、COS 配置的独立保护；不得随制品覆盖。

部署前必须获得实际目标的独立审查与签收：

1. **代码门禁**：PR 审核通过，远端 CI 实际全绿，分片 TypeScript 的资源限制有正式说明，精确 Git SHA 与制品哈希可核对；最好补齐原始单一 lint OOM 问题。
2. **P1 数据与回滚**：核实目标数据库身份/当前 schema、只读差异清单；先做可恢复的生产备份和实际恢复演练，得到迁移、回退负责人批准。禁止把 CI 当成任何生产数据库 DDL 许可证。
3. **P2–P6 业务**：在经批准的**隔离预发布**服务/独立测试 MySQL 实测角色、三库真实 CRUD/COS、七页 UI、xlsx 事务、三个单据的历史回读/打印；不允许在当前业务库测试破坏性场景。
4. **P7 切换**：真实账号端到端/P95 验收通过，准备旧 API、PM2、静态资源、数据库、媒体各自回滚路径；使用 GitHub production 环境的人工审批与分支限制（仓库套餐可能影响规则能力），且应禁止自助审批/管理员绕过。
5. **上线与复核**：仅在业务负责人明确签收后的独立部署执行中更新 /opt/fabric；检查 /api/health 的 storage=mysql、账号隔离、实际业务 API、附件、打印与关键性能，并能按统一发布工具回退程序；V2 新数据产生后不得恢复旧可写应用或覆盖数据库。

当前 GitHub 工作流**刻意没有** deploy job、生产 Secret、workflow_dispatch、SSH、PM2 指令或数据库初始化；后续不得仅添加一次 SSH 远端命令就称作安全自动部署。

## 历史证据与当前风险核查

10-17 的 CI 成功、失败修复、依赖升级及漏洞数量是历史快照，原件已存[恢复包](../maintenance/文档整合与恢复.md)，不作为当前风险数量或未上线结论。精确依赖取 package-lock.json；只有实际运行的审计才能报告当前风险，不能为清理文档启动网络审计或伪造安全通过。

正式入口是否装配由只读一期检查核对；生产签收按对应版本、环境及证据判定，不要求源码已接线的当前版本仍报告“未接线”。CI 不含部署 Secret，新增 CD 需单独设计和明确授权；日常发布使用[统一发布工具](统一发布工具.md)，不另造一套手工日期脚本。
