# 色卡分享微信 H5 · 发布前验收记录（2026-10-21）

**状态：正式活动代码本地优化完成，未发布；不能以浏览器模拟代签微信实机验收。**

## 真实功能与隔离边界
- 已上线基线：2026-10-20 的色卡分享，当前客户维系 V1.2 的活动工作树 `D:\fabric\.agent-workspaces\v2-quality-20261020`。正式只读外链为 `/c/{43位token}`；不同于内部选样二维码，默认客户免登录访问。
- 本轮调整的是**活动工作树真实组件**：`src/components/customer-share/PublicCardGallery.tsx`、`PublicProductImage.tsx` 和 `PublicPatternPage.tsx`，不是 `PublicPatternGallery` 历史 B1 方案。
- 保留服务器端卡范围、公开字段白名单、链接撤权、实时图片二次校验；不变更 SQL/令牌签发、COS 数据和实际部署。前端 `PublicPatternPage` 保持 `credentials:'omit'` 和 `cache:'no-store'`。
- 移动端以图片为主，按配色分组，保留面料大图、细节图和效果图的归属及空态、色卡参数首屏可读、配色 44px 触控跳转、原页面点图放大。真实图片失败后可直接重试**相同受控图片路径**；永久 403 仍安全失败，不尝试替换令牌。
- 客户页底部刷新按钮改为轻量圆角按钮，初始加载文本区分色卡与其他花型分享，不改变旧 /s/ 和 /p/ 页面规则。

## 核验结果

| 项目 | 证据 | 结果 |
|---|---|---|
| 浏览器界面/接口/弱网/安全路径总回归 | `npm run test:ui:ux`，在 Edge 本机含模拟微信 UA、390/375/430px、图片重试、永久拒绝、404、503、白名单拒绝、焦点、配色切换及内部样板 | **17/17 PASS** |
| 服务端授权与前端专项测试 | 在活动工作树用 `node scripts/run-ts-tests.mjs server/customer-share/cardPublicRoutes.test.ts server/customer-share/cardShareCatalog.test.ts src/components/customer-share/cardWeChatMobile.test.ts src/components/customer-share/PublicProductImage.test.ts` | **8/8 PASS** |
| 新版真实组件的专项 TypeScript | `tsc --noEmit` 对 3 个分享组件和浏览器脚本定向校验 | **PASS** |
| 活动 V2 客户端手工隔离构建 | 直接执行 Vite 构建至 `artifacts/ui-ux-pilot/active-v2-client-build`，不触发发布工具、不建后端 | **PASS**（并非全栈正式 build） |
| 真实图片手机查看 | 只读使用本机 `D:\歌朗\面料展示图\12度假条纹\G0626*.png` 及 `D:\歌朗\效果图\12度假条纹\G0626.png`；生成本机测试的 4 张 720px WebP，71–82KB/张，通过 mock 图片 API 注入正式组件；验证图片尺寸、解码、点击放大、关闭和本机同源请求 | **PASS**（仅 UI/资源，非正式产品映射） |
| 源码冻结校验 | `node scripts/fabric-v2-workspace.mjs check` + 原冻结清单只读 SHA 对比 | **BLOCKED**：原清单 721 项中 3 个组件修改，另有 1 个新增测试；不可擅自篡改旧发布清单 |
| 正式公开 API / COS / 微信 iOS 安卓真机 | 未使用真实生产令牌/客户数据，不请求真实私有 COS，未连接手机微信 | **未验证** |
| 全量 TS/lint、正式发布工具和生产回归 | 曾遇 Node 堆 OOM；本轮没有以旧通过状态冒充当前通过 | **待完成** |

## 媒体与屏幕证据
- 本机实物素材**原文件未修改**，只在 `artifacts/ui-ux-pilot/fixture-media` 存放 WebP 派生样张。样张和 `artifacts/ui-ux-pilot/wechat-real-fabric-g0626-mobile.png`、`wechat-real-fabric-g0626-zoom.png` 仅作本机内部验收，不发布公共样板。
- G0626 源图各自可能对应不同配色，图片拼组只是页面排版与图片性能测试，**不验证实际色卡—配色—产品—图片对应关系**。正式映射只能通过现有授权后端确认。
- `ui-ux-wechat-review.html` 为静态模拟视觉样板；`ui-ux-wechat-route.html` 为正式 React `PublicPatternPage` 的本机模拟 API 调试入口，默认不接生产后端。均不能发送客户。

## 上线前阻断项 / 操作次序
1. **重新冻结发布候选**：从已确认的活动工作树和当前 3 个组件＋1 个新测试差异创建新的验证清单，保留 2026-10-21 已发布原清单不覆盖。核对该工作树其他未提交业务变更的发布范围；不使用 `git add -A`。
2. **正式产品映射与媒体**：用一张受控真实业务色卡检查关联产品各配色、三类图片身份一致，确认成分克重门幅、缺图、原始图片被撤权时的安全响应。暂不向聊天输入或公开有效令牌。
3. **真机**：在 Android/iPhone 微信内，从内部测试聊天打开有效 HTTPS `/c/` 链接，检查直接打开免登录、首屏图片/文字、不同配色跳转、大图缩放与关闭、返回聊天、弱网以及被停用/删除色卡。微信 UA 浏览器模拟不能代替这项。
4. **上线操作**：只有完成候选验证、单独部署授权、统一发布工具备份／回滚准备及发布后公网验收，才允许生产发布。**本轮无生产部署、无生产 DB/COS 修改。**

## 后续工作和范围
- 以内部系统效率优先；微信分享页仅使用必要的移动端图片展示样式。小修继续走定向测试，正式发布走统一质量/源校验门禁。
- 对客户端初始包大小和长列表实测资源耗时可在真实 COS 测试中记录；从 4 张本地压缩测试图的尺寸，不能推算公网性能。
