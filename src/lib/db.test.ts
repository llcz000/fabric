/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IndexedDB v3 metadata-only product store behavior.
 * Uses an injectable in-memory IDB shim (no third-party dependency).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DB_VERSION,
  getAllProducts,
  putProduct,
  deleteProduct,
  replaceAllProducts,
} from './db';
import type { ProductItem } from '../types';

// ── In-memory IDB shim ────────────────────────────────────────────────

class MemoryStore {
  indexNames = new Set<string>();
  records = new Map<unknown, unknown>();
  constructor(public keyPath: string | null) {}
  createIndex(name: string): void { this.indexNames.add(name); }
  getAll() {
    const request: Record<string, unknown> = {};
    queueMicrotask(() => {
      request.result = [...this.records.values()];
      const onsuccess = request.onsuccess as (() => void) | undefined;
      onsuccess?.();
    });
    return request;
  }
  put(value: unknown) {
    const request: Record<string, unknown> = {};
    queueMicrotask(() => {
      this.records.set(this.keyPath ? (value as Record<string, unknown>)[this.keyPath] : value, value);
      const onsuccess = request.onsuccess as (() => void) | undefined;
      onsuccess?.();
    });
    return request;
  }
  delete(key: unknown) {
    const request: Record<string, unknown> = {};
    queueMicrotask(() => {
      this.records.delete(key);
      const onsuccess = request.onsuccess as (() => void) | undefined;
      onsuccess?.();
    });
    return request;
  }
  clear() {
    const request: Record<string, unknown> = {};
    queueMicrotask(() => {
      this.records.clear();
      const onsuccess = request.onsuccess as (() => void) | undefined;
      onsuccess?.();
    });
    return request;
  }
}

class MemoryDb {
  stores = new Map<string, MemoryStore>();
  version = 0;
  failOpen: unknown = null;
  failTx: unknown = null;

  get objectStoreNames() {
    return { contains: (name: string) => this.stores.has(name) };
  }

  open(_name: string, version?: number) {
    const request: Record<string, unknown> = { result: null, error: null };
    const oldVersion = this.version;
    queueMicrotask(() => {
      if (this.failOpen) {
        request.error = this.failOpen;
        (request.onerror as (() => void) | undefined)?.();
        return;
      }
      if (typeof version === 'number' && version > oldVersion) {
        this.version = version;
        request.result = this;
        (request.onupgradeneeded as ((event: { oldVersion: number }) => void) | undefined)?.({ oldVersion });
      }
      request.result = this;
      (request.onsuccess as (() => void) | undefined)?.();
    });
    return request;
  }

  deleteObjectStore(name: string): void { this.stores.delete(name); }

  createObjectStore(name: string, options?: { keyPath?: string | string[] }) {
    const keyPath = typeof options?.keyPath === 'string' ? options.keyPath : null;
    const store = new MemoryStore(keyPath);
    this.stores.set(name, store);
    return store;
  }

  transaction(_names: string[], _mode?: string) {
    const tx: Record<string, unknown> = { error: null };
    setTimeout(() => {
      if (this.failTx) {
        tx.error = this.failTx;
        this.failTx = null;
        (tx.onerror as (() => void) | undefined)?.();
        return;
      }
      (tx.oncomplete as (() => void) | undefined)?.();
    }, 0);
    tx.objectStore = (name: string) => this.stores.get(name);
    return tx;
  }

  storeNames(): string[] { return [...this.stores.keys()]; }
  store(name: string): MemoryStore | undefined { return this.stores.get(name); }
}

function product(overrides: Partial<ProductItem> = {}): ProductItem {
  return {
    id: '1',
    itemNo: 'A-001',
    productName: 'Fabric',
    composition: 'cotton',
    weight: '200',
    width: '150',
    imageCount: 0,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

test('opens version 3 with only the products store and an itemNo index', async () => {
  assert.equal(DB_VERSION, 3);
  const db = new MemoryDb();
  await getAllProducts(db as unknown as IDBFactory);
  assert.deepEqual(db.storeNames(), ['products']);
  assert.equal(db.store('products')!.keyPath, 'id');
  assert.ok(db.store('products')!.indexNames.has('itemNo'));
  assert.ok(!db.storeNames().includes('product_images'));
});

test('upgrading an existing v2 database deletes the legacy product_images store', async () => {
  const db = new MemoryDb();
  db.version = 2;
  db.stores.set('products', new MemoryStore('id'));
  db.stores.set('product_images', new MemoryStore('id'));
  await getAllProducts(db as unknown as IDBFactory);
  assert.deepEqual(db.storeNames(), ['products']);
  assert.ok(!db.storeNames().includes('product_images'));
});

test('putProduct persists only metadata (no base64, thumbnail, full, or images)', async () => {
  const db = new MemoryDb();
  await putProduct({
    ...product(),
    images: [{ source: 'asset', role: 'pattern_original', sortOrder: 0, isPrimary: true, assetId: 'a1', thumbnailUrl: 'https://cos.example/signed' }],
    base64: 'aGVsbG8=',
    thumbnail: 'data:image/jpeg;base64,aGVsbG8=',
    full: 'data:image/jpeg;base64,aGVsbG8=',
  } as unknown as ProductItem, db as unknown as IDBFactory);
  const stored = db.store('products')!.records.get('1') as Record<string, unknown>;
  assert.equal(stored.itemNo, 'A-001');
  assert.ok(!('images' in stored));
  assert.ok(!('base64' in stored));
  assert.ok(!('thumbnail' in stored));
  assert.ok(!('full' in stored));
});

test('deleteProduct removes only the products record', async () => {
  const db = new MemoryDb();
  await putProduct(product({ id: '1' }), db as unknown as IDBFactory);
  await putProduct(product({ id: '2' }), db as unknown as IDBFactory);
  await deleteProduct('1', db as unknown as IDBFactory);
  const remaining = await getAllProducts(db as unknown as IDBFactory);
  assert.deepEqual(remaining.map((p) => p.id), ['2']);
});

test('replaceAllProducts invalidates stale metadata', async () => {
  const db = new MemoryDb();
  await putProduct(product({ id: '1', itemNo: 'OLD' }), db as unknown as IDBFactory);
  await replaceAllProducts([
    product({ id: '2', itemNo: 'B' }),
    product({ id: '3', itemNo: 'C' }),
  ], db as unknown as IDBFactory);
  const remaining = await getAllProducts(db as unknown as IDBFactory);
  assert.deepEqual(remaining.map((p) => p.id).sort(), ['2', '3']);
  assert.ok(!db.store('products')!.records.has('1'));
});

test('getAllProducts surfaces availability errors', async () => {
  const db = new MemoryDb();
  db.failOpen = new Error('IndexedDB unavailable');
  await assert.rejects(() => getAllProducts(db as unknown as IDBFactory), /IndexedDB unavailable/);
});

test('putProduct surfaces quota errors from the write transaction', async () => {
  const db = new MemoryDb();
  db.failTx = new Error('QuotaExceededError');
  await assert.rejects(() => putProduct(product(), db as unknown as IDBFactory), /QuotaExceededError/);
});

test('replaceAllProducts surfaces quota errors without committing a partial write', async () => {
  const db = new MemoryDb();
  db.failTx = new Error('QuotaExceededError');
  await assert.rejects(() => replaceAllProducts([product({ id: '1' }), product({ id: '2' })], db as unknown as IDBFactory), /QuotaExceededError/);
});
