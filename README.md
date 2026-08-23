# Fabric DMS 面料单据管理系统

面向面料贸易业务的内部管理工具，支持样布码单、销售发货码单、定金单、产品图库、Excel 导入导出和库存台账。

项目使用 React + Vite 前端、Express 后端和 MySQL。MySQL 未配置时可使用本地 JSON 作为开发降级存储；生产环境应配置唯一的权威数据库。

## 本地运行

要求：Node.js LTS、npm；生产数据建议使用 MySQL。

1. 安装依赖：`npm.cmd install`
2. 复制 `.env.example` 为 `.env`
3. 设置一个随机的 `ADMIN_PASSWORD`
4. 按需填写 `DB_*` 和腾讯云 `COS_*`
5. 启动开发环境：`npm.cmd run dev`
6. 打开 `http://127.0.0.1:3000`

服务缺少 `ADMIN_PASSWORD` 时会拒绝启动，不再使用默认密码。

## 验证

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:security
npm.cmd run test:all
npm.cmd run test:image-assets
npm.cmd run test:image-assets:smoke
```

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

公司 Logo/二维码与产品图片走同一套图片资产生命周期：浏览器直传私有 COS 隔离区，服务端 Sharp 校验 + SHA-256 去重，后台生成 original/display/thumbnail，业务表只存资产 ID 与 object key。普通展示用短期签名 URL，样布码单导出走同源受控内容接口。功能开关（IMAGE_ASSETS_ENABLED、COMPANY_IMAGE_ASSETS_ENABLED、PRODUCT_IMAGE_ASSETS_ENABLED）、迁移/上传命令、回收与对账流程见 docs/solutions/architecture-patterns/image-asset-operations.md。

## 项目知识库

使用 Obsidian 打开 `Fabric-DMS-Knowledge-Base/`。入口是 `00-首页.md`，其中包含架构、API、数据模型、清理审计、安全基线和优化路线图。

## 主要目录

- `src/`：React 前端
- `server.ts`：Express API 和服务启动
- `scripts/`：图片与安全验证脚本
- `uploads/`：本地图片运行数据，不提交 Git
- `template/`：Excel 模板运行数据，不提交 Git
- `Fabric-DMS-Knowledge-Base/`：项目知识库
