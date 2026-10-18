# 花型取消、标签与选样货号勾选修正

> 执行：单实现者，按executing-plans逐项RED→最小修复→GREEN；基线1036d5c。

目标：图片选择器取消不触发父弹窗离页确认，新增花型可选题材/颜色，已选列表按稳定选样条目ID（对应货号）勾选并统一批量移除。

约束：复用现有React和标签API；保留花型草稿本身的离页保护、标签10项/归档规则、永久配色、来源/扫描/人工/寄样/跟进历史；无新DDL，无正式切流。唯一需求为product-master-v2-requirements.md；用户最新确认优先于旧整卡移除UI。

- [x] 图片取消：真实浏览器复现input cancel冒泡到dialog，确认只处理弹窗自身cancel；保留草稿、已有图片和父弹窗。修改PatternWorkspaceV2.tsx，浏览器脚本先RED。
- [x] 新增标签：复用PatternLibraryV2的TagSelector/InlineColorTagEditor、loadCatalogTags及已有主花型PUT；patternCreateModel.ts保留部分成功进度、确定4xx可重试、结果不明禁止重复。专项验证标签持久化、失败不重复建花型/配色。
- [x] 货号勾选与统一移除：SampleSelectionPanel.tsx按item.id每行一个框，页内全选和跨页保留；去掉重复行内操作列，表头单一“移除所选（N）”。sampleSelectionClient/Workspace及sessionRemove/Routes新增严格itemIds批量接口，全量校验、按ID锁行、同事务软移除+审计，任一失败全回滚。原整卡API保留兼容但UI不再使用。
- [x] 验证与交付：专项、统一串行单测/lint/build、只读审查、隔离真实MySQL/COS/浏览器后刷新52987。更新唯一需求/进度、同题复盘及索引，历史计划/复盘保留，人工UI和正式发布Gate另列；文档镜像逐文件外部SHA备份，禁止删除。

实际结果：取消误弹和标签409锁死均观察浏览器RED→GREEN；专项25/25、统一1281项（1280通过/1跳过）、lint/build通过；独立只读复审P2关闭，无其它确认P1/P2。真实候选14项通过，精确itemId跨页移除与历史数量实查，当前包c94cf5277a77b2a7b831b60f74ffbd887a98822b168afe5bb86fdb9dad8c71d8。人工UI/手机纸打、当前包独立恢复、正式发布Gate仍开放，本计划/同题复盘保留，无归档。
