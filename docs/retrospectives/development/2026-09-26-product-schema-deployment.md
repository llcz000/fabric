> 文档状态（2026-10-09整合）：保留历史决策/验证证据；原日期的版本、测试和线上结果未在本轮重新验证。当前实现与未解决项见知识库首页。

# 2026-09-26 产品库部署失败复盘（本地专用）

> 文档定位：复盘经验｜主要读者：开发、测试/评审、Agent。用途：遇到同类问题时读根因、做法和验证范围。

## 结果

- 失败提交 `33f1da4` 已从远程运行目录回退到 `bef3447`。
- PM2 重建重启完成，`/api/health` 恢复为 `storage=mysql`。
- 失败窗口内 JSON fallback 文件未发生修改，没有发现业务数据误写。

## 根因

1. 产品域建表被错误绑定到图片资产功能开关；开关关闭时，读取代码已上线，但数据库字段和表未创建。
2. 第一次修复把完整图片/产品域初始化改为无条件执行，却只在模拟连接上验证 SQL，没有在远程同版本 MySQL 上验证真实语法。
3. `server/products/schema.ts` 使用了 MySQL 8.0 不支持的 `ADD COLUMN IF NOT EXISTS` 和 `ADD KEY IF NOT EXISTS`。
4. 初始化失败后应用静默回退 JSON，使健康检查仍返回 `status=ok`，但存储已变为 `json`；只看 PM2 online 和 HTTP 200 不足以判定部署成功。

## 已确认的环境事实

- MySQL 8.0.46，严格模式，InnoDB，账号具备所需 DDL 权限。
- `INFORMATION_SCHEMA.COLUMNS` 可用于幂等判断列是否存在。
- `INFORMATION_SCHEMA.STATISTICS` 可用于幂等判断索引是否存在。
- 远程已留下 6 个空的图片资产基础表，后续迁移必须兼容“全新、部分完成、完整”三种状态。
- Nginx 在本机反代并设置 `X-Forwarded-For`；Express `trust proxy` 仍需单独修复，但不是本次产品库 500 的直接根因。

## 后续开发约束

1. 不再使用 `ADD ... IF NOT EXISTS`；先查询 `INFORMATION_SCHEMA`，只对缺失列或索引执行标准 MySQL 8.0 DDL。
2. 数据库结构初始化独立于业务功能开关，开关只控制路由、上传和 worker。
3. 为全新、部分迁移、重复启动三种状态各写真实行为测试。
4. 部署前先执行 `mysqldump` 备份；部署后必须同时验证：目标提交、工作区干净、PM2 online、`health.storage=mysql`、关键表/列存在、产品 API 返回 200。
5. 任一数据库初始化失败或 `health.storage` 变化，立即判定部署失败并回退，不继续数据导入。
6. 代码提交推送与远程部署继续分别等待用户确认。

## 官方依据

- MySQL 8.0 `ALTER TABLE` 语法只提供标准 `ADD COLUMN` / `ADD INDEX`，没有本次代码使用的 `IF NOT EXISTS` 变体。
- 列存在性以 `INFORMATION_SCHEMA.COLUMNS` 判断，索引存在性以 `INFORMATION_SCHEMA.STATISTICS` 判断。
