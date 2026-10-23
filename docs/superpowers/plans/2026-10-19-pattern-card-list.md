# 花型排序与色卡二维码列表调整

> 按executing-plans单Agent执行，结束统一只读评审。

目标：花型库按created_at DESC、id DESC稳定分页；实体色卡移除二维码专列，在操作中点击查看二维码大图。沿用原权限、筛选、数字配色顺序、二维码payload/导出及原生弹窗关闭焦点。

- [x] server/product-master/patternCatalog.test.ts加入时间/同秒ID/分页排序行为RED，patternCatalog.ts最小修改；不改独立master身份API的其他用途。
- [x] SampleCardLibraryV2.test.ts先验证列表无SVG/二维码专列、操作按钮RED，SampleCardLibraryV2.tsx复用已有420px弹窗；Excel六列保持。
- [x] focused GREEN后串行质量检查，真实候选浏览器验证新增花型第一行、分页/筛选和二维码大图关闭/原payload/手机/导出，并回归实时扫码。
- [x] 更新当前唯一状态、需求、同题复盘/索引，历史保留，无归档/删除；仅已授权隔离候选，不切正式入口。

证据：两项实际RED；相关32/32，完整1318（1317通过/1跳过）、lint/build；真实候选30项含实时相机回归与实际Excel。只读delta复核无确认P1/P2；QA30停用。当前状态V2进度，计划/复盘保留，无归档，实体新增UI/纸打/独立恢复/正式Gate保留。
