# 统一图片资产系统运维手册

本手册描述 Fabric DMS 统一图片资产系统的存储模型、功能开关、上传/迁移、回收与对账运维流程。设计依据见 docs/superpowers/specs/2026-08-22-unified-image-asset-system-design.md，实施计划见 docs/superpowers/plans/2026-08-22-unified-image-asset-system.md。

## 存储模型

生产以私有腾讯云 COS 为唯一权威文件存储；本地存储仅在显式选择 ASSET_STORAGE_PROVIDER=local（开发或单节点应急）时使用，绝不作为单次请求失败时的自动回退。

数据库新增六张表（全部为增量 DDL，CREATE TABLE IF NOT EXISTS）：

- image_assets：经服务端验证的图片内容元数据。sha256 唯一（内容寻址去重）、status（quarantine/processing/ready/recycled/purging/degraded/purged）、ref_count 引用计数缓存、recycled_at/purge_after/purged_at 回收语义。
- image_asset_variants：每个资产的原图 original、展示图 display 与（产品图）缩略图 thumbnail。object key 为内容寻址路径 assets/sha256/aa/bb/sha256/variant.ext。
- image_upload_sessions：隔离区上传会话，默认 24 小时过期。
- image_processing_jobs：数据库任务表 + 应用内 worker，含尝试次数、locked_at、last_error_code。
- company_image_assets：公司图片关联，(company_id, role) 唯一，role 支持 brand_logo/wechat_qr/alipay_qr。
- product_image_assets：产品图片关联，含 role（pattern_original/gallery/swatch）、sort_order、is_primary、legacy_product_image_id、软删除 deleted_at。

业务表只保存资产 ID 与 object key，不保存永久签名 URL 或新 Base64 图片。

## 功能开关

| 环境变量 | 默认 | 说明 |
|---|---|---|
| IMAGE_ASSETS_ENABLED | false | 资产运行时总开关（需 MySQL） |
| COMPANY_IMAGE_ASSETS_ENABLED | false | 公司 Logo/二维码走资产链路 |
| PRODUCT_IMAGE_ASSETS_ENABLED | false | 产品图片走资产链路 |
| ASSET_STORAGE_PROVIDER | cos | cos 或 local |
| ASSET_SIGNED_URL_TTL_SECONDS | 300 | 签名 URL 有效期（秒） |
| ASSET_UPLOAD_GRANT_TTL_SECONDS | 900 | 直传授权有效期（秒） |
| ASSET_UPLOAD_SESSION_TTL_SECONDS | 86400 | 上传会话有效期（秒） |
| ASSET_RECYCLE_DAYS | 30 | 回收保留天数（仅允许 30） |

约束：COMPANY_IMAGE_ASSETS_ENABLED 或 PRODUCT_IMAGE_ASSETS_ENABLED 为真时 IMAGE_ASSETS_ENABLED 必须为真，否则启动失败。启用任一业务开关时要求 MySQL 可用，否则启动失败。

## 上传与迁移

浏览器直传隔离区，服务端 finalize 做 Sharp 校验 + SHA-256 去重，后台 worker 生成 variants 并转正。客户端不能选择正式 object key，服务端不信任客户端 MIME/尺寸/哈希。

历史数据迁移：

    npm.cmd run migrate:image-assets -- --dry-run --domain=all --report=migration-report.json
    npm.cmd run migrate:image-assets -- --apply --domain=company --batch-size=100
    npm.cmd run migrate:image-assets -- --apply --domain=product --batch-size=100

迁移默认 dry-run；--apply 才写库；--after-id 断点续跑；--report 路径拒绝越界。重跑跳过已完成 legacy ID 并按 sha256 去重。批量上传使用 scripts/upload-product-images.mjs（走鉴权资产 API，不直接写 COS/DB，不打印密码或 token）。

## 回收与清理

引用数降为零时资产进入 recycled 并设 purge_after = recycled_at + 30 days。30 天内保留原图与全部 variants，重新关联可恢复为 ready。清理 worker 物理删除前加锁并二次确认状态/引用/purge_after；全部 variants 删除成功后才标记 purged，部分失败记录具体 variant 并重试。共享资产只要有任一有效引用就不会回收。

## 对账（reconciliation）

每天一次的 worker 对账执行以下只读/安全动作，绝不直接物理删除：

- 重算 ref_count（以 company_image_assets + product_image_assets 的有效关联为准），把零引用的 ready 转 recycled、有引用的 recycled 转 ready。
- 枚举孤儿候选：ref_count = 0 且 recycled 且 purge_after 已过期（仅列表，不删除）。
- 缺失对象检测：对非 purged/purging/quarantine 资产逐 variant 用 StorageAdapter.exists() 检查，任一 variant 缺失即把资产标记 degraded + error_code=ASSET_NOT_FOUND（不删除对象）。
- 启动恢复：把 locked_at 超过 5 分钟的 processing 任务重置为 queued。

每轮对账输出一条 JSON 汇总日志（stage: reconciliation，含 refCountDrift、missingObjects、orphanCandidates、elapsedMs）。孤儿物理删除不在本期范围内——只有数据库已知、零引用且超过 purge_after 的资产才由 purge worker 物理删除。

## 结构化日志与脱敏

server/image-assets/observability.ts 提供 redactLogText 与 safeLogLine：结构化日志保留 requestId/assetId/jobId/errorCode 等稳定字段，丢弃 authorization/cookie/set-cookie/password/secret/token/bearer/sign/signature 等敏感字段，并对字符串值里的密文做正则脱敏。日志不得包含 Cookie、密钥、完整签名 URL。

## 稳定错误码

UPLOAD_SESSION_EXPIRED、IMAGE_CONTENT_INVALID、IMAGE_LIMIT_EXCEEDED、ASSET_NOT_READY、ASSET_ACCESS_DENIED、ASSET_NOT_FOUND、ASSET_PROCESSING_FAILED、STORAGE_UNAVAILABLE。统一错误响应形如 error.code、error.message、error.requestId、error.retryable；前端只自动重试 retryable 为 true 的请求。

## 回退与上线顺序

回退方式是在包含新旧读取能力的新版本中关闭对应业务开关，不删除新表、不回滚数据。上线顺序：先部署基础设施（业务开关全关）并验证 COS CORS/签名/处理/同源内容，再启用公司资产并迁移公司图片，再启用产品资产并验证共享删除，迁移先 dry-run 再分域 apply。旧字段与旧文件在整个观察期内保留。

## 非目标

模特库、换装任务、花型循环尺寸/DPI/色彩空间等专业打印元数据不在本期实现范围内。
