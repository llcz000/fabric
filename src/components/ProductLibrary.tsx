/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Product Library — browse, search, CRUD, import/export fabric product records
 * with multi-image pattern support and similar-image search via dHash.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { ProductItem } from '../types';
import {
  Search, Plus, Upload, Download, Trash2, Edit3, X, ChevronLeft,
  ChevronRight, Image, Package, CheckSquare, Square, Filter,
} from 'lucide-react';
import {
  getAllProducts, putProduct, deleteProduct,
  getImages, getFullImage, addProductImage, deleteImage,
  processImageUpload,
} from '../lib/db';
import { computeImageHash } from '../lib/phash';

// ── Helpers ──────────────────────────────────────────

function genId(): string {
  return 'prod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
function nowISO(): string {
  return new Date().toISOString();
}
function blankProduct(): ProductItem {
  return { id: '', itemNo: '', productName: '', composition: '', weight: '', width: '', imageCount: 0, createdAt: nowISO(), updatedAt: nowISO() };
}

function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem('fabric_auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
    ...(options.headers as Record<string, string> || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    sessionStorage.removeItem('fabric_auth_token');
  }
  return res;
}

// Blob → base64 data URL for server transport
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── ThumbnailCell (memoized, outside parent) ─────────

const ThumbnailCell = memo(({ productId }: { productId: string }) => {
  const [thumbs, setThumbs] = useState<{ id: string; url: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Revoke previous URLs
    urlsRef.current.forEach(u => URL.revokeObjectURL(u));
    urlsRef.current = [];

    getImages(productId).then(imgs => {
      if (cancelled) return;
      const items = imgs.slice(0, 3).map(i => {
        const url = URL.createObjectURL(i.thumbnail);
        urlsRef.current.push(url);
        return { id: i.id, url };
      });
      setThumbs(items);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [productId]);

  // Cleanup on unmount
  useEffect(() => () => urlsRef.current.forEach(u => URL.revokeObjectURL(u)), []);

  if (!loaded) return <div className="w-16 h-16 bg-slate-100 rounded animate-pulse" />;
  if (thumbs.length === 0) return <div className="w-16 h-16 bg-slate-50 rounded flex items-center justify-center"><Image className="w-5 h-5 text-slate-300" /></div>;

  return (
    <div className="flex gap-1" data-product-id={productId}>
      {thumbs.map((t, i) => (
        <img key={t.id} src={t.url} className="w-14 h-14 object-cover rounded border border-slate-200 cursor-pointer hover:opacity-80"
          onClick={() => { const ev = new CustomEvent('open-lightbox', { detail: { productId, index: i } }); window.dispatchEvent(ev); }}
          alt="" />
      ))}
      {thumbs.length >= 3 && (
        <div className="w-14 h-14 bg-slate-100 rounded border flex items-center justify-center cursor-pointer text-xs font-bold text-slate-500"
          onClick={() => { const ev = new CustomEvent('open-lightbox', { detail: { productId, index: 2 } }); window.dispatchEvent(ev); }}>
          +{thumbs.length}
        </div>
      )}
    </div>
  );
});

// ── PendingPreview (memoized) ─────────────────────────

const PendingPreview = memo(({ files, onRemove }: { files: { file: File; url: string }[]; onRemove: (i: number) => void }) => (
  <div className="flex flex-wrap gap-2">
    {files.map((f, i) => (
      <div key={i} className="relative">
        <img src={f.url} className="w-20 h-20 object-cover rounded-lg border border-sky-200" alt="" />
        <button onClick={() => onRemove(i)}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center cursor-pointer">
          <X className="w-3 h-3" />
        </button>
      </div>
    ))}
  </div>
));

// ── Main Component ────────────────────────────────────

export default function ProductLibrary() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [itemNoTags, setItemNoTags] = useState<string[]>([]);
  const [productNameTags, setProductNameTags] = useState<string[]>([]);
  const [itemNoInput, setItemNoInput] = useState('');
  const [productNameInput, setProductNameInput] = useState('');
  const [editModal, setEditModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem>(blankProduct());
  const [editImages, setEditImages] = useState<{ id: string; order: number; thumbnailUrl: string }[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; url: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductItem | null>(null);
  const [lightboxProductId, setLightboxProductId] = useState<string | null>(null);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [similarSearching, setSimilarSearching] = useState(false);
  const similarInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load products ──────────────────────────────────

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getAllProducts();
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setProducts(list);
    } catch (e: any) {
      console.error('Load products failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // ── Lightbox via events (from memoized ThumbnailCell) ──

  useEffect(() => {
    const handler = async (ev: Event) => {
      const { productId, index } = (ev as CustomEvent).detail;
      const imgs = await getImages(productId);
      if (imgs.length === 0) return;
      const urls: string[] = [];
      for (const img of imgs) {
        const full = await getFullImage(img.id);
        if (full) urls.push(URL.createObjectURL(full));
      }
      setLightboxImages(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return urls; });
      setLightboxProductId(productId);
      setLightboxIndex(Math.min(index, urls.length - 1));
    };
    window.addEventListener('open-lightbox', handler);
    return () => window.removeEventListener('open-lightbox', handler);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxProductId(null);
    setLightboxImages(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
    setLightboxIndex(0);
  }, []);

  // ── Filter ─────────────────────────────────────────

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (itemNoTags.length > 0 && !itemNoTags.some(t => p.itemNo.toLowerCase().includes(t.toLowerCase()))) return false;
      if (productNameTags.length > 0 && !productNameTags.some(t => p.productName.toLowerCase().includes(t.toLowerCase()))) return false;
      return true;
    });
  }, [products, itemNoTags, productNameTags]);

  const addTag = (input: string, tags: string[], setTags: (t: string[]) => void, setInput: (s: string) => void) => {
    const v = input.trim();
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setInput('');
  };
  const removeTag = (tag: string, tags: string[], setTags: (t: string[]) => void) => setTags(tags.filter(t => t !== tag));

  // ── Selection ──────────────────────────────────────

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelectAll = () => setSelectedIds(prev => prev.size === filteredProducts.length ? new Set() : new Set(filteredProducts.map(p => p.id)));

  // ── CRUD ───────────────────────────────────────────

  const openCreate = () => {
    setEditingProduct({ ...blankProduct(), id: genId() });
    setEditImages([]);
    setPendingFiles([]);
    setEditModal(true);
  };

  const openEdit = async (product: ProductItem) => {
    setEditingProduct({ ...product });
    setPendingFiles([]);
    try {
      const imgs = await getImages(product.id);
      setEditImages(imgs.map(i => ({ id: i.id, order: i.order, thumbnailUrl: URL.createObjectURL(i.thumbnail) })));
    } catch { setEditImages([]); }
    setEditModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const p = { ...editingProduct, updatedAt: nowISO() };

      // Process new images (compress + store in IndexedDB)
      let order = editImages.length;
      for (const pf of pendingFiles) {
        const { thumbnail, full } = await processImageUpload(pf.file);
        const imgId = await addProductImage(p.id, order, thumbnail, full);
        setEditImages(prev => [...prev, { id: imgId, order, thumbnailUrl: URL.createObjectURL(thumbnail) }]);
        order++;
      }

      p.imageCount = order;
      if (!p.createdAt) p.createdAt = nowISO();
      await putProduct(p);

      // Sync to server
      try {
        const formData = new FormData();
        formData.append('itemNo', p.itemNo);
        formData.append('productName', p.productName);
        formData.append('composition', p.composition);
        formData.append('weight', p.weight);
        formData.append('width', p.width);
        for (const pf of pendingFiles) {
          formData.append('image_files', pf.file, pf.file.name);
        }
        const existingId = products.find(x => x.id === p.id);
        const method = existingId ? 'PUT' : 'POST';
        const url = existingId ? `/api/products/${p.id}` : '/api/products';
        console.log('[sync]', method, url, 'itemNo:', p.itemNo, 'images:', pendingFiles.length);
        const syncRes = await authFetch(url, { method, body: formData });
        const syncData = await syncRes.json().catch(() => ({}));
        console.log('[sync] response status:', syncRes.status, 'body:', syncData);
        if (!syncRes.ok) {
          console.error('[sync] server error:', syncData.error || syncRes.statusText);
        }
      } catch (e: any) {
        console.error('[sync] exception:', e.message || e);
      }

      showToast('产品已保存');
      setEditModal(false);
      await loadProducts();
    } catch (e: any) {
      showToast('保存失败: ' + (e.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProduct(deleteTarget.id);
      try { await authFetch(`/api/products/${deleteTarget.id}`, { method: 'DELETE' }); } catch { /* best-effort */ }
      setSelectedIds(prev => { const n = new Set(prev); n.delete(deleteTarget.id); return n; });
      showToast('已删除');
      setDeleteTarget(null);
      await loadProducts();
    } catch (e: any) { showToast('删除失败: ' + (e.message || '')); }
  };

  const handleDeleteImage = async (imageId: string, index: number) => {
    await deleteImage(imageId);
    setEditImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSelectImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files).map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setPendingFiles(prev => [...prev, ...newFiles]);
    e.target.value = '';
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  };

  // ── Excel Export ───────────────────────────────────

  const handleExport = async () => {
    const selected = selectedIds.size > 0
      ? filteredProducts.filter(p => selectedIds.has(p.id))
      : filteredProducts;
    if (selected.length === 0) { showToast('没有可导出的产品'); return; }

    // Try server export first (has image embedding support)
    const itemNos = selected.map(p => p.itemNo);
    try {
      const res = await authFetch('/api/products/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemNos }),
      });
      if (res.ok) {
        const blob = await res.blob();
        // If blob is too small (< 5KB for 3+ records), likely only headers — fall through to client export
        if (blob.size > 5000) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url;
          a.download = `产品库_${new Date().toISOString().slice(0, 10)}.xlsx`;
          a.click(); URL.revokeObjectURL(url);
          showToast(`已导出 ${selected.length} 条记录`);
          return;
        }
      }
    } catch { /* fall through to client-side export */ }

    // Client-side fallback: export metadata from IndexedDB as .xls (HTML table)
    try {
      const rows: string[] = [];
      for (const p of selected) {
        const imgs = await getImages(p.id).catch(() => []);
        const imgCount = imgs.length > 0 ? `[${imgs.length}张图片]` : '';
        rows.push(`<tr><td>${esc(p.itemNo)}</td><td>${esc(p.productName)}</td><td>${esc(p.composition)}</td><td>${esc(p.weight)}</td><td>${esc(p.width)}</td><td>${esc(imgCount)}</td></tr>`);
      }
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table><tr><th>货号</th><th>品名</th><th>成分</th><th>克重</th><th>门幅</th><th>花型</th></tr>${rows.join('')}</table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `产品库_${new Date().toISOString().slice(0, 10)}.xls`;
      a.click(); URL.revokeObjectURL(url);
      showToast(`已导出 ${selected.length} 条记录（不含图片）`);
    } catch (e: any) { showToast('导出失败: ' + (e.message || '')); }
  };

  // HTML escape for .xls export
  function esc(s: string) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ── Excel Import ───────────────────────────────────

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const form = new FormData(); form.append('file', file);
    try {
      const res = await authFetch('/api/products/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      showToast(`成功导入 ${data.count} 条记录`);
      await loadProducts();
    } catch (err: any) { showToast('导入失败: ' + (err.message || '')); }
    e.target.value = '';
  };

  // ── Similar Search ─────────────────────────────────

  const handleSimilarSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setSimilarSearching(true);
    try {
      const form = new FormData(); form.append('file', file);
      const res = await authFetch('/api/products/search/similar', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      const matchIds = new Set<string>(data.results?.map((r: any) => String(r.productId)) || []);
      const matchedProducts = products.filter(p => matchIds.has(p.id));
      if (matchedProducts.length > 0) {
        setItemNoTags(matchedProducts.map(p => p.itemNo));
        showToast(`找到 ${matchedProducts.length} 个相似产品`);
      } else { showToast('未找到相似产品'); }
    } catch (err: any) { showToast('搜索失败: ' + (err.message || '')); }
    finally { setSimilarSearching(false); }
    e.target.value = '';
  };

  // ── Render ─────────────────────────────────────────

  const hasFilters = itemNoTags.length > 0 || productNameTags.length > 0;

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-pulse">{toast}</div>}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-sky-600" />
          <h2 className="text-lg font-bold text-slate-800">产品库</h2>
          <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">{products.length} 条</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept="image/*" className="hidden" ref={similarInputRef} onChange={handleSimilarSearch} />
          <button type="button" onClick={() => similarInputRef.current?.click()} disabled={similarSearching}
            className="flex items-center gap-1 px-3 py-2 border border-purple-200 hover:border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors">
            <Search className="w-3.5 h-3.5" />{similarSearching ? '搜索中...' : '以图搜图'}
          </button>
          <label className="flex items-center gap-1 px-3 py-2 border border-emerald-200 hover:border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />导入Excel
            <input type="file" accept=".xlsx" className="hidden" onChange={handleImport} />
          </label>
          <button type="button" onClick={handleExport}
            className="flex items-center gap-1 px-3 py-2 border border-slate-200 hover:border-slate-300 bg-white text-slate-600 rounded-xl text-xs font-semibold cursor-pointer transition-colors">
            <Download className="w-3.5 h-3.5" />导出{selectedIds.size > 0 ? `选中(${selectedIds.size})` : '全部'}
          </button>
          <button type="button" onClick={openCreate}
            className="flex items-center gap-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold shadow-sm cursor-pointer transition-colors">
            <Plus className="w-4 h-4" />新增
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-500"><Filter className="w-3.5 h-3.5" /> 筛选</div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-400">货号:</span>
            {itemNoTags.map(t => (<span key={t} className="inline-flex items-center gap-0.5 bg-sky-50 text-sky-700 text-xs px-2 py-0.5 rounded-full">{t}<button onClick={() => removeTag(t, itemNoTags, setItemNoTags)} className="hover:text-sky-900 cursor-pointer"><X className="w-3 h-3" /></button></span>))}
            <input type="text" value={itemNoInput} onChange={e => setItemNoInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTag(itemNoInput, itemNoTags, setItemNoTags, setItemNoInput); }}
              placeholder="输入后回车..." className="w-24 text-xs px-2 py-1 border border-slate-200 rounded-md outline-none focus:border-sky-300" />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-400">品名:</span>
            {productNameTags.map(t => (<span key={t} className="inline-flex items-center gap-0.5 bg-sky-50 text-sky-700 text-xs px-2 py-0.5 rounded-full">{t}<button onClick={() => removeTag(t, productNameTags, setProductNameTags)} className="hover:text-sky-900 cursor-pointer"><X className="w-3 h-3" /></button></span>))}
            <input type="text" value={productNameInput} onChange={e => setProductNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTag(productNameInput, productNameTags, setProductNameTags, setProductNameInput); }}
              placeholder="输入后回车..." className="w-24 text-xs px-2 py-1 border border-slate-200 rounded-md outline-none focus:border-sky-300" />
          </div>
          {hasFilters && <button onClick={() => { setItemNoTags([]); setProductNameTags([]); }} className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer">清除全部筛选</button>}
          <span className="text-xs text-slate-300 ml-auto">{filteredProducts.length} 条匹配</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">加载中...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Package className="w-12 h-12 mx-auto mb-3 text-slate-200" />
            <p className="font-semibold">暂无产品记录</p>
            <p className="text-xs mt-1">点击"新增"添加或"导入Excel"批量导入</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="py-3 px-2 text-left w-8">
                      <button onClick={toggleSelectAll} className="cursor-pointer text-slate-400 hover:text-sky-600">
                        {selectedIds.size === filteredProducts.length && filteredProducts.length > 0 ? <CheckSquare className="w-4 h-4 text-sky-600" /> : <Square className="w-4 h-4" />}
                      </button>
                    </th>
                    <th className="py-3 px-2 text-left font-semibold text-slate-600">花型</th>
                    <th className="py-3 px-2 text-left font-semibold text-slate-600">货号</th>
                    <th className="py-3 px-2 text-left font-semibold text-slate-600">品名</th>
                    <th className="py-3 px-2 text-left font-semibold text-slate-600">成分</th>
                    <th className="py-3 px-2 text-left font-semibold text-slate-600">克重</th>
                    <th className="py-3 px-2 text-left font-semibold text-slate-600">门幅</th>
                    <th className="py-3 px-2 text-center font-semibold text-slate-600 w-16">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(p => (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className="py-2 px-2">
                        <button onClick={() => toggleSelect(p.id)} className="cursor-pointer text-slate-400 hover:text-sky-600">
                          {selectedIds.has(p.id) ? <CheckSquare className="w-4 h-4 text-sky-600" /> : <Square className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="py-2 px-2"><ThumbnailCell productId={p.id} /></td>
                      <td className="py-2 px-2 font-bold text-slate-800">{p.itemNo}</td>
                      <td className="py-2 px-2 text-slate-700">{p.productName || '-'}</td>
                      <td className="py-2 px-2 text-slate-600">{p.composition || '-'}</td>
                      <td className="py-2 px-2 text-slate-600">{p.weight || '-'}</td>
                      <td className="py-2 px-2 text-slate-600">{p.width || '-'}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openEdit(p)} className="p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer text-slate-400 hover:text-sky-600 transition-colors" title="编辑"><Edit3 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setDeleteTarget(p)} className="p-1.5 hover:bg-red-50 rounded-lg cursor-pointer text-slate-400 hover:text-red-500 transition-colors" title="删除"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedIds.size > 0 && (
              <div className="border-t border-slate-200 bg-sky-50/30 px-4 py-2 flex items-center gap-3">
                <span className="text-xs text-slate-600">已选 <b>{selectedIds.size}</b> 项</span>
                <button onClick={handleExport} className="text-xs text-sky-600 hover:text-sky-800 font-semibold cursor-pointer"><Download className="w-3 h-3 inline mr-1" />导出选中</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Edit Modal ──────────────────────────────── */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-10 overflow-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">{products.find(p => p.id === editingProduct.id) ? '编辑产品' : '新增产品'}</h3>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="text-xs text-slate-500 font-semibold">货号 *</span>
                <input type="text" value={editingProduct.itemNo} onChange={e => setEditingProduct({ ...editingProduct, itemNo: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400" /></label>
              <label className="space-y-1"><span className="text-xs text-slate-500 font-semibold">品名 *</span>
                <input type="text" value={editingProduct.productName} onChange={e => setEditingProduct({ ...editingProduct, productName: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400" /></label>
              <label className="space-y-1"><span className="text-xs text-slate-500 font-semibold">成分</span>
                <input type="text" value={editingProduct.composition} onChange={e => setEditingProduct({ ...editingProduct, composition: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400" /></label>
              <label className="space-y-1"><span className="text-xs text-slate-500 font-semibold">克重</span>
                <input type="text" value={editingProduct.weight} onChange={e => setEditingProduct({ ...editingProduct, weight: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400" /></label>
              <label className="space-y-1"><span className="text-xs text-slate-500 font-semibold">门幅</span>
                <input type="text" value={editingProduct.width} onChange={e => setEditingProduct({ ...editingProduct, width: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400" /></label>
            </div>

            {/* Existing images */}
            {editImages.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs text-slate-500 font-semibold">花型图片 ({editImages.length})</span>
                <div className="flex flex-wrap gap-2">
                  {editImages.map((img, i) => (
                    <div key={img.id} className="relative group">
                      <img src={img.thumbnailUrl} className="w-20 h-20 object-cover rounded-lg border border-slate-200" alt="" />
                      <button onClick={() => handleDeleteImage(img.id, i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add images */}
            <label className="block border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-sky-300 transition-colors">
              <Image className="w-6 h-6 text-slate-300 mx-auto mb-1" />
              <span className="text-xs text-slate-400">点击或拖拽上传花型图片（可多选）</span>
              <input type="file" accept="image/*" multiple className="hidden" ref={fileInputRef} onChange={handleSelectImage} />
            </label>

            {/* Pending files preview */}
            {pendingFiles.length > 0 && <PendingPreview files={pendingFiles} onRemove={removePendingFile} />}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { pendingFiles.forEach(f => URL.revokeObjectURL(f.url)); setEditModal(false); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">取消</button>
              <button onClick={handleSave} disabled={saving || !editingProduct.itemNo.trim() || !editingProduct.productName.trim()}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold cursor-pointer transition-colors">{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ───────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm mx-4 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">确认删除</h3>
            <p className="text-sm text-slate-600">确定删除 "<b>{deleteTarget.itemNo} {deleteTarget.productName}</b>" 及所有花型图片吗？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">取消</button>
              <button onClick={handleDelete} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold cursor-pointer">删除</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ─────────────────────────────────── */}
      {lightboxProductId && lightboxImages.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.92)' }} onClick={closeLightbox}>
          <button onClick={closeLightbox} className="absolute top-4 right-4 text-white/70 hover:text-white cursor-pointer z-10"><X className="w-7 h-7" /></button>
          <span className="absolute top-4 left-4 text-white/60 text-sm">{lightboxIndex + 1} / {lightboxImages.length}</span>
          {lightboxImages.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(prev => prev > 0 ? prev - 1 : lightboxImages.length - 1); }} className="absolute left-4 text-white/70 hover:text-white cursor-pointer z-10"><ChevronLeft className="w-10 h-10" /></button>
              <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(prev => prev < lightboxImages.length - 1 ? prev + 1 : 0); }} className="absolute right-4 text-white/70 hover:text-white cursor-pointer z-10"><ChevronRight className="w-10 h-10" /></button>
            </>
          )}
          <img src={lightboxImages[lightboxIndex]} className="max-w-[90vw] max-h-[90vh] object-contain" onClick={(e) => e.stopPropagation()} alt="" />
        </div>
      )}
    </div>
  );
}
