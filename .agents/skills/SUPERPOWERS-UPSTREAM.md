# Superpowers — 本项目离线技能副本

本目录部分项目级技能来自 [obra/superpowers](https://github.com/obra/superpowers)（Jesse Vincent，MIT许可；许可文本见 `SUPERPOWERS-UPSTREAM-LICENSE`）。这些是针对本地 WebCodex 无法直接加载 ChatGPT Superpowers 的**最小可用离线副本**，不是 OpenAI插件的共享安装，也不是运营系统业务事实来源。2026-10-12通过已连接GitHub读取官方文件；未执行仓库中的脚本。

**已安装**：`writing-plans`、`executing-plans`、`test-driven-development`、`systematic-debugging`、`requesting-code-review`、`verification-before-completion`；相关辅助文档按相对路径原样保存。

**非已安装**：`subagent-driven-development` 等需要多Agent调度支持的技能；当前WebCodex没有经验证的spawn子Agent工具，计划执行阶段只能在有真实调度能力时分工。Fabric的业务约束统一由 `fabric-product-master-v2` 与最新 `docs/product-master/README.md` 关联。

## 来源与版本追踪

GitHub repository: `obra/superpowers`, default branch `main`（如需更新，应核对下表SHA并回归测试，不能覆盖Fabric项目技能）。

| 原始路径 | GitHub blob SHA |
| --- | --- |
| `skills/writing-plans/SKILL.md` | `4cf0275d88d67aa4ef09f4bbca9970ed6ff74a00` |
| `skills/executing-plans/SKILL.md` | `49077ad961268a840d7dcb5d8c5d06c46fc276ae` |
| `skills/test-driven-development/SKILL.md` | `46838cc9e893c06259e3bdad0fc2425b36242f15` |
| `skills/test-driven-development/writing-good-tests.md` | `d3c4482fd30b4f9084bb61545fe73939a7502c28` |
| `skills/systematic-debugging/SKILL.md` | `62fc752aaef59a8bbed5d305f4cadc60f8ae07ed` |
| `skills/systematic-debugging/root-cause-tracing.md` | `0e72e8f9566b7ef85e814633d1feacad9d0c5868` |
| `skills/systematic-debugging/defense-in-depth.md` | `e2483354dc2b62478a2624e34ca18bc0efe887b2` |
| `skills/systematic-debugging/condition-based-waiting.md` | `70994f777c586f7d4c43033aac34c7cf0da6688b` |
| `skills/requesting-code-review/SKILL.md` | `68d338a58ecdd8b77bfbb519b781ef223dbbb842` |
| `skills/requesting-code-review/code-reviewer.md` | `6d358b5d7d450c83cacbe450b7dbd4e673b694ad` |
| `skills/verification-before-completion/SKILL.md` | `7d45333cc4a49c57a80df6c1fe2fa777a207afbc` |
| `LICENSE` | `abf0390320aa14406af7a520b9b0739fdda9bf08` |

检查入口：`node scripts/check-fabric-v2-skill.mjs`、在WebCodex中按技能原名调用 `skill_load`。只有实际加载成功的技能才能计为WebCodex可用。
