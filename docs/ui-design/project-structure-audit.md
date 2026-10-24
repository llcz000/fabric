# Fabric 当前项目结构与源码定位

> 核对：2026-10-24。用于定位当前源码；旧目录审计原件在[恢复包](../maintenance/文档整合与恢复.md)。

唯一正式工作区为 `D:/fabric`，`docs/project/fabric-v2-active-workspace.json` 的 workspace 为 `.`、role 为 application。`server.ts` 启动 V2-only 运行时，`src/App.tsx` 装配 V2App 和受限公开分享页；旧内嵌工作区、控制器与旧 App 均不作为开发目标。

| 位置 | 当前用途 |
|---|---|
| `src/components/product-master-v2/` | 花型、面料、产品、色卡及选样组件 |
| `src/components/customers/` | 当前轻量客户档案 |
| `src/components/document-product-selector/`、`src/lib/documentPrintModel.ts` | 三单据选品与共享输出模型 |
| `server/product-master/`、`server/access/` | 主数据与正式认证授权 |
| `server/customer-share/`、`server/customer-samples/` | 受限公开分享与色卡选样 |
| `server/order-v2/`、`server/image-assets/` | 单据与图片资产生命周期 |
| `.agents/skills/` | 项目技能；`agent/skills/` 为既有设计工具技能，不代表都已采用 |
| `artifacts/releases/`、`.local/` | 冻结发布证据与私有本机状态，不随文档清理删除 |

命令以 `package.json` 为准；开始运行 `npm run v2:source`，UI 任务另运行 `npm run ui:preflight`。默认单 Agent、单工作区；临时隔离仅在明确要求时按[并行规范](../development/Fabric并行开发与合并规范.md)执行。需求和状态分别查[需求总览](../project/项目需求总览.md)、[项目现状](../project/项目现状.md)，不在结构说明重复版本和测试流水。
