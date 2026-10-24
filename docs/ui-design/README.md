# Fabric UI 规范入口

> 仅用于现行界面设计与验收，不再保留“某年某月某日修复版本”作为规范副本。现行业务要求以[项目需求](../project/项目需求总览.md)为准。

**开工即执行 `npm run ui:preflight`。** 仅在已有用户批准的范围内修改 UI；页面、组件与弹窗合并审查，不做 PPT 式展示或无关大改。

| 需要解决的问题 | 对应规范 |
|---|---|
| 视觉、间距、列宽、行密度 | [design-system](design-system.md) |
| 搜索、多选、上传、弹窗、关闭/取消/错误处理、草稿保护 | [component-rules](component-rules.md) |
| 产品内外定位：内部高效操作；客户公开链接展示图片 | [product-positioning](product-positioning-2026-10-21.md) |
| 微信 H5 分享、手机滚动和大图 | [wechat-card-share](wechat-card-share-2026-10-21.md) |
| 一轮完成组件 + 页面 + 浏览器核验 | [one-pass-ui-review](one-pass-ui-review-2026-10-21.md) |
| 验收清单与最低证据 | [ui-review-checklist](ui-review-checklist.md) 与 [ux-delivery-gate](ux-delivery-gate.md) |
| WebCodex/ACP 交接 | [collaboration-workflow](collaboration-workflow.md) |

**强制区分**：工程测试通过、浏览器交互通过、人工视觉通过、生产发布是四种不同结论。新UI使用实际正式React组件；用户允许低效时弃用Stitch，只有明确使用远程画布才另做画布审查。

旧色卡、面料、客户和开单页面各轮截图/发布记录已做外部可恢复备份，且不再作为当前规范；旧工作区已退役，历史文件按恢复索引移出，不能从旧截图复原已修改的正式页面。来源可通过[恢复索引](../maintenance/文档整合与恢复.md)找回。
