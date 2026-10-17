# Fabric V2｜P2-3b 旧接口整体阻断闸门与迁移前置清单

> 文档定位：中间过程｜主要读者：当前任务的开发/评审、Agent。用途：查实现/计划、历史证据和未完成Gate；不是业务新需求。

> 2026-10-12。第9.3章三种单据权限延续[当前v1.43需求](product-master-v2-requirements.md)、[P6-5与本人订单范围](product-master-v2-p6-document-write-read.md)。**本轮完成了代码可启用、默认关闭的全旧路由拒绝闸门及独立MySQL8.0.46+V2身份整链演练。不是生产权限收口，也不是V2正式上线。**

## 实际编码

- 新建`server/access/legacyCutoverGuard.ts`：配置项`FABRIC_V2_LEGACY_ROUTE_MODE`仅支持`legacy`（**默认：保持旧行为不变**）或`deny_legacy`（**未来安全切流时才启用**）。无效/含空格/拼错配置直接阻止进程启动，不回退到不安全默认。
- `server.ts`在`const app=express()`后**第一条`app.use`**注册`createLegacyCutoverGuard`，严格早于`/uploads`、所有JSON解析/旧全局登录、产品图库挂载、订单、旧Excel、库存及后续catch-all。仅在显式`deny_legacy`时生效：
  - 只接受`GET/HEAD /api/health`、后续需要新V2会话认证的`/api/v2[/...]`命名空间、极少数明确的静态前端路径（`/`、`/index.html`、`/favicon.ico`、`/assets/<文件名>`）。
  - 拦截**全部其他 HTTP method/path**（包括旧`POST /api/login`、`GET/POST/PUT/DELETE /api/orders`、`/api/export_template/:id`、`/api/inventory/*`、`/api/products/*`及批删/导入导出、`/api/company`及图片、`/api/image-assets`、上传、`/uploads/*`、代理图片和未认识的旧API），统一返回**410 Gone**、`no-store`与`nosniff`；不会执行已注册的旧服务/旧JSON回退、不会受旧单一管理员token、cookie、伪装owner影响。
  - 不接受含`%`、反斜线、双斜线或`.`/`..`路径分段的歧义路径绕过；URL的普通query仍交由V2业务路由校验。严格匹配`/api/v2`边界，不放行`/api/v2evil`。
  - 此闸门**没有绕过V2独立鉴权**，V2登录用`createV2AccessRouter`持久账号密码与散列会话；每个V2读取/写入路由仍必须自己调用`requireV2Principal`、角色/owner判定。它只是在权限功能未知/暂缺时**关闭旧入口**，不是从旧token升级为新账号。
- 新建`server/access/legacyCutoverGuard.test.ts`4项：不启用时旧行为不变；显式拒绝时用本地Express实际HTTP模拟订单/Excel/库存/产品批删/图片/公司配置/旧登录并确认handler执行计数始终**0**；原始HTTP反斜线与百分号/traversal路径无法放行；读取**真实`server.ts`的所有直接`app.get/post/put/delete/patch`旧API声明**逐条HTTP检查为410；静态断言第一闸门在uploads和路由注册之前。
- 在固定测试脚本`scripts/test-v2-document-api-mysql.ts`添加**另一套独立Express应用的`deny_legacy`演练**：连接已建的MySQL8.0.46隔离库`fabric_v2_test_20261012_p6documents`，先装闸门再挂旧路径诱饵，再在`/api/v2/auth`挂真实`createV2AccessRouter`、`/api/v2`挂原V2订单路由。旧登录/订单/导出/库存/产品批删/公司/上传共7条路径均410且服务实现没执行，健康200，未登录或伪造token V2查询401，新V2账号重新登录成功，业务员只看本人3单、无owner旧单404，管理员可以看旧单，已保存的本人打印模型200。保留其他P6真实MySQL HTTP、产品引用禁删及Excel回归；每轮隔离数据清0。

## 安全阻断与实际代码边界

**切勿现在在正式机设置`FABRIC_V2_LEGACY_ROUTE_MODE=deny_legacy`**。正式`server.ts`虽然已放置`createLegacyCutoverGuard`，但**还没有挂载任何`/api/v2`持久登录、订单、三库、图片服务**，现有React`App.tsx`仍调用旧`/api/login`、旧`/api/orders`以及浏览器localStorage fallback。直接打开闸门只会造成旧App大面积410、无法正常开单和无法登录，**不代表V2启动成功**。本轮没有部署/重启/更新环境变量，默认旧运行流程完全保留。

正式启用的阻断前提应按顺序完成：
1. 完整只读审计`fabric_db`，最小备份（历史订单/所有共享资产/公司资料）、备份可恢复演练，旧实例停写窗口与回滚方案，P1 owner/line/display快照及V2用户/产品schema版本、MySQL FKs/CHECKs检验。
2. 代码原子切流：单独装配`/api/v2/auth`和受权的产品/面料/母版/订单/图片/公司/库存相关V2路由；旧`App.tsx`入口替换为V2登录+新端点，清除旧JSON/localStorage**作为业务数据兜底**，旧JWT/bearer/cookie不得视为V2用户。
3. 真实浏览器跨角色/公司图片/打印Excel/库存/导出、2千产品P95和权限负例验收；检查全部直接注册及间接`mountProductRouteAssembly`路由，在新切流闸门前被拦截，无遗漏的任意旧挂载。
4. 所有正式前置通过并获得单独授权后**才**配置`deny_legacy`、完成一站式V2路由切流，实施全接口黑盒拒绝/owner回归、实际订单保存回读、COS签名、健康检查和回退演练。任何测试失败都不得上线。

## 本轮与下一开发范围

已通过的单元/真实MySQL结果归档到[总进度](product-master-v2-progress.md)；`npm run lint/build`不代表真实浏览器可用。

**下一优先**：P2-3b后段V2完整装配（或新独立server入口）和`App.tsx`持久用户登录导航、P3三库及图片/库存/公司按角色真实服务端权限、原旧接口禁止旁路且不产生无主新订单。需要针对新V2模块补浏览器自动化与COS真实签名，不应把本轮410闸门当成这些缺失功能的代替。
