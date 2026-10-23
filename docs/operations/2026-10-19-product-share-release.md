# 2026-10-19 花型产品分享正式发布

用户先确认本地UI“通过”，随后明确“可以上线”。本次已按该授权完成生产迁移和发布，唯一当前状态为[产品主数据进度](../product-master/product-master-v2-progress.md)。

## 已上线范围

正式地址 `https://124.223.97.60`。花型库列表移除分享；产品库操作新增“分享花型产品”，只展示当前产品的面料大图、细节图、效果图、成分及原有公开规格，支持查看大图。三类图片各允许0～10张，缺图占位。现有生产产品实际只有面料大图1张，细节/效果均0；没有为凑图而修改生产图片或关联。

新增独立 `product_share_links` 稳定映射，JSON及每次受控display图片读取检查当前产品、配色、母版与面料启停和图片关联。旧母版分享链接兼容。未改客户、单据、产品和图片业务资料，未修改NGINX或清理旧静态资源。

## 版本与保护证据

- 正式源码在 `C:/Users/yangx/.codex/worktrees/product-share-release/fabric`，以4f56b15及已上线题材/建产品增量重建。加入本次分享前，28/28前端文件和原server.cjs与线上逐字节SHA匹配；保留原Legacy前端文件，没有夹带此前被拦截的旧版UI清理。原脏工作区未覆盖、未提交/推送Git。
- 发布包SHA256 `55969033b8fdea2814709abe0762e8d9e2c7ce255e9abd230278f83e9e885448`；包含33个校验文件，暂存 `/opt/fabric-product-share-release-20261019-55969033`。正式安装目录仍 `/opt/fabric-v2-production-20261019-11910f5f`。
- 正式首页SHA256 `665c9cd95c1c7e45cb5d96177a8e920de78ce312f6d34eebf03b9ca45b49c1ad`；后端SHA256 `00742b0f68814f68a96197fd3cd12a45d23712972ee231c2f8a8e4e49c92f9d2`。只重启对应3008的V2进程，旧资源保留；3009只读恢复继续可用，拒绝新分享/新公开路径及业务写入。
- 生产MySQL8.0.46，UUID `a937ff09-72b6-11f1-b04e-52540034488b`，库 `fabric_db`。加法迁移计划SHA `897ccf3ef96427b6269d88258721fc23a545de954149e54a76516e8c5e6badbb` 已执行，重复执行确认alreadyApplied。运行账号未增DDL权。
- 备份 `/var/backups/fabric/product-share-20261019T132529Z/fabric_db.sql.gz`，SHA256 `1db35fb00267ed81f06be64e6929cde920bd7bc8e2f590cbf1d07573388b34e0`；46表恢复到 `fabric_v2_test_productshare_20261019t132529z`，逐表CHECKSUM一致。离机加密包 `D:/fabric-release-backups/product-share-20261019T132529Z/release-backup.tar.gz.enc`，SHA256 `dcee77dc0a4869771ebdf24845c5ae12887c098ba53c4729d6cd771dafe0bf9b`，已实际解密并核SQL摘要、配置/密钥包含，未在本机落明文SQL。密钥分开保管。
- 42张原业务表迁移前后及发布后CHECKSUM保持一致；迁移ledger、认证会话、异步job/upload会话按其独立角色不混入业务值比较。只新增本次映射表、迁移账本及为现有已公开产品签发的产品映射，不新增生产测试产品或客户。

## 实际验证与纠偏

- 发布工作区完整单测1368项：1367通过、1原设计跳过、0失败；lint、build、安全冒烟通过。此前本地1359项只保留其原工作区范围。
- 恢复库13项真实HTTP/MySQL/COS通过：登录/匿名拒绝、伪造字段拒绝、稳定链接/唯一映射、单产品白名单、三类真实display图及成分、非法查询/原始资产ID拒绝、停用隐藏JSON及媒体、重启用同链接恢复、兄弟产品/媒体隔离、真实DELETE级联清理映射、公开页及后端bundle保护。恢复库为补齐分类使用真实ready资产增加2条仅沙箱的图片关联；不复制到生产，最终QA重复运行的added=0不能冒称从未加过夹具。
- 正式公网41项通过，含28个HTML/JS/CSS逐文件内容SHA、HTTPS、mysql/v2健康、真实产品链接页面/单产品JSON/成分、实际面料图读取、缺失细节/效果空数组、匿名401、后端/.env404、只读恢复503、稳定链接复用、原业务值和NGINX摘要保持。
- 独立Windows本机默认TLS另5项通过：新首页精确SHA、健康mysql/v2、匿名401、server/.env404。浏览器工具读取线上标签失败，未绕过目标/证书策略，未把HTTP说成新增生产浏览器视觉验收；用户本地UI签收有效，实体手机/微信未在本轮单列。
- 过程纠偏：演练最初继承SSH环境的生产DB_DATABASE，隔离守卫正确拒绝启动；改用dotenv显式override后恢复库服务正常。首次生产核验错误地要求当前产品三类均有图，发现实际仅一类时自动回退代码，新增映射表保留且未恢复/覆盖数据库；按既有0～10张/缺图规则修正验证后，复核同一已审核迁移的幂等状态并完成发布。不是绕过功能或权限失败，生产未补图、未借用其它产品图。
- 恢复库QA服务已停止，专用QA账号已锁定，恢复库及备份保留。没有启动恢复库图片worker，没有COS上传/删除。

原始脱敏证据：源码工作区 `artifacts/product-share-release/` 的baseline-equivalence.json、unit/lint/build/security.log、artifact.json、windows-check.json；主目录 `tmp/product-share-release-backup.json`、`product-share-offsite-backup.json`、`product-share-publish.json`；远端暂存的real-qa-result.json及release-result.json。凭据/密钥不写文档。

## 回退与历史治理

回退保留新表和已发生的新写入，只恢复备份中的原server.cjs/首页并重启同一V2进程，必要时转3009只读；绝不恢复旧V1 worker或用整库恢复覆盖客户新增数据。执行前必须重新核对线上实际摘要，避免覆盖后续发布。原首页/后端与可恢复备份已保留。

本发布及原B1安全/分享/生产迁移/静态更新证据均**保留**。当前未进行文档归档、删除、移动或旧数据清退。手机/微信专项与新增生产浏览器视觉未测，不作签收；本次用户要求的分享功能已发布且实际HTTP/SQL/COS验收通过。
