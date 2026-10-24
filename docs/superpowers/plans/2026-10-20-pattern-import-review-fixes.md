# 花型导入复查缺陷修复实施计划

> 2026-10-24 目录整理：本文部分历史路径对应的临时文件、已退役源码副本或旧发布证据已完整迁至仓库外；原路径作为历史定位保留，按[归档恢复索引](../../maintenance/2026-10-24-workspace-archives.json)中的范围和逐文件 SHA256 查找原件。未完成的业务 Gate 仍按当前进度保留。

> 执行方式：本会话直接修复用户已批准的五项缺陷，按系统排查与测试驱动逐项验证，最终独立审查。既有隔离工作区继续使用，不新增客户模块、不部署。

**Goal:** 修复审查记录中的导入低号失败、来源校验、20MB限制、离开保护与返回关闭。

**Architecture:** 不更改数据库结构或放开历史序号计数器。按母版处理失败屏障：失败后同母版后续项明确暂停，其它母版继续；未知提交不自动重试。原生dialog复用现有离开注册；卸载后不再发起新上传/POST。前后端产品图片限额统一20MB。新活动清单独立保存，旧发布证据不变。

**Spec:** docs/product-master/product-master-v2-recheck-20261020.md、唯一需求1.4。

## 任务与验证

- [x] 先新增组件回归：G0008-1失败后2不上传/不提交，H0001-1仍成功；重选1/2可依序完成；双击只发一次；忙碌取消/Esc拒绝，空闲原生取消关闭；离开注册busy；上传/POST等待时强制卸载不发后续请求。
- [x] 新增真实客户端上传20MB流程及20MB+1拒绝、服务端20MB策略边界，观察修复前失败。
- [x] 修改PatternBulkImportDialog.tsx、patternBulkImportModel.ts，复用useV2LeaveProtection及ProductCardCreateDialog模式，不改变后端不复用规则。未知POST失败暂停同母版，不自动重试。
- [x] 修改src/lib/imageAssets.ts及server/image-assets/policy.ts产品图片限额；公司资源仍2MB。routes.test.ts过限夹具更新为20MB+1/+2，保持真实413断言。
- [x] 完成定向RED→GREEN后，串行全量unit/lint/build/security/image smoke/delivery测试；用既有独立审查技能复核。
- [x] 生成artifacts/pattern-import-fixes-20261020/source-manifest.json，更新开发校验常量与根目录活动指针；验证check成功、篡改/新文件/错HEAD/需求漂移/历史工作区/命令注入均拒绝。旧646清单和发布source-fence不覆盖。
- [x] 更新需求中失败暂停说明、进度与审查修复证据；最后同步文档和新证据到主目录。

## Review Focus

- 上传失败和HTTP提交结果不确定均需暂停该母版，不能仅处理某类异常。
- 多母版之间仍独立，暂停不冒充提交失败/成功。
- 强制卸载发生在上传后POST前，以及POST挂起时均不启动后续项。
- 忙碌状态立即防重复、空闲可关闭、关闭后不再后台写入。
- 20MB字节边界前后端一致，不改变公司资源限制、不降低MIME和像素校验。

既有历史低号已被旧计数器覆盖时，无法可靠区分从未使用和已删除；不自动改生产计数器/补号。保留历史号保护，修复重点防止再因同批失败造成该状态。
