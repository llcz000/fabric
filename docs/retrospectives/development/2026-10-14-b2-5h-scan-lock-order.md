# 2026-10-14：色卡生命周期、供样与实库安全复盘

> 文档定位：复盘经验｜主要读者：开发、测试/评审、Agent。用途：遇到同类问题时读根因、做法和验证范围。

范围：B2-5a～h。合并原七篇零散复盘；逐切片代码、命令和当时测试结果保存在[色卡交付记录](../../product-master/README.md#色卡与选样)。这些是历史本机/只读证据，真实迁移、并发写测与正式上线仍开放。v1.50选样资料读取规则以[当前需求](../../product-master/product-master-v2-requirements.md)为准，不沿用早期属性快照结论。

## 退役与永久废旧码

原来全记录唯一的母版/面料组合和card_no会阻止同组合重建；简单停用也不能表示永久废码。采用deleted_at业务退役、仅约束有效记录的可空生成列、同事务撤令牌，保留历史外键；重建使用新ID与新码。扫码排除退役卡，部分配色停用只过滤本次候选，零款409且不写空选样。服务缺导出和HTTP 404先RED，补服务/鉴权DELETE后GREEN。

证据：[B2-5a/b](../../product-master/product-master-v2-b2-5h-scan-lock-order.md)。物理结构、历史FK和并发重建仍须目标MySQL验证，不能据DDL字符串判断已上线。

## 面料更新与重印确认

实体卡可共用面料；仅在前端提示或只在色卡编辑页标记会漏掉普通面料编辑和XLSX更新。两条写路径同事务调用markCardsForReprintOnFabricChange，对实际变化的印刷字段标记全部未退役引用卡；备注、产品新增/停用不触发。运营确认使用expectedRevision CAS，旧修订409，防止误清刚发生的新变化。失败须整笔回滚，不新增运营角色、审批或标签下载。

证据：[B2-5c](../../product-master/product-master-v2-b2-5h-scan-lock-order.md)。先以缺模块RED，再完成服务、事务及React测试；真实Edge记录25项/15张截图，不能由组件测试替代。

## 独立供样状态

停用与暂不供样分开；is_available_for_sampling默认1，沿用products.manage和rowVersion，扫码在同一次锁定读过滤，不影响订单isSelectable。产品列表沿用12列，在启用栏提示，编辑另设开关。两处跨模块HTTP夹具缺字段造成失败，修正夹具后专项27/27；当时Edge闭环40项/28张截图通过。

证据：[B2-5d](../../product-master/product-master-v2-b2-5h-scan-lock-order.md)。存量迁移前需核对已有暂停供样清单，不能把默认1当作人工供样确认。

## 结构与服务器身份

fresh CREATE定义不能证明现存表已经升级。B2-5e补只读schema contract，核对退役/活动唯一约束、历史FK、重印列和产品供样字段/CHECK；专项13/13。当时远端仅SELECT，色卡专库不存在、P6隔离库缺供样列；不自动ALTER。

B2-5f的一次性隔离写测需显式ACK、固定全新空库、禁止默认客户库和重用存量库；guard 5/5。B2-5g再加独立预置的FABRIC_V2_B25_EXPECTED_SERVER_UUID，根连接、pool和色卡连接同时校验实际库名/UUID；新旧guard 10/10，ACK但缺UUID启动被拒绝。不能自动把实际连接读到的UUID当预期值。

证据：[结构](../../product-master/product-master-v2-b2-5h-scan-lock-order.md)、[测试程序](../../product-master/product-master-v2-b2-5h-scan-lock-order.md)、[UUID](../../product-master/product-master-v2-b2-5h-scan-lock-order.md)。三轮当时全量分别779/784/789项，各1项默认远端跳过、0失败，lint/build通过；均未执行远端写测。

## 跨表锁序与验证顺序

token/card JOIN FOR UPDATE的实际锁序可能随优化器变化，与退役事务的卡→令牌顺序冲突。改为母版→面料→卡PK单表FOR UPDATE→令牌card_id单表FOR SHARE，逐步重查退役、撤码和身份；竞态状态必须零业务写入。SQL锁序先RED后GREEN；两处HTTP旧查询夹具404修正后，专项46/46，全量791项790通过/1跳过，lint/build通过。

证据：[B2-5h](../../product-master/product-master-v2-b2-5h-scan-lock-order.md)。当时并行运行测试和lint曾争用临时编译目录，之后等待测试结束再串行lint。SQL推断不能证明真实InnoDB锁竞争已经验收。

## 剩余与回流

真实MySQL迁移/两连接并发/FK/回滚、正式App接线、真实账号与手机扫码、用户视觉确认仍需各自证据和授权。测试、lint、build按顺序执行；本机、只读、实库和部署分别登记。通用要求回流[开发与验证规范](../../development/开发与验证规范.md)，不继续为每轮重复测试数量另建复盘。

## 本轮同主题提炼（2026-10-15）

- 库名字符串参数不等于实际连接目标；核库与 DDL 必须在同一物理连接，错误也要释放连接。二维码不是授权凭证，远端安全拦截不能用私有口令脚本绕过；旧选样快照经验已被v1.50实时规则替代。
- 建卡与扫码共用对象必须统一母版→面料→卡→令牌锁序；先无锁定位再加锁重读核身份，不能从 JOIN FOR UPDATE 推断真实加锁顺序。页面二维码与 Excel QRcode 直接共用持久原文。
- 组件与模拟 API 单测全绿仍可能漏掉入口依赖注入；必须从真实入口跨页面建卡、改号、更新规格、导出。测试下载副本只在本次专有临时目录处理，不假定浏览器自动重命名。
- 资料实时刷新与身份永久稳定是两件事；列表、重复创建及导出共用 currentCards，停用不抹掉历史卡，父引用不能只数产品。不要为回归恢复废弃的标签下载或单品码功能。

已转移的旧原文中“多母版、选样属性冻结、仅摘要不能重导出、必须先Stitch、双格式xls”的过时方案不恢复；现行v1.50单母版/稳定原码/实时选样、xlsx和React预览优先。
