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
```

## 生产运行

```powershell
npm.cmd run build
$env:NODE_ENV='production'
npm.cmd run start
```

生产部署前必须完成凭证轮换、HTTPS、数据库备份、登录限流验证、上传验证和 SSRF 测试。不要提交 `.env`、上传文件、JSON fallback 数据库或客户数据。

## 项目知识库

使用 Obsidian 打开 `Fabric-DMS-Knowledge-Base/`。入口是 `00-首页.md`，其中包含架构、API、数据模型、清理审计、安全基线和优化路线图。

## 主要目录

- `src/`：React 前端
- `server.ts`：Express API 和服务启动
- `scripts/`：图片与安全验证脚本
- `uploads/`：本地图片运行数据，不提交 Git
- `template/`：Excel 模板运行数据，不提交 Git
- `Fabric-DMS-Knowledge-Base/`：项目知识库
