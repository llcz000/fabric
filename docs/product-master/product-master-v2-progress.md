# Fabric 产品主数据 V2｜设计、开发与验收进度

本页仅维护V2模块阶段明细，不是全项目实施清单。既有单据、库存、统计、公司设置及总体待办见[项目进度](../project/项目现状.md)，业务全貌见[项目需求总览](../project/项目需求总览.md)。

更新：2026-10-17。本模块唯一业务基线为[需求v1.50](product-master-v2-requirements.md)。本表是V2唯一当前状态，不是过程日志；旧测试数字仅对原时点有效。当前源码已包含本会话AC-84增量，不能直接继承此前929项全量结果。

## 当前结论

**2026-10-17 第三批代码交付准备**：新增独立 P1–P6 一期V2七页业务**可写**工作台，复用已有花型/面料/产品/单据React与后端CRUD、Excel导入和共用选品；补产品确认删除的列表连接、花型新增表单、公司设置完整文本字段及两签字文案持久化、Logo/微信/支付宝可选隔离媒体桥接。可写前端Vite仅127.0.0.1:4466、独立后端3456，必须双重显式授权，不触碰旧 server.ts / App.tsx。**可写组件仅源代码/本机验证，尚未运行任何真实MySQL/COS或完成正式七页UAT，发布No-Go。** [第三批操作与缺口](product-master-v2-batch3-workbench.md)。



**2026-10-17 一期P5面料XLSX压缩存档安全前置门禁（真实解析路径、非实库）**：在现有previewFabricXlsx真正ExcelJS解压前加只读Zip32存档元数据检查，对文件/单条/整体标称解压字节数、压缩比和条目数设上限，限制规范路径/唯一性及本地头/中央目录一致性，拒绝Zip64、宏、外部链接/嵌入媒体、加密及畸形数据。真实ExcelJS生成的正常中文7列面料文件仍可预览，伪造zip-bomb/路径穿越/畸形包等被拦截；真实本机V2认证HTTP上传路由新增坏档案400/无面料写入测试。额外纠正旧提示“只有管理员可二次确认”，符合批准的管理员/业务员两角色均可显式确认覆盖。**2026-10-17同日强化：专项TDD发现伪造中央目录小尺寸可绕过静态预检，现已在ExcelJS之前用有maxOutputLength上限的实际DEFLATE解压逐条核验展开字节数与CRC32；修复伪造数据引发的解压膨胀风险，本机认证HTTP坏文件400、正常文件导入提交均通过。生产仍需进程隔离、CPU/内存/超时/并发限制；真实MySQL、业务账号、UAT、正式App装配未完成，发布No-Go。**[P5安全门禁说明](product-master-v2-p5-browser-and-mysql-gate.md)。


**2026-10-17 B1稳定链接SQL结构评审与同连接只读预检（未创建表）**：继独立签发/停用恢复HTTP功能后，新增 patternLinkSchema.ts 仅生成未执行的 InnoDB pattern_share_links 表DDL（64字符hex token_hash采用ASCII_BIN且唯一，master_id独立唯一，RESTRICT FK）。verifyPatternLinkSchemaContract针对受控fabric_v2_test_*沙箱目标，使用一个物理连接同时检验DATABASE()和server_uuid，并只SELECT校验父/子表InnoDB、主键类型、字符集、完整唯一键、默认值/外键。模拟元数据TDD 11/11：错库、不同服务器UUID、弱索引/字符集、CASCADE、额外FK、驱动异常均拒绝并释放连接。**无真实MySQL、未执行DDL、尚无批准的备份/恢复及密钥托管，实际H5仍未上线**；这是B1可本地验收的只读迁移前置合同，不能标记一期/二期发布门禁通过。[B1库表审核与DBA门禁](product-master-v2-b1-link-schema-review.md)。


**2026-10-17 B1稳定花型分享链接签发与停用恢复（未挂载、非真实客户H5）**：按已确认AC-73/V2-12，补patternLinkIssuer.ts的32字节高熵受信秘钥HMAC-SHA256域隔离稳定令牌签发，按母版永久ID生成相同43字符不可猜令牌，同一受控HTTPS origin格式化为可点击URL；事务读取最新管理员/业务员有效账号和会话、锁住母版与唯一映射、仅以域隔离哈希存SQL而**不写裸令牌**，再次请求返回原链接。母版停用/重新启用无需重新分享；无法复用/异常/现有撤销数据/密钥变化一律回滚拒绝，不支持手动撤回UI。新增独立POST /patterns/:masterId/share严格Bearer与空JSON入参接口，以及对客GET的resolvePatternLinkPresentation：**被停用但有效的链接仅在服务端显式核验unavailableVerified后显示“暂不可用”**，重启后原URL恢复；随机猜测、状态异常、拒绝授权仍404，前后重复验证避免中途停用时泄露原投影。独立伪SQL事务和127.0.0.1真实HTTP测试涵盖签发→对客只读→停用→重启→旧映射异常拒绝。**未实施真实pattern_share_links数据库唯一索引/FK/元数据预检、密钥托管备份和迁移、任何生产写库或路由挂载、真实H5与受控图片签名网关**，故此仅是可离线验收的业务合同，不代表签发功能可对客户使用；一期P1–P7发布仍No-Go。已批准无手动撤回，以[唯一需求第9.1.5节](product-master-v2-requirements.md)为准。

**2026-10-17 P4/P7 独立沙箱七个只读预览tab增量**：在此前独立登录+花型/面料/产品三页基础上，增加色卡库分页、选样单ID+grant权限查询、单据查询与匹配合计、经营大盘Top5筛选联动四页。仅调用隔离V2 GET与成熟React数据合同，没有mock或业务写操作；三个旧目录启用allowExport=false隐藏下载按钮，其它正式/评审组件默认行为不变。模型新增4项、React静态验收3项。**7个沙箱tab不表示P4正式七页功能已交付**，真实MySQL/COS、账号签收及生产Server/App接线尚缺。详见[隔离沙箱](product-master-v2-p7-sandbox-frontend.md)。

**2026-10-17 P7/P4独立前端只读接线（非正式App）**：新增非默认产品主数据V2沙箱HTML/React入口，显式确认后仅在127.0.0.1:4455代理到独立V2沙箱127.0.0.1:3456。实现服务器me二次校验的V2独立账号登录、花型/面料/产品三库只读浏览和安全登出；内存会话、不持久保存、401失效、拒绝公网/旧API/写请求/跨源。6项会话测试与2项Vite端口/隔离构建安全守卫，本机沙箱UI独立编译成功。该UI没有正式7页导航和真实数据库/COS验证，主server.ts/App.tsx完全未接线；需真实账号及环境单独批准，不能替代P4/P7发布门禁。[独立浏览器沙箱](product-master-v2-p7-sandbox-frontend.md)。

**2026-10-17 HTTP/媒体/数据库依赖安全补丁列车（独立审查，生产No-Go）**：根据最新项目总状态保持旧正式App不切换；只在干净审查工作树中先于隔离tmp目录对现有package/锁文件运行无强制升级的npm audit fix --package-lock-only，审核51个包条目的版本/可选二进制清单变化（包含sharp跨平台预编译包），然后精确替换审查锁文件，正式package.json与已确认COS3/代理补丁保持不变。关键修复包括multer 2.2.0→2.4.0、sharp 0.35.3→0.35.5、mysql2 3.22.6→3.24.6、express 4.22.2→4.22.3、fflate 0.8.2→0.8.3及同主版本传递查询/解析依赖；本机独立安装新HTTP/图像依赖，真Express multipart内存文件大小限制及Sharp真实SVG转PNG/坏数据拒绝3项通过。锁文件TDD 2项从红转绿，CI新增真正npm ci后再跑已安装HTTP/图片冒烟的强制校验。本次生产范围只读npm audit从16项（0 critical/8 high/8 moderate）下降到**2项（0 critical/0 high/2 moderate）**；剩余是exceljs 4.4.0→uuid 8.3.2的审计关联，audit fix --force建议降级exceljs 3.4.0属不兼容，未执行。由于未运行真实MySQL/COS、受保护预发布/业务UI、备份恢复和P1–P7签收，**不能因审计0高危而批准上线**；Linux GitHub实际npm ci/构建结果单独核查。新增同题[复盘](../retrospectives/development/2026-10-17-http-image-security-patches.md)，计划/文档保留、暂无归档候选。


**2026-10-17按最新总进度补OUTPUT-01浏览器Gate**：核对已有实现后未重复编码PNG/JSON按钮；新增独立浏览器验收脚本，三类型实际点击并等待下载完成，读取PNG/打印JSON实物，核对240mm预览、2倍PNG尺寸、全部显示字段/明细/汇总一致、三类型390px窄屏与桌面PNG像素相同，以及Excel404后按钮恢复且JSON导出成功。最终19项通过，打印/组件专项12/12通过、脚本语法及评审构建通过、文档导航77份/598链接通过，证据`artifacts/product-master-ui/qa/document-output/`，最终日志`tmp/document-output-browser-final.log`。仅本机演示数据，不模拟Excel成功，不接正式App/实库/COS/纸质打印，不等同DATA-01集合备份；业务输出实现无修改，不重复全量回归。独立审查分支与主工作树分别保留，不改中央ACP签收；只读调度计划因需求源变化拒绝派发，未绕过Gate。计划及同题复盘**保留**，无归档候选或清理。

**2026-10-17 COS SDK 安全升级与移除闲置 Transformers（待 GitHub 全新安装验证）**：生产 cos-nodejs-sdk-v5 2.15.4 升 3.0.0，保留原API名称、GET/PUT签名和对象Promise方法；本机**隔离安装官方3.0.0**且使用伪密钥的无网络SDK冒烟2/2通过。扫描Git跟踪代码发现 @xenova/transformers 仅在 tmp 实验引用、无业务运行时代码使用，按差异白名单从依赖清单及锁移除，去除旧ONNX链。只读 npm audit --omit=dev 由28项（4 critical）降为**16项（0 critical、8 high、8 moderate）**；真实COS通信/系统回归、剩余高危和正式P1–P7门禁仍未闭合，不授权生产切换。GitHub审核CI新增SDK3真实实例无网络签名冒烟，须以远端全新npm ci运行与制品结果为最终验证。

**2026-10-17 生产依赖安全补丁（审查候选）**：基于 npm audit --omit=dev --json 全量核查发现29项生产依赖告警（5 critical/11 high/13 moderate），其中Express传递地址解析依赖 proxy-addr 2.0.7存在critical IP spoofing。使用项目 npm overrides 精确锁定 proxy-addr 2.0.8（新增Git锁文件差异仅小范围版本及少量可选包元数据），新增2项防倒退测试和2项审计摘要契约测试；重新审计为28项（4 critical/11 high/13 moderate），proxy-addr 不再报告。GitHub审查CI现增加运行时npm audit只读报告与无密钥告警摘要，**仍禁止部署**；COS SDK 2.x的request、fast-xml-parser、form-data以及Transformers链protobufjs严重项尚待隔离升级评审，不能npm audit fix --force或盲目换主版本。Windows本机node_modules复用旧仓库，不能以本机单测宣称新proxy运行时验证；以GitHub全新npm ci/run验证为准。生产P1–P7与真实回归仍No-Go。
**2026-10-17 GitHub Ubuntu 构建成功（仅审查制品，生产No-Go）**：草稿PR #1 的远端Actions run **38996817370（run #4）** 全部成功：GitHub Ubuntu24/Node24 运行npm ci、1103项单测（1102通过/1跳过）、四组TypeScript、Git已跟踪文档闭包/文档导航、前后端build和制品上传。已实际下载并校验artifact **12086584571**（258700字节压缩、19个文件，含server.cjs/index.html及前端资源；无map/env/key），ZIP SHA-256为55f0b389c9302c6aaf260bcc1f6ac9ac21087f874010070d2ac99a20d48b20dc。GitHub PR使用合并测试SHA 8178cd7d90b16b38203d5bdb95ce35e84b3ac3fa 命名制品，**不是用于线上发布的审定源SHA**。主master未合并；仍无真实部署、P1–P7业务签收和DB迁移回滚；首轮npm ci的29条依赖风险（5 critical）待核实并处置。链接见GitHub Actions https://github.com/llcz000/fabric/actions/runs/38996817370。
**2026-10-17 GitHub Linux 远端 CI 首轮实测与修复（未上线）**：GitHub PR #1 的 Actions run 38996348748 在 Ubuntu 24.04 完成真实 npm ci、1103项单测（1102通过/1跳过）、后端/前端/工具/B1-B3四组 TS 和 CI 安全测试；在文档检查因被 Git 忽略的 .agents/skills/fabric-ui-design/SKILL.md 不在远端检出而失败，构建与制品步骤因此跳过。隔离审查分支现已精确暂存该公开项目技能，新增 Git 索引文档链接闭包检查及反向缺文件回归，专项4/4通过、文档85份/602链接通过，完整本地1103项与构建再次通过。修复后 GitHub 远端是否全绿必须以新 run 为准。首轮 npm ci 另观察到29项依赖安全告警（13中/11高/5严重），未自动升级；须在生产发布安全复核中分类处置。正式 P1–P7 与生产部署仍 No-Go。


**2026-10-17 远端自动构建基础设施（生产不部署）**：在上游审查分支新增 GitHub Actions .github/workflows/fabric-v2-review-build.yml，push 审查分支与 master 或 master PR 将以 Ubuntu 24.04/Node24 运行 npm ci、全量单测、四组 TypeScript、文档导航与 build；仅短期上传不含 sourcemap 的 dist 审查制品，GITHUB_TOKEN 仅 contents:read，不提供环境/SSH/数据库/COS/部署任务。增加三个持久 TS CI 分片配置和只读 CI 契约及 2 项反向安全测试；本机验证 1103 项单测（1102 通过、1设计跳过）、四组 tsc、构建、CI契约2/2与文档85份/601链接通过。**云端实际 run 尚须以 Actions 日志验收；本地绿色不是云端绿色**。服务器历史环境为远端 Ubuntu /opt/fabric/PM2，未来部署应以单独审批的制品哈希、真实DB备份/回滚与P1–P7证据为前提；本轮不触发生产部署。


**2026-10-17 Git审查分支已提交并推送（生产仍No-Go）**：经白名单完整源代码/评审资料核对，隔离工作树`D:\\fabric-v2-release-review-20261017`在`origin/master=7e2d81d`之上以404文件、**零历史删除**形成提交`1e9a7c76241db2e577bc7515642fbc2001fcfeee`，已推送至`origin/codex/fabric-v2-integration-review-20261017`；远端`refs/heads/master`经`git ls-remote`再次证明仍为`7e2d81d`。该分支本机完整测试1103项（1102通过、1设计跳过）、分组/专项TS四组通过、构建通过、84份文档/597条本地链接和暂存差异检查通过。共享Git的旧pre-commit hook指向不存在的他项目配置，首次提交失败；核对无目标配置后仅本次提交使用钩子自身建议的`PRE_COMMIT_ALLOW_NO_CONFIG=1`，**未使用`--no-verify`、未改全局Git设置**。推送范围为**非生产审查分支**，未建立PR、未合并master、未切正式V2、未执行DDL/COS或真实环境部署/回归。原主工作树的脏文件及已暂存历史删除仍原封不动；发布预检`readyForReview=false`、`releaseAuthorized=false`，P1–P7八项真实证据与原完整单次lint资源限制仍待解决。

**2026-10-17 远端最新基线的隔离集成候选（并非正式交付）**：以`origin/master=7e2d81d`创建仓库外`D:\\fabric-v2-release-review-20261017`的独立审查分支`codex/fabric-v2-integration-review-20261017`；逐文件白名单导入V2源码/方案/测试与对应Stitch证据，禁止`git add .`、主工作区强制合并及历史删除。发现远端`ProductReviewStatus`新增`pending_manual_confirmation`，保留远端类型并只增补本地`DocumentData.styleNo`；补齐候选端`server.ts`中默认`legacy`的显式切换保护挂载、两个旧图片服务测试替身的`setReviewStatus`，不启用线上拒绝/切流。B3只读四表预检进一步要求**真实CHECK_CLAUSE表达式**匹配数量大于零、客户确认值及日期顺序；针对同名弱约束观察RED→GREEN，6/6通过。远端独立工作树完成全量`npm.cmd run test:unit` **1103项（1102通过、1设计跳过、0失败）**，后端/前端/脚本分片和新增B1/B3独立`tsc --noEmit`均退出0、`npm.cmd run build`退出0、文档导航84份/597条链接通过、候选暂存差异`git diff --cached --check`为0。所有候选文件由审计清单精确暂存（404项、0删除），保留原工作区及上游商品人工审核逻辑；21份评审截图/HTML/JSON有独立哈希清单并未伪造。**单一完整lint仍受机器内存限制**，独立候选并无真实MySQL/COS/正式账号/客户H5或业务页面验收；只读发布预检继续`readyForReview=false`、`releaseAuthorized=false`，禁止把隔离审查代码/ Git审查分支误当可部署的生产版本。

**2026-10-17 继续发布准备（隔离功能与Git检查）**：B1隔离公开`publicPatternRoutes.ts`修复“查询花型期间链接状态已失效却继续返回旧资料”的竞态，候选加载后**再次查询链接及当前服务端发布决策**，同一母版才返回；4项定向RED→GREEN通过。B3新增`fulfillmentSchemaContract.ts`及5项只读元数据测试：通过**同一物理连接**校验预期数据库身份、四张表InnoDB、关键列类型与非空、唯一键、RESTRICT复合外键、强制CHECK；拒绝错库、缺表、MyISAM、跨会话FK与不执行的CHECK；全程只读，不执行DDL，不意味着真实MySQL通过。安全基线`node scripts/fabric-v2-safe-baseline.mjs --create`在仓库外`D:\\fabric-agent-baselines\\v2-2026-10-17T01-51-50-857Z-c72038a9`创建484文件/4,073,365字节源码**受控子集**快照，随后`--verify`、`--restore-smoke`均通过；**不涵盖全部仓库/运维文档，也不是生产数据库备份**。Git审计`origin/master`相对当前HEAD新增3个旧商品库治理提交，涉及`src/types.ts`与部分旧组件，当前原工作树还有3个旧历史文档已暂存删除；未合并/覆盖/提交/推送，不应在dirty master直接合并。本轮追加后的`npm.cmd run test:unit`总计**1095项（1094通过/1设计跳过/0失败）**；后端、前端、脚本3个分片及新增B1/B3专项`tsc --noEmit`均退出0，构建通过；原始全量lint单进程的内存问题仍保留。经只读`git ls-remote`确认远端`origin/master`最新短SHA仍为`7e2d81d`，已在仓库外创建干净独立工作树`D:\\fabric-v2-release-review-20261017`（detached HEAD在`7e2d81d`，`git status --porcelain`零行）；不在主工作区直接拉取或复制覆盖。代码复核后已刷新受控源码子集快照`D:\\fabric-agent-baselines\\v2-2026-10-17T01-59-18-395Z-13150c63`（486文件/4,093,720字节），哈希校验和隔离恢复演练再次通过，但仍非完整仓库/数据库备份。正式P1–P7和B1/B3实际库/账号/媒体/发布门禁仍待外部证据，故不提交/推送/部署。
**2026-10-17 本轮交付判断（代码已验证≠可推送/可部署）**：新增B3私有寄样/跟进的未挂载事务写入、按会话受权分页读取和四张**未执行DDL**的FK约束设计；新增B1未挂载的发布状态复核/白名单JSON查询路由。全量`npm.cmd run test:unit` **1089项（1088通过、1跳过、0失败）**，`npm.cmd run build`通过，新增范围`node node_modules/typescript/bin/tsc -p scripts/tsconfig-b3-fulfillment.json --noEmit`退出0；**原始`npm.cmd run lint`因运行机内存耗尽中断，不能记作单次lint命令通过**。补偿验证以`tmp/fabric-lint-split-{backend,frontend,tooling}.json`按同一根tsconfig拆分后端（含server.ts）、前端（含vite.config.ts）与scripts源码，三个`tsc --noEmit`命令均退出0；这证明各范围可独立类型检查，但非同一TypeScript Program，不能隐藏原命令资源问题。仍无真实MySQL的四表迁移/回退、正式V2前后端接线、真实分享链接媒体安全、手机和账号浏览器验收。Git当前`master`落后`origin/master`3个提交，且保留已暂存删除和约百项历史未提交/未跟踪内容；本轮未执行commit/push以避免发布未经审核的旧状态。只读发布预检仍`readyForReview=false`、`releaseAuthorized=false`。待干净隔离分支经完整差异审计/回归后才适合提交推送；真实部署仍受P1–P7门禁保护。
**2026-10-17新增B1/B3隔离HTTP与可选持久化契约（尚未上线）**：新增`server/customer-samples/fulfillmentSchema.ts`四张新增表的**只生成SQL、绝不执行DDL**设计，包括批次/跟进表、明细关联、与选样单ID绑定的组合RESTRICT FK。`fulfillmentService.ts`基于当前admin/sales受权选样会话、事务锁和实时未移除产品实施批次/跟进保存、明细/关联原子事务，异常整笔回滚；`fulfillmentRead.ts`补授权后服务端分页查询及历史数量/产品关联；`fulfillmentRoutes.ts`补未挂载的私有`POST/GET /sessions/:id/shipments|followups`，拒绝跨会话、恶意字段与匿名请求。B1新增`publicPatternRoutes.ts`隔离`GET /:token`，依赖受信注入的真实链接查询、服务端当前发布裁决和实时候选投影，每次请求核验、无缓存/无Referrer、拒绝非法令牌，严格过滤客户私有字段；**不能代替链接生成/失效管理或图片授权、未挂正式服务/没有真实MySQL schema及已批准公开地址**。本机RED→GREEN定向覆盖事务成功/回滚、角色/授权/HTML/无缓存、受限列表及公开投影；完整门禁与部署仍No-Go。`master`相对本地跟踪`origin/master`落后3个提交且现有工作区含数十项历史修改与已暂存删除，**未做git add .、commit、push或真实部署**；等待独立分支集成审核与P1–P7真实证据。
**2026-10-17 后续B3/FOLLOW/B1安全切片**：`server/customer-samples/sessionRead/sessionRemove`及两条私有路由由sales-only改为**admin/sales**双角色，保留服务端实时账号/登录/显式选样会话授权、事务锁序、失权404、单款软删除与追加审计；统一V2本机HTTP验证包含管理员已授予/失权/移除记录，原选样者不被覆盖。`followupDraft`新增FOLLOW-01纯校验：客户确认/反馈/跟进结果、下次日期及有效选样产品ID关联，不接受过期/移除/跨会话/伪造订单字段；**不保存数据库、不发提醒、不自动开单**。B1新增`PublicPatternGallery`只读React展示壳，消费已有公开字段白名单投影，配色按启用状态展示，每款面料分别显示原规格/预览占位；未注入受信安全预览renderer则绝不渲染图片地址。**尚无稳定对客链接、公开HTTP/H5装配、真实图片授权/展示及用户UI接受**。当前均为独立代码，不应标为B1/SHIP/FOLLOW完整交付；按正式App/实库/数据迁移发布门禁继续No-Go。本轮全量`npm.cmd run test:unit`共1074项（1073通过、1按设计跳过、0失败），`npm.cmd run lint`及`npm.cmd run build`分别退出0；文档导航76份、597条本地链接通过，`git diff --check`退出0。只读一期预检`readyForReview=false`、`releaseAuthorized=false`（正式前后端挂载与8项证据门禁均未达成）。

**2026-10-17多模块本机切片 AUTH/STATS/QUERY/OUTPUT**：V2成员列表、新增/修改DTO及`/access/me`不再对外提供旧双授权字段，新成员兼容历史列写入1/1并拒绝客户端旧授权配置；管理员新增账号、角色/停用与会话撤销不变。新增独立`V2DocumentStats`服务端范围统计/日期过滤/排名/最近单据交互，`?view=stats`隔离评审将品名接预填查询、最近单据接受权打印预览。V2打印预览补PNG捕获和**打印模型**JSON导出按钮，既有Excel/浏览器打印保留；JSON不是服务器数据备份。专项已观察新行为RED→GREEN，未代表真实打印机/图片、真实MySQL/账号、完整COMPANY-01或正式`App.tsx/server.ts`切换。2026-10-17统一全量`npm.cmd run test:unit`为1062项（1061通过、1按设计跳过、0失败）；`npm.cmd run lint`、`npm.cmd run build`均退出0；文档导航76份/596链接通过，`git diff --check`未发现跟踪文件空白错误。**一期No-Go**，不执行旧列数据库迁移、客户数据写入或部署。

**2026-10-17继续DOC-05/07**：复用已有V2单据工作区，样布去定金且应收=合计、匹数=明细行数；定金去匹数/结清，比例计算金额先按分舍入再扣减，打印及XLSX补应收；销售金额定金/分匹扣损保持。共享支付计算覆盖服务/编辑映射/打印，拒绝非法类型字段；定金文本保留未完成输入并阻止提交。独立审查两项P2已观察RED→GREEN修正：样布旧汇总按实际行数派生、普通PATCH省略样布deposit及定金settled，隐藏历史原值不被无关编辑覆盖；创建仍用0/false。原产品快照/行身份不变，无批量迁移。

相关100项、本机真实HTTP三类创建/重读/非法PATCH回滚/普通编辑保留旧值/打印与实际XLSX通过，浏览器13项/6截图。最终全量1046项：1045通过、1按设计跳过、0失败；类型/构建记录见同题复盘。预览`?view=documents`复用原页面，查询演示仍不模拟保存/导出，HTTP完整链使用内存SQL替身；正式App/真实MySQL/完整当前设置及签字链仍开放。证据`artifacts/product-master-ui/qa/document-types/`、`tmp/document-types-*.log`，过程及保留判定见[同题复盘](../retrospectives/development/2026-10-16-document-query.md#2026-10-17单据类型与金额doc-0507)。客户选样紧凑UI已获本轮用户明确验收，未扩为B3正式接线/实库验收。

**2026-10-17 AC-84紧凑缩略图追加修订**：色卡编号不附展开/收起文案，直接点击切换；展开显示可勾选花型缩略图＋花型编号（不显示产品货号），每卡只留行内“加入”，按当前勾选提交，全选整卡/部分子集/零选禁用，移除独立“加入勾选”。候选增加花型编号和图片资产引用；展开才调用既有图片resolver，分批thumbnail，不请求原图，失权清除资料。42项定向及最终全量1038项（1037通过、1跳过、0失败）通过，Edge26项/5截图在`artifacts/product-master-ui/qa/card-selection-compact/`，旧截图保留。类型/构建结果在同题复盘补记；紧凑补选规则及预览已于2026-10-17获用户“都检查过，可以”确认。正式图片鉴权/COS、App/实库及既有权限Gate仍开放，无部署或历史清理。

紧凑修订最终串行lint/build均退出0；证据`tmp/card-compact-lint.log`、`tmp/card-compact-build.log`。静态52985评审已重建，无正式服务重启或路由切流。

**2026-10-17 AC-84仅基于色卡补选**：用户确认人工补选只搜索已建有效色卡，首列色卡编号，一行一卡可展开，默认全选当前可供样配色，可取消部分勾选，支持整卡/勾选子集加入；去掉按货号补选。React与私有服务已实现，服务端拒绝裸productId、跨卡/无卡/失效项，整卡事务失败回滚，同单去重/恢复；人工卡来源独立记录并在首列展示，不伪造扫码。fresh DDL/只读契约新增人工事件可空card_id和RESTRICT FK，NULL仅容纳历史无卡记录，未迁移存量库。交互规则及后续紧凑修订已于2026-10-17获用户确认。相关153/153、统一装配HTTP30/30、Edge19项/5截图通过，只读独立审查未确认P1/P2；最终串行质量回归见同题验收记录。入口[当前选样说明](product-master-v2-b3-history-ui-review.md)，证据`artifacts/product-master-ui/qa/card-selection/`，复盘[色卡补选](../retrospectives/development/2026-10-15-fabric-v2-efficiency-b3.md#2026-10-17仅基于色卡补选)。正式App、真MySQL迁移/并发/权限、旧read/remove两角色整改及寄样/跟进仍未完成；本轮计划及同题过程/复盘判定保留，无归档操作。

**本次最终验证**：全量1038项，1037通过、1按设计跳过、0失败；随后串行lint/build退出0。文档导航75份/594条链接通过，git diff --check通过；静态52985评审入口HTTP200。日志`tmp/card-only-all-tests-final.log`、`card-only-lint-final.log`、`card-only-build-final.log`和`card-only-doc-navigation.log`；浏览器19项/5截图为内存交互，统一HTTP为本机内存SQL替身，均不代表真实MySQL或正式上线。

**2026-10-17补齐EX-01/02与DOC-06**：三库现有列表均增加“导出筛选结果”，经当前登录/两角色读权限验证，服务端复用查询解析器与过滤器按100条逐页读取全部匹配记录，不受列表当前页码限制；XLSX列为当前列表数据列（去掉图片/操作），显式字段白名单不带资产ID、路径、签名地址，保留编号文本、规格单位/空值和字面量字符串。默认10个逐匹米数输入位与追加已接入现有V2销售单编辑；毛米数按已填匹的分值合计，空位不计匹数，清空不移动其他位；取消前后端200匹业务上限，235匹计算/映射通过。保留历史无分匹明细原米数直至实际修改，永久产品/行身份规则不变。

独立审查发现原生number输入会把未完成1e当空位并缩短分匹，实际浏览器RED后改为保留原文、decimal键盘/格式校验，无效值会被保存映射拒绝。最终专项19/19，Edge81项/30截图（含三库实际下载文件、逐列/筛选核对及分匹操作），全量1038项：1037通过、1按设计跳过、0失败，串行lint/build通过。当前代码/导出实物和截图在artifacts/product-master-ui/qa/p4-6，日志/基线tmp/remaining-v2-20261017/。同题复盘见[三库与SQL](../retrospectives/development/2026-10-13-fabric-crud-tests.md#2026-10-17三库筛选资料导出)、[V2单据编辑](../retrospectives/development/2026-10-16-document-query.md#2026-10-17销售逐匹输入doc-06)。

**剩余边界**：导出会拒绝可检测的总数变化、重复ID和短页，但分页读取不是数据库一致性快照，同总数并发替换仍可能混合时点；真实MySQL并发/性能与正式账号/App仍待验。DOC-05/06/07已补独立V2界面及本机保存/重读/打印/XLSX契约，真实完整链另验；完整统一设置、统计前端/旧授权UI、B1/B3后续流程仍有开放项。不改中央ACP队列签收，不把已实现的单据查询/统计后端重做。只读一期预检仍readyForReview=false、releaseAuthorized=false，未部署。


**2026-10-17色卡中文表头**：列表及真实/评审XLSX六列统一为色卡编号、品名、成分、克重、门幅、二维码。只改展示标题，保留一行一卡、编号前导0、gsm/mm/cm、空值和二维码原始文本。专项先5个旧表头断言RED，更新后39/39通过；Edge33项/17截图及实际下载XLSX读取通过。下载脚本由仅等文件出现改为等Browser.downloadProgress completed，避免读到0字节临时文件；不是导出业务数据修复。全量1029项1028通过/1跳过，lint/build通过。当前需求/总览及同题复盘同步，未部署。


**2026-10-16去掉产品维护页“允许供样”控件**：现有ProductEditorV2共用新增/编辑页已移除该控件；保留启用状态与底层供样字段，新建仍默认可供样，编辑保存沿用原状态（包括false），不重置历史值、不改扫码过滤。既有测试观察RED→GREEN，编辑专项16/16、Edge72项/28截图通过；最终全量1029项（1028通过、1按设计跳过、0失败），串行lint/build通过；52985预览已重建。需求6.3同步，证据及保留判定在[同题复盘](../retrospectives/development/2026-10-13-p4-edge-browser-review.md#2026-10-16去掉允许供样控件)。仅本机独立React，未接正式App或操作数据库/COS，未部署。


**2026-10-16产品图Tab与按需原图：独立React已实现并本机验证**。用户费用调研后批准实施；现有产品图弹窗改为面料大图/面料细节图/效果图三个Tab，读取original，仅当前类别申请原图链接，未查看类别不预取，已加载原图在当前窗口保留DOM和URL，切回不重复请求；关闭清理本次缓存。失败可重试；角色切换/关闭导致的迟到请求被取消并忽略，不引入全局或持久化私有URL缓存。花型库与产品库列表仍读thumbnail，点击按所选配色资产ID请求original，缺图不可点；本机以320px缩略图和1440px原图实际核验，未用放大缩略图冒充原图。独立审查发现焦点圈遗漏Tab面板，浏览器RED→GREEN修复；专项39/39及真实Edge71项/30截图通过，全量1029项（1028通过、1跳过、0失败），串行lint/build通过。原费用假设保留在[图片运维调研](../operations/image-asset-operations.md#2026-10-16产品图原图访问费用调研)；细节及保留判定见[同题复盘](../retrospectives/development/2026-10-13-p4-edge-browser-review.md#2026-10-16产品图tab与按需原图)。52985独立预览已重建；示例为明确标注的本地内存图片，真实COS传输/权限/费用与正式App接线未验收，未部署。

**2026-10-16花型编辑与列表精简（用户追加修订）**：复用现有组件，标题“编辑花型”、列表“花型”及“编辑花型及配色”；配色行支持实际文件上传/替换/删除草稿，保存配色统一提交图片关联+备注+启停，取消保留原关联。颜色标签移至花型级，与题材同级，花型列表各占一列，版本表改六列。归档但已关联颜色连续保存不丢失，原版本颜色关联保留作为迁移依据。产品列表暂去掉题材/颜色两列及筛选，保留货号/品名AND和启停、图片数量后产品备注，共10列；花型库去掉独立配色序号筛选，保留编号搜索、题材/颜色及启停。专项76/76、真实Edge内存预览55项/28截图及关联功能回归30项/17截图通过；全量1029项（1028通过、1按设计跳过、0失败），串行lint/build通过。评审预览已重建；当前需求对应4.2、6、8.2、AC-25/56～61/72，证据和保留判定见[同题UI复盘](../retrospectives/development/2026-10-13-p4-edge-browser-review.md#2026-10-16花型编辑与列表精简)。

**开放边界**：本次图片浏览器验证使用真实File和内存资产，后台图片引用事务通过SQL替身；正式V2上传授权/签名/COS、真实MySQL并发及回收、App/server挂接、人工视觉接受仍未验收。花型颜色改为现有母版关联表的color维度，不执行真实DDL/DML；旧版本颜色关联未删除，正式切流前须明确花型级合并/冲突/超过10项及历史空值处理并另行验证。未部署。

**2026-10-16用户指定三处UI修订**：在现有组件内修改母版列表（题材标签独立列）、新增面料（克重单位默认gsm，空克重仍保存NULL，已有mm/空值不追改）及新增色卡（成功提示后自动关闭弹窗，失败仍保留）。未另建替代页面；三组件专项50/50、浏览器30项（含六列XLSX/QR和退役重建）通过，色卡闭窗已实际观察RED→GREEN；最终全量1025项（1024通过、1按设计跳过、0失败），完整lint/build通过。质量检查及保留判定见[既有UI复盘新增段](../retrospectives/development/2026-10-13-p4-edge-browser-review.md#2026-10-16三处现有组件修订)。独立React评审、本机验证与正式App/真实数据库/部署继续分别登记。

**2026-10-16 QUERY-01～03查询页增量**：新增`V2DocumentBrowser`及请求model，独立React评审入口`product-master-v2-review.html?view=documents`提供客户/货号/色号/品名/类型/日期/结清组合筛选、服务端分页、命中明细展开及分页、全部命中行合计，并复用现有编辑与打印预览。补充`/documents/:id/matching-items`，同一明细AND匹配、header/COUNT/明细页均校验服务端owner；列表改为日期倒序，结清过滤排除定金，样布行计1匹。修正已有编辑/打印接口URL重复`documents`，保持正式入口未切换。本机专项44/44、桌面/390px浏览器16项通过；独立审查发现的分页P2已观察RED→GREEN修复；最终全量1023项（1022通过、1按设计跳过、0失败），完整lint/build通过。证据见[复盘](../retrospectives/development/2026-10-16-document-query.md)。**仅隔离内存演示与本机测试，用户UI接受、真实MySQL/性能、正式账号/App及部署仍开放；未派发ACP或伪造中央队列签收**。

**2026-10-16 STATS-01～02后端增量**：现有`GET /api/v2/documents/stats`增加`topProducts`和`recentOrders`，分别按已存单据品名归并米数取Top5、按开单日期及ID倒序取最近4单；三类单据参与品名米数排名，定金合同额/预收不进入既有综合金额汇总。三部分复用同一服务端owner/日期谓词，业务员限本人，管理员全公司，未开放客户端owner参数。已观察RED→GREEN，专项及统一HTTP **43/43**，本机全量 **1009项：1008通过、1按设计跳过、0失败**，独立只读代码审查未发现可操作问题。完整类型/构建检查另见[复盘](../retrospectives/development/2026-10-16-order-statistics.md)。**未接旧StatsDashboard/正式App，未操作真实MySQL或部署；浏览器交互、真库聚合/性能及一期Gate仍开放**。本轮为单主Agent本机实现加只读审查，未派发ACP或改写中央队列的ACP签收状态。

**2026-10-15 SCAN-01窄切片**：跨模块Orchestrator通过最新需求队列向独立ACP实际派发`scan-admin-v2`，Agent正常终态、受控精确两文件合并，后端`persistSampleCardScan`允许admin/sales在具备当前登录及样品会话`can_manage=1`时扫码，保留QR秘密和停用/撤销/引用安全。主项目专项**30/30**，全量**1004项1003通过/1按设计跳过/0失败**，完整lint/build通过。需求文档于派发后更新，队列曾拒绝旧来源直接签收；现有`SCAN-01`最新语义经过明确独立复核、旧/新哈希双留存且`scan-admin-v2=reviewed`。**未验证B2真实数据库/实卡QR/UAT及正式应用入口**；一期No-Go。详见[跨模块协作闭环](../project/Fabric-Multi-Agent-Orchestrator-V2.md)。

**2026-10-15 最新 QUERY-01～03 / STATS-01～02 后端增量（本轮）**：已在`server/order-v2/orderQueries.ts`按[项目需求总览](../project/项目需求总览.md#query)增加客户、货号、色号、品名、结清筛选，三个明细条件用**同一条 order_items 的 EXISTS**判定，不把不同明细行拼成命中；分页与COUNT使用相同服务端owner范围。新增`/api/v2/documents/matching-totals`聚合**所有满足条件的明细**的米数/金额及销售分匹JSON条数，联合查询仍必须以当前登录账号作用域查询；组合汇总排除定金单合同额和预收。原`/documents/stats`保持基础总数/米数/金额键，同时增加sample/bulk/deposit分类，综合米数/金额排除定金合同、定金合同金额单独命名`contractAmount`，不把百分比当收款。**隔离HTTP/SQL替身专项8/8通过，本轮全量999项998通过/1按设计跳过/0失败，lint/build通过。** 这仍是**独立V2后端**，旧`DocumentList/StatsDashboard`仍未接此API；命中明细展开、Top 5及最近4单/前端分页表现、真实MySQL执行计划和P95、正式server/App集成仍未通过业务验收。**一期 No-Go，未操作真实数据库/COS或部署**。

**2026-10-15角色权限简化：P2/P3/P5服务端已按新规则整改并本机测试通过，正式环境仍未验。** 现行差异只看[项目需求总览2.1](../project/项目需求总览.md#roles)：仅账号新增、本人/全部单据归属与管理员手工开单有角色区别，其余业务操作共用。`policy/sessions`、三库与共享标签、P5重复面料更新和统一HTTP均取消旧双授权限制，仍保留有效登录/停用账号/单据归属/引用并发等防护。**旧授权列的成员管理UI/DTO仍需清理，B2/B3及真实账号/实库/扫码仍需按新规则做完整回归，不能视为正式验收。**

**统一开单设置：P6已完成独立V2打印模型/Excel接口的当前公司名、地址、电话与条款切片，其余待验。** 已存单据无论有无历史公司快照，`print-model`与`export.xlsx`都读取当前`company_config`，产品规格/价格及本单业务字段继续冻结；配置缺失安全失败。**正式React/旧版应用/JSON/PNG展示、Logo与收款码、签字设置、真实MySQL和纸张打印仍未全部改造或验收**。现行完整业务规则见[项目需求总览2.2](../project/项目需求总览.md#output)。

**一期正式交付：No-Go。** 独立V2模块和评审页已有实现，正式`src/App.tsx/server.ts`仍是旧入口；真实迁移/备份、权限、COS、完整业务E2E及上线未验。细项见[交付门槛](product-master-v2-phase1-delivery-readiness.md)。一期交付不被二期B1～B3阻塞，两期独立验收。

**本会话已确认：AC-84人工补选UI接受。** 停用产品及关联停用项不展示，暂不供样独立禁选；撤销/恢复授权等可见模拟按钮已移除。可选V2会话适配和真实本机HTTP＋内存SQL替身已做定向验证，未正式接线，未连接MySQL。

**本轮 P1/P7 + ACP效率计量（2026-10-15）**：ACP Agent A 完成AC-71永久递增配色号的只读迁移前快照校验（30/30专项），总控完成P7正式入口的TypeScript语法树检查（假代码不能当挂载）。主项目最新全量**962项961通过/1按设计跳过/0失败**，完整lint/build通过；真实迁移、备份回滚和正式接线仍未完成，因此一期**No-Go**。ACP实际计量见[手册](product-master-v2-agent-context-handbook.md#持续衡量-acp-收益本轮开始强制2026-10-15)；首批是延迟开始的部分观测，不能推导加速率。

**最新 P1/P7 增量（2026-10-15）**：ACP A开发AC-71迁移锁/备份/回滚离线计划，终态`cancelled`；总控独立验收23/23并经三方SHA256按两文件白名单接管，不能记作ACP正常完成。P7验收证据增加SHA256内容绑定，8/8专项通过；Windows符号链接创建无权限，该分支在本机未实际测试。本次主项目全量**985项984通过/1按设计跳过/0失败**，lint/build通过。真实迁移/备份、UI/业务E2E仍未做，因此一期**No-Go**。详情见[ACP实测记录](../maintenance/2026-10-15-ACP-协作闭环.md)与[交付门槛](product-master-v2-phase1-delivery-readiness.md)。

**本轮 P7 独立沙箱 HTTP 启动入口（2026-10-15）**：新增`v2SandboxPreview.ts`、独立CLI `scripts/run-v2-sandbox-preview.ts` 与本机真实HTTP+内存SQL专项测试。仅在明确沙箱确认值、`NODE_ENV=development`、监听/数据库代理固定127.0.0.1、独立预置实例UUID及隔离库名一致时才允许启动；V2每次租借连接再检查固定身份，禁止绕过旧`getMySQLPool()`的旧表自动建表/JSON后备。默认不启动，正式`server.ts`/`App.tsx`均未切换。**尚未获准运行真实MySQL写入或UI接线，一期仍No-Go**。专项5/5、主项目全量**990项989通过/1按设计跳过/0失败**，完整lint/build、知识库68份文档515条链接通过。详见[沙箱启动与后续Gate](product-master-v2-p7-sandbox-preview.md)。（本段为先前P7时点状态；后续P2/P3/P5和P6局部整改及验收见本页最新增量。B2/B3及统一设置全链路仍开放。）

**2026-10-15最新 P2/P5/P6 业务整改验收**：已按确认规则更新P2两角色权限、P3共享标签治理、P5两角色面料重复品号明确确认后的更新，以及P6当前公司配置打印/Excel。**本机全量994项993通过、1项按设计跳过、0失败；`npm.cmd run lint`及`npm.cmd run build`均通过**（最后加强P5旧授权位测试另有11/11专项通过）。Codex ACP D派发因额度限制立即`failed/usageLimitExceeded`，未实际写代码，效率账本记`blocked`；源码由总控完成，**不能计作ACP成功或提速**。真实生产、正式App、完整开单统一设置和一期全部Gate仍未完成，状态**No-Go**。

## 一期工作包

| 编号 | 设计/批准 | 已编码及已有证据 | 尚待验收/上线 |
|---|---|---|---|
| P0-1 | 一期业务范围确认 | 唯一需求v1.50 | 技术与业务环境各自验收 |
| P0-2 | 远程只读审计完成 | 2026-10-12历史MySQL8.0.46盘点，见[原审计](product-master-v2-remote-db-audit.md) | 迁移当天重新核对，旧计数不可继承 |
| P0-3 | V2原生空库/保护历史确认 | 新旧领域分离 | 旧产品退出须另经备份、引用及切流验收 |
| P0-4 | Stitch七页UI | **全部业务决策已确认**：D-01永久递增不复用，D-02七页及12列备注，D-03按v1.47仅xlsx；[批准登记](product-master-v2-stitch-design-review.md) | React真实应用验收独立，Stitch按需使用 |
| P0-5 | SQL/DTO/事务边界确定 | 独立契约及部分schema Gate | 正式迁移与装配 |
| P1-A/B/C | 原生表/计数/模式/版本 | [结构与迁移](product-master-v2-p1c2-schema-versioning.md)，有2026-10-12隔离MySQL历史证据 | 生产迁移器、锁、备份/回滚、启动 |
| P1-D | owner/稳定行身份保护 | [历史单据技术说明](product-master-v2-p1d2-lines.md)，隔离实库演练 | 正式加法迁移、旧PUT切换及历史兼容 |
| P1-E | 旧产品受控退出 | 未执行数据清退 | 正式切换后另行授权；保护图片、单据、库存/公司 |
| P2 | 两角色简化规则2026-10-15确认，不再设双授权开关 | 2026-10-17成员DTO及/access/me已移除旧开关；服务端两角色业务权限已按新规则本机回归；[登录/成员](product-master-v2-p2-access-foundation.md)、[旧入口门禁](product-master-v2-p2-legacy-cutover-gate.md)历史证据保留 | 正式账户/登录及成员UI、真实跨owner权限、兼容旧列迁移及新旧原子切流 |
| P3 | 三库/标签/三类图规则确认 | [三库与实库专题](product-master-v2-p3-real-mysql-gate.md)，部分并发/查询隔离证据 | 真实COS、正式写链及网络/浏览器性能 |
| P4 | 七页设计及颜色一次保存确认 | [三库React与浏览器](product-master-v2-p4-browser-qa.md)，本机Edge＋内存API | 正式账户/受控图片/键盘触屏/人工视觉 |
| P5 | 仅xlsx；两角色均可导入，重复项均须二次确认 | 两角色更新/明确差异确认已按新规则本机整改，保留并发指纹、一次凭证及逐行事务；[导入专题](product-master-v2-p5-browser-and-mysql-gate.md)记录历史/当前边界 | 实库写链与并发冲突、真实角色账号及正式UI |
| P6 | 三单据产品关联/资料冻结，统一开单设置修改后全部单据用最新值 | [选品→保存→计算→输出](product-master-v2-p6-document-write-read.md)，独立API和部分历史实库证据，不自动覆盖本次设置更新规则 | 开单设置实时引用及三类单据多输出一致性整改/验收；正式单据/库存/媒体接线 |
| P7 | 正式交付门槛独立 | [统一HTTP和数据库目标](product-master-v2-p7-local-http-assembly.md)，模拟状态流/空库只读 | 真实授权业务写入、并发/COS/E2E、P95≤1秒、恢复与上线 |

尚未实现.xls，且v1.47已取消；不恢复旧双格式方案。

## 二期工作包

| 编号 | 已确认/已实现 | UI接受 | 未完成Gate |
|---|---|---|---|
| B1 花型分享 | 受限投影/哈希只读映射、稳定HMAC签发事务与独立私有POST、可恢复的停用时“暂不可用”公开GET合同；均未挂载；持令牌不自动授权 | 仅伪SQL/本机HTTP，真实客户H5未交付 | 实库唯一映射/秘钥托管、发布授权、公开H5/受控图片、正式接线与实际签发回归 |
| B2 色卡/扫码 | 单母版+面料、稳定原码/文本xlsx、退役重建、独立供样/重印CAS；SCAN-01已允许活跃登录admin/sales并保留显式会话授权及实时复核；[技术说明](product-master-v2-b2-5h-scan-lock-order.md) | v1.48色卡UI已确认；模拟Edge与真实账号/实机证据分开 | 存量迁移、真库并发/回滚、正式双角色账号/COS/实机扫码及正式接线 |
| B3 选样/人工补选 | v1.50最新资料；移除/重扫恢复；2026-10-17基于色卡补选与人工卡来源、read/remove双角色均已本机整改；寄样/跟进新增未执行DDL四表设计、受权事务服务及私有HTTP、只读schema契约，均未挂正式系统；[当前说明](product-master-v2-b3-history-ui-review.md) | 色卡搜索/展开默认全选与紧凑缩略图已于2026-10-17获用户确认；不新增授权管理按钮 | 正式App/API、现存schema及人工卡审计迁移、真MySQL/并发/账号、寄样及跟进业务页面/实库持久化、手机扫码 |

## 验证范围与下一步

| 证据 | 适用范围 |
|---|---|
| 2026-10-15此前主控全量929项928通过/1设计跳过、lint/build通过 | 见[原交付复盘](../retrospectives/development/2026-10-15-phase1-b1-release-review.md)，不覆盖后来AC-84源码 |
| 本会话AC-84定向21/21、局部tsc通过，实际浏览器交互 | 仅该切片及本机真实HTTP＋内存SQL替身；完整项目回归仍由总控执行 |
| 本次文档整理与ACP聚焦派发优化 | 阶段导航及角色文件检查通过；新增单AC intake验证AC归属、精确编辑/读取路径和当前SHA256，TDD专项通过，示例简报缩短但不代表开发耗时同等降低。无业务源码、真库或线上验收变更 |

下一开发主线依[一期交付门槛](product-master-v2-phase1-delivery-readiness.md)：生产安全装配设计及离线启动Gate→获准的隔离试点→真实业务验收→独立上线批准。新Agent必须用最新源码哈希基线、隔离Project及三方合并链；旧432/443/448/489快照都只证明生成时点，见[协作手册](product-master-v2-agent-context-handbook.md)。

客户花型分享与业务员实体卡扫码分开；B3实时资料与三单据冻结分开。本次没有迁移/清理客户数据、COS操作、Git提交/推送或部署。
