# P7｜独立沙箱 V2 HTTP 启动入口（2026-10-15）

> 类型：一期集成候选切片，**不代表已上线、生产可用、真实 MySQL 验收或用户 UI 签收**。唯一业务基线见[需求 v1.50](product-master-v2-requirements.md)，状态见[进度](product-master-v2-progress.md)与[一期 Go/No-Go](product-master-v2-phase1-delivery-readiness.md)。

## 本轮为何不直接修改正式 server.ts

正式`server.ts`复用旧认证、旧产品 API 和`getMySQLPool()`，后者在首次建立MySQL连接时可能自动`CREATE TABLE IF NOT EXISTS`旧版业务表，并在失败时落入本机JSON fallback。若将 TEST-ONLY `createV2CatalogAssembly`直接接入此入口，会混合认证、迁移副作用和单据路由，不能认为是安全V2交付。本轮**未修改**正式`server.ts`或`src/App.tsx`。

## 交付代码与离线回归

- `server/product-master/v2SandboxPreview.ts`：强制`NODE_ENV=development`、单独确认值、`HOST=127.0.0.1`、本机数据库代理`DB_HOST=127.0.0.1`、明确沙箱名`fabric_v2_test_*`、固定的`FABRIC_V2_SANDBOX_EXPECTED_UUID`、DB账号密码及合法端口。默认未授权必拒绝；生产目标名或UUID不一致均拒绝。
- `scripts/run-v2-sandbox-preview.ts`：**独立 CLI，默认不会从`npm run dev`或`npm start`自动执行**。验证配置后才建独立MySQL池；本入口没有legacy MySQL自动建表或JSON后备。验证身份成功后才监听本机HTTP。真实授权业务API在沙箱上**可能写入沙箱**，因此运行CLI必须另获用户对选定隔离库的明确批准。
- HTTP 前缀`/api/v2`由既有 TEST-ONLY V2 Assembly 提供，独立`/health`只报告`sandbox-preview`与`releaseAuthorized:false`。不提供旧`/api/login`、`/api/orders`、`/uploads`入口，也不复用旧admin token。验证各次从池借出的连接，都与操作人员预先独立固定的UUID一致。
- `server/product-master/v2SandboxPreview.test.ts`：5项TDD回归，用内存SQL替身和本机真实HTTP监听验证配置拒绝、URI隔离、匿名拒绝、连接漂移及租借连接释放。**没有连接任何真实DB**。最终5/5通过；主项目全量990项989通过/1设计跳过/0失败，完整lint/build通过。
- 独立启动说明（**仅供获批后执行，当前未运行**）：配置`NODE_ENV=development`、`HOST=127.0.0.1`、`PORT`、`DB_HOST=127.0.0.1`、`DB_PORT`、`DB_DATABASE`、`DB_USER`、`DB_PASSWORD`、`FABRIC_V2_SANDBOX_PREVIEW=I_ACKNOWLEDGE_SANDBOX`、`FABRIC_V2_SANDBOX_DATABASE`、`FABRIC_V2_SANDBOX_EXPECTED_UUID`。确认DB_DATABASE与沙箱名一致、UUID为独立查证且已获授权后，使用`npx tsx scripts/run-v2-sandbox-preview.ts`。**不提供密码、UUID或预置批准**。

## 下轮真实交付门槛

R1：在取得目标库授权后用真实隔离 MySQL 验证 V2 账号登录、受权产品读取/写入、跨账号拒绝、DDL保持不变、双连接及回滚、图片COS；前端独立V2登录/七页React与此入口对接，避免复用legacy token。R2：真实账号业务/UAT、三单据历史、导入及P95；R3：生产装配替换旧入口，明确备份恢复、版本化迁移及独立切流批准。

当前所有工作属于**离线本机源码与内存SQL测试**，并非真实隔离库演练；`check-fabric-v2-phase1-delivery.mjs --status`仍应为No-Go。二期B1/B2/B3不作为一期上线前提，但必须保护其已有代码与持久化命名空间。

**归档状态：保留**。此记录定位独立启动实现及未完成实库UI Gate；本轮无生产或测试MySQL连接、无COS写入、Git清理/提交或部署。
