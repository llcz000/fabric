# 小规模业务状态与删除精简

2026-10-23；用户本会话确认简版并要求记录需求后继续开发。唯一业务依据：[项目需求总览 §2.3.1 LITE-01～06](../project/项目需求总览.md#catalog)。当前唯一状态入口：[项目现状](../project/项目现状.md)。本轮未授权生产部署。

## 已实现的候选

- 三库/配色编辑及关联弹窗移除启停控件、状态列、停用筛选和不可供样提示；面料8列、产品10列、配色编辑5列。编辑提交不携带旧状态字段，旧客户端写false被服务器拒绝。单个和批量新建默认可选样/开单，图片可后补。
- 旧字段保留用于存储兼容；登记迁移business-simplification统一未删除且父资料有效对象的旧状态。产品变化递增row_version；已删除资料、已撤销旧码与账号状态不复活。应用启动不执行DDL或批量改数据。
- 花型/配色、面料、产品、色卡、客户、选样、单据的明确删除使用同一事务追加最小business_delete_events；面料自动使色卡失效时同步留对应卡事件。只存类型、内部ID、编号/名称、操作人ID和时间，不存单据全文/明细快照。日志失败回滚删除。
- 单据继续实际删除主表、明细及客户关联，原统计随之更新；无作废、审批、回收站和恢复。其它资料继续沿用引用、历史、共享媒体与账号权限保护。
- 当前色卡分享已有固定地址、复制与查看入口，无人工撤回/期限管理，保留原实现。历史兼容分享组件未扩大范围。
- 实际浏览器发现原配色编辑每次render重置焦点，关闭后无法恢复到列表触发按钮；改为一次捕获、卸载恢复及latest close ref，且Esc不穿透上层原生dialog。回归有RED→GREEN。

## 验收证据

活动源：`.agent-workspaces/v2-quality-20261020`；证据目录：`artifacts/business-simplification-20261023/`。

| 检查 | 当前结果 |
|---|---|
| 需求 | 总览根/活动副本均补LITE-01～06；详细规格加覆盖指针，不把旧启停条款作为现行要求 |
| 定向测试 | 229项PASS，unit.log；含真实内存SQLite客户审计失败回滚、单据owner/admin删除、引用与共享图片保护、API旧状态拒绝、迁移身份/摘要/幂等/回滚及UI列/负载 |
| 类型与构建 | 定向tsc PASS（types.log）；客户端Vite PASS（build.log）；正式server.ts bundle PASS（backend-build.log）；不宣称全项目tsc/lint通过 |
| 发布器专项 | 19项PASS，release-tests.log；新增必要迁移拒绝门禁 |
| 专项浏览器 | Edge 13项PASS（browser-evidence.json/browser.log）；1440×900及360×780，保存、错误、Esc/焦点、表格列、窄屏及受影响弹窗 |
| 视觉 | 18张实际组件/CSS截图逐张作者自审PASS，含桌面、窄屏和读取失败；不是用户视觉签收 |
| 本地UI工作流 | ui:verify PASS：13个UI文件、18张截图、13项交互、11份工程日志；报告artifacts/ui-workflow/05da9856f483bee06b5918367c863cd926e09d4f2ba1938beb9e51fbc5de3252.json |
| 完整UI/隔离MySQL | 候选prepare/rehearse进行中，实际结果后补；此前33/35，2项使用已移除状态控件的旧测试已更新，不计为通过 |
| 审查 | 已做独立于编码过程的作者源码复核；独立审查工具额度中断，未记独立PASS，review.json/progress.md保留实际限制 |

候选manifest：`artifacts/business-simplification-20261023/r2/source-manifest.json`；已精确审阅49条源路径（含测试/脚本）。当前生产版本保持20261023t051028030-82baa9b8；开发UI门禁userAcceptance=pending、production=not-deployed、releaseReady=false，不代替发布授权。

可交互模拟预览：`http://127.0.0.1:52997/business-ui-review.html`，正式组件与CSS，模拟数据，不写业务数据库。未验证的生产浏览器业务写入、微信真机及上线分别登记；本轮不执行生产迁移或版本切换。

## 文档治理

需求/计划/当前专题、失败与成功证据和复盘均保留。旧客户UI/发布与恢复记录保留，未移除其独有约束。归档候选不适用，无文件删除/移动。


## 最终复核补充：批量创建路径

首个固定包20261023t084330664-c29bbe1c的prepare和隔离恢复曾通过，但后续逐个核对写入入口发现：批量创建仍显式写sampling=0，旧测试也断言0；因此旧候选经源码复核拒绝并保留review-rejected.json，不能用此前绿色代替这条业务验收。把原断言改为1，实际观察RED后，修正批量INSERT及“补图后开启供样”的旧提示；229项定向、13项真实Edge（含批量创建）和R2前后端构建/类型通过。R2截图和工程证据独立保存在r2目录；正式prepare及隔离恢复重新执行，不复用旧包发布。

首轮隔离MySQL恢复56表，迁移归一31个产品（仅隔离库），重复执行幂等及最小事件插入/回滚通过；生产首页/后端未切换。预览Vite曾因监听加密备份文件遇到EBUSY退出，已将artifacts/tmp/dist从预览监听排除并恢复，未修改正式Vite配置。


## R2最终验证

R2 `20261023t085615057-b2ac7559`：229项定向、发布器19项、专项Edge13项、完整UI35项、面料46项、定向类型、正式构建/HTTP合同通过。真实MySQL隔离恢复56表、41个产品旧状态归一、迁移幂等及日志回滚通过；生产index/backend/starter/nginx与基线一致，未部署。独立审查额度中断，作者单独源码复核完成，未记独立PASS。用户新增客户/开单三项反馈继续实现，最终候选须更新。
制品SHA256 `5dcad037235649affd77d936999cc570bacab1b00015d8abe43d39c7c5c5a792`；证据为活动源码`artifacts/releases/20261023t085615057-b2ac7559/`及`artifacts/business-simplification-20261023/r2/post-rehearsal-check.json`。


## 后续追加已完成

客户面料多选/备注、五列摘要及开单缩略图已在同一候选完成。当前状态以[追加专题](customer-picker-followup-2026-10-23.md)及项目现状为准；R2旧包标注superseded，未部署。
