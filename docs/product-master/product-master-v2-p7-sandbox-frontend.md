# P7/P4 独立 V2 沙箱账号与只读三库浏览器接线

日期：2026-10-17。**范围：离线验收/非生产/非正式七页签收。** 需要真实沙箱 MySQL 时须独立批准，本文没有授权启动或写库。

## 已实现

独立V2后端已有 [沙箱preview](product-master-v2-p7-sandbox-preview.md)：server/product-master/v2SandboxPreview.ts 需要固定沙箱数据库名、UUID与独立认证，默认不自动运行。原有 product-master-v2-review.html 是内存mock，不是实际登录/读取真实业务。

本轮补充非默认入口 product-master-v2-sandbox.html，引用 src/product-master-v2-sandbox/main.tsx 与 sandboxSession.ts。具备独立V2账号登录、服务端 /api/v2/access/me 二次验证、花型/面料/产品**只读三库浏览**及退出。原旧 server.ts / src/App.tsx / vite.config.ts 均未导入或启用该页面；没有自动发起连接。产品媒体无专用授权解析器时使用安全占位，不请求旧图像资产接口。

安全边界：仅接受完整的 http://127.0.0.1:4455 同源、不接受localhost/公网/IPv6或非HTTP；仅允许同源 /api/v2/* GET，拒绝外部路径、旧 /api、传入Cookie/Authorization覆盖、写入请求、未授权重定向；登录/注销POST仅由私有客户端发往V2专用 access 路径。Bearer仅内存存在，不保存localStorage、sessionStorage或持久Cookie；API401自动清空会话，已退出时迟到的登录响应不得复活身份。浏览器只读操作不等于后端真实账号/事务权限已经验收。

Vite专属 scripts/vite-v2-sandbox.config.ts 须显式 FABRIC_V2_SANDBOX_FRONTEND=I_ACKNOWLEDGE_SANDBOX，仅绑定127.0.0.1:4455与严格端口，只代理 /api/v2 到127.0.0.1:3456的独立沙箱后端。默认npm run build不包含此页面。单独编译只写到被Git忽略的 tmp/v2-sandbox-frontend-dist；GitHub CI运行守卫测试与单独编译，但绝不上传这一沙箱UI产物或部署。

## 2026-10-17 新增四个只读业务页面

原版沙箱只覆盖花型/面料/产品，本轮在同一独立V2登录会话基础上增加色卡库、客户选样单查询、三类单据查询和经营大盘四个GET-only页面。所有读取使用真实V2 API合同，服务端继续校验当前账号及相应的订单owner或选样单grant，而不是本地mock。

- 色卡库：请求 /api/v2/sample-cards，搜索分页并展示编号、面料、启用及需重印状态；复用严格的色卡数据合同，禁制卡/导出/撤销/重印确认。
- 客户选样：必须输入合法正整数sessionId后才请求 /api/v2/customer-samples/sessions/:sessionId；服务端拒绝未获grant，前端严格校验返回的ID、产品明细、色卡来源、分页，拒绝超长/注入/异常数据，不提供扫码与修改。
- 单据查询：复用业务已有的createDocumentSearchController，同时调用 /api/v2/documents及/matching-totals，显示当前账号范围内单据、数量及匹配明细合计，含品名过滤和分页；没有编辑/打印/导出。
- 经营大盘：复用loadDocumentStats GET接口和响应结构校验，显示当前账号统计、Top5品名及最近四单；排名点击联动前述只读单据筛选，最近单据仅文字展示。

四页由独立 readOnlyPages.tsx 提供，连同原三个目录形成7个只读sandbox tab。**7个tab不等于批准P4的正式七页业务功能**：真实UI编辑/媒体/三单据打印及Excel导入、正式App导航与上线仍有单独Gate。原花型/面料/产品组件新增allowExport=false可选能力，在本沙箱隐藏下载按钮，其它模块仍按原默认行为显示按钮。沙箱数据只在独立服务器和显式登录许可后可读，不使用旧App会话或本机mock，不访问真实MySQL/COS。

新增 readOnlyData.test.ts (4项)：色卡真实GET参数、选样ID和路径校验、损坏/重复资料拒绝及分页边界；readOnlyPages.test.ts (3项)：导航唯一7项、复用组件默认/沙箱禁导出对照、四新增只读页面无修改按钮。新增测试进入默认npm run test:unit和GitHub CI。

## 本轮可复现离线验证

1. 运行 node scripts/run-ts-tests.mjs src/product-master-v2-sandbox/sandboxSession.test.ts ：覆盖loopback/API限制、验证/me、会话安全、401撤销与并发注销等6项。
2. 运行 node --test scripts/check-v2-sandbox-front-config.test.mjs ：未授权配置必须拒绝，明确验证仅回环代理、只写tmp、正常主入口未引入沙箱。
3. 在命令所在终端单次设置FABRIC_V2_SANDBOX_FRONTEND=I_ACKNOWLEDGE_SANDBOX，然后运行 node node_modules/vite/bin/vite.js build --config scripts/vite-v2-sandbox.config.ts ：只做独立静态编译，不启动HTTP或DB。
4. 项目全量单测、四组TypeScript、正式构建、文档导航及GitHub Actions结果需单独核查，**不能因离线mock通过而宣布真实系统已联通**。

## 待批准的真实隔离库联调（本轮没有执行）

操作者须先核实单独的 fabric_v2_test_* MySQL沙箱、固定实际@@server_uuid、独立数据库账号和可恢复备份；不可使用生产库或旧账号。获得明确运行/测试许可后，按 [独立V2后端运行门禁](product-master-v2-p7-sandbox-preview.md) 启用 NODE_ENV=development、HOST=127.0.0.1、PORT=3456、DB_HOST=127.0.0.1及隔离DB_PORT/DB_DATABASE/DB_USER/DB_PASSWORD，且配置 FABRIC_V2_SANDBOX_PREVIEW=I_ACKNOWLEDGE_SANDBOX 和独立UUID，并由获准人员启动 scripts/run-v2-sandbox-preview.ts；**登录会写入隔离库会话行**。随后只在本机设置前端确认变量并运行 node node_modules/vite/bin/vite.js --config scripts/vite-v2-sandbox.config.ts，在 http://127.0.0.1:4455/product-master-v2-sandbox.html 使用专用测试账号核查登录、撤权、真实目录数据和退出。前端不会访问旧/api或自动产生写入业务数据的入口。

真实媒体授权上传、真实MySQL三库及角色隔离、正式七页UI、三单据及XLSX、P95性能、备份恢复和正式App装配仍缺P1–P7真实签收，发布继续No-Go。本记录保留作为安全联调手册，不作为已上线证据。
