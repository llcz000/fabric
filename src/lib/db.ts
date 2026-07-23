/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IndexedDB wrapper for product library storage.
 * Stores product metadata and image blobs for offline access.
 */

import { ProductItem, ProductImage } from '../types';

const DB_NAME = 'textile_dms';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'products';
const STORE_IMAGES = 'product_images';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const productsStore = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
        productsStore.createIndex('itemNo', 'itemNo', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        const imagesStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
        imagesStore.createIndex('productId', 'productId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

export async function getProduct(id: string): Promise<ProductItem | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readonly');
    const store = tx.objectStore(STORE_PRODUCTS);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putProduct(product: ProductItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    const store = tx.objectStore(STORE_PRODUCTS);
    store.put(product);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteProduct(id: string): Promise<void> {
  const db = await openDB();
  // Delete product and all its images
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    tx.objectStore(STORE_PRODUCTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    const index = tx.objectStore(STORE_IMAGES).index('productId');
    const req = index.openCursor(IDBKeyRange.only(id));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Product Images ────────────────────────────────────

export async function getImages(productId: string): Promise<{ id: string; order: number; thumbnail: Blob }[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const index = tx.objectStore(STORE_IMAGES).index('productId');
    const results: any[] = [];
    const req = index.openCursor(IDBKeyRange.only(productId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push({ id: cursor.value.id, order: cursor.value.order, thumbnail: cursor.value.thumbnail });
        cursor.continue();
      } else {
        results.sort((a, b) => a.order - b.order);
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getFullImage(imageId: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const req = tx.objectStore(STORE_IMAGES).get(imageId);
    req.onsuccess = () => resolve(req.result?.full || null);
    req.onerror = () => reject(req.error);
  });
}

export async function addProductImage(
  productId: string,
  order: number,
  thumbnail: Blob,
  full: Blob,
): Promise<string> {
  const db = await openDB();
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    tx.objectStore(STORE_IMAGES).add({ id, productId, order, thumbnail, full });
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
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

export async function updateImageOrder(images: { id: string; order: number }[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    const store = tx.objectStore(STORE_IMAGES);
    for (const img of images) {
      const req = store.get(img.id);
      req.onsuccess = () => {
        const record = req.result;
        if (record) { record.order = img.order; store.put(record); }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Image compression ─────────────────────────────────

export function compressImage(file: File, maxWidth: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result as string; };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);

    img.onload = async () => {
      try {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        // toDataURL + fetch -> Blob (reliable on all platforms including iOS Safari)
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        resolve(blob);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
  });
}

export async function processImageUpload(file: File): Promise<{ thumbnail: Blob; full: Blob }> {
  const [thumbnail, full] = await Promise.all([
    compressImage(file, 300, 0.6),
    compressImage(file, 1600, 0.75),
  ]);
  return { thumbnail, full };
}
