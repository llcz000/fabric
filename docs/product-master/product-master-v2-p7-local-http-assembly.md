# P7 统一 HTTP、数据库目标与端到端验收技术说明

用途：分清统一装配、只读实库和业务写入证据。当前状态看[进度](product-master-v2-progress.md)，正式交付看[交付门槛](product-master-v2-phase1-delivery-readiness.md)。2026-10-15提炼，不构成生产启动配置。

## 装配和目标身份

`server/product-master/v2CatalogAssembly.ts`为TEST-ONLY async装配器；要求预期隔离名、ACK，先核DATABASE()/@@server_uuid，认证读取和事务池须同目标。`verifiedTransactionPool`每次借同一物理连接核身份后才BEGIN/业务SQL；`verifiedQueryDatabase`也从受保护池借连接核身份再读并释放，登录/owner/产品读不能绕过运行期校验。漂移、缺元数据或异常安全503，禁止把隔离Router直接挂生产。

## 三种证据层次

| 层次 | 已有证据 | 不能推出 |
|---|---|---|
| 本机统一HTTP+状态化SQL替身 | 权限/订单保存→冻结/引用禁删/共享图片2→1→0、失败整笔回滚，目标连接漂移先于业务拒绝 | 真实InnoDB锁/FK、实际COS对象回收 |
| 固定空MySQL8.0.46 SELECT-only | 列类型/NULL、来源与JSON、RESTRICT FK、CHECK ENFORCED；有效资产唯一生成列须STORED且表达式正确，非只看名字 | 授权后的正向业务写入或并发回滚 |
| 空账号真实HTTP→只读池 | 匿名/伪造token/错误登录拒绝，适配器DML硬拒绝 | 真实用户已开单或图片已保存 |

代码定位：`v2CatalogAssembly.test.ts/p7DocumentLifecycle.test.ts/p7MediaOrderLifecycle.test.ts`；只读探针`check-v2-p7-mysql-readonly.mjs/check-v2-p7-media-order-readonly.mjs/p7-v2-readonly-http-pool.ts`及对应测试。历史P7-4f远端5/5只证明约定负向范围，本轮未连接远程。

这些历史只读演练还要求固定目标MySQL8.0.46、14表白名单及每表0行；先核实际库/实例/版本，未知表或非空立即拒绝，不能因为库名像测试库就放行。该14表范围只对应原演练，不描述当前生产库。

## 生命周期断言

三单据共用受控产品删除核心，已引用先拒绝且零媒体DML；未引用删除、图关联和ref_count同事务，最后引用进入30日回收状态，不能直接删除COS。FK竞态/扣图账后故障须完整ROLLBACK。单据保存后读取冻结字段；与B3实时选样区分。解析器按受保护业务路由局部安装，不吞multipart或泄漏HTML堆栈。

**2026-10-15正式交付证明的SHA256完整性Gate**：`scripts/check-fabric-v2-phase1-delivery.mjs`在`--evidence`模式对已签收证明文件执行内容SHA256校验，拒绝摘要失配、路径异常、审核人缺失和符号链接；只证明提交的文件字节与摘要相符，仍不能自动证明审核人真实身份及获得上线许可。具体结构见[交付门槛](product-master-v2-phase1-delivery-readiness.md)。

**2026-10-15新独立HTTP试点入口（尚未运行真实数据库）**：`server/product-master/v2SandboxPreview.ts`及`scripts/run-v2-sandbox-preview.ts`建立仅development、localhost、独立指定MySQL沙箱和UUID的单独V2预览进程，不复用旧`server.ts`及旧数据库自动建表。内存SQL与真实本地HTTP专项测试已加入；未经批准不可连接真实库，因为认证后的V2业务接口可能写入**隔离沙箱**。见[沙箱启动专题](product-master-v2-p7-sandbox-preview.md)。这不是正式前后端接线或生产部署。

## 未完成Gate

真实授权业务连续写事务、两连接并发/死锁/FK/持久回滚、池重连/超时、探针开销及网络/浏览器P95≤1秒、真实COS/30日回收、生产结构/数据迁移、备份恢复、正式App及部署均待验。目标UUID必须独立预置，不能自证；不绕过既有远端写入阻断。
