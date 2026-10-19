# 定金单品名与收货地址

按writing-plans记录，executing-plans单Agent实现；结束统一独立只读评审。

- [x] DocumentItemsTable.test.ts先验证定金库内品名仅品名且草稿规格仍在RED；DocumentItemsTable.tsx只限制库内定金的规格副文案，样布/销售及管理员手工能力保持。
- [x] V2DocumentPrintView.tsx固定保留定金地址空白栏，已填用原receiverAddress；server/documentExcel.ts按同份模型增加定金地址整行并计入打印区域，PNG由预览原DOM生成。先用真实候选未填地址不显示复现RED，src/lib/documentPrintModel.test.ts验证Excel地址空/非空RED。
- [x] 相关GREEN、统一串行质量检查，候选三类型真实选择/保存回读/预览/PNG/XLSX验证；不得丢库内规格或改财务字段，联系信息仍默认收起。
- [x] 更新唯一需求/进度/项目摘要/同题复盘/索引，外部SHA备份后同步根文档；原记录保留、无归档，无正式切流。

证据：两项单测RED及实际旧候选预览RED；审查多行地址P2另RED→修复/复核。相关27/27，最终1321（1320通过/1跳过）、lint/build；真实候选三单据30项，实际PNG/XLSX；QA30停用。唯一状态V2进度，计划和复盘保留，无归档，人工/纸打/当前包恢复/正式Gate开放。
