---
tags:
  - api
  - backend
updated: 2026-08-13
---

# API 清单

## 鉴权规则

- 基础路径：`/api`
- 白名单：`POST /api/login`、`GET /api/proxy-image`
- 其他端点要求 `Authorization: Bearer <token>`。
- token 当前仅存在服务端内存集合，无过期时间。

## 端点

| 方法 | 路径 | 用途 | 主要风险/备注 |
|---|---|---|---|
| POST | `/api/login` | 管理员登录 | 默认密码、无登录限流 |
| POST | `/api/logout` | 删除当前 token | UI 无明确入口 |
| GET | `/api/proxy-image` | 跨域图片代理 | SSRF 防护需完善 |
| GET | `/api/company` | 读取公司配置 | DB 异常会静默 fallback |
| POST | `/api/company` | 保存公司配置 | 缺少 zod schema |
| GET | `/api/orders` | 列出订单与明细 | 忽略分页参数、全量 JOIN |
| GET | `/api/orders/:id` | 读取单据 | ID 校验可统一 |
| POST | `/api/orders` | 创建单据 | zod parse 位置和错误码需修复 |
| PUT | `/api/orders/:id` | 更新单据 | 已使用事务 |
| DELETE | `/api/orders/:id` | 删除单据 | 已使用事务；前端不检查响应 |
| POST | `/api/upload` | 通用图片上传 | 本地文件生命周期、SVG |
| POST | `/api/template/upload` | 上传 Excel 模板 | 原名覆盖、模板类型未映射 |
| GET | `/api/template/config` | 读取模板配置 | JSON 文件并发安全 |
| GET | `/api/export_template/:id` | 导出单据 Excel | Base64 JSON，定金条款错误 |
| GET | `/api/inventory/entries` | 入库明细 | 全量返回 |
| POST | `/api/inventory/entries` | 批量新增入库 | 已 zod + 事务 |
| DELETE | `/api/inventory/entries/:id` | 删除入库 | 应校验删除结果 |
| GET | `/api/inventory/ledger` | 库存台账 | 按品名聚合，匹数口径待确认 |
| GET | `/api/products` | 产品列表 | 全量产品 + 图片索引 |
| GET | `/api/products/:id` | 单个产品 | — |
| GET | `/api/products/:productId/images/:imageId` | 原图 | 未校验 productId 归属 |
| POST | `/api/products` | 新增产品与图片 | 无事务/完整 schema |
| PUT | `/api/products/:id` | 更新产品与追加图片 | 无事务/完整 schema |
| GET | `/api/products/:id/thumbnails` | 缩略图或全图 | Base64 JSON、无分页 |
| POST | `/api/products/batch-delete` | 批量删除 | itemNos 可能扩大删除范围 |
| DELETE | `/api/products/:id` | 删除产品 | 文件与 DB 非原子 |
| DELETE | `/api/products/:productId/images/:imageId` | 删除单图 | 应验证父子关系 |
| POST | `/api/products/export` | 产品 Excel 导出 | 流式响应较合理 |
| POST | `/api/products/import` | 产品 Excel 导入 | 部分提交、错误吞掉 |

## 推荐统一响应

```json
{
  "data": {},
  "error": null,
  "meta": {
    "requestId": "..."
  }
}
```

错误至少区分 400 校验、401 未登录、403 禁止、404 不存在、409 冲突、413 文件过大、429 限流和 500 内部错误。

## 推荐中间件顺序

1. request ID / 结构化日志
2. 安全头与 CORS 策略
3. body 大小限制
4. API 与登录 rate limit
5. 认证/授权
6. 路由
7. 404
8. 统一错误处理中间件
