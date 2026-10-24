# Fabric Web UI 工具选型与持续迭代方案

> 文档定位：规范与手册｜主要读者：设计/开发/测试/运维及Agent。用途：按当前任务选择对应规范或运行方法。

> **2026-10-14现行工具口径**：用户明确允许效率低时弃用Stitch。默认使用现有React组件与可交互预览，Stitch为可选工具；取消“新独立页面/较大布局必须先进入Stitch”和“所有UI迭代必须核对画布”的通用要求。现行规范见[UI Design规范库](../ui-design/README.md)与[协作流程](../ui-design/collaboration-workflow.md)。
>
> 本文旧日期的工具推荐、接入状态和新页面先Stitch规则保留为历史记录，不代表当前必经步骤。第8节仅在实际操作/交付远程Stitch页面时适用，实时读取、用户修改保护和真实画布核验继续保留；未使用Stitch的任务通过本地可交互预览及UI清单验收。既有批准稿保留参考，用户UI接受与应用实施/部署仍分别跟踪。


工具选型初次核对与归档：2026-10-10；现行操作流程更新：2026-10-11。知识库当前文件：`D:\fabric\docs\product-master\product-master-v2-ui-iteration-workflow.md`；后续修改本文件，聊天 outputs 仅为交付快照。第1～6节保留初次工具选型与接入研究的核对日期；第7节为设计稿清理规则，第8节为当前每轮必须执行的画布完整性交付流程。Stitch现已接入并形成五张现行设计；业务应用尚未实施。

## 当前进展（2026-10-11）

用户已配置 Stitch MCP 并重启，owned / shared 项目查询通过。随后用户授权继续设计；花型库已收敛为默认对齐列表和母版内配色列表两张当前图，用户已于 2026-10-10 确认；中间稿及时清理，详见 [Stitch 当前设计评审](product-master-v2-stitch-design-review.md)。以下接入步骤作为操作参考，早前未接入 / 未创建的描述仅对应归档时状态。当前五页及列表遗漏后的补齐见现行登记。新页面先在Stitch形成稿，微调和状态在本地原型继续；每轮按第8节完成交付完整性核验。尚未修改业务应用代码。

## 1. 推荐结论

**本项目 Web UI 首选 Stitch；Lovart 可用于视觉方向与素材设计。频繁调整应以已有 React 组件和设计规范为基准，画布承载方案与反馈。需要长期精确维护组件画布时，优先评估 Penpot＋官方 MCP。**

这是对 Fabric 使用场景的判断，不是实测两个工具的质量排名。本机 package.json 已核对：Fabric 前端使用 React、Vite、TypeScript 和 Tailwind。用户选定的花型库紧凑行、配色独立图片、编号规则、权限与一期范围继续作为设计约束。

## 2. Lovart 与 Stitch 的证据比较

| 维度 | Lovart | Stitch | 对 Fabric 的判断 |
| --- | --- | --- | --- |
| 修改已有设计 | 官方帮助描述局部修改、文字与图层编辑 | 作者工具支持编辑已有屏幕、生成变体 | 都可用于多轮视觉调整，实际一致性须小范围试验 |
| 开发交付 | 官方导出表列出 Layout → HTML | 配套技能提供 HTML 提取、设计规则提取及 React 组件生成 / 更新 | Stitch 的 React / Vite 衔接证据更明确 |
| 画布与代码互通 | 本轮未核实可用于本项目的持续代码映射或官方 MCP 工作流 | code-to-design 与 react-components 构成双向转换流程 | Stitch 可以建立受控同步，但转换不等于无损持续同步 |
| 后期频繁微调 | 可继续修图层及布局；源码维护能力待验证 | 可回到已有屏幕、沿用设计规则，并按组件更新 | 采用最新代码与规则作为基准，逐次审查变更 |

Lovart 的能力依据：[局部与图层编辑帮助](https://www.lovart.ai/docs/edit-your-design/advanced-ai-editing)、[导出格式](https://www.lovart.ai/docs/export-formats)。HTML 导出能力不直接证明筛选、业务权限或数据流程已完成。

Stitch 的能力依据：[作者技能集合](https://github.com/google-labs-code/stitch-skills)、[code-to-design](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-design/skills/code-to-design/SKILL.md)、[react-components](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-build/skills/react-components/SKILL.md)。其中代码转设计通过静态 HTML、设计规范与上传完成；回到 React 则涉及组件生成 / 更新。已有事件、数据读取及权限仍需结合实际源码核对。

## 3. 与画布结合的迭代方式

建议先用 Stitch 自带画布完成花型库，减少首轮工具切换；只有长期组件画布维护成为实际需要时，再引入 Penpot。两种路径都以以下规则保持一致：

1. **页面有身份**：约定花型列表、配色预览、配色编辑等页面状态名称；记录设计项目 / 屏幕 ID、对应源码组件、设计版本和最近同步的代码版本。
2. **公共规则单独维护**：用设计规范记录字号、颜色、间距、缩略图尺寸、行密度和状态样式；用 React 组件复用母版行、配色块和表单。规则的正式文件位置在选型后结合项目既有目录确定，不另造知识库入口。
3. **微调针对组件**：如调整编号位置或上下留白，明确目标组件与变更范围；整体按钮样式通过公共规则调整。涉及字段、权限与业务流程的变更先回需求评审。
4. **变更带版本**：每轮从最新网页 / 组件提取设计参考，画布生成局部修订；选择获批版本后，对照差异更新对应组件，检查真实数据、长文本、多配色与窄屏，再把截图和结果回写画布。
5. **阶段各有基准**：需求稿管理业务事实；已实现的组件和设计规则管理当前 UI；画布只保留当前审查稿或获批稿及公共设计规范；反馈结论存入知识库，被替代的备选及时清理。发生差异时明确哪一版已批准，不直接覆盖。

MCP 提供工具间读写通道，正确同步仍需要页面身份、设计规则、组件对应关系和验证步骤。此处没有假设生成工具能自动保留全部业务逻辑。

## 4. GitHub 参考项目与成熟度边界

| 项目 | 可参考的内容 | 成熟度与适配边界 |
| --- | --- | --- |
| [google-labs-code/stitch-skills](https://github.com/google-labs-code/stitch-skills) | code-to-design、design-system、React 组件生成 / 更新 | 具有具体技能与脚本；README 明确不是 Google 官方支持产品。先小范围验证，Windows 下核对脚本运行环境 |
| [google-labs-code/stitch-sdk](https://github.com/google-labs-code/stitch-sdk) | 项目 / 屏幕管理、编辑和变体、获取 HTML 与截图 | 适合后续自动化；SDK 与 MCP 不是可维护业务 UI 的替代品 |
| [penpot/penpot](https://github.com/penpot/penpot) | 可编辑组件、设计规范与画布维护，官方 MCP | 画布产品有稳定发布；本轮最新 release 页面为 2.18.3。连接能力与当前账号 / 版本相关，仍需实际验证 |
| [penpot/penpot-ai-kit](https://github.com/penpot/penpot-ai-kit) | 让 AI 在真实 Penpot 文件中维护组件、样式与设计规则 | 作者配套工作流，需要 Penpot MCP；不能把主产品成熟度直接当作每个 AI 工作流的稳定保证 |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | 直接编辑 DOM 并修改源码、图层与分支 / 检查点 | 当前 README 主要支持 Next.js＋Tailwind，非 Next.js 支持未完成；Fabric 是 Vite，不建议直接接入或为工具迁移框架 |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | 设计审查、布局修订及实际网页局部迭代 | 可作为代码侧的审查补充；它的浏览器迭代能力与独立设计画布职责不同，接入前核对当前环境 |

本轮通过 GitHub 元数据确认前五个仓库存在且未归档，读取作者 README / 文档，并核对 Penpot release。没有用 Star 数作为成熟度结论，也未声称已现场验证这些集成。

Penpot 的画布读写能力及组件对应工作流：[官方 MCP 文档](https://help.penpot.app/mcp/)。发布证据：[Penpot 2.18.3](https://github.com/penpot/penpot/releases/tag/2.18.3)。Onlook 的框架限制以当前 README 为准，不采用旧 Wiki 的广泛兼容描述。

## 5. Fabric 的最小试验

建议先评估 **Stitch＋代码侧设计审查**，保留 Penpot 作为长期画布候选。试验只覆盖花型列表、配色预览、配色编辑三种状态，不扩展到全部三库页面：

- 默认看见各配色独立花型图，紧凑行不隐藏内容。
- 做一次编号位置调整、一次行间距调整，检查修改是否只影响预期部分。
- 做一次共享控件规则调整，检查多个页面是否保持一致。
- 将获批方案落实到现有 React / Vite 组件，验证键盘焦点、上传、多配色、长编号、标签和权限状态。
- 保存当前设计 ID、版本、组件映射与当前截图；修订结论记录为文字，确认下一轮能基于当前版本继续修改，随后清理被替代截图。

能完成上述过程，再决定是否扩展到面料 / 产品 / 单据页面或引入 Penpot。**用户已要求将方案归档并了解 Stitch 接入步骤；本轮未执行安装、认证或外部项目创建，应用实施仍待需求与设计批准。**

## 6. Codex 接入 Stitch：MCP、Skills 与 SDK

当前建议组合为 **Stitch MCP＋stitch-design**。Skills 推荐但不是连接的必要条件；SDK 当前不需要。

| 项目 | 作用 | 本轮选择 |
| --- | --- | --- |
| Stitch MCP | 让 Codex 调用 Stitch 的项目、屏幕与设计工具 | 连接必需，先配置并验证认证 |
| Stitch Skills | 指导代码转设计、设计生成与设计规范维护 | 推荐安装 stitch-design；stitch-utilities 按需增加 |
| Stitch SDK | 在自编程序中调用项目 / 屏幕、编辑、变体与导出 | 批量自动化或自建集成时再考虑，当前不安装 |

作者 README 明确要求预先配置并认证 Stitch MCP；安装 Skills 不会代替连接认证。当前设计插件清单未声明内置 MCP。SDK 是程序调用封装，不是 Codex 连接远程 MCP 的前置依赖。依据：[作者安装说明](https://github.com/google-labs-code/stitch-skills#installation)、[设计插件清单](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-design/plugin.json)、[SDK README](https://github.com/google-labs-code/stitch-sdk)。

### 6.1 先创建 Stitch API Key

登录 [Stitch 设置页](https://stitch.withgoogle.com/settings)，在 API Keys 中选择 Create API Key。密钥仅填写在本机认证配置中，不写入项目知识库、Git 或聊天。

这里采用 API Key 接入路径，不需要为这条路径安装 Google Cloud SDK；OAuth 是另一个认证选择。连接地址为 `https://stitch.googleapis.com/mcp`，认证请求头为 `X-Goog-Api-Key`。依据：[Stitch MCP 设置文档](https://stitch.withgoogle.com/docs/mcp/setup)。

### 6.2 配置 Codex MCP

在本机用户配置 `C:\Users\yangx\.codex\config.toml` 中新增以下段落，保留已有配置；如果已有同名 stitch 段落，修改原段落，避免重复。此处只有占位符，不包含真实密钥：

```toml
[mcp_servers.stitch]
url = "https://stitch.googleapis.com/mcp"
http_headers = { "X-Goog-Api-Key" = "替换为你的 Stitch API Key" }
startup_timeout_sec = 30
tool_timeout_sec = 300
enabled = true
```

`http_headers` 适用于直接填写本机密钥。若以后使用环境变量，可改为 `env_http_headers = { "X-Goog-Api-Key" = "STITCH_API_KEY" }`，并确保 Codex 进程能读取该环境变量；变量名位置不能填写实际密钥。两种方式选择一种。300 秒是为设计生成预留的本项目建议值，不是官方固定要求。依据：[Codex MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

### 6.3 安装设计 Skills

按作者当前 Codex 安装说明：在 Settings → Plugin Marketplaces → Add 添加来源 `https://github.com/google-labs-code/stitch-skills`，Git ref 填 `main`，Sparse paths 可以留空；随后在该来源安装 `stitch-design`。

- stitch-design：当前设计阶段推荐，包括代码转设计、生成设计和设计规范维护。
- stitch-utilities：需要设计规范整理、提示词增强等辅助流程时再增加。
- stitch-build：获批界面进入 React 组件实施阶段再考虑，不在需求阶段自动启用代码生成。

如果当前界面没有上述入口，作者提供的命令行替代为 `codex plugin marketplace add google-labs-code/stitch-skills --ref main`；注册来源后仍需安装具体插件。依据：[作者 Codex 安装步骤](https://github.com/google-labs-code/stitch-skills#installation)。作者 README 明确声明这些配套项目不是 Google 官方支持产品。

### 6.4 验证连接，再开始设计试验

保存后重新启动 Codex，在新会话中先要求：“检查 Stitch MCP 是否可用，先列出已有项目。”工具列表或项目查询成功可证明连接；Skills 被发现仅证明流程包已加载，不等于 MCP 已认证。

连接通过后，按第 5 节的三种页面状态进行小范围试验。保留同一项目 / 屏幕 ID，在既有设计上局部修改；页面身份、版本记录与 React 组件映射继续遵循第 3 节。

本轮仅将操作说明归档；没有修改 Codex 配置、安装插件 / SDK、录入密钥或调用 Stitch 创建设计。


## 7. 每轮及时清理 UI 中间稿（2026-10-10 用户确认）

本轮花型库只保留默认对齐列表和母版内配色编辑页两图，不单独制作预览图。后续在同一画布迭代；需求决定与反馈写入稳定的需求、UI 评审记录，设计附件统一更新 `artifacts/product-master-ui/stitch/current`。

1. 先核对当前两图的 HTML、截图、字段和屏幕 ID，再更新登记及知识库入口。
2. 新稿替代旧稿后，同一轮移除画布旧屏幕、重复上传的 HTML / 截图、本地旧稿及临时渲染文件；不再积累 `before-v*` UI 资产目录。Stitch 编辑返回新 ID 时也必须清理旧 ID，不能把工具成功响应当成已经替换原屏幕。
3. 清理前提取仍有效的独有约束；角色、引用规则、图片归属、分期、键盘焦点与上传入口检查保留为文字要求。需求历史和仍未实现的批准方案不随 UI 稿清理删除。
4. 留简短清单：日期、删除理由、文件 / 屏幕 ID、当前替代位置、实际验证结果，不保留已被否定的整套画面来充当历史。清单见 [UI 稿清理记录](product-master-v2-ui-review.md)。
5. 只清理本项目已被替代的设计资产；公共当前设计规范保留。每轮结束核对当前画布屏幕数量、附件和链接，清理未完成时明确记录，不写成全部完成。

本轮确认仅覆盖花型库当前两图；面料、产品、导入及单据页面仍需设计评审，整体需求尚未冻结。


2026-10-11 进度：按三库评审顺序新增一张面料行内维护稿，画布目前保留三张当前设计（花型两图已确认，面料一图待审查）及公共规范。每轮只添加当前评审需要的状态，及时移除被替代稿；两图限制对应花型库这一轮，不将其他业务库永久排除。面料入口见 [评审记录](product-master-v2-ui-review.md)。


## 2026-10-11 迭代方式确认

用户批准：Stitch用于新页面及较大布局调整，本地可交互原型用于字段、按钮、间距和状态精修，较大布局变化再回画布。产品新增原生生成一图，未为缺选、重复或图片操作逐项增加静态变体；这些状态在本地示例验证。当时画布仅四图（产品列表只有本地稿，随后已补齐；现行以五页登记为准）及[交互稿](../../artifacts/product-master-ui/stitch/current/library-review.html)统一登记，业务需求及界面批准状态保持分开。


## 8. Stitch 画布与本地原型交付流程（2026-10-11 生效）

适用于用户指定Stitch进行Fabric UI评审的工作。依据本次[产品列表画布遗漏复盘](../retrospectives/README.md)。本节是现行操作规则，第1～6节工具选型与接入信息保留其原核对日期；第7节的清理规则继续适用。

### 8.1 先确定交付范围与页面身份

开始每轮工作前，按已授权任务列出预期页面，不能从“当前已经生成哪些稿”倒推任务范围。分别记录页面名称、业务用途、需要新增还是修改、Stitch屏幕ID、对应本地稿、审核状态。新独立页面或较大布局变更先在指定Stitch项目中形成可审查稿；缺选、重复、上传、锁定等同一页面的交互状态可在本地模拟，不要求每个状态另建静态稿。

“减少中间稿”指删除同一页面的过时变体，不能据此省略产品列表等不同业务页面。业务员管理授权等状态也不是新的角色或新的业务页面。已经授权的设计修订继续执行，不因这一流程新增反复确认；业务范围或分期变化回到需求评审。

现行范围登记为 [review-delivery.json](../../artifacts/product-master-ui/stitch/current/review-delivery.json) 的`expectedPages`，不能只登记完成项；延期或排除项要有明确原因和授权依据。2026-10-12当前七页包含Excel导入预览和三种单据共用选品；此前五页范围为历史时点。当前页数通过不等于一期全部设计获批。

### 8.1.1 修改前读取最新Stitch并合并用户调整（2026-10-12生效）

1. 每轮修改先读取实际项目未隐藏实例，确认目标页面ID，再读取目标get_screen完整HTML、截图并核对实际画布；不能只根据本地缓存、旧文档或上一轮ID发起修改。用户可能在Stitch另建替代页；同名多页或ID变化先依据实际画布和用户描述定位。
2. 以“上次同步稿、当前远程稿、本轮用户要求”三方对照，列出字段、列顺序、控件、文字、操作和布局差异。哈希/文件URL可提示变化，但不能代替语义和视觉核对，也不能据此认定变更来源或用户批准状态。
3. 用户明确说明的Stitch独立修改必须保留并同步正式需求/本地原型；如本次产品备注列。未知来源差异保持待核，不自动当批准的新需求；若与本轮明确要求冲突，先形成具体对照再确认。已经清楚授权的同范围变更不反复请求许可。
4. 编辑提示词列出“本轮改变项”和“必须保留项”，从最新远程稿局部改动；不得套旧固定列数而抹除新增字段。产品列表当前12列，备注是受保护列；后续删除/改位置必须有新的明确要求并同步清单。
5. 更新后核对原保留项和本轮变更均存在。返回DomOperationEvent或成功文字时仍检查实际文件/画布；未形成完整保存稿不宣称交付。保存当前ID、HTML指纹、表头及核对时间作为下一轮基线，验证新稿后再清理旧稿。
6. 编辑与清理之间若发现用户又修改了源页，先重读差异并合并，不能覆盖或删除新增内容；截图和文件资源不一致时分别说明，修正同步后再交付。

交付清单可为表格页登记requiredColumns与columnCount。交付脚本检查当前HTML中的字段顺序和列数，缺少备注时失败；它仍不能自动监听Stitch、识别全部视觉修改或代替实际画布检查。本规则源于[用户独立修改被覆盖复盘](../retrospectives/README.md)。

### 8.2 生成或更新后核验画布

1. 使用已核对的项目与公共设计规范；新页面生成，已有页面优先编辑，返回新ID时记录替代关系。
2. 工具响应仅代表一次操作返回。读取实际屏幕HTML与截图，检查字段、排列和本轮修改；只有DOM操作或文字回复时，不把它当成已保存完整页面。
3. 读取`get_project`中未隐藏的`screenInstances`，逐项对照预期页面名称和ID；同时打开实际Stitch画布核对可见性，保存带页面名称和项目上下文的截图。屏幕能被`get_screen`读取但不在当前可见画布中，仍不能标记画布交付完成。
4. 生成超时或连接错误时先查实际状态；不得盲目重复生成。只知道文件存在、已有屏幕数量、工具成功文字，均不足以证明页面齐全。
5. 登记清楚页面位置；优先使相关页面易于定位。若仅确认页面位于画布下方，最终交付说明就写实际位置，不声称位于当前视口或已经置顶。

最新原生读取保存为 [canvas-snapshot.json](../../artifacts/product-master-ui/stitch/current/canvas-snapshot.json)。截图及快照必须来源于实际核验；不能为通过检查伪造可见性、日期或ID。

### 8.3 本地原型与画布保持同一轮登记

本地原型用于已确认布局方向的精修和交互检查，不代替新页面的Stitch稿。每个本地页面要能对应Stitch屏幕ID；本地新增页面若暂无画布稿，应明确列为“本地已有、画布未完成”。

本地与远程存在文案、布局或字段差异时，登记差异、当前评审依据及同步状态；本地微调不自动宣称远程已更新。较大布局变化需回Stitch修订。交互检查通过不能替代画布交付检查；画布可见不能替代UI批准、后端权限和应用实施验证。

### 8.4 每轮结束的交付门槛

| 检查 | 必须满足的证据 |
| --- | --- |
| 页面齐全 | 每个预期页面均有唯一屏幕ID，实际未隐藏，标题对应业务用途 |
| 当前附件 | HTML、截图及评审记录存在，指向同一页当前稿；本地与原生差异已标明 |
| 画布可见 | 最新实际画布读取与带上下文截图；交付说明能定位页面 |
| 业务一致 | 对照当前需求与本轮修改，不混入已取消筛选、二期功能或模型自加限制 |
| 状态准确 | “已交付”“待评审”“已批准”“已实施”分开记录 |
| 清理完成 | 新稿验证、登记和知识库更新后再清理被替代稿，保留当前不同用途页面及公共规范 |

用 `node scripts/check-stitch-review-delivery.mjs` 检查预期页面与最新原生快照、附件、视觉证据登记。也可通过`--manifest`和`--snapshot`指定其他一轮的清单与快照。脚本不自行连接Stitch，不能替代实时读取和实际画布核验；先更新真实证据，再运行。任何预期页缺少Stitch ID或未出现在可见快照中，检查失败，禁止报告“本轮设计交付齐全”。

当前登记覆盖七页。数字配色五页及面料维护待评审；导入展示稿获允许继续，真实解析和兼容范围未验收。花型两页在旧颜色身份方案下的批准不自动批准数字修订稿。页面交付检查通过不批准设计，不授权应用实施、提交推送、部署或数据导入。

### 8.5 最终交付说明

逐页提供名称、所在Stitch项目、位置或可访问入口，并链接当前附件 / 评审记录。明确尚未同步、未完成或待评审项。不得把只存在本地的列表笼统写成Stitch UI已完成；不要让用户负责发现页面是否缺失。
