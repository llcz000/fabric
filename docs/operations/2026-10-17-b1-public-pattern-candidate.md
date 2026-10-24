# B1 稳定花型分享与公开 H5：真实候选验收

> 2026-10-24 目录整理：本文部分历史路径对应的临时文件、已退役源码副本或旧发布证据已完整迁至仓库外；原路径作为历史定位保留，按[归档恢复索引](../maintenance/2026-10-24-workspace-archives.json)中的范围和逐文件 SHA256 查找原件。未完成的业务 Gate 仍按当前进度保留。

用户已授权继续完成剩余功能及部署。业务依据为需求 v1.50 / V2-12；本记录是独立候选技术证据，不代签人工 UI 或正式发布。基线为 B3 工作台 3398bee，当前分支 codex/v2-phase2-completion-20261017，包含一期受控 server/App 接线。

## 实现与安全边界

- admin/sales 登录后从花型列表“分享”取得稳定 HTTPS IP 链接；首次受权签发的 active 映射构成服务端公开发布边界。随机 token、未签发花型及客户端伪造 flags 不获得公开权限；不增加手动撤回/审核按钮。
- `/p/:token` 免登录，只请求独立公开白名单接口。当前启用的花型、配色、产品与面料逐层核验；停母版或无启用配色显示暂不可用，重新启用保留原链接。
- 四类图片只暴露按当前关系 HMAC 限定的同源 display 预览引用；服务端取私有 COS 派生图后再复核当前关系。无原图、资产 ID、存储路径、COS 签名 URL、价格、客户或选样数据；公开路径无内部 bearer，也不能访问内部 API。原有全局 Google Fonts 请求保留，未把字体请求误判为 COS 泄漏。
- 运行默认关闭；必须显式配置 HTTPS canonical origin、独立 32 字节密钥与合格映射表。启动只读核验数据库/实例身份和真实结构，不自动建表。

## 真实环境与恢复

仅使用 `/opt/fabric-b3-candidate-20261017`、回环 3004、独立恢复库 `fabric_v2_test_b3_20261017`，MySQL 8.0.46 / UUID a937ff09-72b6-11f1-b04e-52540034488b。不改变正式 3000 / fabric_db 或一期 3001。

独立 B1 加法迁移计划 SHA256：4163ae1640990dac5f9b2d9c0e1f902b84ba3891b61b54d09e38c743f82d92ee。保持一期 core/support/audit 三个计划哈希不变。先一致性备份再实际迁移；重复执行 alreadyApplied=true。最新备份 `/var/backups/fabric/b1-rehearsal-20261017T155420Z/b3-before-b1.sql.gz`，SHA256 165e0eef8a0c5f3710829253ade67bfd43318939849210b381a219c6f454e740。首次元数据核验发现默认 UPDATE_RULE=NO ACTION，按 InnoDB 等价语义修复检查器后沿用原表/原账本完成，未删表、改约束或手工抹除迁移状态；DELETE 仍要求 RESTRICT，CASCADE 仍拒绝。依据：[MySQL 官方外键说明](https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html)。

候选密钥为服务器独立受限文件 `/etc/fabric-secrets/fabric-b1-candidate-20261017.key`，目录 700 / 文件 600；不入环境明文或 Git。Windows 仓库外 AES-GCM 备份 `D:/fabric-release-backups/b1-candidate-20261017/pattern-share-v1.key.enc`，密文 SHA256 22086e46b35c2b5f0ad72d9d104db0bb721c97d9424c72ec2f266368e096af7b；解密比对通过，备份密钥分开保管并限制 NTFS。正式发布须创建不同生产密钥、独立备份，禁止复制候选映射/夹具入生产。

## 验收与审查

- 真实 HTTP/MySQL/COS 9 项通过：8 并发签发只创建一个稳定映射；匿名白名单、四角色实际派生图字节；随机 token、任意资产/原图参数、内部 API 拒绝；产品/配色/花型停用与恢复；旧 orders/order_items/products CHECKSUM 不变。
- 真实 Windows Edge 10 项 / 4 截图通过：分享、稳定链接、同源预览、无登录 H5、规格单位、四类图、空配色、390px、公开请求边界及无效链接。独立审查仅发现一项 P2：Clipboard API 缺失时同步抛错；真实浏览器 RED 后修复为选中链接并提示手动复制，单元覆盖缺失/同步异常/拒绝/成功，浏览器 GREEN。未发现已确认 P0/P1；审查为静态只读，不冒充运行验收。
- 最终统一单测 1248 项：1247 通过 / 1 设计跳过 / 0 失败；完整 lint、build、安全冒烟、图片冒烟通过。最新集成候选再次跑 B3 浏览器 13 项通过，保持跨页批次、草稿和撤权行为。
- 候选归档 SHA256：32f1966a04b980d548bd46ecca7c4954931be489e5276be7bd9941ad4d90d958。报告在主工作区 `tmp/b1-*.log`、`tmp/b1-run-real-qa.json`，业务截图留在独立工作树 artifacts/product-master-ui/qa/b1-public-pattern，不提交 Git。

## 当前可验收结果与开放 Gate

最新完整安装包已独立恢复并通过17项实际只读恢复检查，包含B1签发/B3写入拒绝与九张实际表CHECKSUM；最终执行顺序、完整PR与未签收事项见[整合发布交接](2026-10-17-v2-combined-release-handoff.md)。

[完整可操作候选](http://127.0.0.1:52987/) 包含三库、色卡、选样/寄样/跟进、单据、设置和分享；使用本机私有管理员凭据。分享弹窗的“查看花型”可直接在候选查看公开 H5。正式 HTTPS IP 仍代理旧应用，不能把候选生成的 canonical URL 当正式 H5 已发布。

剩余：用户七页人工 UI 签收、真实手机/扫码枪与纸质输出验收、正式新备份/密钥/加法迁移/原子切流及切换后复测。已有部署授权；不再次申请同一授权。独立一期预检源码两项通过，八项外部签收仍 pending，readyForReview=false / releaseAuthorized=false；不填造证明。本任务验收范围/证据如上，唯一当前状态为 [V2 进度](../product-master/product-master-v2-progress.md)，对应计划/本证据/同题复盘均 **保留**，无文档归档、删除、媒体清理或旧数据退出。
