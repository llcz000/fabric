# Fabric UI/UX Gate（新 UI 开发强制工作流）

版本：1.0 · 2026-10-21 · 适用于新建/明显改动的 Fabric Web UI。以现有 [fabric-ui-design](../../.agents/skills/fabric-ui-design/SKILL.md) 和 [当前业务需求](../product-master/README.md) 为上游；此流程不授权生产部署。

## 每次必须执行
**交付提效决定（2026-10-21）**：组件实现、正式页面视觉审查、可用性与浏览器测试必须合并在**同一轮交付**，发现冗余文案、按钮风格或实际布局差则本轮修复，不以组件功能测试通过提前结束。执行详见 [UI 单轮交付实例与规范](one-pass-ui-review-2026-10-21.md)；本规范不要求所有常规字段小修制作 A/B。
先依 [内部效率与客户分享定位](product-positioning-2026-10-21.md) 判定页面类型：内部操作/色卡链接客户展示。内部页面不借客户展示名义添加大 Hero、营销介绍或无关图片；客户页不泄露内部管理字段。
1. **理解实际任务**：先确认当前源码和最新要求，写清操作者、目标、最短操作路径，列出旧页面已批准的内容。
2. **设计前**：加载 `fabric-ui-design` → `ui-ux-pro-max`（按需一条 UX 搜索）→ `frontend-design`（需要视觉重排时），禁止无依据生成平行样式。记录筛选、弹窗、空态、错误、取消、键盘行为。
   - **分层设计、按需预览**：内部小幅改动优先沿用已验收页面和现成组件，直接实现并做有范围的浏览器验证；重大视觉重排或客户分享页面才制作视觉预览。A/B 仅在确有选择问题时使用，不是每次新 UI 的硬性开销。高质量不等于多装修饰，核心目标是操作效率和可持续升级。
3. **实现**：先复用在用的业务组件及数据 model；复杂弹窗优先采用成熟 accessible primitives；没有明确必要不换整套 UI 框架。
4. **浏览器证据**：使用 Playwright + 预构建的隔离本机静态评审页面运行 `npm run test:ui:ux`（针对新案例新增 spec），至少主路径/空态/关闭/焦点/360px 宽度。代码检查不是视觉接受。
5. **验收报告**：按[UI 清单](ui-review-checklist.md)标记 PASS / FAIL / 未验证；主流程屏幕截图、浏览器执行报告、受影响路径和未完成事项必须列出。P0/P1 或浏览器失败 **NO-GO**，不能因 build PASS 宣称 UX 完成。
   - **双重关卡**：视觉评审检查层级、留白、文字尺寸、色彩对比、素材真实性及桌面/手机截图；交互测试单独记录主路径、取消/失败、键盘、焦点和响应式行为。两者分别给出 PASS/待批准/FAIL，不能互相替代。
6. **交付边界**：独立评审、用户 UI 接受、真实数据接线、服务端权限、生产发布分别登记；未测不得宣称通过。

## 工程级 UI Gate 接线（2026-10-21）

已在活动发布器 `scripts/release/cli.mjs` 的普通 `prepare` 中接入按源码变更识别的 UI Gate：浏览器前端源码更改时，必须先有同版本两张以上页面/弹窗实际截图、评审记录与前次已核验发布版本一致的证据，然后在构建前重跑 `npm run test:ui:ux`；纯后端变更跳过，避免拖累普通迭代。证据保存在新制品中；没有用户签收的 UI 审查不能自动伪称签收。详细命令和边界见 [统一发布工具](../operations/统一发布工具.md#2026-10-21-ui-质量门禁已接入-prepare不触发自动部署)，实际候选样例见 [面料库 UI](fabric-library-next-2026-10-21.md)。


## 新会话强制检查与单轮完成门禁（2026-10-22）

**唯一规范来源**：共享根目录 `D:\\fabric` 的本文件、`one-pass-ui-review-2026-10-21.md`、`ui-review-checklist.md`、相关设计规范与项目技能。活动工作区由 `docs/project/fabric-v2-active-workspace.json` 指定；根目录旧业务代码不是开发目标。规范文件和技能以 SHA256 与活动工作区逐文件核对，不能以聊天记忆或旧工作区副本替代。

1. **每次新开会话/UI任务编码前**，在根目录或活动工作区执行 `npm run ui:preflight`；检查失败为 NO-GO。只有明确允许的 `npm run ui:preflight -- --sync` 会从根目录同步指定 UI 规范和技能，再重跑普通只读检查；不覆盖业务源码/客户数据。同步后实际加载 `fabric-ui-design`、`fabric-ui-ux-qa`，重大视觉调整按需加载专家设计技能。工具不可用时说明并采用规范回退，不能虚报已加载。
2. **正式组件同轮评审**：先核对现有已验收页面，完成目标页面/全部受影响弹窗与必要错误/空态；分别审查 1440px 桌面与 360px 窄屏，保留实际正式 CSS 的截图。Playwright 测主路径、取消、Esc、焦点、失效和未保存草稿；受影响功能做定向 TS/单测，正式前端 build。不能只验自己新增的孤立样板或用 build PASS 代替设计审美。
3. **先核对并更新候选源码清单**：进入活动工作区执行 `node scripts/release/source-automation.mjs inspect` 查看全部变更；人工逐个核对后执行 `node scripts/release/source-automation.mjs accept <inspect列出的全部精确变更路径>`（必须完整审查，拒绝自动接受未知文件）。确保 `sourceManifest` 指向本轮候选完整源文件身份，且上一已验证发布的源码清单可读；旧指针、过期快照不能进入交付。报告必须覆盖候选相对已验证发布的**全部**前端变更文件，不能只挑几个已经测试的路径。
4. **自动创建未通过的报告模板**：`npm run ui:template -- --page 新建单据 --file src/components/.../File.tsx`（多个实际变更文件重复 `--file`）。生成 `artifacts/ui-workflow/<候选源码清单SHA256>.json`，初始均为 not-verified，**不得直接当 PASS**。填入实际评审人、独立视觉 PASS 与至少两张真实 PNG（必须同时覆盖桌面宽 ≥1000px、窄屏宽 ≤600px，可另含弹窗），`visual.screenshots` 的每项为 `{\"path\":\"artifacts/...png\",\"sha256\":\"真实文件SHA256\"}`；浏览器测试 JSON 含 `checks` 非空数组和 `errors` 空数组，`interaction.browserEvidence` 与 `interaction.browserSha256` 对应实际文件；`engineering.evidence` 每项为 `{\"path\":\"artifacts/...log\",\"sha256\":\"真实文件SHA256\"}`，至少一项，保存测试/构建日志并禁止事后无痕替换。`uiRulesSha256`、`candidateManifestSha256`、`uiSourceSha256` 均由模板初始写入，审查后不得擅自重写以绕过过期证据。用户签收只能是 `pending` 或 `not-attested-by-tool`，`unverified=[]` 且 `releaseReady=false`；任何证据状态不满足均 NO-GO。
5. **任务完成前**执行 `npm run ui:verify`。它验证规范/技能 SHA、候选与已发布清单的 UI 变更范围、UI 文件 SHA、截图/浏览器/工程证据及状态，缺失/过期/FAIL 一律 NO-GO。脚本仅可将工作流标为本地候选已检，不会代替用户签收，报告 `userAcceptance` 必须保持 pending 或 not-attested-by-tool，`releaseReady=false`。
6. **发布前**现有统一发布器 `scripts/release/cli.mjs prepare` 另行强制运行只读 preflight，以及 UI 变更时的 `ui:verify`；沿用其原有源码绑定视觉证据和 `npm run test:ui:ux` 浏览器质量门禁。任何发布仍需用户明确授权，`prepare` 本身绝不部署。非 UI 后端任务按原有范围跳过 UI 内容证据，避免无关全量测试。

**命令边界**：`npm run test:ui:workflow` 测上述新门禁；`npm run test:ui:ux` 是根目录正式浏览器回归；活动工作区的同名命令委托根目录执行。新页面的视觉/交互报告和用户生产验收各自记录，不能互相代替。

## 微信客户分享验收专项

仅对公开的 `/c/` 色卡分享客户页面，优先 iOS/Android 微信中 375～430px 常见屏宽：首屏花型/色卡身份、配色快速定位、受控三类图、点击大图/返回、响应式安全区、懒加载及缺图/失效状态；Playwright UA 与触屏模拟只作为前置测试，**微信真机未测不得标记微信验收 PASS**。具体见 [微信 H5 专项](wechat-card-share-2026-10-21.md)。

## 本次首批样板
独立评审入口 `ui-ux-pilot.html`（综合评审页面亦保留 `?view=cardUx`），本机固定演示数据，非正式 App 页面。覆盖色卡搜索、查看配色、关联产品展示、复制本机预览链接、二维码、键盘与窄屏。产品分享链接只是本机预览，不能发送客户。真实色卡分享与原始产品媒体需要对接正式后端、重新验收。

## 可执行命令
- `npm run test:ui:ux` — 本机 Edge + 预构建静态 mock 回归（端口52992，独立输出 site-test）；不启动正式 server.ts，可与 52991 人工预览同时运行。
- `npm run test:unit` / `npm run lint` / `npm run build` — 按实际改动范围在受保护工作区串行验证。
- UI 规范检索：`python .agents/skills/ui-ux-pro-max/scripts/search.py "modal dialog accessibility" --stack react`。

任何分享/复制前先确认 URL 来源、公开可达性与授权。禁止用 demo 链接冒充生产链接。
