# 2026-10-16：V2经营统计品名Top5与最近4单

> 2026-10-24 目录整理：本文部分历史路径对应的临时文件、已退役源码副本或旧发布证据已完整迁至仓库外；原路径作为历史定位保留，按[归档恢复索引](../../maintenance/2026-10-24-workspace-archives.json)中的范围和逐文件 SHA256 查找原件。未完成的业务 Gate 仍按当前进度保留。

> 文档定位：研发与验收复盘。当前状态仅见[项目进度](../../project/项目现状.md)及[V2模块进度](../../product-master/product-master-v2-progress.md)；业务依据为[STATS-01～02](../../project/项目需求总览.md#inventory)。

- 日期与范围：2026-10-16，中央任务`stats-api-v2`对应的独立V2后端切片；未派发ACP，不改其占位/签收记录。
- 状态：本机编码、SQL契约/真实本机HTTP测试、独立只读代码审查、完整类型及构建检查已通过；真实数据库及UI未验。
- 交付物：`server/order-v2/orderQueries.ts`、同名测试、`server/product-master/v2CatalogAssembly.test.ts`；[接口合同](../../product-master/product-master-v2-p6-document-write-read.md#经营统计接口补充2026-10-16)。

## 问题与触发条件

分类汇总接口已有实现，但未返回需求中的品名米数Top5与最近4张可导航单据。旧大盘对浏览器提供的单据数组自行聚合，不代表V2服务端owner隔离已接入。

## 根因与证据

`statsScopedOrders`原先只执行分类SUM，没有分组排名或最近单据查询。新增契约测试后实际RED：13项中7通过、6失败，缺失返回字段及同范围子查询。实现期间旧汇总测试把“最后一条SQL”误当唯一汇总，新查询让该断言失败；已明确识别各查询而非放宽业务条件。统一HTTP的严格SQL替身也拒绝了新增查询形状（503），仅补充这两条确切只读查询合同。

专项审查另补一条归并约束并观察RED：不能用可能与物理列同名的`product_name`别名作为GROUP BY，改用完整`COALESCE(NULLIF(TRIM(i.product_name),''),'未命名的面料')`表达式。该测试约束生成SQL，未声称复现过真实MySQL分组行为。

## 处理与结果

- 复用同一`where(actor,filters)`生成汇总、排名及最近单据的owner/日期条件，日期参数保持绑定；不接收客户端owner。
- 按保存的明细品名归组，三类单据按米数参与排名；不连接当前产品库。数据库固定取5组和4张单据，分别稳定以米数/品名、开单日期/ID排序。
- 保持原分类和综合汇总键；新增`topProducts`及`recentOrders`，ID保持字符串，DECIMAL返回值转数值，非法/负数拒绝整份报告；不增加定金金额汇总。
- 本机真实HTTP覆盖sales/admin、日期范围、未登录/登录失效、owner注入与未知参数拒绝、no-store和内部错误安全503；统一装配测试额外核对三条业务查询均受sales owner/日期约束。
- 独立只读审查未发现可操作缺陷，未修改文件或访问数据库；明确指出SQL替身不执行真实聚合/排序，驱动BIGINT/日期解码、生产性能仍待验。

## 验证

| 日期 / 环境 | 实际命令或检查 | 结果与证据 |
|---|---|---|
| 2026-10-16 / 本机Node，SQL契约替身 | `node scripts/run-ts-tests.mjs server/order-v2/orderQueries.test.ts server/product-master/v2CatalogAssembly.test.ts` | 43/43通过，包含真实127.0.0.1 HTTP；未连接MySQL |
| 同上 | `node scripts/run-ts-tests.mjs` | 1009项，1008通过、1按设计跳过、0失败 |
| 同上 | `npm.cmd run lint` / `npm.cmd run build` | 均退出0；Vite前端与esbuild服务端构建成功 |
| 同上 | `node scripts/check-fabric-v2-doc-navigation.mjs` / `git diff --check` | 71份文档、559条本地链接通过；已有跟踪文件差异无空白错误。任务文件另做逐文件空白检查 |

当次基线与RED/GREEN/回归日志在本机`tmp/stats-api-v2-20261016/`；这是临时过程证据，不是数据库备份或正式归档备份。

## 可复用经验与回流

报告包含多个SQL查询时，每条查询都要复用可信服务端范围，测试既检查接口返回也检查每条参数；替身对新查询应显式识别并对未知形状拒绝。现有[开发验证规范](../../development/开发与验证规范.md)已覆盖SQL替身与串行质量检查，无需新增重复规范。

## 剩余问题与待验证实验

旧`StatsDashboard`未接V2统计，排名点击/最近单据跨账号权限、正式V2账号及App/server入口仍待实现/验收；两处均价已于2026-10-17在旧组件中移除。真实MySQL分组/排序及驱动类型处理、目标数据量性能尚未测试。本轮没有生产DDL/DML、COS、服务重启、Git提交推送或部署；一期仍No-Go。

## 2026-10-17 旧大盘局部展示语义修订（STATS-01，非正式V2接线）

- **触发与根因**：`src/components/StatsDashboard.tsx`仍显示两处无需求依据的“平均单价”；最近4单按`createdAt`而非开单日期`date`排序；定金分类卡片把`totalAmount`（合同金额）误标成“定金金额”。当前`src/App.tsx`仍渲染旧组件且向它传本地单据数组，不是带owner隔离的V2统计接口。
- **修改**：仅调整旧`StatsDashboard.tsx`及`StatsDashboard.test.ts`。删除两处均价与未用总量变量；最近四张先按开单日期倒序，日期相同用创建时间决胜；定金分类的合同总额仅单独标为“合同金额”，没有并入样布/销售合计。未动独立`server/order-v2/`统计服务、正式路由或任何数据。
- **RED→GREEN**：隔离Git工作树及主工作树中均观察到3项行为测试修订前失败，应用最小修复后3/3通过。初次全量检查发现项目`run-ts-tests.mjs`仅收集`.test.ts`，最初`.test.tsx`未进入全量；已将测试改名为`.test.ts`并复核项目默认runner专项3/3；随后`npm.cmd run test:unit`运行1049项（1048通过、1按设计跳过、0失败），`npm.cmd run lint`与`npm.cmd run build`均退出0，日志为`tmp/stats-20261017-final-*`。文档导航76份/596个链接通过，`git diff --check`退出0；不继承旧测试数字。
- **权限、历史与剩余Gate**：测试为React静态渲染语义回归，不证明真实角色、数据库、浏览器点击或端到端性能；STATS-02统一服务端owner作用域、排名关联导航、正式账号/App切流、真实MySQL聚合与P95仍未验收。未操作客户数据、COS、生产迁移、部署、Git commit/push。
- **文档治理判定**：本篇及对应接口合同**保留**（唯一过程证据仍有未闭合Gate）；历史文章归档候选**不适用**，未执行归档/删除。唯一业务要求仍是`docs/project/项目需求总览.md`，当前实现状态唯一见`docs/project/项目现状.md`；本篇不是第二份状态表。既有`docs/retrospectives/README.md`已索引本专题，无需新增重复入口。

## 闭环

- [x] 复盘索引已更新。
- [x] 复用已有开发/验证规范，无需重复回流。
- [x] 最终文档导航与类型/构建检查结果已回填。

## 2026-10-17 V2 经营大盘/查询/权限 DTO 联动（独立切片）

- **触发与根因**：既有V2 `GET /api/v2/documents/stats`虽已实现server owner/日期范围、Top5及最近四单，旧`StatsDashboard`仍自聚合浏览器数组。现有隔离V2查询页无法接受排名预填条件，成员API仍接受/下发2026-10-15已废弃的两个独立授权DTO字段。
- **处理**：新增`documentStatsModel`（日期参数、严格形状、bigint字符串、权限拒绝即清空）和`V2DocumentStats`（分类/合同金额/Top5/最近4单），支持排名按品名进入V2查询、最近单据按服务端ID进入V2受权打印预览；`?view=stats`只挂隔离评审页。`members.ts/memberRoutes.ts/routes.ts`移除成员新增/修改/列表以及`/access/me`的旧授权DTO字段；注册写旧表兼容列1/1但不进行DDL，管理员新增账号、最后管理员保护及停用撤销会话仍保留。
- **RED→GREEN**：成员管理新增行为先2项失败，后10/10通过；`/access/me`旧字段断言先失败，后与装配HTTP合计47/47通过。V2统计/预填查询先缺失失败，统计+查询定向11/11通过，隔离评审模拟排名/owner/日期/导航先3项失败后5/5通过。最终全量`npm.cmd run test:unit`1062项（1061通过、1按设计跳过、0失败）；`npm.cmd run lint`及`npm.cmd run build`均退出0，文档导航76份/596条链接通过。初次串行PowerShell包装命令在单测完成后报告OutOfMemory，已分别重启lint/build直接命令并各以退出0验证；不继承历史数量。
- **约束/未完成Gate**：未把评审模拟当真实认证验收；正式`server.ts`/`App.tsx`仍挂旧应用；旧成员DB列保留待安全迁移，成员管理真实UI与真实账号/历史单归属、MySQL分组/性能、浏览器交互还需核实。不存在真正的跨账号授权参数入口；不能用本机字符串角色选择代替真实服务端鉴权。
- **文档治理**：本篇**保留**并维护原接口证据，当前唯一项目状态仍在`docs/project/项目现状.md`及V2进度；归档候选**不适用**。无迁移/部署、无客户数据操作、无Git commit/push或旧资料删除。

## 本任务历史文档归档判定

- **保留**：本篇及`docs/product-master/product-master-v2-p6-document-write-read.md`，分别保留当前统计切片证据与接口/权限合同；正式UI和真库Gate尚未闭合。
- **保留**：`docs/retrospectives/development/2026-10-13-fabric-crud-tests.md`，其SQL替身与真实DB的区分仍适用，未被本篇替代。
- **不适用**：本轮没有被正式替代且具备归档条件的旧过程文档，无归档候选、移动或删除操作；未运行归档移动前Gate。
- **当前唯一状态**：项目范围用`docs/project/项目现状.md`，V2模块补充用`docs/product-master/product-master-v2-progress.md`；本篇仅保留过程和验收证据。
