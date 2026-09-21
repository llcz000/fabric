import React from 'react';

import type { ProductImageLayoutInput } from '../../lib/products';
import type { ProductImageRole } from '../../types';

export function ProductImageCategory({ role, label, images, onUpload, onDelete, onMove, onReorder, onReplace }: {
  role: Exclude<ProductImageRole, 'legacy'>; label: string; images: ProductImageLayoutInput[];
  onUpload?(role: Exclude<ProductImageRole, 'legacy'>, files: FileList): void;
  onDelete?(assetId: string): void;
  onMove?(assetId: string, role: Exclude<ProductImageRole, 'legacy'>): void;
  onReorder?(assetId: string, direction: -1 | 1): void;
  onReplace?(assetId: string, role: Exclude<ProductImageRole, 'legacy'>, files: FileList): void;
}) {
  return <section className={role === 'unclassified' ? 'rounded-lg border border-amber-300 bg-amber-50 p-3' : 'rounded-lg border border-slate-200 p-3'}>
    <div className="mb-2 flex items-center justify-between"><strong>{label}</strong><label className="cursor-pointer text-sm text-sky-700">上传<input className="sr-only" type="file" accept="image/*" multiple onChange={(event) => event.target.files && onUpload?.(role, event.target.files)} /></label></div>
    <div className="space-y-2">{images.map((image) => <div key={image.assetId} className="flex items-center justify-between gap-2 rounded bg-white p-2 text-xs"><span className="truncate">{image.assetId}</span><div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => onReorder?.(image.assetId, -1)}>上移</button><button type="button" onClick={() => onReorder?.(image.assetId, 1)}>下移</button>
      <select aria-label="移动分类" value={role} onChange={(event) => onMove?.(image.assetId, event.target.value as Exclude<ProductImageRole, 'legacy'>)}><option value="pattern_original">花型原图</option><option value="fabric_display">面料展示图</option><option value="detail">细节图</option><option value="ai_effect">AI效果图</option><option value="unclassified">待分类</option></select>
      <label className="cursor-pointer text-sky-700">替换<input className="sr-only" type="file" accept="image/*" onChange={(event) => event.target.files && onReplace?.(image.assetId, role, event.target.files)} /></label>
      <button type="button" onClick={() => onDelete?.(image.assetId)} className="text-red-600">删除</button>
    </div></div>)}</div>
  </section>;
}
