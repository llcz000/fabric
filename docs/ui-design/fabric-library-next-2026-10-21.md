# 面料库 UI 联合优化 · 第一批候选（2026-10-21）
**验收问题修正（2026-10-21）**：用户指出行内编辑时「克重单位」显示被压缩。已完成修复，并通过完整 30 项 UI 回归，详情见 [克重单位显示修复](fabric-weight-unit-fix-2026-10-21.md)。当前唯一活动候选已更新为 `artifacts/internal-fabric-weight-unit-fix-20261021/source-manifest.json`。

## 工作范围
色卡库发布 `20261021t134811458-b98988bc` 已经用户线上验收通过，结束本阶段。下一页优先**内部面料库**，维持原有面料品号、成分规格、克重单位（gsm/mm）、启停用、关联产品、列设置、Excel 导入导出、编辑及删除权限与服务端校验。

复用同一次色卡库获批的设计理念：精简页面的冗余说明、清晰标题与主次操作、表格样式一致、只在有条件时出现「清空筛选」、不堆叠无意义图标。保留面料库三字段独立检索和现有排序（未获用户要求删除），防止用户习惯被无依据更改。长品名省略展示并通过 title 可看完整值。手机列设置与表格横向滚动不造成整页横向溢出。

## 真实组件与测试
- 正式组件改动：`src/components/product-master-v2/FabricLibraryV2.tsx`，样式：`src/components/product-master-v2/v2Experience.css`（`v2-fabric-page` 局部 CSS，不影响其它页面）。
- 只在根目录添加本机评审入口 `ui-ux-internal-fabrics.html` + `src/ui-ux-pilot/internalFabricReview.tsx`；用正式 React 组件/正式 CSS、3 条示例数据，**不是正式后台 API/生产用户数据**。
- 截图：`D:\\fabric\\artifacts\\ui-ux-pilot\\fabric-library-design-desktop.png`、`fabric-library-design-edit.png`、`fabric-library-design-delete.png`、`fabric-library-design-mobile.png`。
- `tests/ui/internal-fabric-design.spec.ts`：三种本机 Edge 测试覆盖筛选和复位、保留列设置、编辑/取消、删除确认与不可删除关联记录、窄屏布局，**3/3 PASS**。
- `FabricLibraryV2.test.ts` 旧业务合同 **13/13 PASS**；新旧页面综合 `npm run test:ui:ux` **28/28 PASS**；专项 TypeScript PASS；正式活动客户端 Vite 构建 PASS（旧大包 warning 仍存在）。
- **用户视觉验收：待确认**；当前为本地候选，**未部署生产**。

## 统一发布 UI Gate 实装
- 活动发布器新增 `scripts/release/ui-quality-gate.mjs`、`ui-quality-gate.test.mjs`，并在 `scripts/release/cli.mjs` 的 `prepare` 里绑定源码与截图证据；前端变更自动跑 Edge 浏览器测试，纯后端变更跳过。
- 发布专项 `npm run test:release` 的 4 个环节（基础/新 UI/远端故障/HTTP 合同） PASS；Gate 行为及发布器单测 **20/20 PASS**（含陈旧源码、截屏改动、权限伪造、缺少视觉评审等）。
- 实际验证新源码缺少评审证据时 **FAIL CLOSED**；新增 3 张截图的 SHA256 对应本次候选，`inspect` 正确识别面料库 2 个 UI 变化及原已上线生产基线 `20261021t134811458-b98988bc`。
- 版本清单 `artifacts/internal-fabric-ui-20261021/source-manifest.json`，725 项，新增仅发布器 UI QA 的 2 个脚本；其余业务文件不带入。本轮没有进行 `release prepare` 或任何生产切换。

## 下一步
用户确认面料库实际视觉后，继续从下一页内部主数据/产品库做同轮视觉+组件+交互优化。是否部署新候选需明确上线授权；直接切换生产环境不是「UI Gate 已实现」的含义。
