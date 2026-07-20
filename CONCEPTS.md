# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Fabric DMS Concepts

### Order
A fabric industry business document that records a transaction with a customer. Each Order contains shipment details (dates, customer, signatory) and one or more line items describing the fabrics shipped. Orders are the central entity in the system.

Two types exist: Sample Orders for fabric samples and Sales Orders for bulk shipments. The type determines which item fields are recorded (composition/weight for samples vs. roll numbers for sales).

### Order Item
A single line within an Order describing one fabric product. Each item records product identification (product number, color number, product name), measurements (meters, width), pricing (unit price, amount), and optional remarks. Items are stored normalized in the `order_items` table, separate from their parent Order.

### Sample Order
A type of Order used for fabric sample dispatch. Sample items record composition, weight, and width in addition to standard item fields. Identified by `template_type: 'sample'` in the database.

### Sales Order
A type of Order used for bulk fabric sales shipment. Sales items record roll numbers (匹号) representing individual fabric rolls, each with its own meter count. Identified by `template_type: 'bulk'` in the database.

### JSON Fallback
A local file-based storage (`database_fallback.json`) used when MySQL is unavailable. Stores orders, order items, and company configuration as JSON. While MySQL is the primary storage, the fallback provides graceful degradation during connection failures. The fallback uses synchronous file I/O and does not support concurrent access.

### MySQL Dual-Path
The architectural pattern where every API endpoint branches between MySQL and JSON Fallback storage based on the `useMySQLFallback` flag. Each route handler contains two implementations of the same business logic — one for MySQL and one for the JSON file. This pattern doubles the maintenance surface for bug fixes and schema changes.

## Flagged ambiguities

- "template_type" values differ between frontend and backend: the frontend uses `DocType.SAMPLE` / `DocType.SALES` enums, while the backend database stores `'sample'` / `'bulk'`. The mapping occurs in `mapDocToBackendPayload`.
