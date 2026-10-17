# P4 三库 React 交互与浏览器验收技术说明

用途：实现定位与UI约束，避免逐个读取旧切片。业务以[需求](product-master-v2-requirements.md)为准，状态看[进度](product-master-v2-progress.md)，视觉规则看[UI规范](../ui-design/README.md)。2026-10-15提炼，历史Edge证据不是生产验收。

## 已有实现及批准交互

| 页面 | 实现位置 | 必须保持的行为 |
|---|---|---|
| 花型/配色 | `PatternLibraryV2.tsx/patternModel.ts`；`patternCatalog.ts/colorwayIdentity.ts` | 花型分页、六列配色、只读永久序号；题材/颜色在花型级同级维护且列表独立列，独立配色序号筛选已去掉。行内编辑可上传/删除图，保存图片关联+备注+启停，取消不改关联；新配色同事务分配计数 |
| 面料 | `FabricLibraryV2.tsx/fabricModel.ts`；`fabricCatalog.ts` | 九列行内编辑；品号/品名/成分联合关键词；规格数值/单位成对，可空值不填0，不自动换算gsm/mm；关联产品或色卡的品号和删除由服务器保护 |
| 产品列表 | `ProductCatalogV2.tsx/catalogModel.ts` | 2026-10-16暂去掉题材/颜色列及筛选，十列含产品独立备注；货号/品名独立AND，与启停组合，服务端过滤分页、变筛选回首页、旧响应失效；本版原图与产品三类图分开；产品图三类Tab按需original，当前窗口切回复用，关闭清空 |
| 产品编辑 | `ProductEditorV2.tsx/productEditorModel.ts/ProductCatalogWorkspaceV2.tsx` | 具体配色+面料生成只读货号预览，服务器最终编号；三类有序UUID各0～10，跨组不重复，替换保位置、解除关联只改草稿；一次POST/PATCH及expectedRowVersion，失败留草稿 |

花型编辑打开读取全部版本，不受列表颜色筛选截断；归档已关联标签可保留/移除但不能新挂。图片签名批量、按需加载，无图/失败有占位，不用其他产品图填空。上传需受控ready资产回调，缺回调不显示假上传。成功持久化但后置刷新失败不得诱导重复POST；取消/卸载/切换对象后迟到响应不可污染新草稿。未有真实订单引用标志时，不由前端猜测身份可变。

## 2026-10-16当前修订验证

现有React组件修订，无新替代页面。后续产品新增/编辑已去掉“允许供样”控件，底层状态保留；最新脚本不再操作该控件。`scripts/p4-v2-browser-qa.mjs`最新81项、30张截图通过：六列编辑、自定义颜色、归档关联连续保存保留、真实File上传/保存回读/删除取消/删除保存、产品十列与无标签筛选、花型无配色序号筛选，以及320/360/1280/1440布局。产品图Tab请求原图、未看类别不预取、切回无重复原图请求、键盘Home/End与焦点正反回绕通过；花型/产品列表320px缩略图点击同资产1440px原图已验证。内存API不代表COS或真实MySQL写链。

三库导出在原列表增加按钮，当前筛选全匹配数据下载为XLSX，真实Edge下载完成事件后用ExcelJS读取文件核对；不导出图片及内部字段。现有V2单据编辑增加逐匹输入及追加、毛米数合计、空位和未完成文本保护。保存/打印实库链不由内存评审补造。

## 历史浏览器证据

独立`product-master-v2-review.html`及`src/product-master-v2-review/`只用内存API，不代理远端。`scripts/p4-v2-browser-qa.mjs`在Edge Headless实际点击320/360/1280/1440视口；花型七列编辑、引用面料只读品号、产品选择→保存→回列表、颜色自定义/原子保存均有截图。报告从初次19项/17图增长为后续包含xlsx的32项/25图，详细日期以`artifacts/product-master-ui/qa/p4-6/browser-qa.json`及原归档记录为准；不是本轮重验。检查body无横向溢出不代表窄屏所有列同时可见，表格仍需内部滚动及人工体验。

当前Stitch七页批准和屏幕身份在[设计登记](product-master-v2-stitch-design-review.md)，后续按[UI评审依据](product-master-v2-ui-review.md)保护用户修改；Stitch可选，未操作画布不运行其专项冒称视觉验收。

## 未完成Gate

正式账号/App/server、V2受控图片签名与COS、真实浏览器业务链/键盘/触屏、人工视觉、真MySQL图片/配色复合事务与完整性能仍待验。面料普通字段无完整乐观锁并发验收；产品已开单身份锁依赖真实引用桥；不能把React组件/SSR/模拟Edge或旧App构建当正式上线。
