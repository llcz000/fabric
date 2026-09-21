import React, { useMemo, useState } from 'react';

import type { ProductDetail, ProductImageDescriptor, ProductImageRole } from '../../types';

const TABS: Array<{ role: Exclude<ProductImageRole, 'unclassified' | 'legacy'>; label: string }> = [
  { role: 'pattern_original', label: '花型原图' }, { role: 'fabric_display', label: '面料展示图' },
  { role: 'detail', label: '细节图' }, { role: 'ai_effect', label: 'AI效果图' },
];

export function ProductImageViewer({ product, initialAssetId, onClose }: { product: ProductDetail; initialAssetId?: string; onClose?(): void }) {
  const initial = product.images?.find((image) => image.assetId === initialAssetId);
  const [role, setRole] = useState(initial && initial.role !== 'legacy' && initial.role !== 'unclassified' ? initial.role : 'pattern_original');
  const grouped = useMemo(() => product.images?.filter((image) => image.role === role) ?? [], [product.images, role]);
  const [index, setIndex] = useState(Math.max(0, grouped.findIndex((image) => image.assetId === initialAssetId)));
  const active: ProductImageDescriptor | undefined = grouped[Math.min(index, Math.max(0, grouped.length - 1))];
  const move = (step: number) => setIndex((current) => grouped.length ? (current + step + grouped.length) % grouped.length : 0);
  return <section className="rounded-xl bg-slate-950 p-4 text-white" tabIndex={0}
    onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); if (event.key === 'Escape') onClose?.(); }}>
    <div role="tablist" className="mb-4 flex gap-2">{TABS.map((tab) => <button role="tab" aria-selected={role === tab.role} key={tab.role} type="button" onClick={() => { setRole(tab.role); setIndex(0); }} className="rounded px-3 py-2 text-sm">{tab.label}</button>)}</div>
    {active ? <div className="flex min-h-72 items-center justify-center"><img src={active.displayUrl ?? active.thumbnailUrl} alt={TABS.find((tab) => tab.role === role)?.label} className="max-h-[70vh] max-w-full object-contain" /></div>
      : <div className="flex min-h-72 items-center justify-center text-slate-400">{role === 'pattern_original' ? '缺少花型原图' : '暂无图片'}</div>}
    {grouped.length > 1 && <div className="mt-3 flex justify-center gap-3"><button type="button" onClick={() => move(-1)}>上一张</button><span>{index + 1} / {grouped.length}</span><button type="button" onClick={() => move(1)}>下一张</button></div>}
  </section>;
}
