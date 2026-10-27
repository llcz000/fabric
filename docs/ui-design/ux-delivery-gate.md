# Fabric UI/UX Gate（新 UI 开发强制工作流）

**唯一 UI 交付门禁**：适用于新建或明显改动的 Fabric Web UI。业务规则只读取[唯一需求总览](../project/项目需求总览.md)，复用[fabric-ui-design](../../.agents/skills/fabric-ui-design/SKILL.md)；此流程不授权生产部署。

## 每次必须执行
组件、正式页面视觉、交互与浏览器回归必须在同一轮交付。实际视觉核对方法见[单轮页面审查方法](ui-page-visual-review.md)，具体检查项只在[UI清单](ui-review-checklist.md)维护；普通字段修改不强制A/B。
先依 [内部效率与客户分享定位](product-positioning.md) 判定页面类型：内部操作/色卡链接客户展示。内部页面不借客户展示名义添加大 Hero、营销介绍或无关图片；客户页不泄露内部管理字段。
1. **理解实际任务**：先确认当前源码和最新要求，写清操作者、目标、最短操作路径，列出旧页面已批准的内容。
2. **设计前**：加载 `fabric-ui-design` → `ui-ux-pro-max`（按需一条 UX 搜索）→ `frontend-design`（需要视觉重排时），禁止无依据生成平行样式。记录筛选、弹窗、空态、错误、取消、键盘行为。
   - **分层设计、按需预览**：内部小幅改动优先沿用已验收页面和现成组件，直接实现并做有范围的浏览器验证；重大视觉重排或客户分享页面才制作视觉预览。A/B 仅在确有选择问题时使用，不是每次新 UI 的硬性开销。高质量不等于多装修饰，核心目标是操作效率和可持续升级。
3. **实现**：先复用在用的业务组件及数据 model；复杂弹窗优先采用成熟 accessible primitives；没有明确必要不换整套 UI 框架。
4. **浏览器证据**：使用 Playwright + 预构建的隔离本机静态评审页面运行 `npm run test:ui:ux`（针对新案例新增 spec），至少主路径/空态/关闭/焦点/360px 宽度。代码检查不是视觉接受。
5. **验收报告**：按[UI 清单](ui-review-checklist.md)标记 PASS / FAIL / 未验证；主流程屏幕截图、浏览器执行报告、受影响路径和未完成事项必须列出。P0/P1 或浏览器失败 **NO-GO**，不能因 build PASS 宣称 UX 完成。
   - **双重关卡**：视觉评审检查层级、留白、文字尺寸、色彩对比、素材真实性及桌面/手机截图；交互测试单独记录主路径、取消/失败、键盘、焦点和响应式行为。两者分别给出 PASS/待批准/FAIL，不能互相替代。
6. **交付边界**：独立评审、用户 UI 接受、真实数据接线、服务端权限、生产发布分别登记；未测不得宣称通过。

## 工程级 UI Gate 接线

已在活动发布器 `scripts/release/cli.mjs` 的普通 `prepare` 中接入按源码变更识别的 UI Gate：浏览器前端源码更改时，必须先有同版本两张以上页面/弹窗实际截图、评审记录与前次已核验发布版本一致的证据，然后在构建前重跑 `npm run test:ui:ux`；纯后端变更跳过，避免拖累普通迭代。证据保存在新制品中；没有用户签收的 UI 审查不能自动伪称签收。详细命令和边界见 [统一发布工具](../operations/统一发布工具.md#源码批准与-ui-专项)。


## 新会话检查与单轮完成门禁

**唯一规范来源**：`D:/fabric` 的本文件、相关 UI 规范和项目技能；当前 workspace 为 `.`，根目录就是正式业务源码。preflight 按实际指针和 SHA256 核验，禁止凭旧内嵌工作区路径判断源码归属。

1. **每次新开会话/UI任务编码前**，在根目录或活动工作区执行 `npm run ui:preflight`；检查失败为 NO-GO。只有明确允许的 `npm run ui:preflight -- --sync` 会从根目录同步指定 UI 规范和技能，再重跑普通只读检查；不覆盖业务源码/客户数据。同步后实际加载 `fabric-ui-design`、`fabric-ui-ux-qa`，重大视觉调整按需加载专家设计技能。工具不可用时说明并采用规范回退，不能虚报已加载。
2. **正式组件同轮评审**：先核对现有已验收页面，完成目标页面/全部受影响弹窗与必要错误/空态；分别审查 1440px 桌面与 360px 窄屏，保留实际正式 CSS 的截图。Playwright 测主路径、取消、Esc、焦点、失效和未保存草稿；受影响功能做定向 TS/单测，正式前端 build。不能只验自己新增的孤立样板或用 build PASS 代替设计审美。
3. **先核对并更新候选源码清单**：先运行 `node scripts/ui-workflow-gate.mjs inspect` 区分 `source-refresh-required`（清单过期，列出遗漏/变更UI）、`review-required`（清单已新鲜，需相应评审）和 `no-ui-changes`（与已核验发布无UI差异）。`verify/template` 在使用评审前会核对实际全部UI源码，不允许旧清单漏记新增文件；实际UI与候选及已发布版本均一致时，`verify` 返回 `required:false`，不复用旧报告冒充本轮评审。进入活动工作区执行 `node scripts/release/source-automation.mjs inspect` 查看全部变更；人工逐个核对后执行 `node scripts/release/source-automation.mjs accept <inspect列出的全部精确变更路径>`（必须完整审查，拒绝自动接受未知文件）。确保 `sourceManifest` 指向本轮候选完整源文件身份，且上一已验证发布的源码清单可读；旧指针、过期快照不能进入交付。报告必须覆盖候选相对已验证发布的**全部**前端变更文件，不能只挑几个已经测试的路径。
4. **自动创建未通过的报告模板**：`npm run ui:template -- --page 新建单据 --file src/components/.../File.tsx`（多个实际变更文件重复 `--file`）。生成 `artifacts/ui-workflow/<候选源码清单SHA256>.json`，初始均为 not-verified，**不得直接当 PASS**。填入实际评审人、独立视觉 PASS 与至少两张真实 PNG（必须同时覆盖桌面宽 ≥1000px、窄屏宽 ≤600px，可另含弹窗），`visual.screenshots` 的每项为 `{\"path\":\"artifacts/...png\",\"sha256\":\"真实文件SHA256\"}`；浏览器测试 JSON 含 `checks` 非空数组和 `errors` 空数组，`interaction.browserEvidence` 与 `interaction.browserSha256` 对应实际文件；`engineering.evidence` 每项为 `{\"path\":\"artifacts/...log\",\"sha256\":\"真实文件SHA256\"}`，至少一项，保存测试/构建日志并禁止事后无痕替换。`uiRulesSha256`、`candidateManifestSha256`、`uiSourceSha256` 均由模板初始写入，审查后不得擅自重写以绕过过期证据。用户签收只能是 `pending` 或 `not-attested-by-tool`，`unverified=[]` 且 `releaseReady=false`；任何证据状态不满足均 NO-GO。
5. **任务完成前**执行 `npm run ui:verify`。已完成实际审查并填好的PASS报告可运行 `npm run ui:seal` 保存候选专属截图快照；seal先验证整份证据，只修改快照路径，不提升任何未通过状态，也不代签用户接受。统一发布器在完整浏览器回归前自动seal，回归后再次verify，防止通用截图被覆盖造成重复准备。它验证规范/技能 SHA、候选与已发布清单的 UI 变更范围、UI 文件 SHA、截图/浏览器/工程证据及状态，缺失/过期/FAIL 一律 NO-GO。脚本仅可将工作流标为本地候选已检，不会代替用户签收，报告 `userAcceptance` 必须保持 pending 或 not-attested-by-tool，`releaseReady=false`。
6. **发布前**现有统一发布器 `scripts/release/cli.mjs prepare` 另行强制运行只读 preflight，以及 UI 变更时的 `ui:verify`；沿用其原有源码绑定视觉证据和 `npm run test:ui:ux` 浏览器质量门禁。任何发布仍需用户明确授权，`prepare` 本身绝不部署。非 UI 后端任务按原有范围跳过 UI 内容证据，避免无关全量测试。

**命令边界**：`npm run test:ui:workflow` 测上述新门禁；`npm run test:ui:ux` 是根目录正式浏览器回归；当前从唯一根目录执行同名命令。新页面的视觉/交互报告和用户生产验收各自记录，不能互相代替。

## 微信客户分享验收专项

仅对公开的 `/c/` 色卡分享客户页面，优先 iOS/Android 微信中 375～430px 常见屏宽：首屏花型/色卡身份、配色快速定位、受控三类图、点击大图/返回、响应式安全区、懒加载及缺图/失效状态；Playwright UA 与触屏模拟只作为前置测试，**微信真机未测不得标记微信验收 PASS**。具体见 [微信 H5 专项](wechat-card-share.md)。

## 可执行命令
- `npm run test:ui:ux` — 本机 Edge + 预构建静态 mock 回归（端口52992，独立输出 site-test）；不启动正式 server.ts，可与 52991 人工预览同时运行。
- `npm run test:unit` / `npm run lint` / `npm run build` — 按实际改动范围在受保护工作区串行验证。
- UI 规范检索：`python .agents/skills/ui-ux-pro-max/scripts/search.py "modal dialog accessibility" --stack react`。

任何分享/复制前先确认 URL 来源、公开可达性与授权。禁止用 demo 链接冒充生产链接。
