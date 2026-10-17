# Fabric V2 Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: executing-plans，单Agent逐项执行，最后一次独立只读审查。

**Goal:** 按2026-10-17用户“继续要部署还有哪些工作项都一并完成”授权，补齐已批准V2业务的生产接线、迁移/回退和真实环境验证后部署。

**Architecture:** 保持已有沙箱门禁不变，抽取业务路由供沙箱和独立生产装配复用；生产按显式运行模式、独立预置数据库名/UUID、每物理连接检查、只读schema验收后启动，绝不自动DDL或JSON后备。前端根据同源运行模式接入实际登录和已有React页面，复用已接受的列表/编辑/输出；旧模式保留作回退。

**Tech Stack:** Express、React、MySQL 8.0.46、私有COS、PM2；以安全审查提交5598934为基线，独立codex/v2-production-deploy-20261017，不覆盖其他工作树。

**Spec:** docs/project/项目需求总览.md，docs/product-master/product-master-v2-requirements.md v1.50，product-master-v2-phase1-delivery-readiness.md。

## Global Constraints

- 保留124张历史单据、156条明细、1211旧产品和977图片资产（远程盘点时点），不清空旧库、不猜历史owner、不改存量产品快照。
- 迁移为加法；MySQL DDL隐式提交，以保留新列/新表和回切旧代码为回退，恢复演练在独立新库进行。
- 不以静态源码检查或mock签收真实Gate，不改检查器以制造通过；生产接线新路径应有真实AST识别与回归。
- 管理员/业务员共享业务权限，只有管理员建账号/新增手工明细；销售单据限本人。
- 一期发布不被B1/B2/B3阻塞；二期未实现正式链不能假称一期已包含，用户已确认的业务修订保持。

## Review Focus

- 默认/错配配置拒绝启动；数据库连接重建后仍拒绝错库/错实例。
- 旧单据NULL归属只对管理员可见，迁移不回填身份/资料。
- V2与旧API认证不能串用，撤权立即失效，不对外发固定admin身份。
- 迁移中断/重复执行拒绝漂移，备份实际可恢复且迁移前后历史行内容不变。
- 受控图片上传/预览及所有输出不能绕权限或静默退回演示数据。

## Tasks

- [x] 只读目标盘点：线上c743742，Node22.23.1/MySQL8.0.46，storage=mysql；V2表尚无。新独立分支与依赖安装完成。
- [x] 真实一致性备份和新库恢复：18表计数/校验和匹配，SHA256、配置备份在远程受限目录；原生产数据未改。证据见Ledger。
- [ ] TDD生产运行配置/每连接身份保护，复用路由、成员/公司/资产受权接线；沙箱门禁与原有测试不削弱。
- [ ] 实际V2登录/导航/开单/设置/成员页接入，受权图片及当前配置多输出，保留旧入口回退。
- [ ] 正式业务差距核对补齐：花型新增入口（原onCreateMaster未接）、DOC-01复制/确认删除、DOC-03默认序号与客户建议、编辑单头、DATA-01受权集合JSON；保留既有库存入口而不扩大STOCK-01需求。
- [ ] 加法迁移器的锁/账本/幂等与漂移拒绝，先在恢复库实际演练，再核对生产备份与目标后执行。
- [ ] 新真实账号、COS/三库/导入/三单据历史/权限/性能/浏览器完整验收；独立审查和串行质量Gate。
- [ ] 精确白名单提交/推送、可回退候选部署与正式切换；健康storage=mysql和关键业务复测，异常立即回切。
- [ ] 填写真实证据、唯一进度及同题复盘；过程保留，无历史文档清理。

## Ledger

2026-10-17：用户本轮已明确要求部署，旧文档中的“尚未授权部署”不是本轮阻断；真实证据缺失仍须实际补齐。源代码检查器当前仅认识沙箱装配函数，生产新路径需正确适配，不能把TEST-ONLY函数直接挂生产。

2026-10-17实际证据：线上c743742/Node22.23.1/MySQL8.0.46，数据库UUID独立盘点；备份`/var/backups/fabric/v2-release-20261017T034108Z/fabric_db.sql.gz`，SHA256 `efc9ee75e810a27f22de2b1db594a5a954c88bc410f13694e807828adeae1b6f`，748970字节。恢复库`fabric_v2_test_release_20261017t034108z`，18表计数和CHECKSUM一致，耗时4.39秒，生产DDL/DML均未执行。恢复库已执行新加法迁移器并完整schema验收，6张历史关键表原有字段逐值摘要不变；再次执行返回alreadyApplied=true。迁移计划SHA `e5ed28807642abf5fc7a41bb1288b026bcd2e3fbb401811d737181fcac5d597c`，远程迁移演练证据同备份目录。源代码3项迁移拒绝/锁测试通过；目标/已有统一装配33项通过；图片身份与目标进一步RED→GREEN后通过，日志在主工作树tmp/v2-deployment-*.log。生产尚未迁移/重启/切流。

Ruling：运行配置必须使用现有`deny_legacy`值而非不存在的`v2`值，已补拒绝不存在值的测试并修正。目前独立生产Runtime/HTTP骨架已新增，需继续接真实前端、公司多输出及资产/完整真实链；第一次全量lint仅发现LegacySourceOptions字段名应为localRoot，尚待修正后最终统一验证。原沙箱目标门禁未放开，业务路由仅抽取共享组合。

2026-10-17候选实际运行：`/opt/fabric-v2-candidate-20261017`、PM2 `fabric-v2-candidate-20261017`、127.0.0.1:3001，只接恢复库。依赖单独npm ci；专用DML账号只授权恢复库。新管理员admin（旧.env口令不足8字符，已新生成；凭据仅在本机`.local/server/v2-deployment-20261017/initial-admin.local.json`与候选私有配置，不入Git/日志）。首次配置被SSH环境DB_DATABASE=fabric_db覆盖，身份Gate安全拒绝；候选专用启动wrapper明确加载本release .env后启动成功，health=mysql/v2。真实候选HTTP15项通过：两新sales账号、三库持久化、三类型单据ID221/222/223、同owner/admin读取及跨owner404、真实XLSX、产品引用409、停用账号使session401。fixture只在恢复库；原生产3000/c743742未切换。报告主目录tmp/v2-deployment-candidate-http.log。

Ruling：旧MySqlAssetRepository的周期引用核对只统计旧product_image_assets/company_image_assets，会漏V2引用。生产Runtime改为仅处理新图片job，不启动旧自动回收/清理/COS purge；已有SQL关联/引用计数由领域事务维持，新图片每秒处理，旧对象保持。已用专门RED→GREEN测试断言不会调用旧reconcile/recycle/purge；后续自动维护需独立完整V2引用域和并发验收，不借部署清理客户媒体。

浏览器首轮已真实登录并经过花型/面料/产品/色卡/成员/查询/新增页面，最后等待窄屏花型时脚本把role=table错当原生table超时；还未出具通过报告。花型截图已目视核对真实数据，发现onCreateMaster尚未接导致新增按钮未出现，已加入差距清单。ManualSelectionPane与主工作区差异仅CRLF/LF，git diff --no-index无内容差异，主要已接受列表/单据编辑源码SHA相同。
