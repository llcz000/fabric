# 2026-10-17 Fabric V2 生产依赖高危补丁与兼容回归

**触发条件**：最新总进度审查已确认 V2 生产仍No-Go，前一轮COS 3与废弃Transformers依赖移除后，审查构建已绿但生产npm audit还报告16项漏洞（8 high）；其中涉及HTTP上传、图像处理、数据库驱动和解析依赖。这里的告警是审查分支package-lock的依赖树证据，不等于线上真正已安装版本。

**根因及处理**：multer 2.2.0、Sharp 0.35.3、mysql2 3.22.6、Express 4.22.2及传递的body-parser/qs/ip-address、postcss等处于已知受影响版本。先在被git忽略的tmp独立副本运行npm audit fix --package-lock-only（无--force，不修改本机共享node_modules），确认package.json和根声明不变、旧COS3/proxy-addr补丁不回退，再逐条审阅51个锁条目版本变化，其中多个只是Sharp的可选目标平台二进制条目；只将审查过的新package-lock写入独立review worktree。

**RED→GREEN**：新增锁定版本和嵌套包下限断言；在旧锁上红，新锁上绿。真正运行时冒烟不能把老dirty master共享的node_modules当新安装：先观察旧multer 2.2.0触发RED，再将multer 2.4.0/Sharp 0.35.5/Express 4.22.3/mysql2 3.24.6安装到ignored tmp独立prefix，验证小文件实际Express multipart上传/超限413、Sharp的SVG转PNG及损坏格式拒绝、MySQL字符串转义。GitHub CI在正式npm ci后执行相同冒烟，减少Windows隔离安装与Linux二进制差异导致的错判。

**当前安全证据**：更新后的package-lock按npm audit --omit=dev实际得到0 critical、0 high、2 moderate，前一轮8 high全部不再报告。剩余exceljs 4.4.0依赖旧uuid 8.3.2的bounds-check告警，npm自动修复提出不兼容降级到ExcelJS 3.4.0，故**没有执行--force**、没有为审计绿灯破坏既有xlsx代码。安全审计的结果受2026-10-17注册表公告时点影响，后续需要重新读最新告警；非静态发布授权。

**尚未验收的Gate**：本地/CI模拟multipart、图像转换与驱动转义只属于自动化兼容范围，尚无生产MySQL、真实云COS、文件上传规模/资源限制/网络中断、七页UI、三单据/Excel真实业务及备份恢复签收。即使0高危，正式P1–P7仍No-Go，不执行生产部署或旧API切流。唯一项目总状态保留于[项目现状](../../project/项目现状.md)，V2模块只在[当前进度](../../product-master/product-master-v2-progress.md)维护。

**归档判定**：本篇及运维审查门禁均为**保留**，需保存安全处理依据/剩余中危/上线Gate；旧同题历史快照仍保留历史时间点，不据此清理或移动。无归档候选。
