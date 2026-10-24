# UI评审与原型交付：当前依据及历史边界

> 文档定位：中间过程｜主要读者：当前任务的开发/评审、Agent。用途：查实现/计划、历史证据和未完成Gate；不是业务新需求。

2026-10-15提炼。读者：业务/UI验收负责人、前端开发、Agent。类别：过程记录。用于定位批准稿与原型证据；业务规则只以[唯一需求](product-master-v2-requirements.md)为准。

## 现在从哪里看

| 要审什么 | 入口与必须保留的边界 |
|---|---|
| 一期七页批准与屏幕身份 | [Stitch登记](product-master-v2-stitch-design-review.md)、artifacts/product-master-ui/stitch/current/review-delivery.json；花型/配色、面料、产品列表/维护、导入和共用选品。产品12列及备注保护、货号/品名独立AND；旧11列与颜色身份字段不恢复 |
| 当前React三库及维护 | [P4浏览器](README.md)、[产品编辑](README.md)、[配色同次保存](README.md)，独立评审入口product-master-v2-review.html；内存API不是真实业务保存 |
| 面料导入 | [P5专题](README.md)；只xlsx、七列模板/八列行号预览、默认跳过/管理员明确更新，窄屏内部横滚 |
| 三单据共用选品 | [P6选择器](product-master-v2-p6-document-write-read.md)、[单据工作区](product-master-v2-p6-document-write-read.md)；库内选品/管理员手工、四级启用与历史行冻结分开验，UI通过不证明真实保存打印 |
| 二期实体色卡 | [色卡记录](product-master-v2-b2-5h-scan-lock-order.md)、[生命周期专题](product-master-v2-b2-5h-scan-lock-order.md)；v1.48色卡稿获确认，单母版＋面料、六列文本xlsx、QR同源；不恢复标签下载/多母版/客户扫卡 |
| B3选样明细 | [交互评审](product-master-v2-b3-history-ui-review.md)、[10月15日实现](product-master-v2-b3-history-ui-review.md)；资料实时刷新与移除/重扫审计按v1.50，不拿旧首次属性快照稿作当前规则 |

## 从历史中保留什么

- 数字配色、永久锁号、七页UI及仅xlsx的批准以当前需求为准，不再在十份评审文档分别复制“待审/未实现”状态。
- 产品三类图草稿同次保存、面料九列行内维护、花型矩阵默认可见、单据共用窗口、导入差异与权限，是当前需求/组件记录中的具体验收点。
- 原型/DOM示例检查、Stitch保存截图、真实画布、Edge模拟API、真实后端和业务签收是不同证据。缺失历史附件已注明，不能拿当前同名截图补验过去。
- 历史旧项目/替代稿清理只发生在当时明确授权和核验范围，保留用户修改及唯一当前稿；本轮没有修改/删除任何远程设计资产。
- v1.49聊天单文件打包只是当时固定快照，当前评审优先现有项目入口；不能用旧包替代最新源码或真实账号/数据库。

## 当前采用的设计方式

按[UI规范](../ui-design/README.md)复用现有React并交付交互预览。Stitch可选；实际操作它时才执行[远程改稿与画布流程](product-master-v2-ui-iteration-workflow.md)。新增视觉接受、代码接线、真库及部署分别登记，不因历史稿批准扩大授权。

## 证据追溯

原始10篇的日期、详细命令/测试数字及哈希在[合并清单](../maintenance/2026-10-15-文档分类合并清单.json)定位；原文经备份校验后退出日常目录。下列经验只在注明场景内适用，不能扩大为生产或实库已验收。
