# Fabric UI/UX 第一批样板验收记录（2026-10-21）

## 范围
- `ui-ux-pro-max` 已通过项目级 CLI 安装，WebCodex `skill_load` 与内置 Python 检索通过。
- 已存在 `fabric-ui-design`、`frontend-design`、`web-design-guidelines` 且均可加载；新增 `fabric-ui-ux-qa`。
- 新开发流程：`docs/ui-design/ux-delivery-gate.md`；项目入口 `AGENTS.md` 和 `fabric-ui-design/SKILL.md` 已引用。
- 交互样板：`ui-ux-pilot.html`，`src/product-master-v2-review/SampleCardUxPilot.tsx`。4张本地模拟色卡，含搜索/重置/无结果、花型配色查看、色卡关联产品媒体分组、仅本机预览链接复制、演示二维码。
- 仅本机离线演示，不调用生产 MySQL/COS、真实业务接口，不生成可用客户分享令牌。独立静态预览服务：`node scripts/serve-ui-ux-pilot.mjs`；地址 `http://127.0.0.1:52991/ui-ux-pilot.html`。

## 实际验证
| 项目 | 结果 |
|---|---|
| Playwright + 系统 Edge：搜索/重置/无匹配 | PASS |
| 查看花型、Esc关闭与焦点恢复 | PASS |
| 关联产品/三类媒体分组、本机链接复制、关闭恢复焦点 | PASS |
| 演示二维码来源（DEMO-ONLY） | PASS |
| 360px 布局、弹窗关闭按钮宽高与键盘交互 | PASS |
| `npm run test:ui:ux` | **5 passed (10.8s)**；测试隔离端口 52992，与人工预览 52991 分开；用本机 Edge 单独验证了 52991 演示深链预览弹窗可打开 |
| 专项 TypeScript 检查（`src/ui-ux-pilot/main.tsx`） | PASS |
| 整体 `npm run lint` | **FAIL：隔离工作区 tsc Node 堆接近 2 GB 时 OOM（exit 134）**，不能宣称全局质量门禁通过 |

浏览器截图：`artifacts/ui-ux-pilot/card-list-desktop.png`（1440px）、`artifacts/ui-ux-pilot/card-dialog-mobile.png`（360px）。手机截图审查发现关闭按钮折行，已修正并新增断言，重测通过。

## 留待后续验收
用户实际 UI 接受：待确认。正式色卡库接线、真实图片、真实公开分享 API、角色权限、生产数据 E2E、整站 lint/build 和发布：均未在本任务确认通过。

本次保留原工作区未提交内容，不删除/清理/批量提交，不部署。正式使用必须先完成与线上实际版本的差异对照以及专门上线授权。


## 实施计划归档后保留约束（2026-10-24）

以下约束从已被本文替代的执行计划提炼，历史实现状态以原日期为准，现行业务以最新需求为准；不是新增需求或本轮业务验收。

- 独立 UX 样板仅本地模拟数据，链接必须 localhost、不代表实际分享 token；搜索空态不能残留旧行，Esc/遮罩回到原按钮，360px 保留操作。工具验证、样板接受、正式组件接线和生产验收分别记录；当前样板源码已迁至 tools/ui-preview。
