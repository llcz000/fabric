/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IndexedDB wrapper for product library metadata.
 *
 * v3: image payloads are no longer cached in IndexedDB. Product rows store
 * metadata only; image descriptors (asset IDs, signed URLs) live at runtime
 * and are refreshed from the server, never persisted as Base64 or raw URLs.
 */

import type { ProductItem } from '../types';

const DB_NAME = 'textile_dms';
export const DB_VERSION = 3;
const STORE_PRODUCTS = 'products';
const STORE_IMAGES_LEGACY = 'product_images';

function resolveIndexedDB(idb?: IDBFactory): IDBFactory {
  if (idb) return idb;
  const factory = (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) throw new Error('IndexedDB is unavailable');
  return factory;
}

function openDB(idb?: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = resolveIndexedDB(idb).open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE_IMAGES_LEGACY)) {
        db.deleteObjectStore(STORE_IMAGES_LEGACY);
      }
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const store = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
        store.createIndex('itemNo', 'itemNo', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

// ── Products (metadata only) ────────────────────────────────────────

function toMetadata(product: ProductItem): ProductItem {
  return {
    id: product.id,
    itemNo: product.itemNo,
    productName: product.productName,
    composition: product.composition,
    weight: product.weight,
    width: product.width,
    imageCount: product.imageCount,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export async function getAllProducts(idb?: IDBFactory): Promise<ProductItem[]> {
  const db = await openDB(idb);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readonly');
    const req = tx.objectStore(STORE_PRODUCTS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putProduct(product: ProductItem, idb?: IDBFactory): Promise<void> {
  const db = await openDB(idb);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    tx.objectStore(STORE_PRODUCTS).put(toMetadata(product));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteProduct(id: string, idb?: IDBFactory): Promise<void> {
  const db = await openDB(idb);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    tx.objectStore(STORE_PRODUCTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Replaces the entire product metadata set in one transaction. Used after a
 * server refresh so stale local rows are removed rather than merged.
 */
export async function replaceAllProducts(products: ProductItem[], idb?: IDBFactory): Promise<void> {
  const db = await openDB(idb);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    const store = tx.objectStore(STORE_PRODUCTS);
    store.clear();
    for (const product of products) store.put(toMetadata(product));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
