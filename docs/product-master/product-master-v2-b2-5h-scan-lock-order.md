# B2-5 色卡生命周期、供样、重印与实库验收准备

> 文档定位：中间过程｜主要读者：当前任务的开发/评审、Agent。用途：查实现/计划、历史证据和未完成Gate；不是业务新需求。

2026-10-15提炼，历史实现/QA2026-10-14。读者：色卡/扫码开发、数据库评审、测试与Agent。业务批准见[决定](product-master-v2-b2-5-approved-decisions.md)，最新资料读取见需求v1.50；本记录不是生产迁移授权。

## 已实现的独立切片

| 切片 | 最有价值的实现约束与入口 |
|---|---|
| a/b 退役/重建 | customer-samples/schema.ts、cardLibrary.ts、Routes；deleted_at不可逆退役、仅有效组合/编号唯一的可空生成列；同事务撤令牌，历史FK保留，同组合重建新ID/新码；当前列表/Excel排除退役，旧码永久失效 |
| c 面料重印 | updateFabric与writeFabricImportRow两写路径在同事务调用markCardsForReprintOnFabricChange，印刷字段真实变化标全部有效引用卡；reprint_revision/printed_revision及expectedRevision CAS，旧确认409不能清新提醒；备注/产品新增停用不触发 |
| d 独立供样 | v2_products.is_available_for_sampling默认1并CHECK0/1，products.manage与rowVersion保护；编辑独立开关，12列状态栏提示；扫码同次锁读过滤启用/可供样，恢复重扫补入，不改变订单isSelectable |
| e 只读结构 | verifyB25SampleSchemaContract核对退役生成列/有效唯一、历史FK、旧码撤销、重印CAS；P1核产品供样列及CHECK。fresh CREATE不等于已有库升级，不自动ALTER |
| f/g 实库写测准备 | scripts/test-v2-b25-mysql.ts及b25SandboxGuard.ts：ACK、固定全新空库、不默认选客户库、不允许复用存量库；独立预置FABRIC_V2_B25_EXPECTED_SERVER_UUID，根连接/pool/色卡连接分别核实际库名+UUID；不能把本次读回UUID直接用作预期 |
| h 扫码锁序 | scanRepository.ts不以token/card JOIN FOR UPDATE推断锁序；母版→面料→卡PK FOR UPDATE→token card_id FOR SHARE，逐次重验退役/撤码/身份；零可选409且零空选样写入 |

扫码选中资料已按v1.50改为实时读取，不沿用早期属性快照；来源、首次事件和移除审计仍保留。权限以当前需求为准，不新增运营角色/审批/标签下载。

## 证据与开放门槛

- 独立服务/真实本机HTTP/SQL替身先RED后GREEN；c轮Edge25项/15截图，d轮40项/28截图；这是模拟API交互，不是MySQL写入或手机扫码。
- e轮远端SELECT发现色卡专库不存在、P6隔离产品表缺供样列；f/g脚本可编译且缺ACK/UUID拒绝启动，安全专项分别5/5、10/10。无真实远端写测成功证据。
- h轮SQL锁序与退役/撤销竞态专项46/46；当时全量791项790通过/1跳过。真实优化器锁竞争须两连接InnoDB验证，替身不证明死锁已消除。
- 存量迁移必须保护历史卡/令牌/事件/选样关系，核对原暂停供样清单而非用默认1当运营批准；先设计备份/回滚，再另行授权隔离写测。正式App、既有MySQL迁移、真实并发/FK/回滚、用户UI/手机扫码及部署未验。

回归时先目标专项，最终串行全量→lint→build；不要与执行器临时目录并行争用。

## 原始证据与追溯

本文合并7份同主题记录。原日期、各轮完整测试日志和原文哈希见[分类与合并清单](../maintenance/2026-10-15-文档分类合并清单.json)；原文已逐文件校验并存入仓库外恢复包。本文保留接口/风险/验收结论，当前项目状态只查[进度](product-master-v2-progress.md)，业务只查唯一需求。

## 本轮同主题提炼（2026-10-15）

- 扫码真实登录、sales 角色及显式客户会话授权必须在事务内重验；订单/产品管理权不等于选样授权。已知错误按403/404/409分类，未知故障503且不回显内部异常；旧多母版/属性快照结构不得自动升级。
- 色卡只引用一个母版和一种面料，Article No 保留前导0；随机 qr_payload 与定位摘要同事务持久化，重复有效组合复用原卡原码。admin/sales可管理导出，只有获会话授权的sales可扫码。
- 真实 Edge 曾发现跨页依赖注入绕过色卡引用保护：三库与色卡必须共用带保护的 API。productCount=0不代表无色卡引用；实际下载两份 XLSX 重读品名文本和 QR 原码，不能只测成功提示。
- 深链接白名单函数必须真正接入 React 初始状态；色卡规格经 currentCards 实时读取，停用面料仍允许历史卡读取。卡号/原码稳定，品名/规格可变；只被色卡引用的父记录也禁改号与删除。
- B1客户花型分享与B2业务员实体卡扫码是两个入口；不恢复客户扫色卡、单产品二维码或独立客户合集。重扫只补当前可选产品差集并保留原来源/事件，v1.50不保存选样属性快照。

已转移的旧原文中“多母版、选样属性冻结、仅摘要不能重导出、必须先Stitch、双格式xls”的过时方案不恢复；现行v1.50单母版/稳定原码/实时选样、xlsx和React预览优先。
