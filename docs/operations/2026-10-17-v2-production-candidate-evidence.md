# V2 一期真实候选与部署证据（持续更新）

2026-10-17；当前为候选联调，不是正式上线记录。用户已授权补齐并部署；唯一模块状态为[当前进度](../product-master/product-master-v2-progress.md)，执行步骤见[部署计划](../superpowers/plans/2026-10-17-v2-production-release.md)。

## 目标与隔离

部署工作树C:/Users/yangx/.codex/worktrees/v2-deployment-completion/fabric，分支codex/v2-production-deploy-20261017；已合并最新审查72c63e9，统一提交04f3694已推送。原生产/opt/fabric、PM2 fabric/127.0.0.1:3000、c743742未切换。候选/opt/fabric-v2-candidate-20261017、3001，只访问fabric_v2_test_release_20261017t034108z。独立DML用户没有DDL权限，每个物理连接核对库名和实例UUID，健康mysql/v2；旧API410，无JSON后备。QA夹具不进入正式库。

## 数据与恢复

- 一致性备份748970字节，SHA256 efc9ee75e810a27f22de2b1db594a5a954c88bc410f13694e807828adeae1b6f；/var/backups/fabric/v2-release-20261017T034108Z/fabric_db.sql.gz。18张InnoDB表恢复行数/CHECKSUM一致，4.39s。
- Windows仓库外AES256-GCM离机副本D:/fabric-release-backups/v2-release-20261017T034108Z/fabric_db.sql.gz.enc，SHA256 c4e9a387f09456fedae263a5f4d4b18adf2e74f7caca5ac09d7ebd20dadaa9b6；密钥另存本机私有配置，不入Git或本文。内存解密/校验后回传，在独立MySQL8.0.46实例、私有数据目录和socket恢复，18表逐表行数/CHECKSUM一致，3.78s，验完停止。仍在同一物理远程主机，非跨主机灾备。
- 原生产PM2完整运行环境另备份在上述受限备份目录，不只依赖.env。固定候选归档43a538b961eedb65577b66dbab68c3155e3cf59f9cfaf704e6dc8093bf34eec2已从归档恢复至另一/opt目录，独立3002进程实际启动，再经3003只读proxy检查9项：可登录/查单/查产品，业务POST/DELETE/公司保存/上传/旧API均503拒绝；orders/order_items/products/v2_products CHECKSUM前后一致，两临时进程已停。切正式前还要新备份并验证，不能复用数小时前快照代替。
- 恢复库core/support迁移均重复执行alreadyApplied=true；SHA分别e5ed28807642abf5fc7a41bb1288b026bcd2e3fbb401811d737181fcac5d597c、2b4f88a1b7bec6449f97870daedfd188791fd5f0bae16c10e2c38efda8957a11。第三个AUTH-05审计加法表计划154bf28a274d1f1adf1f74337d3f96561696c2241b1c91b010f9778d3f58def5，首次/再次通过。
- 124旧单全部读取成功；恢复库中原124单、156明细、1211旧产品和库存原字段逐值对照原库一致。无归属猜测/产品回填/历史快照追写。

## 实际业务检查

真实候选HTTP基础15项、COS媒体4项、扩展业务13项通过：实际scrypt登录/两sales角色/撤权；三库SQL、持久配色、三类型单据；owner范围和跨owner拒绝；当前公司Logo/两收款码/文字签字到新旧单与真实XLSX；并发持久单号8个唯一；客户建议与集合JSON作用域；XLSX正常/错行/重复显式更新/令牌单用/并发指纹；无效明细及空单事务回滚；复制停用/旧手工拒绝；管理员修改/删除保留原owner审计。原库存算法只做身份接线，未实施未排期的STOCK-01。

最终浏览器19项通过，包括真实登录、库/成员/单据导航、240×140mm浏览器PDF、当前公司三图/签字、复制/取消删除/确认删除、默认单号和花型新增。原生文件上传经真实COS CORS/worker/SQL后显示缩略图并点击原图，产品三Tab均读取实际原图，PNG/打印JSON/XLSX实际落盘并核对像素/三图/签字。COS原规则为空，已备份并补正式HTTP来源和固定本机52986来源；443开放后已追加正式https://124.223.97.60来源，真实SDK读回三条规则，保留私有桶权限和已有对象。HTTP/临时来源待人工验收及正式切换后精确清理。不把自动浏览器当人工UAT或物理打印机验收。

2,000条恢复库真实配色/产品由领域服务创建，非直接绕过序号计数器的SQL。五类HTTP各25次，P95毫秒：产品37.10，花型37.73，面料9.15，单据6.23，统计11.32。边界为远程服务器回环、完整JSON，未测公网/浏览器端到端P95。

实际日志在主工作树忽略目录tmp/v2-deployment-*.log及各独立报告；截图/PDF留在部署工作树artifacts/product-master-ui/qa/production-candidate，不将可能含历史业务资料的截图或私有凭据提交Git。

## 质量与开放 Gate

独立只读审查已复核5项修复，14项定向通过，无新增P0/P1；未连接远程，不能代签运行事实。审查修复后统一全量1221项/1220通过/1设计跳过、完整lint/build通过；18项发布/补丁脚本及安全、图片冒烟通过。生产依赖审计0high/critical，ExcelJS→uuid仍2项moderate；现安装源码仅调用v4，不执行审计建议的旧版ExcelJS降级。

2026-10-17用户确认继续使用IP。按[Let’s Encrypt官方Certbot说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)，已在独立venv安装Certbot5.4.0，先staging后正式签发124.223.97.60短期IP证书，SAN为该IP，issuer=Let’s Encrypt YE1，有效期至2026-10-24。服务器OpenSSL验证IP及信任链均返回0。Nginx443已监听，专用每小时续期timer已启用；`renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew`退出0，续期和nginx reload hook均成功。systemd负责随机延时，关闭Certbot额外随机休眠避免作业超时。此前因云端443不可达临时保留HTTP服务；用户确认443已放通后，北京时间2026-10-17 20:26从本机以curl默认信任链、不跳过证书校验复测HTTPS健康200/mysql；恢复HTTP308跳转并复测Location正确，ACME探针仍200且内容正确。HTTPS当前仍代理原3000应用，不能当作V2已经切流。证书私钥、原nginx配置与PM2环境不入Git。

正式切流前可恢复原PM2配置。产生V2新业务写入后，禁止恢复不识别owner/快照的旧可写PUT接口；使用上述已演练的受权V2只读恢复模式保留新数据并前滚修复。加法DDL不在线DROP，旧库不清退。

正式P1生产迁移、P4人工七页签收、P7最终完整恢复/切换后复测尚未闭合，发布仍No-Go。已有部署授权；不得把这里的演练结果或代码审查当正式环境已迁移。B1～B3按二期独立验收，不扩大一期上线范围。

文档归档判定：本证据、部署计划、一期readiness、当前进度及关联数据库/输出/安全复盘均保留；未进行历史文档或媒体清理。
