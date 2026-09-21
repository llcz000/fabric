import React from 'react';

import type { ProductLibraryItem } from '../../types';
import { applyPatternTagBatch } from '../../lib/products';

export function applySelectedProductTags(
  apiFetch: typeof fetch,
  selectedIds: string[],
  operation: 'add' | 'remove',
  tagIds: number[],
): Promise<void> {
  return applyPatternTagBatch(apiFetch, { productIds: selectedIds.map(Number), operation, tagIds });
}

export interface ProductTableProps {
  items: ProductLibraryItem[];
  total: number;
  limit: number;
  offset: number;
  selectedIds: Set<string>;
  onSelectionChange(ids: Set<string>): void;
  onOpen(product: ProductLibraryItem, assetId?: string): void;
  onEdit(product: ProductLibraryItem): void;
  onPageChange(offset: number): void;
}

export function ProductTable(props: ProductTableProps) {
  const { items, total, limit, offset, selectedIds } = props;
  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    props.onSelectionChange(next);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left text-slate-500">
        <th className="p-3">选择</th><th className="p-3">花型原图</th><th className="p-3">货号 / 品名</th><th className="p-3">花型分类</th><th className="p-3">图片</th><th className="p-3">审核</th><th className="p-3">操作</th>
      </tr></thead><tbody>{items.map((product) => {
        const pattern = product.images?.find((image) => image.role === 'pattern_original');
        const tags = product.patternTags.slice(0, 3);
        return <tr key={product.id} className="border-t border-slate-100">
          <td className="p-3"><input type="checkbox" checked={selectedIds.has(product.id)} onChange={() => toggle(product.id)} aria-label={`选择 ${product.itemNo}`} /></td>
          <td className="p-3">{pattern?.thumbnailUrl ? <button type="button" onClick={() => props.onOpen(product, pattern.assetId)}><img src={pattern.thumbnailUrl} alt="花型原图" className="h-16 w-16 rounded object-cover" /></button> : <span className="text-amber-600">缺少花型原图</span>}</td>
          <td className="p-3"><strong>{product.itemNo || '缺货号'}</strong><div className="text-slate-500">{product.productName || '-'}</div></td>
          <td className="p-3"><div className="flex flex-wrap gap-1">{tags.map((tag) => <span key={tag.id} className="rounded bg-sky-50 px-2 py-1 text-xs text-sky-700">{tag.name}</span>)}{product.patternTags.length > 3 && <span className="text-xs text-slate-500">+{product.patternTags.length - 3}</span>}</div></td>
          <td className="p-3 text-xs text-slate-600">原图 {product.categoryCounts.patternOriginal} · 展示 {product.categoryCounts.fabricDisplay} · 细节 {product.categoryCounts.detail} · AI {product.categoryCounts.aiEffect}</td>
          <td className="p-3"><span className={product.reviewStatus === 'reviewed' ? 'text-emerald-600' : 'text-amber-600'}>{product.reviewStatus === 'reviewed' ? '已审核' : `待处理 ${product.openIssueCount}`}</span></td>
          <td className="p-3"><button type="button" onClick={() => props.onEdit(product)} className="text-sky-700">编辑</button></td>
        </tr>;
      })}</tbody></table></div>
      <footer className="flex items-center justify-between border-t border-slate-100 p-3 text-sm"><span>共 {total} 条</span><div className="flex gap-2">
        <button type="button" disabled={offset === 0} onClick={() => props.onPageChange(Math.max(0, offset - limit))}>上一页</button>
        <button type="button" disabled={offset + limit >= total} onClick={() => props.onPageChange(offset + limit)}>下一页</button>
      </div></footer>
    </div>
  );
}
