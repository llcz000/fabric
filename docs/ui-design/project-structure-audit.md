# 第一阶段项目结构核对

> 文档定位：规范与手册｜主要读者：设计/开发/测试/运维及Agent。用途：按当前任务选择对应规范或运行方法。

日期：2026-10-14｜本地实际仓库：D:\fabric｜分支 master。
本次通过本地只读检查和已配置 WebCodex Runner 核对；不是生产、浏览器、远程 Stitch 或数据库审计。

## 现有结构与证据

| 位置 | 实际用途 | 本阶段处理 |
|---|---|---|
| AGENTS.md | 知识维护、V2路由、Stitch保护 | 增加 UI 技能入口，解除 Stitch 必经要求 |
| docs/00-首页.md | 唯一知识库入口 | 增加 UI 领域入口，不复制另一套总目录 |
| docs/product-master/ | 当前需求/进度/设计/交付 | 读取 v1.50，旧工具流程增加现行适用范围说明 |
| .agents/skills/ | V2及离线工作流项目技能 | 新增 fabric-ui-design，保留已有技能 |
| agent/skills/ | design-md、Stitch工具、taste-design、shadcn-ui 等 | 仅确认存在；不重装、不当成已采用 UI框架 |
| src/index.css | Tailwind 4全局字体、品牌蓝、打印样式 | 整理现有值，不改打印或全局CSS |
| src/components/product-master-v2/ | 花型、面料、产品、导入、色卡独立组件及model/tests | 作为 UI复用路径 |
| src/components/document-product-selector/ | 三种单据共用选品/独立工作区 | 保留历史身份及单据边界 |
| src/components/product-library/、ProductLibrary.tsx | 旧版图库/组件仍共存 | 不误认成 V2正式入口，不删除 |
| artifacts/product-master-ui/ | Stitch交付快照、本地评审页面和检查证据 | 保留资产，不复制原图或覆盖用户稿 |
| scripts/ | 现有技能检查、Stitch交付、短简报、工作树预检 | 按任务选择；本轮无需应用全量测试 |

package.json 核对前端为 React 19、TypeScript 5.8、Vite 6、Tailwind 4、lucide-react；已有 lint/build/test 脚本。agent/skills/shadcn-ui 的存在不代表应用已使用完整 shadcn 组件库。没有为规范库增加依赖或锁文件变化。

## 本次新增目录

```text
docs/ui-design/
  README.md
  design-system.md
  component-rules.md
  ui-review-checklist.md
  collaboration-workflow.md
  project-structure-audit.md
.agents/skills/fabric-ui-design/
  SKILL.md
```

核心规范仅保存在 docs/ui-design，技能通过相对链接按需读取，不在 agent/skills、个人技能目录或 outputs 再维护另一套正文。聊天交付文件仅为固定日期快照。

## 当前一致性发现

1. 当前需求文件首行与版本表为v1.50；2026-10-15已将领域README和进度收口为当前入口，移除相互冲突的追加摘要。规范仍引用最新需求正文。
2. 数字配色现在永久锁号、删除不复用；历史记录中的“最小空号复用”已被 D-01覆盖。三类产品图片各0～10，不能恢复旧总数限制。
3. 选样属性按最新资料刷新；三种已保存单据的属性口径仍不同。旧快照代码/验收与正式集成尚有待完成项，以当前进度和实际源码为准。
4. 全局蓝与 V2局部蓝紫灰共存；未统一共享 token。先整理映射，不做未获批准的全站视觉迁移。
5. 工作区已有其他未提交/未跟踪改动，且 WebCodex报告近期有同项目活动。本阶段只创建新目录并以版本保护编辑少量入口，不处理其他工作。
6. WebCodex在线，注册同一仓库并提供 Codex ACP provider。新增 fabric-ui-design 已通过精确 skill_load，返回 source_scope=project、name_conflict=false 和完整33行技能正文。此结果证明 WebCodex可发现并加载该项目技能；本次未启动 ACP任务，未测 ACP自动注入或实际行为。

## 本轮不作结论的事项

未检验实际页面对比度、键盘行为、正式 App接线、真实MySQL、线上版本或最新Stitch画布。不从旧项目现状文档推断“V2完全未实现”，也不从独立组件测试推断“已上线”。

2026-10-15文档清理更新了项目现状和索引，移出已删除的design-md/enhance-prompt/remotion安装登记；其余UI技能和设计资产保留。此更新仅核对文档与文件，不新增画布/浏览器/生产验收。


## 现行源码定位（2026-10-24）

规范中的 src/、server/、tools/ 和应用 scripts/ 路径均相对当前活动应用根目录。控制目录按 docs/project/fabric-v2-active-workspace.json 的 workspace 定位；role 为 application 的独立检出直接使用自身目录。旧根应用源码及重复脚本已按维护恢复索引归档，不再作为开发或验收入口；规范用相对源码定位而不把某一本机嵌套路径当成可移植链接。
