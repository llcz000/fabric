# 2026-10-20 V2代码审查、旧入口退役与质量修复

本轮用户批准的代码修复与渐进重构已实施并完成本地验证，随后经明确授权于12:02上线；程序发布、29项服务器/13项Windows公网验证与回滚依据见[本次发布](../operations/2026-10-20-v2-quality-release.md)。两项P1已修复；当前唯一状态仍为[产品主数据进度](product-master-v2-progress.md)。以下初审小节保留原始触发条件和当时证据，以本节修复结果为准。

## 本轮修复与验收结果

| 优先级/范围 | 已实施改动 | 验证 |
|---|---|---|
| P1：合法规格被422误拒 | 以十进制表示检查精度，替代浮点乘100后严格比较；保留旧单据两位小数/字段长度约束、原始规格字符串、gsm/mm及null | 实际选品函数覆盖19.99、0.29、145.01、空值及非法精度；独立AC-68只读复核无阻断；补充零/负值/10位整数边界及科学计数法代表值，4项专项通过 |
| P1：业务员重复面料更新被拦 | UI与客户端以canManage控制明确勾选，移除管理员独占限制；后端身份、选行与指纹冲突校验保留 | admin/sales真实策略输入及无权限负向回归；独立AC-66只读复核无阻断 |
| 大型UI拆分 | 花型行/标签/配色编辑、色卡QR/表格/创建、产品身份/图片/选择对话框按职责拆分，保持原公开导出 | 74项组件兼容性回归；浏览器检查编辑、图片Tab、取消与色卡对话框，无控制台错误 |
| App状态拆分 | 登录、公司资源和导航分别提取hook；旧账号延迟响应不发布，卸载后延迟blob不分配URL | 28项App/登录存储/返回保护/资源生命周期回归 |
| 后端重复逻辑 | 五个目录服务共用账号→会话→业务事务守卫；保留领域行锁、错误类、提交/回滚/释放语义 | 107项鉴权/事务/目录/导入/引用保护专项 |
| 开发入口收敛 | 唯一活动源码为真实Git隔离工作树；主目录常用npm启动/测试/构建转到该工作树；移除旧产品导入命令；运行前检查需求、HEAD及643文件SHA | 7项源变化/新增文件/基线/需求/旧目录/命令白名单检查通过；原发布源620文件零漂移 |

- 工作树：`D:/fabric/.agent-workspaces/v2-quality-20261020`；基线HEAD `4f56b152a1ef3e8ee7079bf47c6c77b0cb4881b1` 加按文件SHA核对的当日发布增量及本轮改动。与实际发布源相较49个源码/配置文件差异（含23个新增），完整清单见 `artifacts/v2-quality-refactor-20261020/change-manifest.json`。
- 从 `D:/fabric` 使用 `npm run v2:source` 验证来源；`npm run dev`、`npm run lint`、`npm run test:unit`、`npm run build`、`npm start`及图片/安全测试均经固定命令路由。根目录旧源码文件保留以避免覆盖既有未提交工作，日常入口不再执行它们。未迁移凭据或连接生产数据。
- 串行全量：1398项中1397通过、1项条件跳过、0失败；lint/build通过；安全24项＋构建入口拒绝4项、图片HTTP43项、交付Gate测试9项通过。跳过项为需专用SSH/MySQL沙箱的P7-4f测试，未伪装执行。
- 本轮没有ACP编码派发。两份独立复核为原生只读审查，范围限AC-66和AC-68；总体需求与集成由总控检查，不能据此声称整库逐文件独立签收。
- 初次抽取遗漏asTags依赖、编辑器图片模块与现有目录模块重名、样式常量声明顺序问题均由测试/tsc发现并修正；保留失败及后续绿色证据。构建仍有既有大chunk提示，本轮未实施动态加载性能改造，也未宣称性能提升。

证据目录：`artifacts/v2-quality-refactor-20261020/`，包括quality-results、完整日志、source-manifest、change-manifest、source-routing-checks和review-evidence。下面记录初次审查范围及历史证据。

## 基线与范围

- 业务依据：主目录现行需求v1.50，尤其§2.2、§8、§9.1.2、§9.1.7、§9.3、AC-20/66/68/71/73；以及本轮用户明确“旧入口去掉”。已加载Fabric产品主数据与UI技能、Superpowers审查/TDD/验证技能。
- 源码依据：今天扫码发布记录所指的`C:/Users/yangx/.codex/worktrees/product-share-release/fabric`，Git HEAD为`4f56b152a1ef3e8ee7079bf47c6c77b0cb4881b1`，包含后续未提交分享/扫码增量。扫码发布18文件均与发布清单after摘要一致；对620份源码/配置生成SHA256快照，交付时原发布来源无漂移。
- `33f1da4..4f56b15`的server/src/scripts/package变更图为498文件、42151行新增；该图用于定位近期V2范围，**不宣称逐行穷尽498文件**。人工重点覆盖正式装配、身份/归属、配色永久序号、图片引用、导入、三单据、色卡选样及公开分享；自动回归覆盖项目现有全量测试。
- 发布来源的需求副本缺少10月19日单产品分享、10月20日扫码链接等最新修订，花型导出仍为旧规则。候选已采用主目录现行需求，未用陈旧副本否定正确的新实现。
- 候选：`D:/fabric/.agent-workspaces/review-cleanup-20261020`。这是保留文件摘要的独立源码副本，没有以旧master覆盖最新发布源码，也没有把普通Job当ACP。3份只读审查任务做了单AC intake；原生审查员随后额度中断，**未获得完整独立审查终稿**，提示均由总控另行核实；未宣称ACP编码或提速收益。

## 初审确认问题（两项已在本轮修复）

### P1-01：合法两位小数规格导致选品/复制被422拒绝

- 位置：候选`server/order-v2/lines.ts:94–95`。
- 触发：有效库内产品克重为`19.99 mm`，选择该产品或调用复制所用有效性检查。`19.99*100`实际为`1998.9999999999998`，与`Math.round(...)`严格不等，被误判为超精度；`20.00`对照通过。门幅使用同一错误判断。
- 影响：符合面料DECIMAL(…,2)合同的产品无法用于单据；三种单据共用该选择路径。需求§9.3及AC-67/68要求有效产品正常选入，不能因二进制浮点尾差拒绝。
- 证据：`review-probes.test.ts`实际调用导出的`assertActiveDocumentProduct`，确认19.99返回422、20.00通过。纯内存数据库替身，无业务写入。
- 建议：按数据库定点小数合同校验，或复用同文件已有的误差容忍判断；补克重、门幅、小数边界与真正超精度的行为测试。本轮保留为审查问题，未顺带修改单据业务。

### P1-02：业务员无法确认更新重复面料

- 位置：候选`src/components/product-master-v2/FabricImportV2.tsx:56,115,179,188`及`fabricImportModel.ts:56–58`。
- 触发：业务员导入包含已有品号的xlsx。组件传入`isAdmin=false`，预览不显示更新勾选框；即使提供勾选行，客户端校验仍抛出“只有管理员可以覆盖已有面料”。
- 影响：服务端已允许两种角色在明确确认后更新，实际UI仍按旧权限拦截，违背现行§8、AC-20/66。现有`FabricImportV2.test.ts`还断言非管理员不得更新，因此全量绿色无法证明现行需求一致。
- 证据：同一预览分别渲染admin/sales，确认只有admin有checkbox；实际调用`validateSelectedRows`，admin通过而sales抛错。
- 建议：移除覆盖操作对管理员身份的额外限制，保留有效登录、逐行差异确认和服务端并发指纹；同步纠正旧测试。初审时未修改；本轮已修复并通过回归，见本页顶部。

## 旧入口改动与保护边界

1. `src/App.tsx`移除LegacyApp及其旧登录/三库/开单导航加载，仅保留V2与既有`/p/`、`/s/`公开分享。运行模式不是V2时显示错误和重试，不回退旧版。
2. `server.ts`只启动固定数据库身份的V2运行时。缺少或错误V2配置时退出，不启动旧API、旧全局密码登录或JSON文件模式。V2现有旧API拒绝路由保持。
3. 移除npm的旧产品导入命令；安全和图片冒烟入口改测V2，不再依赖已退役的旧登录。历史测试helper保留作隔离测试，不挂入发布入口。
4. 历史单据读写保护、打印/Excel、当前公司资料、共享图片、库存及只读恢复逻辑保持。没有清理表、客户资料、历史媒体或知识文档，没有数据库迁移/COS写入、Git提交/推送、服务重启或部署。

精确代码白名单为10文件，见`artifacts/code-review-20261020/entry-change-manifest.json`；补丁见同目录`entry-removal.patch`。候选源码是可审查实现，**主目录旧入口和现有线上程序均未被本轮覆盖**。

## 审查与验证矩阵

| 领域 | 本轮结论与边界 |
|---|---|
| 身份、角色及单据归属 | 检查服务端逐请求身份、事务内账号/会话复核和owner谓词；内存/本机HTTP回归通过，未重验真实账号/生产库 |
| 三库、永久配色与图片 | 检查持久计数/锁、引用删除前置、共享图片扣账；现有全量及图片冒烟通过，MySQL锁/FK/COS不以替身代验 |
| Excel导入 | 服务端预览令牌、重复确认、并发指纹与行事务已检查；UI存在P1-02，不能认定需求通过 |
| 三单据/历史资料/输出 | 原行身份、显式删除、资料快照及当前公司设置已检查；已有历史/输出回归通过，存在P1-01；未真实纸打 |
| 色卡/选样/扫码 | 检查稳定令牌、新旧载体解析、登录后落点、显式确认、同页相机取消和事务内授权；专项已含于全量，未实机手机/微信扫码 |
| 单产品分享 | 检查产品范围、隐藏设计原图、JSON/每次媒体读取的启停与映射复核；本机安全用例通过。未把仅假设的TOCTOU列为缺陷：产品换关联会重算货号，现有身份复核能检测该触发 |
| 旧入口退役 | 入口行为、发布依赖图、无配置启动拒绝及只读schema校验通过；待合并、独立复核及实际发布后验证 |

WebCodex恢复后在候选中**串行**运行：

| 命令/检查 | 实际结果 |
|---|---|
| `npm.cmd run test:unit` | 1379项：1378通过、1既有条件跳过、0失败 |
| `npm.cmd run lint` | 完整tsc通过 |
| `npm.cmd run build` | 前端、server、只读恢复及camera构建通过 |
| `npm.cmd run test:security`；修订后`node scripts/smoke-security.mjs` | 首次测试路径错误已保留；实际脚本复验24项通过，另4项构建产物无效配置启动拒绝通过 |
| `npm.cmd run test:image-assets:smoke` | 43项通过，含当前公司图片与单据输出的HTTP链 |
| `node --test scripts/check-fabric-v2-phase1-delivery.test.mjs` | 9项通过 |
| 旧入口新增专项 | 5项通过；旧入口行为先实际RED，再GREEN；发布图验证排除旧ProductLibrary/DocumentList等；库存共享组件仍由V2复用 |
| 问题复现 | 2项观察探针通过，证明问题存在，不表示缺陷已修复 |
| 一期`--status` | 前后端sourceGate均true；默认未传外部证据，readyForReview=false、releaseAuthorized=false；不据此否定既有线上发布，也不授权新发布 |

本机沙箱首次HTTP连接`EACCES`，该轮中止后才转到恢复的WebCodex重跑，未并行跑全量与lint。安全脚本初次引用不存在的`middleware.test.ts`，已改为实际sessions/policy测试，仅该冒烟重跑，首次失败日志保留。完整串行记录保留在`review-quality.json`，最终安全复验另见`review-security-retry.json`，没有用最终结果覆盖首轮失败记录。

## 工具与技能推荐

| 用途 | 推荐 |
|---|---|
| 需求一致性 | Fabric产品主数据技能＋现行需求逐AC对照；UI任务叠加Fabric UI技能 |
| 独立审查和意见核实 | Superpowers requesting-code-review、receiving-code-review |
| 发现复现、修复与交付 | systematic-debugging、test-driven-development、verification-before-completion |
| 变更定位/证据 | WebCodex git_review_summary、git_diff_hunks、show_changes；本次脏目录/未提交发布增量额外固定逐文件SHA |
| 安全静态分析补充 | [CodeQL JS/TS](https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-queries/javascript-typescript-built-in-queries)、[Semgrep](https://semgrep.dev/docs/category/local-and-cli-scans)；本轮未安装或运行，不能替代业务需求审查 |
| 依赖漏洞补充 | [npm audit](https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities/)，本轮未执行、未自动修包 |


## 未完成Gate与文档处置

本轮代码修复及本地验证通过；随后用户明确授权，本版程序已发布并仅重启正式V2进程。未Git提交/推送、无数据库迁移/业务数据或COS写入；扫码功能保留。正式HTTP/资源与一份历史输出已复核，完整真实业务写入和手机实机验收仍开放。专用真实MySQL事务/FK/保存回读、正式账号xlsx提交、三单据历史输出、正式七页用户验收和手机/微信实扫未用本轮本地测试代签。

本轮只读 `check-fabric-v2-phase1-delivery.mjs --status` 的前后端sourceGates均true，外部证据未为本版本签收，readyForReview=false、releaseAuthorized=false；它不否定已上线旧版本的历史验收，也不构成本次发布许可。

计划、初审报告、独立复核及失败/通过日志、对应复盘和原发布/回退记录全部**保留**；归档候选**不适用**。唯一当前状态是 `product-master-v2-progress.md`；未删除、移动或归档知识文档。
