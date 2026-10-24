# 完整 V2 候选：发布顺序与未签收事项

> 2026-10-24 目录整理：本文部分历史路径对应的临时文件、已退役源码副本或旧发布证据已完整迁至仓库外；原路径作为历史定位保留，按[归档恢复索引](../maintenance/2026-10-24-workspace-archives.json)中的范围和逐文件 SHA256 查找原件。未完成的业务 Gate 仍按当前进度保留。

2026-10-19最终发布更新：正式HTTPS已切V2，五迁移/18表原列保护/新冻结及离机恢复/正式69项/公网44项/独立外网8项通过；旧worker已停止，3009同版本只读恢复可用。release_review八类证据签收，当前11910f5包与用户UI签收版本一致，原历史不清退。详见[正式发布证据](2026-10-19-v2-production-release.md)和[唯一进度](../product-master/product-master-v2-progress.md)。下文早期未切流/拦截段仅为历史时点。

2026-10-19执行更新：最新包恢复、新备份与恢复库51项业务/2000产品性能已通过。正式迁移被自动审批在执行前拒绝，仅blocked by policy；已恢复原正式站和原表数据，未执行V2迁移/切流。继续前须解决执行点限制并重新冻结旧worker/新备份；不能用已恢复旧应用后的004211快照作为下一次冻结备份。详见[实际执行证据](2026-10-19-v2-release-rehearsal.md)和[唯一进度](../product-master/product-master-v2-progress.md)。

2026-10-19：用户已明确“UI检查通过”，当前包11910f5f78150786cb24326e11348dd0c20154aa5f656cf18cd442cf8903da21，近期实现与未完成正式Gate以[唯一进度最新结论](../product-master/product-master-v2-progress.md)为准。下文旧包/人工待签/拍照方案保留历史时点，不代表当前待重做。最新包恢复仍须补跑；沿用既有部署授权，尚未执行生产迁移/切流。手机实时扫码已由用户确认，拍照/相册已下架；库存/导航改版等不自行扩入本次。

2026-10-18九项反馈候选更新：最新包4a7d9c61f531ad0aa0d5594da36299032550993e32119d124c2036f0ca57d35c，3004/52987；真实Edge/MySQL/COS25项＋状态草稿2项、单元1264项（1263通过/1跳过）、完整lint/build通过。旧75b2a16/3aa22d7包的恢复证明保留其时点，不能继承到本包；当前人工UI待复核，生产不切流。生产新词表须在已授权迁移/启动后，使用当前V2身份令牌和明确目标来源显式运行scripts/initialize-v2-default-tags.mjs（FABRIC_V2_SEED_URL/FABRIC_V2_SEED_TOKEN仅置私有运行环境，不写文档/命令日志）；不在启动自动DML，幂等保留自定义/归档。详见[当前进度](../product-master/product-master-v2-progress.md)。

2026-10-18用户单据UI验收未通过，已在同一PR6针对性修复，最新候选归档75b2a16a654b40d6c9e51386a05c566a07a19e531a35ea3ea8b05e6f43dfa9e4，3004/52987。下文3aa22d7安装包/17项恢复为先前检查点，不能称最新UI包恢复证据；最新单据22项真实浏览器/PNG/Excel、1257项单测及完整lint/build见[当前进度](../product-master/product-master-v2-progress.md)。等待重新实际复核，未正式切流。

此文件是最终执行交接，不增加业务范围或再次申请部署许可。用户已授权完成剩余内容及部署；人工 UI 签收来自仓库 AGENTS.md 与一期交付门槛，不能由 Agent 或自动测试代签。

## 当前审查对象

- 完整候选：[PR #6](https://github.com/llcz000/fabric/pull/6)，基于 master，业务源码检查点 baa54e9；含一期与 B1/B2/B3，不要求重复实施原有列表或查询页。[PR #5](https://github.com/llcz000/fabric/pull/5) 保留为一期检查点，不是另一个待开发方案。
- 浏览器：http://127.0.0.1:52987/；实际服务器 /opt/fabric-b3-candidate-20261017 / 3004；独立恢复库 fabric_v2_test_b3_20261017。私有登录资料仅存本机 .local/server/v2-deployment-20261017/initial-admin.local.json。
- 最新不可变安装包 SHA256 3aa22d7de1a78872b60f68197868e565da022b21a7108356a7f15fd37b0abdf6，服务器 release-3aa22d7de1a78872.tar.gz，已含手机拍照/选图本地二维码识别。不可把候选数据库、测试账号/客户资料、分享映射或候选密钥复制成生产数据。
- 正式 https://124.223.97.60 仍指向原应用3000，生产库 fabric_db / UUID a937ff09-72b6-11f1-b04e-52540034488b。HTTPS证书、80→443、ACME与续期演练已验，V2生产加法迁移/切流未执行。

## 最新恢复演练

从上述完整安装包校验摘要后解包至独立 /opt/fabric-v2-combined-recovery-3aa22d7de1a7-checked；独立3005后端与3006只读代理实际启动，通过17项：真实登录及三库/单据/选样查询可用；分享签发、新建选样、寄样、删单、公司保存、上传及旧API写入均503拒绝；匿名私有查询401；页面显示只读提示；公开分享在应急恢复时503停止展示。九张实际存在的原/V2业务表均取得有效数值CHECKSUM，前后一致，进程已停止。报告 tmp/v2-combined-artifact-recovery.json。早期32f1966包及其演练保留，仅作为拍照入口前的检查点。

此演练补足早期一期包不含B1/B3新UI的证据缺口。它使用候选恢复库，不是生产回滚操作；应急时保留所有V2数据并前滚修复，禁止重新开放不了解owner/快照的旧可写接口。

## 人工签收后沿用既有授权执行

1. 记录人工三库/编辑、色卡选样、单据及开单设置结果；真实手机或扫码枪、纸质输出的未测项独立注明，不能以自动Edge替代。签收状态只更新唯一V2进度及对应证据，不给历史记录批量刷绿。
2. 再读远端HEAD/运行进程、库名/UUID、旧表行数及引用；冻结短暂写入窗口后新做一致性备份，核对SHA，仓库外加密备份及恢复可读。旧备份/原PM2完整环境继续保留，不能仅备份.env。
3. 建立独立生产release目录、受限DML用户、强管理员初始凭据；长期B1密钥使用新的32字节安全随机文件，目录700/文件600，先完成单独加密备份解密校验。固定HTTPS来源，不从请求Host生成公开地址；不复用候选密钥/映射。
4. 由独立operator命令打包并运行 scripts/migrate-v2-production.ts：确认值 APPLY_ADDITIVE_V2，B1额外 APPLY_B1_SHARE，明确备份绝对路径和实际SHA。四个计划为 core e5ed28807642abf5fc7a41bb1288b026bcd2e3fbb401811d737181fcac5d597c / support 2b4f88a1b7bec6449f97870daedfd188791fd5f0bae16c10e2c38efda8957a11 / audit 154bf28a274d1f1adf1f74337d3f96561696c2241b1c91b010f9778d3f58def5 / B1 4163ae1640990dac5f9b2d9c0e1f902b84ba3891b61b54d09e38c743f82d92ee。仅加法、显式锁及账本；二次执行核验幂等，旧原列/原行/归属不猜测回填。启动不执行DDL。
5. 生产新后端先只监听独立回环端口；专属wrapper用dotenv override:true，避免SSH继承的旧DB_DATABASE污染。逐连接身份/表结构/健康mysql-v2、真实登录/跨owner、旧API拒绝、当前公司三图、真实xlsx/三单据/色卡/寄样/H5只读验证通过后再原子切换nginx，并保留旧配置及已验证的V2只读恢复入口。
6. 公网验证默认信任链的HTTPS、HTTP跳转/ACME、真实浏览器与P95、私有原图权限、公开仅派生图、停用/恢复。生产测试不得引入候选夹具或改写既有订单。确认稳定后精确移除已不需要的COS临时来源；禁止清空全部规则、回收旧对象或清退旧库。

正式步骤仍需实际执行与证据，本文不宣称已发布。生产schema、恢复、身份/COS、七页UI、xlsx、三单据和最终E2E八份外部签收继续分别登记；只读预检本身恒不授权上线。

## 范围与文档治理

STOCK-01～03未排期，不夹带库存算法整改。手机拍照/选图的本地解码、显式提交与重复去重已通过真实QR图片和Edge；真实手机原生拍照/微信兼容与纸质输出继续待设备签收。需求未批准的CRM、图册/以图搜图、单产品扫码页/客户合集不纳入本包。当前唯一状态为 [V2进度](../product-master/product-master-v2-progress.md)；本交接、B1/B2/B3计划/真实证据/同题复盘、一期恢复资料均**保留**，无归档候选、无删除移动或媒体清理。

## 2026-10-18 选样保历史删除的独立迁移

候选3004使用独立ledger `20261018-sample-session-lifecycle`，planSHA `bce6287bdd56896399dd2b4bad5814b321c4201e9c4ed9c80ed366b87d40696e`；仅新增sessions.deleted_at/deleted_by_user_id及配对CHECK/FK，已冻结核心迁移哈希不变。正式执行仍须新完整备份、SHA、目标数据库/UUID复核及已有迁移授权边界；迁移脚本显式 `FABRIC_V2_MIGRATE_SESSION_LIFECYCLE=APPLY_SAMPLE_LIFECYCLE`，启动只读校验结构且检查真实CHECK表达式，不做启动DDL。候选备份 `/var/backups/fabric/v2-selection-20261018T030814Z/candidate-before.sql.gz` SHA `432f88d7ac72cb866ff65ab310b9ed3471d88f7d0a9ab2ec9d02d4c399f8a387`，首跑/重复跑、原会话字段及受检历史表CHECKSUM通过。该备份是候选恢复材料，不能代替正式生产新备份。

本轮功能与三类单据字段纠偏证据见唯一V2进度；仅刷新隔离候选，正式3000和一期3001未切换。人工UI、手机及纸打Gate仍需真实签收；本交接与计划/复盘保留，不清退旧库、历史或图片对象。
