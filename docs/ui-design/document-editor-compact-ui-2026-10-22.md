# 新建单据页紧凑 UI 优化与验收（2026-10-22）

> 2026-10-24 目录整理：本文部分历史路径对应的临时文件、已退役源码副本或旧发布证据已完整迁至仓库外；原路径作为历史定位保留，按[归档恢复索引](../maintenance/2026-10-24-workspace-archives.json)中的范围和逐文件 SHA256 查找原件。未完成的业务 Gate 仍按当前进度保留。
## 2026-10-23 正式上线与规范复核（覆盖下方历史候选状态）

- **正式上线并验证成功**：统一发布制品 `20261023t031612467-bb25e48d`；当前生产应用见 <https://124.223.97.60>，活动工作区 `currentRelease.id` 已更新。生产制品 SHA256：`bd1cc4a17e31975ef6f2944c3a4d877aa8768b1bb015a6d835ee4861aae256e7`。
- **UI 专项视觉修复**：360px 客户弹窗“取消 / 确认使用”从竖排文字改成正常横排按钮；保留单字段入口、快捷建档、确认与取消、历史客户显示名称、原明细模型。测试捕获桌面、新建客户弹窗、移动弹窗与三种单据字段切换。预览是真实组件加正式 CSS，但模拟 API 数据。
- **验证**：单据页面浏览器专项 14/14 PASS（含 Esc、焦点恢复、三种单据类型、清空明细确认、添加/取消）；统一根目录 UI Playwright 35/35 PASS；单据组件专项 12/12 PASS；发布工具离线测试全部通过，正式前端构建与 HTTP 合同检查 PASS。独立视觉核对已完成；用户本人正式线上视觉确认仍属待验，未伪造签收。
- **双层 UI Gate**：工作流报告 `artifacts/ui-workflow/5ddcae595184738307af1bdcdd0d9e3a6d6167a87e73ee5554fb.json` 已 PASS（用户签收 pending）；发布视觉证据 `artifacts/ui-quality-gate/5ddcae595184738307af1bdcdd0d9e3a6d6167a87e73ee5554fb.json` 已 PASS，审核范围严格绑定 6 个新增/修改的前端文件，发布器准备阶段再次重跑 UI 全套回归。
- **发布及恢复**：`artifacts/releases/20261023t031612467-bb25e48d/release-result.json`；本地/远端上传、预检、备份、离机读回、deploy、verify 与独立 status 均 passed；无数据库迁移、不改现有客户数据，未触发回滚。发布工具记录总阶段用时约 156.4 秒。
- **仍待实际登录验收**：登录线上“新建单据”，核对客户选择/快速建档、产品添加、样布/销售/定金三类实际保存及预览/Excel；隔离模拟测试不能代替生产账号真实写入与视觉签收。历史过程文件判定：本页保留，相关旧候选记录保留作差异审计，未进行任何归档清理。


## 范围与现状
活动源码：`D:\fabric\.agent-workspaces\v2-quality-20261020`，正式入口 `V2App -> V2DocumentWorkspace`；根目录旧共享源码不是当前发布源。本次仅修改活动工作区，不部署或操作真实数据库。保留其他未提交工作，重点保持 V1.2 客户档案、关联版本与幂等保存语义。

## 本次实施
1. 基本信息中的「客户/收货单位」压缩成单个可点击字段；移除重复只读名称与常驻客户列表。弹窗中调用原客户选择/快速建档逻辑，先选择、后确认，取消不更改已选客户。已保存单据保留独立「单据显示客户名称」字段，避免改变历史快照。
2. 快速建档保留客户名称必填与联系人可后补，联系人默认折叠；候选客户不足一页时隐藏无用分页；单据弹窗使用无多余内层边框的嵌入式客户选择器。
3. 产品库添加：确认选用后才新增明细，取消不残留空行；管理员手工录入仍保留。清空明细需要危险操作确认，取消保留明细。管理员手工录入二次确认 Esc 不误关底层选品弹窗。
4. 统一了返回、预览/导出、添加、清空、保存按钮的图标与文字水平排列，并使窄屏产品操作行自动换行；去掉重复空明细说明。保留三类单据业务字段、汇总逻辑、折叠式签署信息。

## 检查证据
- 静态及组件定向单元测试：`node --import tsx --test src/components/customers/CompactCustomerChoice.test.tsx src/components/document-product-selector/V2DocumentWorkspace.test.ts`，**12/12 PASS**。
- 真实 React 组件 + 正式 CSS + 本机模拟 API 浏览器专项：`node scripts/document-ui-compact-browser-qa.mjs`，**10/10 PASS**，桌面 1440px 与窄屏 360px，浏览器 JS 错误 **0**。路径：`artifacts/document-ui-compact-review-20261022/qa-result.json` 与 7 张截图；涵盖已有客户搜索/选择、快捷建档取消/确认、选品取消/添加、手工确认 Esc、明细清空二次确认、返回保留、窄屏溢出。
- Vite 正式前端构建：PASS（1841 模块，`artifacts/document-ui-compact-review-20261022/frontend-build`），仅有既有大 chunk 性能提示。
- 完整工程 `tsc --noEmit` 在本机大型工作区发生 Node 堆内存耗尽，**不能作为已通过的全量类型检查**。本次变更在浏览器 Vite 转译与构建通过，尚不等于完成全量类型验收。
- 由于没有真实登录/数据库，本机模拟页面不代替正式三单据写入、权限、历史快照与导出回归，也不代替最终人工 UI 验收。

## 文件
核心 `src/components/document-product-selector/V2DocumentWorkspace.tsx`、`ProductSelectorDialog.tsx`；新组件 `src/components/customers/CompactCustomerChoice.tsx`；共享客户 UI `CustomerChoice.tsx`、`CustomerProfileForm.tsx`；专项测试 `V2DocumentWorkspace.test.ts`、`CompactCustomerChoice.test.tsx`；本机验收夹具 `document-ui-review.html`、`src/document-ui-review.tsx`、`scripts/document-ui-compact-browser-qa.mjs`。

**历史状态（2026-10-22）：当时仅为本地候选、尚未上线。** 当前部署结果与未完成的用户生产视觉签收，以本页顶部 2026-10-23 更新为准。
