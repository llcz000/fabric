# 2026-10-19 Fabric UI 体验优化｜静态增量发布证据

> 本文只记录 UI 静态增量发布，不取代同日 V2 正式迁移与切流证据。唯一当前状态为 [V2进度](../product-master/product-master-v2-progress.md)。

## 范围与验证

- UI 源代码基线 `701ff6d1f461e3f92e279abb8b9828b1464fa57a`。隔离工作区 `C:/Users/yangx/.codex/worktrees/ui-experience-20261019/fabric`，按`artifacts/ui-experience/publish-source-plan.json`核对46个文件 SHA-256，全量同步到发布来源 `C:/Users/yangx/.codex/worktrees/b3-fulfillment/fabric`。本次修订含 UI-01～08、侧栏/手机导航、草稿及返回保护、产品/花型/面料表格搜索和反馈、分类图标与操作图标。模拟选样创建为独立预览内存会话，不进入正式线上包。
- 在发布来源工作区串行执行 `npm run lint`、`npm run test:unit`、`npm run build`，均退出0。构建产物28/28与静态发布清单的 SHA-256及文件大小完全一致。日志在 UI 证据目录 `publish-target-validation.log`；早期 UI 浏览器 1366/768/390 的交互与截图见同目录 `README.md`，不等同本次正式账号生产E2E。
- 仅发布`index.html`及27个内容哈希 JS/CSS 文件。发布档案 `ui-20261019-af1ab7569f68-assets.tar.gz` SHA-256：`1c2c9a0afb8f73d5e7a8c1777a7856fddfccaee2e2514fab857a70f21ad0ba32`。服务器独立暂存 `/opt/fabric-ui-static-20261019-af1ab7569f68`，解压核验28/28文件 SHA 无额外文件/符号链接。未发布演示入口、源图、服务端或数据库配置。

## 正式发布结果及回退

1. 原生产目录 `/opt/fabric-v2-production-20261019-11910f5f/dist` 入口SHA `176a491cde7c88ab26a10d38bf1f0174cc6a077778775b518769158cdde95b46`，server.cjs SHA `2ddc89b65227559219d347b432bc212cc488a303965b445a866a694dd1c3e01c`，NGINX配置 SHA `2c71bee99e39761a69d7033aada1ff03376d1328a44018207c1c8f86e86cc0db`；公网原入口哈希一致，正式3008/同版本只读3009在线，mysql/v2健康。
2. 对每个新内容哈希静态文件检查同名冲突后按需新增，备份旧入口到暂存目录 `original-index.html`，最后原子替换 `index.html`；发布脚本失败有自动恢复旧入口的陷阱，实际未触发。
3. 发布后新入口 SHA `4f1e78af5da0ba9bcbf594a935a5cd5a3217d171da81f81cb6d85d7f38f8d58e`；经正式服务器公网HTTPS核验28个文件内容哈希一致且mysql/v2健康。独立Windows客户机默认HTTPS实际核验首页/主JS和CSS/V2App JS和CSS共5文件，以及公网mysql/v2健康。
4. 后端 `server.cjs`、NGINX、数据库迁移/记录、PM2/worker、上传目录/COS及相机静态服务均未修改。原首页保留并可作为恢复入口，任何回退先确认当前实际版本，不覆盖新的并发发布。

## Git、未测事项及历史治理

- 源码精确46文件整理到独立 `D:/fabric/.agent-workspaces/ui-release-20261019`、分支 `codex/fabric-ui-experience-20261019`，提交 `bd1d1e3d56c3fce527df075c1526397093e4ef73` 并非强制推送远端该分支。原脏`D:/fabric`工作区和发布来源的其它未提交文件未清理、重置或覆盖；未合并远端master。预提交钩子引用不存在的他项目配置，先报错；根据钩子自身提示仅本次设置 `PRE_COMMIT_ALLOW_NO_CONFIG=1`，不更改全局配置及禁用其它检查。
- 新UI的用户最终人工视觉签收、正式账号逐页生产交互回归、实体纸张输出及单列实体手机返回**未在此次增量发布后重验**；此前已验收的11910f5生产业务证据不冒充新前端E2E，localhost选样内存预览不证明正式数据库保存。
- 本文、预览证据、原版生产迁移与历史验收、相关复盘均判定**保留**，不作归档/删除/旧库清退。