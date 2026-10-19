# 2026-10-19 V2 正式迁移与切流证据

本文记录本次实际发布证据，唯一当前状态仍是[V2进度](../product-master/product-master-v2-progress.md)。**当前结果：正式HTTPS入口已切换V2，八类证据由release_review分阶段签收。** 用户已验收当前候选UI并授权部署；工具拒绝的迁移没有经工具重试，用户在服务器终端手动运行保护脚本并返回MIGRATION_READY。下文“尚待/等待”段保留其阶段时点，最终结果以末节签收为准。

## 本轮新备份与生产迁移

- 唯一安装包SHA256：`11910f5f78150786cb24326e11348dd0c20154aa5f656cf18cd442cf8903da21`，正式目录`/opt/fabric-v2-production-20261019-11910f5f`。正式DB为`fabric_db`，MySQL8.0.46，UUID`a937ff09-72b6-11f1-b04e-52540034488b`。
- 最终停止旧PM2 fabric及子进程/后台worker、移出PM2恢复清单，3000关闭，公网503维护。旧worker在V2运行期间禁止恢复，避免漏算V2图片引用。
- 本次冻结备份`/var/backups/fabric/v2-release-20261019T020554Z/fabric_db.sql.gz`，SHA256`1d3dc42614b51f1f68e992528f602b2ad524aa2f161e772e42301735793e1d76`；18表恢复到`fabric_v2_test_release_20261019t020554z`，行数和CHECKSUM逐表一致，源未变化。
- 离机AES-GCM包`D:/fabric-release-backups/v2-release-20261019T020554Z/production-backup.tar.gz.enc`，SHA256`6bf30d0e21ee574f75e024882d675e27bc11d82a21f5b97b04d3fbe982a63dde`，实际解密、SQL摘要、完整PM2/.env内容验证通过，密钥分开保管；本机未写明文SQL。旧004211备份仅为历史记录。
- 生产新B1密钥32字节、0600、不同于候选；独立加密恢复证明见[当日演练](2026-10-19-v2-release-rehearsal.md)。新运行用户仅SELECT/INSERT/UPDATE/DELETE，无DDL权限，uploads仍指向原路径。
- 人工保护脚本SHA256`f6ae13c69f2b5b99eaea7062b81238daef8ce1d57b0764081e539a3d139d02ba`：检查600秒新冻结清单、备份/操作器摘要、目标UUID、旧进程消失及维护配置后，用户手动执行五迁移、重复迁移及初始admin，再启动私有3008，未自动切流。
- 实际五迁移首跑alreadyApplied=false，重复均true：core e5ed28807642abf5fc7a41bb1288b026bcd2e3fbb401811d737181fcac5d597c；support 2b4f88a1b7bec6449f97870daedfd188791fd5f0bae16c10e2c38efda8957a11；audit154bf28a274d1f1adf1f74337d3f96561696c2241b1c91b010f9778d3f58def5；B1 4163ae1640990dac5f9b2d9c0e1f902b84ba3891b61b54d09e38c743f82d92ee；lifecycle bce6287bdd56896399dd2b4bad5814b321c4201e9c4ed9c80ed366b87d40696e。
- 迁移后18张原表的**所有原有列按主键排序导出字节逐值比对一致**；124张orders、156条order_items、1211条旧products保留，不猜测归属或自动映射到新三库。order_items/orders/company_config只增加列；因表结构改变，整表CHECKSUM不能跨结构作为原值比较，初次此检查拒绝后改为逐原列比对，未执行修复DML。

## 生产私有端口核验与只读恢复

- 正式3008 MySQL/V2健康。真实admin登录、身份及10类业务查询可用；未登录401，旧products/orders/login接口410；专用sales验证账号不能管理成员（GET/POST403），可读产品且看不到无归属旧单据；停用后已有token立即401；admin登出后token401。
- 26条需求默认词表通过正式认证API显式初始化：11题材、15颜色。唯一新增验证账号id2已停用、无业务数据；不复制候选账号、客户、产品、图片映射或2000条性能夹具。
- 同安装包的`dist/recovery.cjs`以PM2 `fabric-v2-production-readonly-20261019`运行于127.0.0.1:3009，上游正式3008。登录认证读取仍可用，未登录401，业务POST/DELETE503，公开分享503，HTML包含只读恢复提示。异常可切到该V2只读入口，不启动旧应用，不覆盖V2新写入。
- 本次生产69个HTTP断言通过；其中包含词表初始化及权限/只读检查，不能把69解释为全部功能正式验收。真实生产数据量下3类查询各15次，完整HTTP JSON回环P95分别7.74/9.83/10.90ms；不含WAN/浏览器渲染，也未向生产插入2000产品。
- 本轮原始证据仅含脱敏值：远端release内`manual-migration-result.json`、`post-manual-verification.json`、`production-smoke-evidence.json`、`human-freeze-offsite-evidence.json`；本机对应`D:/fabric/tmp/v2-post-manual-check.json`、`v2-production-smoke.json`等。密码/令牌/密钥不登记。

## 八类Gate的真实范围

1. P1 schema/历史：上述正式五迁移、重复、实例身份及18表原列全值对照。受限账号启动和真实读取通过。
2. P1备份/恢复：新冻结备份18表实际恢复、离机解密、独立生产密钥恢复、同版本生产只读入口。旧worker不得回切。
3. P2：生产admin/sales/停用/登出/旧API拒绝通过；跨owner/SQL并发撤权等深测在[新恢复库51项](2026-10-19-v2-release-rehearsal.md)完成，无生产业务夹具。
4. P3：当前包真实恢复库三库/COS上传签名及共享引用验证见同日51项证据；生产配置同源、正式库读取及初始化词表通过。正式库三库起始为空，不把恢复库数据说成生产数据。
5. P4：用户2026-10-19明确“UI检查通过”并允许继续；对应11910包的候选七页/三单据既有浏览器证据保留。本轮无新增浏览器自动视觉验收，不以HTTP替代视觉检查。
6. P5：真实恢复MySQL的xlsx预览/新增/更新确认/冲突/失败回滚在当前包51项演练通过；生产未导入测试文件。
7. P6：当前包恢复库三单据保存/回读/XLSX/当前公司媒体，以及已签收定金品名/地址和样布/发货布局；生产18原表全部原列值保持。未替用户填写历史归属，不造历史快照。实体纸打未单列实测。
8. P7：当前包新恢复库51项、2000产品五查询各25次P95均<1s，独立恢复17项；正式69项/生产读延迟、3009只读恢复完成。公网切流、HTTPS/ACME与外网回读在切流后另记，尚未伪填。

## 尚待切流与治理

截至本段记录，公网仍为503维护。先由独立release_review审查上述实际范围和已存演练，登记摘要绑定的证据后运行只读交付Gate，再切NGINX到3008，核验公网健康、认证业务与相机/ACME。证据预检不是部署许可，许可来自用户此前明确授权。

实体纸打、未单列手机返回实测保持未测；不以此代签或另行扩展需求。导航方案仅讨论，库存自动扣减等按原排除项处理。本过程/计划/备份/同题复盘**保留**；不删除/归档/清退旧库，不复制候选夹具。唯一当前状态仍是V2进度。

## 切流前独立审核

审核人`release_review`只读审阅本页、原始正式核验JSON、同日恢复库演练及切流脚本，确认未发现新P1/P2。前七类Gate可按上述明确边界登记passed；P7切流前条件通过，完整P7须等公网复验。现阶段预检保留readyForReview=false，不能伪填完整P7来满足切流脚本。审核允许依已有用户授权先受控切流，再实际公网核验并关闭P7；此为验收顺序处理，不是再次部署审批。

脚本改为核对独立“切流前条件通过/前七类通过/P7公网待验”记录。两处代理3000变为3008，保留相机/ACME；真实nginx -t及公网失败则切同版本3009只读，绝不恢复旧worker。安装包内29个文件与正式安装字节逐个一致，依赖独立复制，用户签收的UI版本未被替换。

## 公网实际切流与复验

已按前述阶段审核记录执行：NGINX原子替换、nginx -t及reload通过，两处代理均到127.0.0.1:3008；正式`https://124.223.97.60`健康为mysql/v2、runtime非只读。新NGINX摘要`2c71bee99e39761a69d7033aada1ff03376d1328a44018207c1c8f86e86cc0db`。旧fabric/3000保持停止，生产3008和只读3009已PM2 save。

公网实际44项断言通过：默认受信任TLS、HTML no-store及JS/CSS与安装文件逐字一致、服务端bundle/.env不可公开、admin登录及三库/色卡/选样/单据/统计身份读取、匿名401、legacy410、无效公开分享404、三种真实历史单据print-model和真实xlsx ZIP读取、三类当前公司图片真实读取及匿名拒绝。静态相机当前版本仍为0b73e426包，HTML及其引用资产与静态版本磁盘字节一致。曾将相机**包摘要**误作index.html摘要导致验证脚本失败，查明后改为版本身份与对应文件字节验证；未修改服务或相机文件。历史类型实际列为template_type，验证查询纠正后检查三种类型，不修改历史数据。

HTTP ACME挑战真实临时文件经80端口原样回读，测试后仅清理该准确文件；证书默认信任，notAfter为2026-10-24 02:00:05 UTC，`fabric-certbot-renew.timer`真实active。相机路由原CSP和Permissions-Policy保持。验证脚本原先误写timer名称，已查原安装定义后纠正，无服务变更。

独立Windows电脑使用默认TLS实际经公网登录，4类认证查询、HTML及JS/CSS下载和匿名401，共8个检查项通过；完整JSON单次约27–53ms，仅为该网络时点观测，不将其冒充P95或浏览器渲染。没有使用被工具拒绝的浏览器目标或CDP替代检查；本轮未新增浏览器视觉签收。

切流后再次从正式库与020554恢复库逐原列比对：18表全部原有值仍一致。原始证据：`D:/fabric/tmp/v2-production-cutover.json`、`v2-public-release-check.json`、`v2-post-manual-check.json`、工作树`tmp/public-desktop-verification.json`及远端同名release证据。测试仅新增停用验收账号与默认词表，公开复验无业务写入；认证session按真实登录/登出保留。

完整P7公网复验现已具备实际证据，等待release_review追加只读签收后更新八类证据的实际文档SHA256并运行--evidence。最终readyForReview只表示资料可评审，releaseAuthorized固定false的工具输出不撤销用户既有部署授权。

## 最终独立签收

审核人`release_review`已核对公网44项、Windows外网8项、切流记录及切后18表原有列全值一致，允许完整P7登记passed，无新增硬阻断。签收限当前11910f5包、生产V2切流、TLS/静态/认证/历史输出/公司图片/相机和ACME、旧worker停用、3009只读恢复；性能及P3/P5/P6保持正文列明的恢复库深测/生产核验边界，未伪称生产造数据或浏览器渲染P95。实体纸打及未单列手机返回仍未测。

据此重新计算本文件SHA256绑定八项证明并运行`node scripts/check-fabric-v2-phase1-delivery.mjs --evidence docs/operations/2026-10-19-v2-production-evidence.json`。部署许可来自用户，预检releaseAuthorized恒false不是撤销既有授权。本次已确认功能及部署工作已落地；后续观察、实体未测和明确排除功能不冒充已测。本文及全部历史/演练/复盘保留，无归档候选/删除/移动/旧库清退。
