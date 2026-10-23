# Fabric 内部工作台第二批 UX 微改进（2026-10-21）

> **审阅结果更新**：原版演示不符合用户的正式业务界面预期（列宽、按钮拥挤、排序无用），已由 [色卡列表纠偏](card-library-correction-2026-10-21.md) 替代。原“列设置夹具”仅用于交互测试，不再作为色卡列表外观验收。

## 上下文与决策
- 用户于 2026-10-21 明确回复“验收通过”，正式色卡客户微信 H5 的四项体验修改已完成业务验收，线上保持发布 ID `20261021t122729174-f6830828`。本次**不改动已验收的公开 /c/ 页面**。
- 内部所有主数据与业务页面效率优先、快速迭代，不引入大面积 Hero、重新设计架构或没有必要的二次弹窗。第二批仅针对高频小操作，复用在用组件。
- 本批为**本地已测试候选，未部署线上、未合入线上用户可见页面**；先提供本机评审入口。

## 本次变更
| 组件 | 影响范围 | 操作改进 |
|---|---|---|
| `src/components/product-master-v2/LibraryTableChrome.tsx` | 面料库、产品库、色卡库共用列设置 | 使用明确的展开状态及对应面板；按 Esc 收起设置并恢复到触发按钮；恢复默认列后关闭菜单并回焦；点击菜单外关闭但不抢外部按钮焦点；保留已存在的列偏好持久化/排序模型 |
| `src/components/product-master-v2/SampleCardLibraryV2.tsx` | 内部实体色卡搜索 | 输入有内容才显示清空按钮；一键清空、按 Esc 清空，焦点留在搜索框；清空搜索回到第一页，原选样/导出/删除/分享业务未调整 |
| `LibraryTableChrome.test.ts` | 共用组件测试 | 更新展开面板语义断言；隐藏时不保留悬空 aria-controls |

## 验证与可复现
- 浏览器全部 UI 回归：`npm run test:ui:ux`，**21/21 PASS**，包含旧微信客户分享 17 项和本轮内部新增 4 项。
- 对应业务单测：`LibraryTableChrome.test.ts`、`libraryTableChromeModel.test.ts`、`SampleCardLibraryV2.test.ts`，**34/34 PASS**。
- 定向 TypeScript `tsc --noEmit` PASS；真实活动源码 Vite 客户端构建 PASS（有既有大 bundle warning，不影响构建成功）。
- 源清单：`node scripts/fabric-v2-workspace.mjs check` **PASS**；当前本地候选为 `artifacts/internal-ui-controls-20261021/source-manifest.json`，**722 项源码**，修改仅 3 个已注册文件，原发布版清单与回滚依据未覆盖，`currentRelease` 仍指向上次已上线的微信分享版。
- 内部审核本机入口：`http://127.0.0.1:52991/ui-ux-internal-chrome.html`（列设置与排序）、`http://127.0.0.1:52991/ui-ux-internal-cards.html`（实体色卡搜索）。页面使用模拟行，不连接正式数据；Edge 实际访问均 HTTP 200，交互在浏览器测试内验证。
- 本轮评审页代码仅在根目录 `src/ui-ux-pilot/` 和 `tests/ui/`，与生产业务路由隔离，不包含真实客户分享 token。

## 待验与后续
- **用户实际内部 UI 验收：待确认**。这两个小改动不构成用户对整个管理 UI 风格的批准。
- **发布：未授权本批新发布，尚未部署**，继续保留线上 `20261021t122729174-f6830828`。下一轮按此候选清单、统一发布工具、完整生产质量 Gate 和用户授权执行。
- 下一批可继续沿真实使用反馈优化：公共表格的列默认值、筛选清空/分页复位与批量动作提示；不默认批量改造所有页面，避免影响已批准业务。
