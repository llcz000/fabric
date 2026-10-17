# B1稳定花型分享链接：只读数据库元数据预检和DBA门禁

日期：2026-10-17。二期B1隔离研发与DBA评审依据；**不是数据库迁移命令、生产批准或真实H5凭据**。业务唯一需求见[需求v1.50](product-master-v2-requirements.md)，真实进度见[当前进度](product-master-v2-progress.md)。

## 本轮离线完成

- server/customer-share/patternLinkSchema.ts 的 getPatternLinkSchemaStatements() **只生成文本**：一张新增 InnoDB 映射表 pattern_share_links，master_id为BIGINT UNSIGNED且唯一；token_hash采用CHAR(64) ASCII/ASCII_BIN区分大小写并且唯一，存储的是SHA-256小写hex而非原始分享密钥/色卡二维码；指向 pattern_masters(id) 的RESTRICT外键。status枚举中包含遗留撤销值只为合同兼容，业务方并未批准手动撤回UI。
- server/customer-share/patternLinkSchemaContract.ts 的 verifyPatternLinkSchemaContract(pool,expectedDatabase,expectedServerUuid) 只接受名字为 fabric_v2_test_* 的隔离沙箱库；在同一物理连接校验 SELECT DATABASE() 与 @@server_uuid 真实身份，继续只通过 INFORMATION_SCHEMA的SELECT校验父子表InnoDB、母版主键、类型/默认值、ASCII_BIN、完整UNIQUE（拒绝前缀）、一条准确的RESTRICT外键与约束位置。异常/无表/弱键/不同目标时失败且归还连接。
- 测试先RED（新模块缺失）后GREEN；11项伪SQL元数据合同测试覆盖错库/错UUID、弱父主键、坏字符集/默认值、前缀/非唯一索引、错误FK、额外CASCADE FK和驱动故障。没有连接数据库、更改表或写业务数据；测试成功只表示**预检代码合同可信**，不是当前生产结构通过。

## 必须经独立审批的真实步骤（本次未执行）

1. DBA明确批准独立 fabric_v2_test_* 测试库和正确MySQL8 UUID，核对现有 pattern_masters 版本/主键，提供可恢复数据库备份和回滚方案。待表DDL及相关键/字符集经评审签字，再由经授权操作者而非该脚本部署。
2. 数据库建表后，由经授权测试人员在可信只读账号及同一个受限连接上调用上面的metadata preflight，提供预期库名及物理server_uuid。不允许用公开URL、客户数据、弱权限账号或生产库替代沙箱。一次成功的预检不保证未来不同连接永远指向同一服务器；业务运行时仍须身份与权限门禁。
3. 真实签发必须另行取得不可丢失的32字节长期密钥、轮换/恢复机制、严格受控的HTTPS公网入口和事务权限；公开读取还必须独立核验实时发布审批、手机/微信H5、逐图片受控预览与内容白名单。旧连接停用显示“暂不可用”、重新启用恢复同一URL，**不增加手动撤回界面**。

**明确未完成**：本轮没有真实数据库DDL或元数据取样、备份/恢复或安全扫描授权，没有真正MySQL和COS联调，也没有公网页面。二期B1未完成，生产发布No-Go。知识生命周期：此表结构预检资料与[已存在的B1复盘](../retrospectives/development/2026-10-15-phase1-b1-release-review.md)均为**保留**，不清理/归档历史文件。
