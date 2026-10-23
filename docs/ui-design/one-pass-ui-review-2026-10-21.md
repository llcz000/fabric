# Fabric UI 单轮交付规范（组件 + 页面 + 浏览器验收）
**成果验收更新**：2026-10-21 色卡库正式生产界面已由用户回复「验收通过」，本轮闭环。下阶段将流程扩展到其它内部业务库，不能把色卡库反复当成待验工作。

**适用**：内部工作台已上线页面的迭代；客户公开分享页另保留手机微信专项门禁。目的：缩短“功能已实现但外观仍差，再返工一轮”的链条。

## 单轮必须同时完成（不分批交接）
1. **实际页面核对**：直接读取活动组件、局部 CSS、业务要求与最新上线页面/截图。不得只评审另建的抽象组件夹具；演示数据仅用于运行正式组件。
2. **一份精简视觉规格**：查阅 `fabric-ui-design`、`ui-ux-pro-max`、`frontend-design` 和 Web Interface Guidelines 中相关规则。注明已实际加载/查询的工具，不把非执行的 Figma/Stitch 称作评审结果。检查标题及冗余文案、信息层级、列宽/密度、主次按钮、弹窗关闭方式、状态和焦点。
3. **同一提交范围修改页面与组件**：复用现有 React 业务 model。共用交互抽小组件、局部页面样式只作用于目标页；不因追求视觉统一改掉其他业务库或对外分享界面。一般浏览弹窗用图标 × 并提供 aria-label；危险确认保留取消/确认语义。
4. **实际渲染 + 同轮复查**：用带**正式 CSS 和全部真实操作**的业务组件浏览器页面，至少一个桌面宽度、一个窄屏，并拍主页面 + 涉及的各个弹窗。视觉 FAIL 要在本轮处理，不能用 Playwright PASS 充当视觉 PASS。
5. **轻量按风险验证，单次交付**：本次影响的主流程 / 搜索空态 / 查看分享 / 删除确认 / Esc / 焦点 / 列设置回归，定向 TS/单元测试及正式客户端 build；共享组件影响多处时补关联测试。发布范围用全活动源码清单冻结，正式部署另需用户授权及统一发布工具。

**交付输出仅一份**：实际组件预览入口、视觉差异、测试 PASS/FAIL、未验项、产物位置和是否发布。不要在一次需求中先提交“样板完成”再让用户另提“页面审查”。

## 本次色卡库实施实例
- **设计依据实际使用**：加载 `fabric-ui-design`、`frontend-design`、`ui-ux-pro-max`、`web-design-guidelines`、`fabric-ui-ux-qa`；运行 ui-ux-pro-max 的 UX、icons、React 和内部高密度设计系统查询；在线读取 Vercel Web Interface Guidelines。
- **页面**：去除“列表与Excel导出”及无助操作的冗长说明；标题 22px、工具栏搜索/复选/导出/新增平衡布局，选中数量仅在非零时显现；清楚区分主按钮及次按钮，缩小不必要边框和文字噪声；表格保留产品列宽及四个操作按钮的可达性，无表头排序；分页区去冗余导出说明。
- **弹窗**：色卡的“查看花型”“分享”“二维码”共用新的 `DialogDismissButton` 右上角 36px × 按钮；保留有意义的标题、aria-label、原生 dialog Esc 和焦点恢复。删除确认仍由现有 `ConfirmProvider` 管理，继续展示“取消”和“确认删除”。
- **预览**：`http://127.0.0.1:52991/ui-ux-internal-cards.html`，使用实际组件＋正式 CSS，3条演示数据。截图位于 `artifacts/ui-ux-pilot/card-library-design-review-{desktop,view,share,qr,delete,mobile}.png`。本机 HTTP 只能展示分享弹窗的失败重试样式：正式分享链接必须为 HTTPS 同源，测试样板不生成真实 token，不能称作生产分享成功演示。
- **验收**：25/25 Playwright/Edge 流程 PASS（含已有微信客户页回归）；34/34 业务/列设置单测 PASS；定向 TypeScript PASS，正式活动客户端 Vite build PASS。已实际查看六张截图：视觉排列、标题简化、三类正常浏览关闭与删除安全确认符合本轮设计目标。仍待用户本人确认视觉。
- **候选范围**：改动 `SampleCardLibraryV2.tsx`、`SampleCardTable.tsx`、`SampleCardPatternsDialog.tsx`、`CardShareDialog.tsx`、`v2Experience.css`；新增 `src/components/ui/DialogDismissButton.tsx`。新候选清单 `artifacts/card-library-one-pass-ui-20261021/source-manifest.json`，共 723 项；原已发布微信分享页面组件 `PublicPatternPage`/`PublicCardGallery`/`PublicProductImage` 未修改。
- **更新后的状态（2026-10-21）**：用户批准后已通过统一发布工具正式上线，发布 ID `20261021t134811458-b98988bc`，详情见 [上线记录](card-library-one-pass-release-2026-10-21.md)。上线工具自动验证 PASS，已登录真实操作的最终视觉体验仍需用户生产验收；客户微信 H5 的已验收行为继续保留。
