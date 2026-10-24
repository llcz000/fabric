# Fabric DMS 面料单据管理系统

面向面料贸易业务的内部管理工具，支持样布码单、销售发货码单、定金单、产品图库、Excel 导入导出和库存台账。

项目使用 React + Vite 前端、Express 后端和 MySQL。MySQL 未配置时可使用本地 JSON 作为开发降级存储；生产环境应配置唯一的权威数据库。

## 本地运行

日常命令统一从 `D:/fabric` 执行。实际应用源码由
`docs/project/fabric-v2-active-workspace.json` 定位，当前为
`.agent-workspaces/v2-quality-20261020`。根目录的 `src/`、`server/`
是历史保存版本；修改正式应用前先执行 `npm run workspace:status` 查看真实路径。

要求：Node.js LTS、npm；生产数据建议使用 MySQL。

1. 安装依赖：`npm.cmd install`
2. 复制 `.env.example` 为 `.env`
3. 设置一个随机的 `ADMIN_PASSWORD`
4. 按需填写 `DB_*` 和腾讯云 `COS_*`
5. 启动开发环境：`npm.cmd run dev`
6. 打开 `http://127.0.0.1:3000`

服务缺少 `ADMIN_PASSWORD` 时会拒绝启动，不再使用默认密码。

依赖和 `.env` 应按实际活动目录配置；本机运行数据不随源码整理迁移。

## 提交与临时产物收尾

```powershell
npm run workspace:status
npm run workspace:clean
# 确认预览后，仅清理已退出进程留下的有标记测试编译目录
npm run workspace:clean -- --apply
# 在活动目录完成定向验证、现有精确 source-automation accept 和 Git 暂存后
npm run workspace:commit -- --message "说明本次已审查改动"
```

提交命令只提交活动目录已经暂存的内容；未暂存文件、源码漂移或 Git 钩子失败都会阻断。
成功后核对实际提交树和工作区，再更新本地开发清单的 HEAD，保留严格源码校验。
冻结发布清单不会改写，也不会自动暂存、推送或部署。

`clean` 默认只读，不处理历史日志、截图、发布包、备份、恢复基线或其他工作树。
历史临时文件按[同一维护记录](docs/maintenance/2026-10-15-项目内容清理.md)逐项治理；
Git 状态无改动不代表磁盘上的过程产物已完成清理。
线上验收后的旧目录、历史 tmp 和旧发布包已按[恢复索引](docs/maintenance/2026-10-24-workspace-archives.json)迁出；
当前源码/回滚包、原始输入和运行数据继续保留。日常缓存及时收尾，整任务过程资料在对应线上验收后归档。

## 验证

```powershell
npm.cmd run test:all
```

按改动选择专项验证见 [开发与验证规范](docs/development/开发与验证规范.md)；`test:all` 已包含类型、单元、构建、安全和图片冒烟，不需逐个重复执行。

## 生产运行

```powershell
npm.cmd run build
$env:NODE_ENV='production'
npm.cmd run start
```

生产部署前必须完成凭证轮换、HTTPS、数据库备份、登录限流验证、上传验证和 SSRF 测试。不要提交 `.env`、上传文件、JSON fallback 数据库或客户数据。

部署后可用 `GET /api/health` 做负载均衡或进程存活检查。该端点无需登录，仅返回服务状态、当前存储模式和运行时长。进程收到 `SIGTERM`/`SIGINT` 时会停止接收新连接并关闭数据库连接池。

默认限流窗口为 15 分钟：普通 API 每个客户端 IP 1000 次，登录失败每个客户端 IP 10 次，成功登录不消耗登录失败额度。可通过 `RATE_LIMIT_WINDOW_MS`、`API_RATE_LIMIT_MAX`、`LOGIN_RATE_LIMIT_MAX` 调整。应用只信任本机反向代理提供的客户端 IP；如果 Nginx/负载均衡不在同一主机，需要按实际网络边界修改可信代理配置。

## 统一图片资产

启用统一图片资产功能后，公司 Logo/二维码与产品图片走同一套生命周期：浏览器直传私有 COS 隔离区，服务端 Sharp 校验 + SHA-256 去重，后台生成 original/display/thumbnail，业务表只存资产 ID 与 object key。普通展示用短期签名 URL，单据导出走同源受控内容接口。功能开关、迁移、回收与对账流程见 [图片资产运维手册](docs/operations/image-asset-operations.md)。

## 项目知识库

项目知识和开发复盘统一放在 `docs/`；视频制作内容已移出本应用项目。从 [按问题阅读](docs/00-首页.md) 进入：业务负责人看需求，开发/验收看进度与专题，遇到问题查经验；找不到时在 [分类检索](docs/文档分类与检索.md) 按 `Ctrl+F` 搜关键词。也可用 Obsidian 打开 `docs/`。

## 产品主数据 V2

三库、权限、面料 xlsx 导入、三种单据和客户选样的需求见 [领域入口](docs/product-master/README.md)，实施与验收见 [当前进度](docs/product-master/product-master-v2-progress.md)。实际开发入口跟随活动工作区指针，不能从根目录历史 `src/App.tsx` / `server.ts` 推断当前应用或线上版本。

## 主要目录

- `src/`：React 前端
- `server.ts`：Express API 和服务启动
- `server/`：旧产品、图片资产及 V2 权限/三库/单据/客户选样模块
- `scripts/`：测试、图片安全、数据库隔离验收与维护脚本
- `uploads/`：本地图片运行数据，不提交 Git
- `template/`：Excel 模板运行数据，不提交 Git
- `docs/`：统一项目知识库、开发规范与复盘
- `artifacts/`：UI 评审快照、验收证据和开发恢复基线
- `.agents/skills/`：项目技能；`agent/skills/`：已安装的 UI 工具技能
