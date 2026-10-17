# Fabric V2｜一期Go/No-Go与ACP B1只读链接交付（2026-10-15）

> 文档定位：本轮研发/验收复盘。业务事实：唯一[需求v1.50](../../product-master/product-master-v2-requirements.md)。一期状态：[Go/No-Go](../../product-master/product-master-v2-phase1-delivery-readiness.md)；当前阶段：[唯一进度](../../product-master/product-master-v2-progress.md)。

## 任务、发现和根因

用户询问“一期是否能交付”，本轮经只读源码审查正式`server.ts`与`src/App.tsx`确认：前者仍挂legacy产品装配而非V2正式Router，后者仍加载旧ProductLibrary。独立V2组件、测试环境`createV2CatalogAssembly`与既往沙箱MySQL成果不能替代生产配置、数据库迁移锁/备份恢复、COS、正式七页UI和历史单据的真实签收。

新增`scripts/check-fabric-v2-phase1-delivery.mjs`和`.test.mjs`（TDD先RED：缺模块；GREEN **5/5**）。其`--status`只读本机源码、不访问数据库/外部服务，检查后端/前端正式入口并列出8类外部验收证据；**当前2个入口仍未挂V2、8类外部证据未完成、`readyForReview=false,releaseAuthorized=false`，结论No-Go**。即使未来文件证据齐全，脚本最多宣称“可提交发布评审”，绝不自动授权生产写库、上线或删除。详细P0–P7十项阻断及R0-R3验收路线记入专题，AGENTS.md增加强制交付Gate。

并行ACP E在经SHA256与独立恢复检查的448文件新快照`D:\\fabric-agent-baselines\\v2-2026-10-15T07-32-35-111Z-4de8d254`上运行，独立Project的`run_id=wc_agent_run_hJXdMfOYHx2J5suhlBh9E7xQLNtS09PniEX0pxPld3I`以`completed/end_turn`结束。B1新增`server/customer-share/patternLinkStore.ts`及同名测试文件：只读参数化摘要lookup，拒绝无效、重复、撤销/停用、父记录无效的数据，仍需可信服务端明确的**授权+发布**双重校验；返回仅内部花型ID，不生成链接、不创建表、不公开路由。ACP子Agent源码专项27/27；主项目合并后专项**27/27**。三方合并Gate只允许两份新增文件，先检查Agent测试`tmp`确实为空再精确移除，使用干运行安全合并。Windows写入端丢失两文件各1个末尾LF，经字节差异核对后仅补该换行，SHA256严格匹配。

## 最终验收、未完成项和交付边界

- 主项目`node scripts/run-ts-tests.mjs`：**929项，928通过、0失败、1远程场景按设计跳过**；项目完整`npm.cmd run lint`、`npm.cmd run build`通过。交付Gate单独5/5；文档导航及开发技能检查另作最终记录。
- **一期不具备正式交付条件**；本轮没有修改`server.ts`或`src/App.tsx`、生产DB数据/DDL、COS和旧单据，没有上线/部署。必须走[一期Go/No-Go清单](../../product-master/product-master-v2-phase1-delivery-readiness.md)，完成真实环境、七页、三单据及回滚测试，再经独立授权。
- B1源码属于二期独立只读链接存储**合同**，并不存在真实`pattern_share_links`表、发行/撤回/发布策略或H5。不能因为链接令牌模块27/27就宣称客户可点链接访问。具体公开权限审批和授权撤回仍待业务/安全Gate。
- **可复制经验**：先从正式入口源码确认真实状态，再做只读证据Gate；并行Agent限定白名单和单一责任者合入；小变更只在测试完毕后最小化合并；真实业务审批不能由自动化代码验证代替。
- **历史过程文档归档判定：保留**。此记录包含一期正式交付阻断的当前证据和B1真实独立交付日志。未做文档清理、Git提交/推送、远程写操作或生产部署。


## 2026-10-17 B1稳定令牌追加验收与仍待闭合门禁

本条为后续新增工作，旧2026-10-15的“不存在签发功能”叙述是历史时点记录，不倒写历史。本轮TDD先验证：母版停用时旧token当前只会404，且尚无对客稳定签发服务；新增严格分离的已授权分享签发与展示状态判断。使用只有server可信配置能提供的32字节CSPRNG长期秘钥加HMAC-SHA256域隔离和母版永久ID，重新签发得到同一不可猜的43字符URL令牌（单条持久映射只存专域哈希）。在同一模拟MySQL事务里复核最新管理员/业务员账号及登录、锁母版、锁映射并只插入一次；旧status异常、失效、秘钥变化拒绝覆盖而非自动换地址。独立私有POST要求实际Bearer、合法母版ID、无查询串且空JSON对象，不允许客户端指定用户ID/URL/签名Key；对客GET验证有效的停用母版时只返回“暂不可用”，重启后原URL可读，撤回/未授权仍404。实跑本机loopback的签发→读→停用→启用全链及SQL事务替身回滚，以上**未连接真实数据库或公开网络**。

**未完成Gates**：需要批准唯一master_id与64位小写hex ASCII token_hash（用二进制/区分大小写排序规则）的数据库唯一索引、FK及迁移/恢复备份，固定并异地备份不可随意轮换的高熵签名Key，唯一允许的受控公网HTTPS源/真实内部账号，独立发布裁决的unavailableVerified语义及服务端媒体预览二次校验；然后进行真实数据库/手机/微信业务H5联调和正式服务端路由挂载。业务已明确“不提供手动链接撤回”，不能因历史代码存在revoked_at就新增撤回UI。遗留随意变更秘钥会使已发链接与DB哈希不一致，代码选择**失败关闭、禁止秘密自动换新**；密钥轮换需额外迁移方案与审批。生产P1–P7亦仍No-Go且一期不被二期B1阻断。

**生命周期判定：保留**。历史复盘记录最初B1授权/公开字段保护和本轮新增真实签发前置要求及跨期边界，未归档或删除其他文档。本项目唯一当前状态仍为[进度](../../product-master/product-master-v2-progress.md)，并未声称真实客户H5已上线。


## 2026-10-17 B1 schema metadata readonly checkpoint（后续新增、仅离线）

稳定链接签发服务及公开停用恢复已有模拟HTTP验收，但当前仍无真实MySQL已审核的pattern_share_links表结构。一旦错误库或错索引上线，可能造成同一母版重复签发、hash大小写/前缀比较不安全或失效链接错误恢复。故本轮新增只输出SQL文本的patternLinkSchema.ts与完全只读的patternLinkSchemaContract.ts：通过同一连接校验明确指定fabric_v2_test_*沙箱库和server UUID、已有父主键、InnoDB、ASCII_BIN的完整hex字段、两项唯一索引以及单个RESTRICT FK。新增11项模拟元数据TDD通过不代表真库已完成或实际业务可用。

**下一步仍需** DBA审核新增表、库身份、真实备份/恢复、密钥托管、真实H5/图片授权及员工/手机UAT。生产库、真实SQL/COS、业务数据和旧App均未接触。**生命周期：保留**。现有B1复盘仍有独有安全上下文与未完成Gates，不符合归档条件；唯一当前状态仍看[进度](../../product-master/product-master-v2-progress.md)，新版[DBA预检门禁](../../product-master/product-master-v2-b1-link-schema-review.md)为运维辅助材料，不构成另一个业务规格。
