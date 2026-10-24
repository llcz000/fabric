# Fabric DMS 当前应用

`D:\\fabric` 是唯一正式应用源码及项目管理目录，开发、测试、UI 验收与统一发布工具均从这里运行。不存在额外的活动应用检出；历史 `.agent-workspaces/v2-quality-20261020` 已被替代，严禁继续向旧工作树提交业务代码。

## 首次准备与日常开发

~~~powershell
npm ci
npm run workspace:init
npm run v2:source
npm run ui:preflight
~~~

workspace:init 仅从干净的已提交源码创建被忽略的本地校验清单；已有清单不覆盖，源码或 HEAD 漂移须明确审查。按 .env.example 配置本地开发环境后使用 npm run dev。业务运行需要其数据库/存储配置；本地 UI 预览和规范门禁不访问生产。

~~~powershell
npm run lint
npm run test:unit -- src/components/product-master-v2/BatchSelectedColorways.test.ts
npm run build
npm run test:ui:ux
npm run test:ui:workflow
~~~

按改动选择定向验证；全量单测与类型检查串行运行。类型检查明确使用 4GB Node 堆，避免本项目在默认 2GB 堆上内存耗尽。

## 审查、提交与临时输出

修改源码后用 scripts/release/source-automation.mjs inspect 查看真实差异；审查并验证后，对精确文件集合执行 accept。需求及未列入白名单的固定配置不会由源码 accept 自动通过。

~~~powershell
node scripts/release/source-automation.mjs inspect
# 根据实际已审查差异执行 accept <精确路径> ...，再 git add 精确文件
npm run workspace:commit -- --message "说明本次已审查改动"
npm run workspace:status
npm run workspace:clean
~~~

提交检查暂存树、Git 钩子、源码及提交后状态，成功后仅刷新本地开发清单 HEAD。不会自动暂存、跳过验证、改冻结发布清单、推送或部署。clean 默认预览，仅有明确标记的死进程测试编译输出可加 --apply 清理；原始输入、截图、发布包和运行数据不在通用清理范围。

## 目录与知识

- src/、server/、server.ts：正式前后端应用。
- scripts/：开发、测试、维护及统一发布工具。
- tools/ui-preview/：只供本地评审的隔离入口和演示样式，复用真实组件，不进入正式浏览器入口。
- tests/ui/、playwright.ui.config.ts：本机 UI 浏览器测试；需要私有 Excel/图片的用例按本机授权素材准备，不提交客户素材。
- docs/、.agents/skills/：当前知识和规范；[首页](docs/00-首页.md)、[当前状态](docs/project/项目现状.md)、[开发验证](docs/development/开发与验证规范.md)。
- artifacts/、tmp/、.local/、uploads/、template/：按用途保留的证据、临时输出、私有配置和运行数据，排除提交。

旧分支和历史工作目录的恢复记录见[恢复索引](docs/maintenance/文档整合与恢复.md)。并行开发使用 `npm run parallel -- audit/start/gate/integrate/finish/retire` 创建临时任务工作树，验收完成后安全退出，最终集成必须回到唯一根目录。部署需独立提供本机私有配置，并使用现有统一发布工具；本地初始化或测试通过不代表生产验收或发布授权。
