---
title: "Fabric DMS 架构审计报告"
date: "2026-07-20"
category: "docs/solutions/architecture-patterns/"
module: "System Architecture"
problem_type: "architecture_pattern"
component: "development_workflow"
severity: "critical"
applies_when:
  - "评估 Fabric DMS 代码库的生产就绪程度"
  - "规划重构迭代或安全审查"
  - "为新开发者 onboarding 提供 Express.js + React 技术栈指引"
symptoms:
  - "MySQL 连接池初始化时序竞争导致冷启动时订单明细丢失（已修复）"
  - "数据库凭证硬编码在版本控制的 .env.example 文件中"
  - "所有 API 端点均无认证或授权机制"
  - "多表订单变更操作缺少事务包裹，存在数据部分写入风险"
  - "MySQL 与 JSON 双路径存储造成数据一致性隐患"
root_cause: "config_error"
resolution_type: "documentation_update"
tags:
  - "mysql"
  - "react"
  - "express"
  - "race-condition"
  - "credentials-exposure"
  - "no-authentication"
  - "architecture-audit"
  - "fabric-dms"
related_components:
  - "database"
  - "frontend_stimulus"
  - "tooling"
---

# Fabric 单据管理系统 -- 架构审计报告

## 背景

Fabric 单据管理系统（Fabric DMS）是一个基于 Express.js + React + MySQL 的面料行业单据管理应用。支持两种单据类型：样布码单和销售发货码单，功能涵盖公司信息管理、COS 图片上传、Excel 模板解析以及数据统计看板。

本次对 `D:\fabric` 完整代码库进行了四个维度的全面架构审计——可用性、交互性、可维护性和安全性。共发现 19 项问题，涉及时序竞争、缺失错误边界、双路径数据库逻辑以及关键凭证泄露。

本文档按严重等级整理各项发现，提供精确的代码引用、可测试的验收标准以及可操作的修复指引。

## 修复指引

### 1. 可用性

可用性问题涉及系统在启动和负载下保持正常运行并提供正确数据的能力。

---

#### ✅ 已修复：MySQL 初始化时序竞争

**严重等级**：高 —— 存在静默数据丢失风险
**文件**：`server.ts:729-759`

原始代码在模块顶层调用 `getMySQLPool().catch(...)` 但未使用 `await`，导致 `startServer()` 在 MySQL 初始化完成前就开始接受 HTTP 连接。在此窗口期内，`useMySQLFallback` 为 `true`，所有 API 请求均由 JSON fallback 文件处理。这导致 `order_items` 被写入 JSON 文件但从未持久化到 MySQL，即使数据库连接池最终成功连接。

**已应用的修复**（`server.ts:729-736`）：将 `await getMySQLPool()` 移入 `startServer()` 内部，位于 `app.listen()` 之前。现在 MySQL 保证在服务器接受连接前已准备就绪。

**验收标准**：使用有效的 `DB_*` 环境变量启动服务器。在启动后 2 秒内到达的任何 API 请求均不得路由到 JSON fallback 路径。日志行 `[Database] Running in JSON local file fallback mode.` 仅应在 MySQL 配置确实缺失或不可达时出现。

---

#### 多表变更操作缺少事务包裹

**严重等级**：高 —— 存在部分数据损坏风险
**文件**：`server.ts:556-631`（PUT 路由）、`server.ts:486-554`（POST 路由）

PUT `/api/orders/:id` 处理器依次执行三个操作——UPDATE 订单、DELETE 所有明细、然后循环 INSERT 新明细。这些操作均未包裹在 MySQL 事务中。如果进程在 DELETE 和 INSERT 循环之间崩溃或连接断开，该订单将永久丢失所有明细。POST 处理器存在类似问题：先插入订单，再逐条插入明细——循环中途崩溃将留下一个缺少部分明细的订单。

**建议修复**：

```typescript
// server.ts:556-631 PUT /api/orders/:id -- 包裹在事务中
const conn = await pool.getConnection();
try {
  await conn.beginTransaction();

  await conn.query(`UPDATE orders SET ... WHERE id = ?`, [...values, orderId]);
  await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);

  for (const item of data.items) {
    await conn.query(
      `INSERT INTO order_items (...) VALUES (?, ?, ...)`,
      [orderId, ...itemValues]
    );
  }

  await conn.commit();
  return res.json({ success: true });
} catch (error) {
  await conn.rollback();
  throw error;
} finally {
  conn.release();
}
```

**验收标准**：在 PUT 操作进行中强行终止服务进程。重启后，订单必须处于其原始状态（无部分 UPDATE 而不带明细，无孤立明细而无父订单）。

---

#### JSON Fallback 并发写入竞争

**严重等级**：中 —— 并发负载下存在数据丢失风险
**文件**：`server.ts:251-253`

`saveLocalDB()` 使用 `fs.writeFileSync()` 且无文件锁。如果两个请求同时调用 `saveLocalDB()`（例如两个不同用户同时 POST 订单），第二次写入可能在第一次完成前覆盖它，导致数据损坏或丢失。

**建议修复**：使用带互斥锁（如 `async-mutex`）的 `fs.promises.writeFile()`，或为 fallback 路径切换为轻量级嵌入式数据库如 `better-sqlite3`。

**验收标准**：针对 JSON fallback 模式（无 MySQL）发起 10 个并发的 POST /api/orders 请求。全部 10 个订单必须被持久化。不存在缺失或部分写入的记录。

---

#### 无数据库连接重试机制

**严重等级**：中 —— 瞬时故障导致永久降级
**文件**：`server.ts:79-212`

`getMySQLPool()` 仅尝试一次连接。失败后将 `mysqlPool` 设为 `null`、`useMySQLFallback` 设为 `true` 并抛出异常。没有重试逻辑。一次瞬时网络抖动或 MySQL 重启就会导致应用在进程剩余生命周期内永久降级到 JSON fallback。

**建议修复**：添加指数退避重试，配置可配置的最大重试次数（默认 3 次）。最终失败后，可选择让进程崩溃并交由编排器重启。

**验收标准**：停止 MySQL 后启动服务器，观测其以递增延迟重试 3 次。启动 MySQL，观测下一次重试成功且服务器恢复。

---

### 2. 交互性

交互性问题涉及前端用户体验：渲染正确性、错误恢复能力和响应性能。

---

#### useEffect 依赖缺失 —— 缺少 `docType`

**严重等级**：中 —— 类型切换后 UI 状态不正确
**文件**：`src/components/DocumentEditor.tsx:73-80`

初始化明细的 `useEffect` 仅依赖 `[existingDocument]`，但内部调用了 `createEmptyItem(docType)`。当用户通过 `handleDocTypeChange()`（第 83-91 行）切换单据类型时，effect 不会重新执行，因为 `docType` 不在依赖数组中。`handleDocTypeChange` 函数手动调用 `setItems(...)` 作为变通方案，但 effect 的依赖列表是不正确且具有误导性的。

```typescript
// 当前（有 bug）：第 73-80 行
useEffect(() => {
  if (existingDocument) {
    setItems(existingDocument.items);
  } else {
    setItems([createEmptyItem(docType), createEmptyItem(docType), createEmptyItem(docType)]);
  }
}, [existingDocument]); // 缺少 docType 依赖
```

**建议修复**：将 `docType` 加入依赖数组，或从 effect 中移除 `createEmptyItem(docType)` 调用（因为 `handleDocTypeChange` 已处理此逻辑）。

**验收标准**：编辑一份现有样布码单。切换为销售类型。明细列表必须显示 3 行带有匹号字段的空白销售型行。

---

#### 无 React 错误边界

**严重等级**：中 —— 任何渲染错误导致白屏
**文件**：`src/components/` 下所有 `.tsx` 组件

组件树中未定义任何 React Error Boundary。如果任何组件在渲染期间抛出异常（如 API 返回的畸形数据、类型不匹配），整个应用崩溃为空白白屏。用户丢失未保存的工作且无恢复路径。

**建议修复**：创建 `src/components/ErrorBoundary.tsx` 包裹关键路由：

```tsx
import React from 'react';

interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  State
> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-8 text-center">
          <h2>页面出现异常</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**验收标准**：在 DocumentEditor 中故意抛出一个错误。应用必须显示降级 UI（而非空白白屏）。用户必须能够导航回单据列表。

---

#### StatsDashboard 缺失 Memoization

**严重等级**：低 —— 不必要的重渲染
**文件**：`src/components/StatsDashboard.tsx:15-47`

父组件 `App.tsx` 的每次状态变更都会触发全部派生统计数据的完整重计算——`sampleDocs`、`salesDocs`、`totalMeters`、`productMetersMap`、`sortedProducts`、`recentDocs`。这些计算均未使用 `useMemo` 包裹。产品排名计算需要每次渲染遍历每份单据的每条明细。

**建议修复**：将所有派生计算用 `useMemo` 包裹，并设置正确的依赖数组。将 `StatsDashboard` 本身用 `React.memo` 包裹。

**验收标准**：使用 React DevTools Profiler，验证在 DocumentEditor 的文本框中输入不会导致 StatsDashboard 重新计算统计数据。

---

#### 无 Toast 通知系统

**严重等级**：低 —— 错误反馈不友好
**文件**：`src/components/DocumentEditor.tsx`、`src/App.tsx`

所有错误反馈要么使用 `alert()`（阻塞式、体验差），要么使用 `console.warn()`（用户不可见）。没有非阻塞的通知系统（toast）。用户可能未意识到 API 调用失败。

**建议修复**：集成一个轻量级 toast 库（如 `react-hot-toast`）或构建一个简单的 context-based toast 系统。将所有 `alert()` 和静默的 `console.warn()` 调用替换为 toast 通知。

**验收标准**：触发一个失败的 API 调用（断开网络）。必须出现一个非阻塞的 toast 通知。用户必须能够将其关闭。

---

#### 传递未使用的 Props

**严重等级**：低 —— 代码噪音
**文件**：`src/components/DocumentEditor.tsx:14,22`

prop `allSavedDocuments: DocumentData[]` 在 `DocumentEditorProps` 接口中声明并在函数签名中解构，但组件体内从未引用。它由 `App.tsx:584` 以 `allSavedDocuments={documents}` 传入。

**建议修复**：从 `DocumentEditorProps` 和 `App.tsx` 中的调用处移除 `allSavedDocuments`。

**验收标准**：`grep allSavedDocuments src/components/DocumentEditor.tsx` 返回零结果。

---

### 3. 可维护性

可维护性问题涉及代码结构、数据库 schema 质量和运维规范化。

---

#### MySQL/JSON 双路径模式导致所有业务逻辑重复

**严重等级**：高 —— 2 倍测试面，2 倍 Bug 面
**文件**：`server.ts:307-652`（所有 `/api/*` 路由）

每个 API 端点都遵循相同的模式：
```typescript
if (!useMySQLFallback) {
  // ~30 行 MySQL 逻辑
} else {
  // ~20 行 JSON fallback 逻辑
}
```

这意味着每个 bug 修复、schema 变更和行为调整都必须在两处应用。JSON fallback 在行为上也略有分歧（例如，`order_items` 在订单中嵌入存储，而 MySQL 中是规范化的），使其成为第二个实现而非真正的 fallback。

**建议修复**：将数据访问抽象为 repository 接口，提供两个实现：`MySQLOrderRepository` 和 `JSONOrderRepository`。所有路由处理器调用 repository 而无需知道底层哪个后端是活跃的。

**验收标准**：重构后，任何当前存在 `if (!useMySQLFallback)` 分支的路由处理器不应再包含此类分支。为订单添加新字段只需在每个 repository 实现中修改一处，而非每个路由处理器。

---

#### 无数据库 Migration 版本管理

**严重等级**：中 —— 随意的 Schema 演进
**文件**：`server.ts:163-177`

列的添加通过 try-catch 执行 `ALTER TABLE` 实现：

```typescript
const addColumnIfNotExists = async (table: string, column: string, definition: string) => {
  try {
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (_: any) {
    if (_.message && _.message.includes('Duplicate column name')) {
      // 忽略
    } else {
      console.warn(`[Database] Error adding column ${column}:`, _.message);
    }
  }
};
```

这种方式无法处理复杂迁移（数据转换、索引创建、外键约束），不提供回滚能力，且无差别地捕获所有错误——一个合法的 ALTER TABLE 错误（如磁盘满）会被静默吞掉。

**建议修复**：引入 migration 工具（如 `db-migrate`、`knex` 或自定义版本化 migration runner），在 `_migrations` 表中追踪已应用的迁移。

**验收标准**：存在 `migrations/` 目录，内含按序编号的 SQL 文件。重复应用迁移是幂等的。数据库追踪哪些迁移已应用。

---

#### 修复 SQL 每次启动无条件执行

**严重等级**：低 —— 数据量大时浪费资源
**文件**：`server.ts:179-193`

```typescript
const [repairResult] = await conn.query<ResultSetHeader>(`
  UPDATE orders o
  SET
    total_meters = (SELECT COALESCE(SUM(meters), 0) FROM order_items WHERE order_id = o.id),
    total_pieces = (SELECT COUNT(*) FROM order_items WHERE order_id = o.id),
    total_amount = (SELECT COALESCE(SUM(amount), 0) FROM order_items WHERE order_id = o.id)
`);
```

这个关联子查询在每次服务器启动时扫描所有订单和所有明细。当订单和明细数量超过 10,000 时，这将成为显著的启动延迟。此修复也是 denormalized schema 的症状。

**建议修复**：移除修复 SQL，或通过 `--repair` CLI 标志进行保护。更好的是，消除 denormalized 的汇总字段，改用 SQL 视图或即时查询计算。

**验收标准**：在无数据变更的干净启动中，修复 SQL 不得执行。启动日志必须显示零行受影响或根本没有修复。

---

#### `order_date` 列使用 VARCHAR(50) 而非 DATE

**严重等级**：低 —— 阻止日期查询和排序
**文件**：`server.ts:128`

```sql
order_date VARCHAR(50) NOT NULL,
```

将日期存储为字符串会导致无法进行 SQL 级别的日期过滤（带正确日期比较的 `WHERE order_date BETWEEN ? AND ?`）、排序以及按月/年聚合。字符串比较 `'2026-1-9'` 与 `'2026-10-9'` 会产生错误结果。

**建议修复**：改为 `order_date DATE NOT NULL`。确保所有 INSERT/UPDATE 语句传入正确格式的日期字符串。添加数据迁移将现有 varchar 日期转换为 DATE 类型。

**验收标准**：`DESCRIBE orders` 显示 `order_date` 类型为 `date`。按 `order_date DESC` 排序返回时间顺序正确的结果。

---

#### Denormalized 汇总字段需要持续修复

**严重等级**：低 —— Schema 异味
**文件**：`server.ts:131-133`

```sql
total_meters DECIMAL(12,2) DEFAULT 0,
total_pieces INT DEFAULT 0,
total_amount DECIMAL(12,2) DEFAULT 0,
```

这三个字段完全可以从 `order_items` 派生（米数 SUM、行数 COUNT、金额 SUM）。它们的存在创建了一个必须由应用代码维护的不变量，并且在直接添加/删除明细时会违反。每次启动执行的修复 SQL 就是应对此设计选择的变通方案。

**建议修复**：删除这些列并创建 SQL 视图：

```sql
CREATE VIEW order_totals AS
SELECT o.*,
       COALESCE(SUM(oi.meters), 0) AS total_meters,
       COUNT(oi.id) AS total_pieces,
       COALESCE(SUM(oi.amount), 0) AS total_amount
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;
```

**验收标准**：`SHOW COLUMNS FROM orders` 不包含 `total_meters`、`total_pieces` 或 `total_amount`。修复 SQL 已移除。

---

#### 未启用 TypeScript 严格模式

**严重等级**：低 —— 错过编译时安全保障
**文件**：`tsconfig.json`

`compilerOptions` 缺少 `"strict": true`。这意味着 `noImplicitAny`、`strictNullChecks`、`strictFunctionTypes` 等严格标志均被禁用。访问 `existingDocument?.customerName` 的函数可能静默产生 `any` 类型的值，在组件树中未经检查地传播。

**建议修复**：在 `tsconfig.json` 中添加 `"strict": true`，并逐步修复所有产生的类型错误（或逐个添加单独的 strict 标志）。

**验收标准**：`tsconfig.json` 包含 `"strict": true`。`npx tsc --noEmit` 报告零错误。

---

### 4. 安全性

安全性问题涉及系统及数据的机密性、完整性和可用性。

---

#### 🔴 严重：`.env.example` 中硬编码凭证

**严重等级**：严重 —— 版本控制中的凭证泄露
**文件**：`.env.example:13-21`

提交到 GitHub 的文件中包含真实有效的凭证：

```
DB_PASSWORD="Lq9749780"
COS_SECRET_ID="AKIDFMyDOQG7xgEf3JOK7nIeoofNwbpyzzvk"
COS_SECRET_KEY="1tdEeyVu9GVipnlkx2zmgOyPjtqTXWbg"
```

任何有仓库访问权限的人都可以使用这些凭证连接到生产 MySQL 数据库和腾讯云 COS 存储桶。这些凭证必须立即轮换。

**建议修复**：替换为占位符值（如 `DB_PASSWORD="your_db_password_here"`）。在生产环境中轮换实际凭证。确保 `.env` 已在 `.gitignore` 中。考虑使用 `git-filter-repo` 从 Git 历史中清除这些凭证。

**验收标准**：`.env.example` 不包含真实凭证。`grep -E '(AKID|Lq97|1tdEey)' .env.example` 返回零结果。生产凭证已轮换。

---

#### 所有 API 端点均无认证

**严重等级**：严重 —— 无限制的数据访问
**文件**：`server.ts:307-652`（所有 API 路由）

所有 API 端点均为公开的。任何可访问网络的客户端都可以读取所有单据、创建新单据、修改公司配置、上传文件以及删除订单。没有认证中间件、没有会话管理、没有 API key 验证。

**建议修复**：添加基于 JWT 或 session 的认证中间件。至少对写操作要求 API key 请求头。对于生产部署，集成 OAuth2 提供者或实现用户名/密码认证。

**验收标准**：不带认证信息发送 `GET /api/orders` 返回 401。不带认证信息发送 `POST /api/orders` 返回 401。带认证的请求如常工作。

---

#### 无限制的文件上传

**严重等级**：中 —— 任意文件上传
**文件**：`server.ts:73`

```typescript
const upload = multer({ storage });
```

`multer` 实例未配置 `fileFilter`、`limits.fileSize` 或类型验证。攻击者可以上传任意类型的文件（可执行文件、HTML，如果上传目录可 Web 访问则为 PHP shell）到服务器。`/uploads` 目录作为静态文件提供服务。

**建议修复**：添加文件类型验证和大小限制：

```typescript
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 最大 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif',
                     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不允许的文件类型'));
    }
  }
});
```

**验收标准**：尝试上传 `evil.exe`。服务器拒绝并返回"不允许的文件类型"。尝试上传 50MB 的图片。服务器因大小限制而拒绝。

---

#### 图片代理中的 SSRF 风险

**严重等级**：中 —— 内网探测
**文件**：`server.ts:32-50`

```typescript
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url as string;
  if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid url');
  const imageRes = await fetch(url);
  ...
});
```

代理仅验证 URL scheme（`http` 或 `https`），不验证目标。攻击者可以传入 `http://169.254.169.254/latest/meta-data/`（AWS 元数据）、`http://localhost:3306/`（MySQL）或 `http://10.0.0.1/admin`（内部服务）来探测内网。代理将请求这些 URL 并返回响应体。

**建议修复**：解析主机名并拒绝私有/保留 IP 范围：

```typescript
import { isIP } from 'net';

const urlObj = new URL(url);
// 拒绝解析到私有/可路由 IP 的主机名
const addresses = await dns.resolve4(urlObj.hostname);
for (const addr of addresses) {
  if (isIP(addr) === 0 || addr.startsWith('127.') || addr.startsWith('10.')
      || addr.startsWith('172.16.') || addr.startsWith('192.168.')
      || addr === '169.254.169.254') {
    return res.status(403).send('不允许访问内部 IP');
  }
}
```

**验收标准**：请求 `/api/proxy-image?url=http://localhost:3000/api/company`。服务器返回 403。请求合法外部图片 URL。服务器成功代理。

---

#### 无请求频率限制

**严重等级**：中 —— DoS 漏洞
**文件**：`server.ts:14-29`（中间件配置）

没有任何路由应用了频率限制中间件。攻击者可以洪水攻击任何端点（尤其是耗性能的 `/api/orders` GET 或 proxy-image 端点）来耗尽服务器资源。

**建议修复**：添加 `express-rate-limit` 中间件：

```typescript
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100,                  // 每个 IP 每个窗口最多 100 次请求
  message: { error: '请求过于频繁，请稍后再试。' }
});

app.use('/api/', apiLimiter);
```

**验收标准**：同一 IP 在 15 分钟内发送 101 次 `GET /api/orders` 请求。第 101 次请求返回 429。不同 IP 不受影响。

---

#### localStorage 明文存储所有单据数据

**严重等级**：低 —— 客户端数据泄露
**文件**：`src/App.tsx:18-21`

```typescript
const STORAGE_KEYS = {
  DOCUMENTS: 'textile_dms_documents',
  PROFILE: 'textile_dms_company_profile',
};
```

所有单据数据未经加密存储在 `localStorage` 中。这可以被同一源上的任何 JavaScript（XSS）、浏览器扩展以及任何对机器有物理访问权限的人（DevTools）读取。

**建议修复**：对于本地优先的应用，文档化说明 localStorage 不安全的性质。对于生产部署，将所有数据持久化移到服务端，并使用 HTTP-only cookies 进行会话管理。如需要客户端存储，考虑静态加密。

**验收标准**：文档明确说明 localStorage 存储不安全，不应在生产环境中用于存储敏感的客户数据。

---

### 5. 其他发现

#### 缺少输入验证

**严重等级**：中
**文件**：`server.ts` 中所有 `POST`/`PUT` 处理器

请求体未经验证，仅由 MySQL 类型约束检查。缺失必填字段（如 `order_no`）、负值（如 `total_meters = -100`）和超长字符串均被静默接受。这导致垃圾数据进入数据库。

**建议修复**：使用 `zod` 或 `joi` 添加验证层：

```typescript
import { z } from 'zod';

const OrderItemSchema = z.object({
  product_no: z.string().max(100),
  meters: z.number().min(0),
  unit_price: z.number().min(0),
  // ...
});

const CreateOrderSchema = z.object({
  order_no: z.string().min(1).max(100),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(OrderItemSchema).min(1),
});
```

## 为什么这很重要

Fabric DMS 位于财务记录管理和客户数据管理的交叉点。此系统的故障会产生直接的业务影响：

- **可用性故障**（时序竞争、缺失事务）导致丢失订单或错误开单，造成收入损失和客户信任受损。
- **交互性故障**（白屏、错误 UI 状态）降低操作员生产力。面料行业从业者通常每天处理数十份单据——一次崩溃就可能丢失 15 分钟以上的数据录入。
- **可维护性故障**（双路径代码、无 migration）使每次未来变更的成本和风险翻倍。当前架构要求在每次 schema 变更时接触 2-4 个文件。
- **安全性故障**（凭证泄露、无认证）是存在级的。`.env.example` 中的凭证在审计时仍然有效。任何曾经克隆过仓库的人都拥有数据库和云存储的访问权限。

每类问题按影响从大到小排序，方便团队确定修复优先级。严重发现（凭证泄露、无认证）应立即处理——最好在数小时内完成。

## 适用场景

严重安全性发现（凭证轮换、`.env.example` 清理）应立即应用于此代码库的任何实例，无论部署环境如何。

高严重等级发现（事务、时序竞争）应在任何生产部署或系统处理真实客户数据之前修复。

中严重等级发现（错误边界、双路径重构、文件上传验证、SSRF 防护、频率限制）应作为下一个迭代修复，或在用户基数超过 10 个并发用户之前完成。

低严重等级发现（memoization、toast 系统、strict 模式、日期列类型）可在日常维护周期中处理。

对从此代码库 fork 的新项目，考虑在初始设置时处理所有中等级及以上的发现。

## 示例

### Before/After：MySQL 时序竞争

**Before**（原始代码）：
```typescript
// 模块顶层——启动连接但不阻塞
getMySQLPool().catch((err) => {
  console.warn('[Database] MySQL not available:', err.message);
});

async function startServer() {
  // 服务器立即开始接受连接
  app.listen(PORT, () => { ... });
}

startServer().catch(console.error);
```

**After**（已修复代码，`server.ts:729-751`）：
```typescript
async function startServer() {
  // 在接受连接前等待 MySQL 就绪
  try {
    await getMySQLPool();
    console.log('[Database] MySQL initialized successfully.');
  } catch {
    console.log('[Database] Running in JSON local file fallback mode.');
  }

  app.listen(PORT, () => { ... });
}

startServer().catch(console.error);
```

### Before/After：事务包裹

**Before**（存在漏洞，`server.ts:556-609`）：
```typescript
app.put('/api/orders/:id', async (req, res) => {
  // 无事务保护
  await pool.query(`UPDATE orders SET ... WHERE id = ?`, [...values, orderId]);
  await pool.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
  for (const item of data.items) {
    await pool.query(`INSERT INTO order_items (...) VALUES (...)`, [...itemValues]);
  }
  return res.json({ success: true });
});
```

**After**（有事务保护）：
```typescript
app.put('/api/orders/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE orders SET ... WHERE id = ?`, [...values, orderId]);
    await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
    for (const item of data.items) {
      await conn.query(`INSERT INTO order_items (...) VALUES (...)`, [...itemValues]);
    }
    await conn.commit();
    return res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});
```

## 关联

本次审计是此仓库的第一份架构文档。无已有的关联文档或 GitHub issues。

## 后续更新：统一图片资产系统

后续引入的统一图片资产系统解决了本审计中与图片相关的多项高风险问题（跨域签名过期、匿名代理 403、多套不一致图片链路、上传/删除非原子、Base64 缓存）：公司 Logo/二维码与产品图片统一走私有 COS + 服务端校验 + SHA-256 去重 + 显式业务关联 + 30 天回收 + 同源受控导出。存储模型、功能开关、迁移/上传、回收与对账运维见 docs/solutions/architecture-patterns/image-asset-operations.md。
