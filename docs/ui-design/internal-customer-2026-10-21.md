# Fabric UI 定位调整与内部/客户样板验收（2026-10-21）

## 已确定的定位
整个 Fabric 管理系统仅公司内部使用；**只有通过色卡分享链接打开的展示内容**给客户。内部人员使用色卡库中的“分享预览/复制链接”是内部工作流程，不等于客户展示网页。

详见 [产品定位及迭代原则](product-positioning-2026-10-21.md)。本轮以“少装饰、低改动、快迭代”为原则收敛此前 A/B 实验方案，并未变更正式产品业务路由。

## 样板结构
| 入口 | 类型 | 设计目标 |
|---|---|---|
| `ui-ux-pilot.html` | 内部色卡工作台 | 标题/搜索紧贴列表、信息紧凑、花型缩略识别、直接常驻操作，移除营销 Hero/无用统计/内部 A-B 切换 |
| `ui-ux-share-demo.html?demoCard=demo-1` | **本机独立模拟**的客户色卡展示内容 | 大图、配色、面料/细节/应用效果成组；页面不提供管理按钮，不访问真实用户或公开数据 |

共同演示数据从 `src/ui-ux-pilot/demoCards.ts` 读取；内部业务组件和客户展示 UI 各自隔离。两个链接均仅本机可用，图案 CSS 演示占位，无真实业务 token/公开分享权限。二维码仍为 `DEMO-ONLY-`。**不能向客户发送链接**。

## 本轮验证
- `npm run test:ui:ux`：**7/7 PASS（23.6 秒）** 的 Playwright/Edge 本机测试：内部列表/筛选/空态、花型弹窗与 Esc/焦点、独立客户样板链接与剪贴板、本机二维码、360px 内部样式、360px 客户媒体、无效演示链接拒绝。
- **专项 TypeScript PASS**，**双入口独立构建 PASS**；更新静态站点后使用 Edge 实际检查内部列表 4 行、客户展示 3 款关联产品，CSS 修复后客户页面 body margin 为 0px。
- 额外检查：专项 TypeScript（`src/ui-ux-pilot/main.tsx`、`src/ui-ux-pilot/shareMain.tsx`、`tests/ui/sample-card-ux.spec.ts`、`playwright.ui.config.ts`），独立双入口静态构建与浏览器加载。
- 实际截图（通过 Playwright/Edge）：`artifacts/ui-ux-pilot/internal-efficient-desktop.png`、`internal-efficient-mobile.png`、`customer-share-desktop.png`、`customer-share-mobile.png`。
- 旧全项目 `npm run lint` 的 Node 堆内存 OOM 仍无修复，不能把专项测试当作发布 Gate；未做任何生产部署或正式业务接线。

## 后续条件
1. 视觉/任务路径由内部用户实际评审。
2. 正式色卡库只按批准后的精确差异实现，复用现有数据和组件，不照搬模拟数据层。
3. 正式公开分享链接需要真实花型/面料图及权限、脱敏、链接有效期、失效码等后端安全校验；不能仅凭这个展示样板上线。
4. 常规版本升级不强制 A/B、全面 UI 重设计或全量测试；只针对影响模块按风险选择 Gate，生产发布仍需既有统一发布检查。
