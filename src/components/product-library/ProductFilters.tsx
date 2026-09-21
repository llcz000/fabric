import React from 'react';

import type { PatternTagSummary } from '../../types';
import type { ProductListOptions } from '../../lib/products';

export type ProductQueryAction =
  | { type: 'set-keyword'; q: string }
  | { type: 'set-tags'; tagIds: number[] }
  | { type: 'set-review'; reviewStatus?: ProductListOptions['reviewStatus'] }
  | { type: 'set-image-state'; imageState?: ProductListOptions['imageState'] }
  | { type: 'set-offset'; offset: number };

export function reduceProductQuery(value: ProductListOptions, action: ProductQueryAction): ProductListOptions {
  if (action.type === 'set-offset') return { ...value, offset: action.offset };
  if (action.type === 'set-keyword') return { ...value, q: action.q, offset: 0 };
  if (action.type === 'set-tags') return { ...value, tagIds: [...action.tagIds], offset: 0 };
  if (action.type === 'set-review') return { ...value, reviewStatus: action.reviewStatus, offset: 0 };
  return { ...value, imageState: action.imageState, offset: 0 };
}

export interface ProductFiltersProps {
  value: ProductListOptions;
  availableTags: PatternTagSummary[];
  onChange(value: ProductListOptions): void;
}

export function ProductFilters({ value, availableTags, onChange }: ProductFiltersProps) {
  const selected = new Set(value.tagIds ?? []);
  const update = (action: ProductQueryAction) => onChange(reduceProductQuery(value, action));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-3" aria-label="产品筛选">
      <div className="flex flex-wrap gap-3">
        <input
          aria-label="关键词"
          value={value.q ?? ''}
          onChange={(event) => update({ type: 'set-keyword', q: event.target.value })}
          placeholder="搜索货号、品名、成分"
          className="min-w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <select
          aria-label="审核状态"
          value={value.reviewStatus ?? ''}
          onChange={(event) => update({ type: 'set-review', reviewStatus: event.target.value as ProductListOptions['reviewStatus'] || undefined })}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">全部状态</option><option value="reviewed">已审核</option><option value="needs_attention">待处理</option>
        </select>
        <select
          aria-label="图片状态"
          value={value.imageState ?? ''}
          onChange={(event) => update({ type: 'set-image-state', imageState: event.target.value as ProductListOptions['imageState'] || undefined })}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">全部图片</option><option value="missing_pattern">缺少花型原图</option><option value="has_unclassified">有待分类图片</option><option value="complete">分类完整</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="花型分类标签">
        {availableTags.map((tag) => (
          <button key={tag.id} type="button" aria-pressed={selected.has(tag.id)}
            onClick={() => update({ type: 'set-tags', tagIds: selected.has(tag.id) ? [...selected].filter((id) => id !== tag.id) : [...selected, tag.id] })}
            className={selected.has(tag.id) ? 'rounded-full bg-sky-600 px-3 py-1 text-xs text-white' : 'rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'}>
            {tag.name}
          </button>
        ))}
      </div>
    </section>
  );
}
