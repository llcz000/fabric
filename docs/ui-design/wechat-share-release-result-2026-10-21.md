# 微信色卡分享 H5 线上发布结果 · 2026-10-21

## 正式状态
- **已上线成功并完成二次状态检查**，统一发布 ID：`20261021t120746473-e5a8dff9`。
- 发布制品 SHA256：`d3e761fa38697a705832d6640bb2564c622f45187e669a1024edb844b7264ae5`。
- 线上正式入口：`https://124.223.97.60`。客户打开的有效色卡链接仍由**内部色卡库现有分享操作**产生；没有在记录里添加/生成真实客户 token。
- 发布前基线：`20261021t081722632-881267a4`。已发布的旧源清单继续保留，新源码清单为 `artifacts/wechat-share-ui-release-20261021/source-manifest.json`，范围严格限定三个分享组件及一个专项单测，共验证 722 条源码。
- `docs/project/fabric-v2-active-workspace.json` 和根目录指针已更新 currentRelease；release-state 的基线由统一工具成功验证后更新。

## 正式发布执行与验证
| 阶段 | 状态 |
|---|---|
| 源验证 / 完整 HTTP 合同 / 构建 / 制品冻结 | PASS |
| 上传 / 生产预检 | PASS |
| 一致性备份 / 加密离机回读 | PASS |
| 隔离恢复演练 | PASS |
| 生产程序原子安装 | PASS |
| 统一工具远端 verify / 独立公网资源哈希验证 | PASS |
| 二次 `npm run release -- status` | PASS，远端全阶段均 passed |
| 公网匿名首页 / `/api/health` / `/api/runtime` | 200 |
| 无效 43 字符的 `/api/public/cards/{token}` | 404，未泄露产品数据 |
| 公网 Edge 手机模拟访问无效 `/c/{token}` | SPA 路由 200、页面呈现“暂不可用”，无内部按钮 |
| 用户 iOS/Android 微信有效链接真机测试 | 待用户实际查看 |

- 发布结果：`.agent-workspaces/v2-quality-20261020/artifacts/releases/20261021t120746473-e5a8dff9/release-result.json`。
- 冻结制品与日志：同目录下的 `run.json`、`manifest.json`（在 `package` 中）、`source.log`、`build.log`、各远端阶段日志、`database.sql.gz.enc` 与 `offsite.json`。
- 报告命令：`npm run release -- report 20261021t120746473-e5a8dff9`；按记录合计约 **41.5 秒**，不包含人工检查等待。
- 生产未运行迁移，保留原 MySQL 数据、COS 图片；备份为发布保护措施。程序回滚入口是统一工具的 `npm run release -- rollback 20261021t120746473-e5a8dff9`，但不要无故执行。

## 本地验收与仍待观察
- 部署前 17/17 项 Playwright Edge 测试通过；前端/后端分享专项 8/8 通过；局部 TS 和正式客户端构建通过。部分素材使用本机 G0626 图片压缩副本，**不意味着已经核实真实数据库中每张图片归属**。
- 现有公开客户页浏览器标题仍显示“面料单据管理系统”（全局 index.html 标题），微信顶部可能展示这一内部名称；建议下一轮在 `/c/` 页面设置客户适合的页面标题，并复查微信内显示，不影响本次链接功能及安全校验。
- 尚需用户在 Android 与 iPhone 微信中用内部色卡库正常生成的有效分享链接，检查真实素材、配色、点击放大、重试、页面返回聊天、首屏加载及链接撤权。不要公开传播测试 token。
- 本轮发布未批量提交其他工作树更改，没有重置/删除用户其他未提交文件。
