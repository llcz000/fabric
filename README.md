# Fabric 工作空间

本目录是统一命令入口和规范入口。正式应用源码位于 docs/project/fabric-v2-active-workspace.json 声明的活动目录，当前为 .agent-workspaces/v2-quality-20261020；旧根应用源码和重复应用脚本已可恢复归档。

**当前为重构过渡期的两个 Git 工作树，不是两套业务应用。** 正常开发从 `D:\\fabric` 进入；根目录的 npm 命令自动定位正式应用，业务源码与业务提交仅以指针中的活动工作树为准。`npm run workspace:status` 同时检查控制目录与应用目录的 Git 状态：`projectClean: true` 才代表两处均无未提交变更；归档在项目外的历史工作树单独审计，不视为当前活动源码。

长期目标是将完整应用与必要规范收敛到 `D:\\fabric` 一个正式 Git 检出，但 **只有在根目录独有规范、应用源码、发布脚本、源清单、环境与真实数据路径的迁移及回滚都单独验证后才切换**。禁止为了减少工作树数量而删除已有活动应用或重置任何历史工作树；尚未完成迁移前不要把根目录当作正式应用源码。

## 开发与提交

在根目录执行常用命令，路由器会先严格核对活动源码、Git HEAD 和需求哈希：

~~~powershell
npm ci
npm run workspace:status
npm run dev
npm run lint
npm run test:unit -- src/components/product-master-v2/BatchSelectedColorways.test.ts
npm run build
npm run ui:preflight
npm run test:ui:ux
~~~

应用依赖和 .env 在活动目录维护；首次准备应用时，在该目录运行 npm ci，并按其 .env.example 配置开发环境。根 package.json 只保留控制器所需的 esbuild 工具依赖。

~~~powershell
# 在活动目录完成审查、定向验证、精确源码 accept 和 Git 暂存后，从任一入口提交
npm run workspace:commit -- --message "说明本次已审查改动"
# 默认预览；--apply 仅处理有所有权标记、进程已退出的纯测试编译目录
npm run workspace:clean
npm run workspace:clean -- --apply
~~~

提交不会自动暂存、接受源码漂移、改写冻结发布清单、推送或部署。根入口支持传递定向测试等原始参数。应用脚本（包括 ACP/Orchestrator、业务静态检查及专项测试）在活动目录执行；根 scripts/ 仅保留路由、工作区维护、知识维护和规范工具。

## 新检出初始化

独立检出当前应用开发分支时，在应用目录执行：

~~~powershell
npm ci
npm run workspace:init
npm run v2:source
npm run ui:preflight
~~~

初始化只允许干净的已提交源码，拒绝未提交或被忽略的源码、路径链接和已有清单漂移；生成的清单仅供本地开发，不授予发布权限。

如果新检出的是本控制目录，先运行 npm run workspace:init：缺少活动目录时，按指针中的 developmentRef 从本地或 origin 已有开发分支建立独立工作树，再初始化本地清单；不会自动 fetch。随后在活动目录 npm ci。缺少该分支时，先自行获取指针声明的分支，不用旧根代码替代它。

## 主要目录与恢复

- .agent-workspaces/v2-quality-20261020/：当前完整应用，可独立检出、开发、测试和提交。
- scripts/：根控制器和维护工具。
- docs/、.agents/skills/：知识与规范；根 UI 规范继续作为本工作空间的同步权威，独立检出使用已提交版本。
- artifacts/：仍需保留的当前/历史证据；tmp/：有明确所有权的临时输出。
- .local/、uploads/、template/ 和本机 .env：本地配置及运行数据，保持原位并排除提交。

归档原件、独立备份、精确路径与 SHA256 在[恢复索引](docs/maintenance/2026-10-24-workspace-archives.json)；恢复时按单文件比较，不能整包覆盖新工作。[整理记录](docs/maintenance/2026-10-15-项目内容清理.md)记录本轮真实验证。

业务规则从[知识库首页](docs/00-首页.md)进入，当前状态看[项目现状](docs/project/项目现状.md)，测试范围见[开发与验证规范](docs/development/开发与验证规范.md)。部署继续使用统一发布器，生产配置和发布授权单独管理。
