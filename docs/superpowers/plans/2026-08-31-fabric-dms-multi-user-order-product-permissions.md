# Fabric DMS Multi-User Order and Product Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator and salesperson accounts so salespeople can only see and manage their own documents, while administrators independently grant full own-document management and shared product-library management.

**Architecture:** Implement two fixed roles and two per-salesperson permission switches, backed by persistent users and hashed sessions. Attach a request principal at the Express boundary, enforce document ownership and product permissions inside focused policy functions before existing route handlers, and let the React UI render the same server-returned capabilities. Existing MySQL and JSON fallback data receive additive creator/updater fields; historical records are assigned to the bootstrap administrator.

**Tech Stack:** Node.js 22 built-in crypto, TypeScript 5.8, Express 4, Zod 4, MySQL 8 / JSON fallback, React 19, Node test runner via `scripts/run-ts-tests.mjs`.

**Spec:** `D:\codex\obsidian-vault\03-产品竞品\Fabric-Play-经营增长系统-首期MVP需求-v0.1.md`

## Global Constraints

- Roles are exactly `admin` and `sales`; no custom-role editor or general-purpose RBAC engine.
- Assignable permissions are exactly `canManageOwnOrders` and `canManageProducts`.
- A salesperson always reads only documents whose `createdByUserId` equals the current user ID.
- `canManageOwnOrders` grants create, update and delete for that salesperson's own documents; it never grants access to another salesperson's documents.
- Every authenticated user can read the shared product library.
- `canManageProducts` grants create, Excel import, update, image changes, single delete and batch delete across the shared product library.
- Product export, document backup import/export, company settings, inventory mutation and user management remain administrator-only.
- Server APIs enforce every permission and ownership rule; hidden buttons are convenience only.
- Unauthorized access to another salesperson's document returns `404`; missing/expired authentication returns `401`; denied operations on visible resources return `403`.
- Existing orders, products, images, inventory and `database_fallback.json` content must be preserved.
- Historical orders and products with no creator are assigned to the bootstrap administrator during additive migration.
- Passwords use versioned scrypt hashes; only SHA-256 session-token hashes are persisted.
- No plaintext password, raw token, `ADMIN_PASSWORD`, COS credential or customer secret may be logged or stored in documentation.
- Use existing dependencies and test infrastructure; do not add an authentication package.
- Git commits listed below require explicit user authorization during execution.

---

## File Structure

**Create**

- `server/access/types.ts`: fixed roles, principal, user/session records and DTOs.
- `server/access/password.ts`: scrypt hashing and verification.
- `server/access/repository.ts`: storage-neutral access repository contract.
- `server/access/mysqlRepository.ts`: MySQL user/session storage.
- `server/access/localRepository.ts`: JSON fallback user/session storage.
- `server/access/schema.ts`: additive MySQL access and ownership migration.
- `server/access/service.ts`: bootstrap, login/logout, member administration and session resolution.
- `server/access/middleware.ts`: Express principal attachment and admin guard.
- `server/access/policy.ts`: pure order/product authorization decisions.
- `server/access/routes.ts`: login, current user and administrator member-management APIs.
- `src/lib/access.ts`: client session DTOs and authenticated fetch.
- `src/components/LoginScreen.tsx`: username/password login.
- `src/components/UserManagement.tsx`: salesperson creation, status and two permission switches.
- Tests beside each focused server/client module.

**Modify**

- `server.ts`: replace shared token map, initialize access storage, add ownership columns, scope existing routes.
- `server/appAssembly.ts`: let product-image routes use request middleware instead of a boolean token predicate.
- `server/image-assets/productServer.ts`, `productImages.ts`, `routes.ts`, `companyImages.ts`: propagate request user and product-management permission.
- `src/App.tsx`: session bootstrap, permission-aware navigation and member-management page.
- `src/components/DocumentList.tsx`: read-only/manage-own controls and administrator-only backup controls.
- `src/components/ProductLibrary.tsx`: shared read UI with permission-gated management/export controls.
- `src/types.ts`: creator/updater metadata and access DTO references where needed.
- `src/lib/db.ts`: keep order request/response metadata and standardize 401/403/404 errors.
- `scripts/smoke-security.mjs`: real multi-user isolation and permission-switch regression.
- `package.json`: focused `test:access` script.
- `docs/solutions/multi-user-order-product-permissions.md`: operator and migration notes.

---

### Task 1: Access contracts, password hashing and pure authorization policy

**Files:**
- Create: `server/access/types.ts`
- Create: `server/access/password.ts`
- Create: `server/access/policy.ts`
- Test: `server/access/password.test.ts`
- Test: `server/access/policy.test.ts`

**Interfaces:**
- Consumes: Node `crypto.scrypt`, `randomBytes`, `timingSafeEqual`.
- Produces: `AppPrincipal`, `AppUserRecord`, `AppSessionRecord`, `hashPassword`, `verifyPassword`, `canReadOrder`, `canManageOrder`, `canReadProducts`, `canManageProducts`, `isAdmin`.

- [ ] **Step 1: Write failing password tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from './password';

test('password hash is salted, versioned and verifiable', async () => {
  const first = await hashPassword('eight-plus-characters');
  const second = await hashPassword('eight-plus-characters');
  assert.match(first, /^scrypt\$v1\$16384\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('eight-plus-characters', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
});

test('malformed hashes fail closed', async () => {
  assert.equal(await verifyPassword('anything', 'sha256$legacy'), false);
  assert.equal(await verifyPassword('anything', 'scrypt$v1$broken'), false);
});
```

- [ ] **Step 2: Write failing policy matrix tests**

```ts
const admin: AppPrincipal = {
  userId: 'admin-1', username: 'admin', displayName: '管理员', role: 'admin',
  canManageOwnOrders: true, canManageProducts: true, sessionId: 'session-a',
};
const allowedSales = { ...admin, userId: 'sales-1', role: 'sales' as const, canManageOwnOrders: true };
const readOnlySales = { ...allowedSales, userId: 'sales-2', canManageOwnOrders: false, canManageProducts: false };
const ownOrder = { createdByUserId: 'sales-1' };

assert.equal(canReadOrder(admin, ownOrder), true);
assert.equal(canReadOrder(allowedSales, ownOrder), true);
assert.equal(canReadOrder(readOnlySales, ownOrder), false);
assert.equal(canManageOrder(allowedSales, ownOrder), true);
assert.equal(canManageOrder(readOnlySales, { createdByUserId: 'sales-2' }), false);
assert.equal(canManageProducts({ ...allowedSales, canManageProducts: true }), true);
assert.equal(canManageProducts(readOnlySales), false);
```

Also assert all authenticated users can read products, administrators manage everything, and a salesperson with order permission still cannot manage someone else's order.

- [ ] **Step 3: Run tests and confirm missing-module failures**

Run: `npm.cmd run test:unit -- server/access/password.test.ts server/access/policy.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Define exact access types**

```ts
export type AppRole = 'admin' | 'sales';

export interface AppPrincipal {
  userId: string;
  username: string;
  displayName: string;
  role: AppRole;
  canManageOwnOrders: boolean;
  canManageProducts: boolean;
  sessionId: string;
}

export interface AppUserRecord {
  id: string;
  username: string;
  usernameNormalized: string;
  displayName: string;
  passwordHash: string;
  role: AppRole;
  canManageOwnOrders: boolean;
  canManageProducts: boolean;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface AppSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}
```

- [ ] **Step 5: Implement password and policy functions**

Use a 16-byte random salt, 32-byte scrypt output, `N=16384`, `r=8`, `p=1`, Base64URL fields and constant-time comparison. Password input is 8–128 UTF-8 bytes. Policy functions contain no database or Express code:

```ts
export const isAdmin = (p: AppPrincipal) => p.role === 'admin';
export const canReadOrder = (p: AppPrincipal, order: { createdByUserId: string }) =>
  isAdmin(p) || order.createdByUserId === p.userId;
export const canManageOrder = (p: AppPrincipal, order: { createdByUserId: string }) =>
  isAdmin(p) || (p.canManageOwnOrders && order.createdByUserId === p.userId);
export const canCreateOrder = (p: AppPrincipal) => isAdmin(p) || p.canManageOwnOrders;
export const canReadProducts = (_p: AppPrincipal) => true;
export const canManageProducts = (p: AppPrincipal) => isAdmin(p) || p.canManageProducts;
```

- [ ] **Step 6: Run focused tests and lint**

Run: `npm.cmd run test:unit -- server/access/password.test.ts server/access/policy.test.ts`

Expected: PASS.

Run: `npm.cmd run lint`

Expected: PASS.

- [ ] **Step 7: Commit after authorization**

```powershell
git add server/access/types.ts server/access/password.ts server/access/password.test.ts server/access/policy.ts server/access/policy.test.ts
git commit -m "feat(access): define fixed roles and business policies"
```

### Task 2: Persistent users, sessions and additive ownership migration

**Files:**
- Create: `server/access/repository.ts`
- Create: `server/access/schema.ts`
- Create: `server/access/mysqlRepository.ts`
- Create: `server/access/localRepository.ts`
- Test: `server/access/mysqlRepository.test.ts`
- Test: `server/access/localRepository.test.ts`
- Modify: `server.ts` `LocalDB`, default/merge logic and MySQL initialization.

**Interfaces:**
- Consumes: records from Task 1 and current mysql2 connection boundary.
- Produces: `AccessRepository`, `initializeAccessSchema`, `MySqlAccessRepository`, `LocalAccessRepository`.

- [ ] **Step 1: Define and test the repository contract**

```ts
export interface AccessRepository {
  countUsers(): Promise<number>;
  createUser(user: AppUserRecord): Promise<AppUserRecord>;
  findUserByUsernameNormalized(username: string): Promise<AppUserRecord | null>;
  findUserById(userId: string): Promise<AppUserRecord | null>;
  listUsers(): Promise<Array<Omit<AppUserRecord, 'passwordHash'>>>;
  updateUser(userId: string, patch: UserAccessPatch): Promise<AppUserRecord | null>;
  replacePasswordHash(userId: string, passwordHash: string): Promise<boolean>;
  createSession(session: AppSessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<AppSessionRecord | null>;
  revokeSession(sessionId: string, revokedAt: string): Promise<void>;
  revokeUserSessions(userId: string, revokedAt: string): Promise<void>;
}
```

Contract tests cover case-insensitive unique usernames, no password hash in list output, status/permission updates, token-hash lookup, logout revocation and revoke-all-on-disable/reset.

- [ ] **Step 2: Run repository tests and confirm failures**

Run: `npm.cmd run test:unit -- server/access/localRepository.test.ts server/access/mysqlRepository.test.ts`

Expected: FAIL because repositories do not exist.

- [ ] **Step 3: Add MySQL tables and columns**

Create additively:

```sql
app_users(
  id CHAR(36) PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  username_normalized VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','sales') NOT NULL,
  can_manage_own_orders TINYINT(1) NOT NULL DEFAULT 0,
  can_manage_products TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);

app_sessions(
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_app_sessions_user(user_id),
  INDEX idx_app_sessions_expiry(expires_at)
);
```

Add nullable `created_by_user_id CHAR(36)` and `updated_by_user_id CHAR(36)` plus indexes to `orders` and `products`. Do not add foreign keys in this migration because existing/fallback deployments must remain recoverable.

- [ ] **Step 4: Extend JSON fallback without replacing business data**

Add `app_users`, `app_sessions`; add `created_by_user_id` and `updated_by_user_id` when records are read/migrated. `loadLocalDB` merges missing arrays into parsed JSON and preserves all existing arrays and values. Write through the existing `saveLocalDB` owner once per repository mutation.

- [ ] **Step 5: Implement both repository adapters**

Normalize usernames with `trim().toLocaleLowerCase('en-US')`. MySQL user creation and changes are transactional. Map duplicates to `AccessConflictError('USERNAME_TAKEN')`. Never expose `passwordHash` through list APIs.

- [ ] **Step 6: Run repository and fallback-preservation tests**

Run: `npm.cmd run test:unit -- server/access/localRepository.test.ts server/access/mysqlRepository.test.ts`

Expected: PASS, including a fixture where pre-existing orders/products remain byte-for-byte equivalent except additive ownership fields.

- [ ] **Step 7: Commit after authorization**

```powershell
git add server/access/repository.ts server/access/schema.ts server/access/mysqlRepository.ts server/access/localRepository.ts server/access/*Repository.test.ts server.ts
git commit -m "feat(access): persist users sessions and record ownership"
```

### Task 3: Login, member administration and request principals

**Files:**
- Create: `server/access/service.ts`
- Create: `server/access/middleware.ts`
- Create: `server/access/routes.ts`
- Test: `server/access/service.test.ts`
- Test: `server/access/routes.test.ts`
- Modify: `server.ts:62-225` authentication and startup flow.
- Modify: `package.json` scripts.

**Interfaces:**
- Consumes: `AccessRepository`, hashing functions and fixed access types.
- Produces: `AccessService`, `authenticate`, `requireAdmin`, `/api/login`, `/api/logout`, `/api/me`, `/api/users`.

- [ ] **Step 1: Write service lifecycle tests**

Verify:

- first startup creates `admin` from `ADMIN_PASSWORD` only when user count is zero;
- later startup never overwrites the stored password;
- login returns a 32-byte hex token but repository stores only its SHA-256 hash;
- disabled users and revoked/expired sessions resolve to null;
- disabling a user or resetting a password revokes all sessions;
- the last active administrator cannot be disabled or changed to salesperson;
- only administrators may list/create/update/reset users.

- [ ] **Step 2: Write API contract tests**

Use a real ephemeral Express server. Assert strict request bodies and these responses:

```text
POST /api/login                         public; username + password
GET  /api/me                            authenticated
POST /api/logout                        authenticated
GET  /api/users                         admin only
POST /api/users                         admin only; creates admin or sales
PATCH /api/users/:id                    admin only; status/role/two switches
POST /api/users/:id/reset-password      admin only
```

Response users omit password hashes. Validation is 400, bad login/session 401, non-admin 403, absent user 404, duplicate username 409.

- [ ] **Step 3: Run service and route tests and confirm failures**

Run: `npm.cmd run test:unit -- server/access/service.test.ts server/access/routes.test.ts`

Expected: FAIL because service/routes do not exist.

- [ ] **Step 4: Implement service and middleware**

Exact service methods:

```ts
bootstrapAdmin(password: string): Promise<{ adminUserId: string; created: boolean }>;
login(username: string, password: string): Promise<{ token: string; expiresIn: number; principal: AppPrincipal }>;
resolveToken(rawToken: string): Promise<AppPrincipal | null>;
logout(rawToken: string): Promise<void>;
listUsers(actor: AppPrincipal): Promise<AppUserSummary[]>;
createUser(actor: AppPrincipal, input: CreateUserInput): Promise<AppUserSummary>;
updateUser(actor: AppPrincipal, userId: string, patch: UpdateUserInput): Promise<AppUserSummary>;
resetPassword(actor: AppPrincipal, userId: string, password: string): Promise<void>;
```

Resolve current user fields on every authenticated request, so permission switches and disabled status take effect immediately without waiting for session expiry. TTL remains 12 hours.

- [ ] **Step 5: Replace the shared token implementation in `server.ts`**

Remove `authTokens`, `passwordsMatch`, `getValidToken` and hard-coded `admin` request identity. Initialize the correct repository after database selection, bootstrap the administrator, then listen. Login remains rate-limited. `/uploads` validates the asset cookie through the same session service.

- [ ] **Step 6: Backfill historical ownership after bootstrap**

Run once idempotently after obtaining `adminUserId`:

```sql
UPDATE orders SET created_by_user_id = ?, updated_by_user_id = ?
WHERE created_by_user_id IS NULL OR created_by_user_id = '';
UPDATE products SET created_by_user_id = ?, updated_by_user_id = ?
WHERE created_by_user_id IS NULL OR created_by_user_id = '';
```

JSON fallback performs the equivalent map only for missing values and preserves existing assigned IDs.

- [ ] **Step 7: Add focused script and run checks**

Add `"test:access": "node scripts/run-ts-tests.mjs server/access"`.

Run: `npm.cmd run test:access`

Expected: PASS.

Run: `npm.cmd run lint`

Expected: PASS.

- [ ] **Step 8: Commit after authorization**

```powershell
git add server/access server.ts package.json
git commit -m "feat(access): add accounts sessions and administrator controls"
```

### Task 4: Enforce own-document scope across every order path

**Files:**
- Create: `server/access/orderScope.ts`
- Test: `server/access/orderScope.test.ts`
- Modify: `server.ts` order list/detail/create/update/delete/export-template routes.
- Modify: `src/types.ts` document ownership metadata.
- Modify: `src/lib/db.ts` response mapping.

**Interfaces:**
- Consumes: `req.principal`, policy functions from Task 1.
- Produces: scoped order query/filter helpers and ownership-safe order APIs.

- [ ] **Step 1: Write storage-neutral scope tests**

Test MySQL predicate generation and local filtering:

```ts
assert.deepEqual(orderListScope(admin), { sql: '', params: [] });
assert.deepEqual(orderListScope(sales), {
  sql: ' WHERE o.created_by_user_id = ?', params: ['sales-1'],
});
assert.deepEqual(filterOrdersForPrincipal(sales, [own, other]), [own]);
```

Also test detail/manage decisions return `not_found` for another salesperson's document and `forbidden` for an own visible document when management is disabled.

- [ ] **Step 2: Run scope tests and confirm failure**

Run: `npm.cmd run test:unit -- server/access/orderScope.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Scope all order reads at the storage query**

For MySQL, append the ownership predicate to list, detail and any order-derived export query before execution. For JSON fallback, filter before mapping/returning. Never fetch all orders and rely only on the React client. Dashboard statistics continue to derive from the already-scoped document list, so salespeople see only their own totals.

- [ ] **Step 4: Enforce create/update/delete semantics**

- POST: require `canCreateOrder`; set `created_by_user_id` and `updated_by_user_id` from the principal and ignore client ownership fields.
- PUT: load ownership first; return 404 for another salesperson's order, 403 when own but `canManageOwnOrders` is false; preserve creator and update updater.
- DELETE: apply the same 404/403 order and allow full deletion for own documents when granted.
- Admin: all operations allowed.

- [ ] **Step 5: Protect adjacent document functions**

`/api/export_template/:id` must apply order read scope. Template configuration/upload and document backup import/export stay admin-only. Any document search/count/export endpoint added during implementation must use the same scope helper.

- [ ] **Step 6: Add API integration tests**

Create admin, sales A and sales B. Grant both order management, create one order each, then assert:

- each salesperson list contains exactly their own record;
- direct GET/PUT/DELETE of the other record returns 404;
- after revoking A's order permission, A can GET their order but POST/PUT/DELETE return 403;
- admin lists, edits and deletes either record;
- submitted fake `createdByUserId` never changes ownership.

- [ ] **Step 7: Run access and order regressions**

Run: `npm.cmd run test:access`

Expected: PASS.

Run: `npm.cmd run test:unit`

Expected: PASS.

- [ ] **Step 8: Commit after authorization**

```powershell
git add server/access/orderScope.ts server/access/orderScope.test.ts server.ts src/types.ts src/lib/db.ts
git commit -m "feat(orders): isolate salesperson documents by creator"
```

### Task 5: Enforce shared product-library management

**Files:**
- Create: `server/access/productAccess.ts`
- Test: `server/access/productAccess.test.ts`
- Modify: `server.ts` product read/write/import/export/image routes.
- Modify: `server/appAssembly.ts`
- Modify: `server/image-assets/productServer.ts`
- Modify: `server/image-assets/productImages.ts`
- Modify: `server/image-assets/routes.ts`
- Modify: `server/image-assets/companyImages.ts`
- Modify: related image-asset tests.

**Interfaces:**
- Consumes: `AppPrincipal`, `canReadProducts`, `canManageProducts`.
- Produces: Express `requireProductRead`, `requireProductManagement`, request-scoped asset principal.

- [ ] **Step 1: Write route permission tests**

Matrix:

```text
GET products/detail/thumbnails/images      any authenticated user -> allowed
POST/PUT products                          canManageProducts -> allowed
POST products/import                       canManageProducts -> allowed
DELETE product/image/batch-delete          canManageProducts -> allowed
POST image upload/finalize for products    canManageProducts -> allowed
POST products/export                       admin only
company image/settings mutation            admin only
inventory endpoints                        admin only in this MVP
```

Test an authorized salesperson can modify/delete a product created by another user because product data is shared.

- [ ] **Step 2: Run focused tests and confirm current over-permission**

Run: `npm.cmd run test:unit -- server/access/productAccess.test.ts server/image-assets/appAssembly.test.ts server/image-assets/routes.test.ts`

Expected: FAIL because current authentication has no product-management distinction and image routes use fixed principals.

- [ ] **Step 3: Apply read/manage middleware to legacy product routes**

All authenticated users read products. Create/update/import/delete/batch-delete/image-delete require product management. Export requires admin. On product create write creator/updater from principal; on update write updater; shared access never filters by creator.

- [ ] **Step 4: Convert product image assembly to request middleware**

Replace synchronous `authenticate(req): boolean` with Express middleware so it can use the resolved principal and required action. Preserve feature-on/feature-off body parser and route ordering behavior.

- [ ] **Step 5: Replace fixed image principals**

Every product image upload/finalize/read/link operation receives `req.principal.userId`. Product image write routes additionally require product management. Generic/company image mutations stay administrator-only; reads needed by product/company display remain authenticated. Update fixture identities from `'admin'` to explicit user IDs and retain cross-principal upload-session security tests.

- [ ] **Step 6: Run product and image regressions**

Run: `npm.cmd run test:access`

Expected: PASS.

Run: `npm.cmd run test:image-assets`

Expected: PASS.

Run: `rg -n "PRINCIPAL_ID|principalId: 'admin'|authTokens|getValidToken" server.ts server`

Expected: no production-code matches.

- [ ] **Step 7: Commit after authorization**

```powershell
git add server.ts server/appAssembly.ts server/access/productAccess.ts server/access/productAccess.test.ts server/image-assets
git commit -m "feat(products): gate shared library management by salesperson permission"
```

### Task 6: React login, member switches and permission-aware business UI

**Files:**
- Create: `src/lib/access.ts`
- Create: `src/lib/access.test.ts`
- Create: `src/components/LoginScreen.tsx`
- Create: `src/components/UserManagement.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/DocumentList.tsx`
- Modify: `src/components/ProductLibrary.tsx`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: `/api/login`, `/api/me`, `/api/logout`, `/api/users` and principal fields.
- Produces: authenticated session bootstrap and UI controls matching server capabilities.

- [ ] **Step 1: Write client access tests**

Test:

```ts
assert.equal(canManageOwnOrders(adminPrincipal), true);
assert.equal(canManageOwnOrders(readOnlySalesPrincipal), false);
assert.equal(canManageProducts(productSalesPrincipal), true);
assert.equal(isAdmin(productSalesPrincipal), false);
```

`authFetch` tests inject fetch/storage fakes and assert bearer header, token clearing on 401, no token clearing on 403, and propagation of 404 without turning it into an authorization disclosure.

- [ ] **Step 2: Run client tests and confirm failure**

Run: `npm.cmd run test:unit -- src/lib/access.test.ts`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement login and session bootstrap**

Login collects username/password and defaults username to `admin` for first upgrade. Store only raw token under `fabric_auth_token`; on every app load fetch `/api/me` and use the returned principal as the capability source. Logout revokes server session before clearing local state.

- [ ] **Step 4: Implement administrator member management**

The administrator-only page supports create salesperson/admin, enable/disable, reset password, and exactly two labeled switches:

- `管理本人单据（新增、修改、删除）`
- `管理产品库（新增、导入、修改、删除）`

Do not display a general permission matrix. Prevent the last administrator from being disabled through both UI message and server validation.

- [ ] **Step 5: Adapt document UI**

- Sales heading is `我的单据`; admin heading is `全部单据` and shows recorder name.
- Hide create/edit/delete controls unless admin or `canManageOwnOrders`.
- Keep visible own documents read-only after permission revocation.
- Show document backup import/export only to admin.
- Treat server 403/404 as the source of truth and refresh the scoped list after mutations.

- [ ] **Step 6: Adapt product and adjacent navigation**

- Product list remains visible to every authenticated user.
- Show create/import/edit/delete/batch-delete only to admin or `canManageProducts`.
- Show product export only to admin.
- Settings, inventory and member management navigation are admin-only for this MVP.
- Sales dashboard uses only the scoped documents already returned by the server.

- [ ] **Step 7: Run client, lint and build verification**

Run: `npm.cmd run test:unit -- src/lib/access.test.ts`

Expected: PASS.

Run: `npm.cmd run lint`

Expected: PASS.

Run: `npm.cmd run build`

Expected: PASS and `dist/server.cjs` is generated.

- [ ] **Step 8: Commit after authorization**

```powershell
git add src/lib/access.ts src/lib/access.test.ts src/components/LoginScreen.tsx src/components/UserManagement.tsx src/components/DocumentList.tsx src/components/ProductLibrary.tsx src/App.tsx src/types.ts
git commit -m "feat(access): add multi-user controls to the DMS interface"
```

### Task 7: End-to-end permission proof and operational handoff

**Files:**
- Modify: `scripts/smoke-security.mjs`
- Create: `docs/solutions/multi-user-order-product-permissions.md`
- Modify: `D:\codex\obsidian-vault\03-产品竞品\Fabric-Play-经营增长系统-实施任务清单.md` after verification.

**Interfaces:**
- Consumes: completed server/client MVP.
- Produces: repeatable security evidence, upgrade instructions and completion record.

- [ ] **Step 1: Add a real security smoke scenario**

Start an isolated server/database fixture and execute:

1. bootstrap/login administrator;
2. create sales A without permissions and sales B with both permissions;
3. confirm A reads products but cannot create an order or mutate products;
4. enable A's order permission and create A's order;
5. create B's order and prove A cannot list/read/update/delete it;
6. prove B can modify/delete any shared product;
7. revoke B's product permission and prove the existing session immediately receives 403 on product mutation but still reads products;
8. disable A and prove A's token receives 401;
9. prove responses/logs do not contain passwords or raw bearer tokens.

- [ ] **Step 2: Run smoke and correct integration gaps**

Run: `npm.cmd run test:security`

Expected: PASS, with isolated server process closed and no fixture data written over the user's database.

- [ ] **Step 3: Write upgrade/runbook documentation**

Document initial admin bootstrap, creating salespeople, two switches, ownership rules, historical-record backfill, shared-product behavior, session TTL, MySQL tables/columns, JSON fallback fields, last-admin protection, password reset and rollback using the pre-migration database backup.

- [ ] **Step 4: Run the complete project verification in order**

```powershell
npm.cmd run lint
npm.cmd run test:access
npm.cmd run test:unit
npm.cmd run build
npm.cmd run test:security
npm.cmd run test:image-assets
git diff --check
```

Expected: every command exits 0; whitespace check prints no errors.

- [ ] **Step 5: Review scope and secrets**

```powershell
git status --short
git diff -- server.ts server src scripts package.json docs
rg -n "ADMIN_PASSWORD=|COS_SECRET|Authorization: Bearer [0-9a-f]{64}" server src scripts docs
```

Expected: scoped access/order/product changes only; secret scan finds no credentials or live token values.

- [ ] **Step 6: Update the knowledge-base completion record**

Only after Step 4 passes, mark task A `已完成`, record verification commands/date, and keep CRM/QR/content/search packages unstarted.

- [ ] **Step 7: Final commit after authorization**

```powershell
git add scripts/smoke-security.mjs docs/solutions/multi-user-order-product-permissions.md
git commit -m "docs(access): verify multi-user order and product permissions"
```

---

## Acceptance Traceability

| MVP requirement | Tasks | Proof |
|---|---|---|
| Administrator and salesperson accounts | 2, 3, 6 | repository/service/API/client tests |
| Salesperson sees only self-entered documents | 1, 4 | pure policy and multi-user route integration tests |
| Administrator grants complete own-document management | 3, 4, 6 | switch lifecycle and POST/PUT/DELETE regression |
| Shared product library visible to everyone | 1, 5, 6 | read matrix and UI tests |
| Administrator grants complete product management | 3, 5, 6 | import/edit/delete/image route tests |
| API enforcement, not button-only security | 4, 5, 7 | direct HTTP smoke tests |
| Existing MySQL/JSON data preserved | 2, 3, 7 | additive migration and fallback preservation tests |

## Explicitly Excluded

- CRM, consultation follow-up, sampling, QR pages, content growth and image similarity.
- Custom roles, departments, per-field permissions and per-product ownership.
- Salesperson product export and document backup import/export.
- Designer accounts and pattern-only permissions.
- Enterprise WeChat synchronization.
