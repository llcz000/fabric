/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IndexedDB wrapper for product library storage.
 * Stores product metadata as JSON and images as base64 strings
 * (more reliable than Blobs on iOS Safari).
 */

import { ProductItem } from '../types';

const DB_NAME = 'textile_dms';
const DB_VERSION = 2;
const STORE_PRODUCTS = 'products';
const STORE_IMAGES = 'product_images';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // DB v1 cleanup: delete old stores and recreate
      if (db.objectStoreNames.contains(STORE_PRODUCTS)) db.deleteObjectStore(STORE_PRODUCTS);
      if (db.objectStoreNames.contains(STORE_IMAGES)) db.deleteObjectStore(STORE_IMAGES);
      const productsStore = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
      productsStore.createIndex('itemNo', 'itemNo', { unique: false });
      const imagesStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
      imagesStore.createIndex('productId', 'productId', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => { alert('请关闭其他标签页后刷新'); reject(new Error('blocked')); };
  });
}

// ── Products ──────────────────────────────────────────

export async function getAllProducts(): Promise<ProductItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readonly');
    const store = tx.objectStore(STORE_PRODUCTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putProduct(product: ProductItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    tx.objectStore(STORE_PRODUCTS).put(product);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteProduct(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_PRODUCTS, STORE_IMAGES], 'readwrite');
    tx.objectStore(STORE_PRODUCTS).delete(id);
    const imgStore = tx.objectStore(STORE_IMAGES);
    const idx = imgStore.index('productId');
    const req = idx.openCursor(IDBKeyRange.only(id));
    req.onsuccess = () => { const c = req.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Product Images (stored as base64 strings) ─────────

export async function getImages(productId: string): Promise<{ id: string; order: number; thumbnailUrl: string }[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const idx = tx.objectStore(STORE_IMAGES).index('productId');
    const results: any[] = [];
    const req = idx.openCursor(IDBKeyRange.only(productId));
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        results.push({ id: c.value.id, order: c.value.order, thumbnailUrl: c.value.thumbnail });
        c.continue();
      } else {
        results.sort((a, b) => a.order - b.order);
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// Returns a blob URL for the full image
export async function getFullImageUrl(imageId: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const req = tx.objectStore(STORE_IMAGES).get(imageId);
    req.onsuccess = () => {
      const rec = req.result;
      if (!rec?.full) { resolve(null); return; }
      resolve(rec.full);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addProductImage(
  productId: string, order: number,
  thumbnailUrl: string, fullUrl: string,
): Promise<string> {
  const db = await openDB();
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    tx.objectStore(STORE_IMAGES).add({ id, productId, order, thumbnail: thumbnailUrl, full: fullUrl });
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function deleteImage(imageId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    tx.objectStore(STORE_IMAGES).delete(imageId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Image compression ─────────────────────────────────

export function compressImage(file: File, maxWidth: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result as string; };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);

    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
  });
}

export async function processImageUpload(file: File): Promise<{ thumbnail: string; full: string }> {
  const [thumbnail, full] = await Promise.all([
    compressImage(file, 300, 0.6),
    compressImage(file, 1600, 0.75),
  ]);
  return { thumbnail, full };
}
