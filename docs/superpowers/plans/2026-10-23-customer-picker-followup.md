# 客户偏好与开单选图 Implementation Plan

> 使用executing-plans，本会话原地完成，沿用已隔离活动源码。

**Goal:** 完成用户追加三项交互修正。
**Architecture:** 复用FabricSearchSelect多选与catalogModel签名解析；客户备注存现有JSON。
**Tech Stack:** React/TypeScript/node:test/Playwright Edge。
**Spec:** docs/ui-design/customer-picker-followup-2026-10-23.md。

## Global Constraints
- 保留旧客户选择、鉴权和单据草稿；不写生产或切换版本。
- 仅新增面料备注，不恢复启停等已取消流程；窄屏可用，桌面普通表单无需滚动。

## Review Focus
- 多选跨搜索保留，取消/失败不丢选择，Esc先关下拉。
- 备注保存读取与空值兼容、400字限制。
- 缩略图逐ID映射、旧请求取消、签名失败仍可选用。

### Task 1: 常用面料多选与备注
**Files:** FabricSearchSelect.tsx、CustomerProfileForm.tsx、customerModel.ts、server/customers/model.ts及对应测试。
**Interfaces:** multiple/selectedIds/onToggle；CustomerProfile.fabricNote。
- [x] 新增备注持久化/多选行为失败测试并观察RED。
- [x] 扩展共享下拉，接入客户表单与详情、备注校验。
- [x] 单选与多选回归，验证保存重新读取。

### Task 2: 摘要紧凑与选品缩略图
**Files:** customerWorkspace.css、CustomerProfileDialog.tsx、selection.ts、ProductSelectorDialog.tsx、selection.test.ts。
**Interfaces:** resolveProductSelectorThumbnails(fetcher,page,signal):Promise<PickerPage>。
- [x] 新增图片ID映射/失败/取消回归，观察RED。
- [x] 接入既有图片鉴权解析器，修正五列布局。
- [x] 实际Edge验证五列位置、普通编辑无滚动、多选/备注、图片加载及失败仍可选。

### Task 3: 验证交付
- [x] 更新需求与候选清单，完成定向测试、类型、构建、UI报告/证据及复核。
- [x] 保留前一固定包验证记录，新源码未封包前不复用旧包宣称可发布；更新唯一状态，未部署。

完成证据见[当前专题](../../ui-design/customer-picker-followup-2026-10-23.md)，独立审查限制及未部署状态明确保留。
