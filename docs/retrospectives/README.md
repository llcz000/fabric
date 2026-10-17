# 经验检索：遇到什么问题，再看哪篇

> 文档定位：导航｜主要读者：按问题选读的所有人。用途：定位其他文件，不维护另一套正文。

2026-10-15提炼。读者：开发、测试/评审、Agent；业务负责人通常只需看需求与当前进度。以下是触发条件和可复用结论，历史命令/数字不作为当前验证。

| 遇到的问题 / 搜索词 | 最有价值的经验 | 详细证据 |
|---|---|---|
| B1公开H5、真实媒体代理、IP链接、NO ACTION元数据、浏览器无法复制 | 当前启用关系和受权映射逐次复核；默认外键语义按目标MySQL验证，不删表重试；Clipboard同步异常与异步拒绝都须手动复制回退 | [B1真实候选与兼容修复](development/2026-10-14-b1-acp-single-agent-projection.md#2026-10-17-真实候选接线与安全预览收口) |
| 正式接线、WebP输出、旧分匹null、COS CORS、复制/图片删除与部署恢复 | 真库/浏览器发现替身未覆盖的兼容，三方合并最新进度；运行环境、加密备份、每连接身份与生产切流分别签收 | [V2真实候选与生产接线](development/2026-10-17-v2-production-integration.md) |
| SQL替身、分页/唯一、标签或图片计数异常；三库筛选导出 | 先核真实语句与夹具；不为Mock绿改业务约束；数据库并发/FK另验 | [三库与SQL经验](development/2026-10-13-fabric-crud-tests.md) |
| UI保存不完整；取消后数据已变；原图Tab、按需加载与焦点回绕；去掉供样控件保留状态 | 草稿合并一次提交、图片与配色属性同事务；花型级标签独立维护并回读已归档关联；列表裁列不删数据 | [React与一次保存](development/2026-10-13-p4-edge-browser-review.md) |
| Excel覆盖、重复、并发更新、窄屏导入难操作 | 服务端预览快照+一次性令牌，两角色明确逐行确认/行事务，上传前检ZIP防压缩炸弹与危险嵌入，真实文件/浏览器/实库证据分开 | [XLSX导入经验](development/2026-10-13-p5-stitch-density-mobile-scroll.md) |
| 单据能保存，但产品删除或共享图回收出错 | 同一HTTP与数据库状态跑完整生命周期；引用拒绝前零图片DML，扣账后故障全回滚 | [集成状态流](development/2026-10-14-p7-document-product-lifecycle.md) |
| 大盘排名/最近单据缺失，统计越过owner或日期范围 | 汇总、Top5和最近4单复用服务端谓词；归并使用完整品名表达式，固定数据库条数上限；SQL契约与真库分开验收 | [经营统计增量](development/2026-10-16-order-statistics.md) |
| 单据筛选/角色切换跳页、销售分匹、样布预收/定金匹数与结清、半分舍入、隐藏字段被清零、PNG/打印JSON实物与窄屏验收 | 服务端同范围查询；先舍入定金金额再扣减；普通PATCH省略不适用字段；下载须等completed，核实实物字段/像素并限定失败恢复场景 | [V2单据与类型金额](development/2026-10-16-document-query.md) |
| 认证读库与写库不一致、连接漂移、结构检查误放行 | 每次物理连接先核身份；读和写都保护；CHECK执行态/生成列语义要查 | [数据库目标与只读证据](development/2026-10-14-p7-verified-read-pool.md) |
| 旧二维码复活、暂不供样影响订单、重印提醒被误清 | 退役保历史/新建新码，供样独立状态，重印修订号CAS；实库身份/锁序另验 | [色卡生命周期](development/2026-10-14-b2-5h-scan-lock-order.md) |
| 人工补选绕过色卡、跨卡配色、整卡部分成功、缩略图及加入动作重复 | 只收卡及卡内子集，事务复核与整体回滚；展开加载缩略图，单一加入按当前勾选提交；人工来源独立，历史保留 | [B3色卡补选](development/2026-10-15-fabric-v2-efficiency-b3.md#2026-10-17仅基于色卡补选) |
| 用户Stitch字段被覆盖、保存稿却无画布、旧状态混入 | 改前做三方差异，12列备注保护；画布/视觉/批准分开；索引不追加版本全文 | [UI改稿与交付](development/2026-10-12-stitch-user-edit-overwrite.md) |
| 打印/Excel字段不一致、二维码或版式不一致 | 共用语义模型/固定纸张DOM；比较有效类型，不另造导出路径 | [输出模型与固定预览](development/2026-10-09-document-output-source-review.md) |
| MySQL部署失败、HTTP200却不可用 | 目标版本DDL演练、storage=mysql和真实业务API一起看，备份回退分开验 | [部署失败](development/2026-09-26-product-schema-deployment.md) |
| 一期测试全绿但正式产品仍不可交付；权限/COS/迁移/旧单据未接线 | 先核server.ts/App.tsx真实入口，再做生产8项证据与备份/回滚的Go/No-Go，不凭隔离沙箱和mock假称上线 | [一期交付及B1并行验收](development/2026-10-15-phase1-b1-release-review.md)、[一期交付Gate](../product-master/product-master-v2-phase1-delivery-readiness.md) |
| Agent读得多、隔离源码陈旧、重复全量回归 | 可恢复基线+逐文件版本核验、任务短简报、同主题更新原文、最终串行统一验证 | [协作手册](../product-master/product-master-v2-agent-context-handbook.md)、[实际协作证据](../maintenance/2026-10-15-ACP-协作闭环.md) |

其他独有事故、未完成实验和历史证据在[完整分类检索](../文档分类与检索.md#复盘经验)按关键词找；不再为每轮测试数量新开一篇。同主题先更新已有复盘，通用规则维护在[开发与验证规范](../development/开发与验证规范.md)，UI规则在[UI规范](../ui-design/README.md)。
| 审查构建仍有高危依赖、Multer/Sharp升级担心破坏上传和图像 | 先在隔离tmp评估同主版本锁文件补丁并审查跨平台二进制；再对实际新安装版本做multipart超限拒绝与图片转码冒烟，剩余ExcelJS uuid漏洞单独追踪 | [V2生产依赖补丁与兼容验收](development/2026-10-17-http-image-security-patches.md) |
