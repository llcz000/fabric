# Fabric 唯一正式源码目录迁移（2026-10-24）

## 正式目录与版本

唯一日常开发、验收、Git 集成和统一发布工具入口为 `D:/fabric`。源码 `src/`、`server/`、`server.ts`、`scripts/`、`docs/` 全部位于仓库根。原 `.agent-workspaces/v2-quality-20261020` 是迁移前的正式应用工作树，不再作为开发入口。

迁移以应用分支 `codex/v2-current-preserve-20261023` 的 `f5b11720cd984084e368f0dc955b3c1336e3a647` 为基线：应用 `src/` 与 `server/` Git tree SHA 保持不变。原控制目录最后提交 `27023ce6e1c69f1e73c4a473c41db8c7d02002f7` 通过具有两个父提交的整合历史保留。仅取回根目录独有的并行开发工具、通用技能、项目维护资料及少数最新的维护索引；冲突文件以应用代码为准，修改发布器和并行工具以适配同根布局。

新指针 `docs/project/fabric-v2-active-workspace.json` 使用 `role: application` 和 `workspace: "."`。应用根执行 `npm run workspace:init` 建立本地被忽略的源码 SHA256 基线，然后执行 `npm run v2:source`；源码和需求变更需在提交后更新校验清单。所有并行任务使用临时隔离 Git worktree，验收合并后安全退役；禁止复活 Controller/Active 两套日常检出。

## 隔离验收和后续环境核验

- 在隔离集成工作树运行 `npm run lint`：通过。
- 运行 `npm run build`（前端、后端、恢复工具和摄像头构建）：通过，原业务 `src/` 和 `server/` 未改变。
- 运行 `npm run test:release`：本地、源码门禁、UI质量、UI工作流、远端故障模拟、HTTP契约等 6 阶段通过，明确 `productionModified: false`。
- 运行 `npm run test:parallel`：6/6 通过，含新增单根任务分配用例。
- 文档导航检查：134 份文档、873 个链接，通过。
- 以上均为隔离本地验证；最终切换到 `D:/fabric` 后必须重新验证 Git 状态、源身份、构建和发布前置检查。未授权生产发布/SSH远程写入/数据库变更。

## 清理和恢复

旧根及应用提交历史作为 Git 父提交或原始旧分支保留；旧应用私有 `.local`、依赖和业务数据不可当作普通临时产物直接删除。保存校验清单、原旧分支 SHA 和必要原件到 `D:/fabric-knowledge-backups/` 后，才能退出旧应用工作树。无关 `node_modules`、`dist` 可以重建，不覆盖原始 `.env`、客户图片、`uploads/` 或 `template/`。

**最终验收条件：** `git worktree list` 只有 `D:/fabric`（没有临时工作树），`npm run parallel -- audit` 返回 `projectClean: true` 与 `allRegisteredClean: true`，单根 `npm run v2:source` 通过，发布工具离线测试通过。线上验证与部署单独授权。
