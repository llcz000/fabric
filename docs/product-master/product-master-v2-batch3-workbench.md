# 第三批：V2 一期七页可写业务联调入口与统一公司设置

> 2026-10-17；**默认关闭，仅允许经独立授权的127.0.0.1隔离数据库，不是旧Fabric正式入口**。
> 本文件记录可执行代码路径，不冒充真实MySQL、COS或业务验收。

## 已接通业务路径

- 花型库列表 → 新建花型编号 → 花型配色编辑、题材/颜色标签、版本启停、图片上传/替换草稿及保存。
- 面料库列表 → 新增/修改/删除（引用受后端约束）以及单独的 XLSX 导入预览/确认。
- 产品库列表 → 新增/编辑/确认删除，绑定花型配色及面料，图片排序/替换/删除草稿及保存。
- 三种单据使用同一个 V2 产品选择器，从产品库选择后支持V2单据保存和回读。
- 管理员独立统一公司设置表单：公司名、品牌字标、地址、电话、两种条款、两种签字文案；GET/PATCH读写当前值，历史单据打印读取最新设置，Logo/微信/支付宝在独立媒体运行时启用后受控上传及关联。

七个业务交互入口由 src/product-master-v2-workbench/navigation.ts 和 main.tsx 装配；花型编辑/产品编辑从列表的编辑/新增打开真正的React组件。不得混同以前的7个只读沙箱tab。

## 仅在正式批准隔离写入后启动

1. 先由负责人批准 fabric_v2_test_* 专库，核实固定 @@server_uuid、独立账号、全库备份、恢复演练和已批准的一期表结构。**本轮未对任何真实MySQL运行DDL、导入、写入或真实媒体。**
2. 后端执行 npx tsx scripts/run-v2-phase1-business-preview.ts，显式设置 NODE_ENV=development、HOST=127.0.0.1、PORT=3456、FABRIC_V2_SANDBOX_PREVIEW=I_ACKNOWLEDGE_SANDBOX、FABRIC_V2_SANDBOX_DATABASE=fabric_v2_test_批准标识、FABRIC_V2_SANDBOX_EXPECTED_UUID=独立已核验UUID、DB_HOST=127.0.0.1、DB_PORT、DB_DATABASE（等于沙箱名）、DB_USER、DB_PASSWORD。
3. 前端显式设置 FABRIC_V2_WRITE_FRONTEND=I_ACKNOWLEDGE_V2_WRITE_SANDBOX，运行 npx vite --config scripts/vite-v2-workbench.config.ts，访问 http://127.0.0.1:4466/product-master-v2-workbench.html。仅loopback且仅代理/api/v2。
4. 原只读沙箱4455以及原session.request()仍只允许GET；写入使用独立工作台session.requestWrite()与V2 Bearer，不调用旧系统token或任何原始/api/orders。
5. V2 schema manifest新增 v2_company_print_labels 专表用于两种签字文案。正式创建前另走隔离DDL评审、备份及批准，任何应用启动都不会自动迁移生产。
6. 图片默认不可用，只有明确注入真实已授权的 imageAssets / companyImages 沙箱运行时后才能显示上传入口；图片及共享引用的真实COS联调待独立批准并验收。

## 交付边界

本批仅源代码、独立本机测试及GitHub CI，基线代码可合master，但旧生产 server.ts、src/App.tsx、生产库和部署均不变。完整真实MySQL/COS、三组图片、历史单据、正式七页人工签收、备份恢复、上线许可仍为No-Go；不可把源码主线合并等同正式上线。
