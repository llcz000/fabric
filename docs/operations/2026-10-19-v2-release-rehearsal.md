# 2026-10-19 最新包恢复、正式发布演练与执行拦截

本页是过程证据，唯一当前状态见[V2进度](../product-master/product-master-v2-progress.md)。用户已确认候选UI通过并授权继续；本次未完成正式V2迁移或切流，不把恢复库结果当成正式发布。

## 已验证范围

- 安装包SHA256：11910f5f78150786cb24326e11348dd0c20154aa5f656cf18cd442cf8903da21；独立/opt/fabric-v2-combined-recovery-11910f5f7815-checked，3005/3006真实17项：认证查询可用、业务写入/公开分享拒绝、只读提示与9张原/V2表CHECKSUM不变。QA30临时激活已复原，两恢复进程已停。
- 生产身份：MySQL8.0.46 / UUID a937ff09-72b6-11f1-b04e-52540034488b，原正式/opt/fabric、c743742、fabric_db；124单/156明细/1211旧产品。正式18表新备份、恢复行数/CHECKSUM一致，未复制候选账号/客户/映射。
- 首次备份/var/backups/fabric/v2-release-20261019T003440Z/fabric_db.sql.gz，SHA 2f678d09dc8afdf09e4d90508bfea327cf3a2d486566c7b7bac0e75f3e15a21e；恢复库fabric_v2_test_release_20261019t003440z。完整PM2环境/.env与SQL离机AES-GCM包D:/fabric-release-backups/v2-release-20261019T003440Z/production-backup.tar.gz.enc，SHA f64551bca34ccc5d6ce5642b9c6481e012bbaa2a9957491eda1258b1c003731d，解密/SQL摘要及目录内容核验通过，密钥分开保管、不入Git。
- 恢复库最新包3007五项迁移首跑/重复均通过，core e5ed2880、support 2b4f88a1、audit154bf28a、B1 4163ae16、生命周期bce6287b，原字段保持、受限DML运行、初始化独立演练管理员。真实HTTP15+发布13+媒体4+B1分享9+B3选样寄样10，共51项；包括跨owner、撤权、回滚、当前公司三图、XLSX并发、共享COS、公开派生图/停用恢复及真实SQL等待撤权。
- 2000条产品、5类查询各25次：P95为产品53.6、花型40、面料17.3、单据6.05、统计11.37毫秒；仅远端回环HTTP完整JSON+真实MySQL，不包含公网/页面渲染。演练结束后3007 PM2已停，原生产受检指纹保持。

## 正式准备与最终冻结备份

- 独立生产目录/opt/fabric-v2-production-20261019-11910f5f，独立复制依赖、原uploads路径可读；新生产DML用户仅SELECT/INSERT/UPDATE/DELETE，生产V2服务未启动。
- 新B1生产32字节密钥与候选不同，文件600；新管理员凭据仅准备在私有文件，尚未向数据库初始化。运行配置/密钥离机加密包D:/fabric-release-backups/production-v2-secrets-20261019/production-secrets.tar.gz.enc，SHA bd6b1c3ccaf1a708235d2f05370c270b623582ceba989173f174fe05bf106fe4，解密/32字节恢复比对通过。密钥、密码及明文配置不写本文。
- 独立只读评审发现P1：旧worker引用重算不识别V2引用，不能只切NGINX。已先备份原PM2完整环境与NGINX字节，进入503维护，停旧fabric及子进程/worker并移出PM2自动恢复清单，确认3000关闭，才完成最终备份。
- 冻结备份/var/backups/fabric/v2-release-20261019T004211Z/fabric_db.sql.gz，SHA 481f58caf1ce48281c752c2b057aac100c8f38f84825f3dcfb7594e32b7e202c，18表恢复到fabric_v2_test_release_20261019t004211z逐表通过；离机完整包D:/fabric-release-backups/v2-release-20261019T004211Z/production-backup.tar.gz.enc，SHA 77423f08a978f5df2e499d49695767b15dbd91af0f4c3aea53035c320d596909，包含原PM2/NGINX/.env，解密验证通过。

## 自动审批拒绝与安全恢复

生产migrate-first/migrate-repeat/bootstrap/start命令在exec_command创建进程前被自动审批拒绝，仅返回blocked by policy，无更具体原因；该命令未执行，未通过换工具/编码等方式绕过。正式V2表为0、3008未启动，未切流。

为恢复可用性，在确认生产尚无V2结构/引用后，按原PM2完整配置恢复旧应用；首次等待8秒不足以判定旧应用启动，历史错误日志亦不可作为当前失败证据，重新核对当前stdout与真实健康后恢复NGINX原始字节。旧启动自检自动重算3张单的orders.total_pieces，逐列只读比对证实其它列0差异后，按已验证最终备份、3个精确ID及期望值CAS仅还原3格；124单/156明细/1211旧产品不清理，orders/order_items/products/image_assets/company_config/inventory_entries六表CHECKSUM最终与冻结备份一致。此为撤销本次恢复启动副作用，不是继续V2迁移。

恢复后https://124.223.97.60/api/health默认信任链200/mysql（旧应用），本机52987为200/mysql/v2（候选）；NGINX非维护，旧正式fabric在线、演练3007停止，候选3001/3004不变。

## 尚未完成与治理

生产五迁移、初始V2账号/词表、独立端口生产核验、正式只读回退、八类正式证据签收与NGINX切流/公网复验未执行。已有用户部署授权没有撤销，但工具的执行点拒绝未解决；需明确生产迁移/切流确认或人工处理工具限制，不能报告已发布。重启发布时必须重新冻结旧worker并新备份，004211快照不得冒充未来的新冻结点。纸打/未单列手机返回恢复继续未测，不伪造验收。

本计划、交接、备份/恢复证据及同题复盘**保留**，无归档候选/删除/移动/旧库清退；新生产文件与密钥保留，不覆盖稳定备份。
