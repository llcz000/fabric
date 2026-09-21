import React from 'react';

import type { ImageAssetClientError } from '../../lib/imageAssets';
import type { ProductImageLayoutInput } from '../../lib/products';
import type { PatternTagSummary, ProductItem } from '../../types';
import { ProductImageCategory } from './ProductImageCategory';

export interface ProductEditorDraft {
  fields: Pick<ProductItem, 'itemNo' | 'productName' | 'composition' | 'weight' | 'width'>;
  patternTagIds: number[];
  images: ProductImageLayoutInput[];
}
export interface ProductEditorState { open: boolean; saving: boolean; draft: ProductEditorDraft; error?: string; }
export type ProductEditorAction = { type: 'set-draft'; draft: ProductEditorDraft } | { type: 'save-started' } | { type: 'save-succeeded' } | { type: 'save-failed'; error: ImageAssetClientError };

export function canAddPatternTag(tagIds: number[]): boolean { return tagIds.length < 12; }
export function canAddProductImage(images: ProductImageLayoutInput[]): boolean { return images.length < 20; }
const ROLE_ORDER: ProductImageLayoutInput['role'][] = ['pattern_original', 'fabric_display', 'detail', 'ai_effect', 'unclassified'];
function resequenceProductImages(images: ProductImageLayoutInput[]): ProductImageLayoutInput[] {
  return ROLE_ORDER.flatMap((role) => images.filter((image) => image.role === role).map((image, sortOrder) => ({ ...image, sortOrder })));
}
export function moveProductImage(
  images: ProductImageLayoutInput[],
  assetId: string,
  targetRole: ProductImageLayoutInput['role'],
  targetIndex?: number,
): ProductImageLayoutInput[] {
  const moving = images.find((image) => image.assetId === assetId);
  if (!moving) return images;
  const groups = new Map(ROLE_ORDER.map((role) => [role, images.filter((image) => image.assetId !== assetId && image.role === role)]));
  const target = groups.get(targetRole)!;
  target.splice(Math.max(0, Math.min(targetIndex ?? target.length, target.length)), 0, { ...moving, role: targetRole });
  return ROLE_ORDER.flatMap((role) => groups.get(role)!.map((image, sortOrder) => ({ ...image, role, sortOrder })));
}
export function reduceEditorState(state: ProductEditorState, action: ProductEditorAction): ProductEditorState {
  if (action.type === 'set-draft') return { ...state, draft: action.draft, error: undefined };
  if (action.type === 'save-started') return { ...state, saving: true, error: undefined };
  if (action.type === 'save-succeeded') return { ...state, saving: false, open: false, error: undefined };
  return { ...state, saving: false, open: true, error: `${action.error.message}${action.error.requestId ? `（请求 ID：${action.error.requestId}）` : ''}` };
}

const CATEGORIES = [
  ['pattern_original', '花型原图'], ['fabric_display', '面料展示图'], ['detail', '细节图'], ['ai_effect', 'AI效果图'], ['unclassified', '待分类'],
] as const;

export function ProductEditor({ state, availableTags, onChange, onSave, onClose, onUpload, onReplace }: {
  state: ProductEditorState; availableTags: PatternTagSummary[]; onChange(draft: ProductEditorDraft): void;
  onSave(draft: ProductEditorDraft): void; onClose(): void;
  onUpload?(role: ProductImageLayoutInput['role'], files: FileList): void;
  onReplace?(assetId: string, role: ProductImageLayoutInput['role'], files: FileList): void;
}) {
  if (!state.open) return null;
  const draft = state.draft;
  const field = (name: keyof ProductEditorDraft['fields']) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, fields: { ...draft.fields, [name]: event.target.value } });
  return <div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-6"><div className="mx-auto max-w-4xl rounded-2xl bg-white p-6">
    <h2 className="text-lg font-bold">产品编辑</h2>{state.error && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</p>}
    <div className="my-4 grid grid-cols-2 gap-3">{(['itemNo', 'productName', 'composition', 'weight', 'width'] as const).map((name) => <input key={name} aria-label={name} value={draft.fields[name]} onChange={field(name)} className="rounded border p-2" />)}</div>
    <div className="mb-4 flex flex-wrap gap-2">{availableTags.map((tag) => { const active = draft.patternTagIds.includes(tag.id); return <button key={tag.id} type="button" aria-pressed={active} disabled={!active && !canAddPatternTag(draft.patternTagIds)} onClick={() => onChange({ ...draft, patternTagIds: active ? draft.patternTagIds.filter((id) => id !== tag.id) : [...draft.patternTagIds, tag.id] })}>{tag.name}</button>; })}</div>
    <div className="grid gap-3 md:grid-cols-2">{CATEGORIES.map(([role, label]) => <ProductImageCategory key={role} role={role} label={label} images={draft.images.filter((image) => image.role === role)} onUpload={onUpload} onReplace={onReplace} onDelete={(assetId) => onChange({ ...draft, images: resequenceProductImages(draft.images.filter((image) => image.assetId !== assetId)) })} onMove={(assetId, targetRole) => onChange({ ...draft, images: moveProductImage(draft.images, assetId, targetRole) })} onReorder={(assetId, direction) => { const current = draft.images.filter((image) => image.role === role).findIndex((image) => image.assetId === assetId); onChange({ ...draft, images: moveProductImage(draft.images, assetId, role, current + direction) }); }} />)}</div>
    <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose}>取消</button><button type="button" disabled={state.saving} onClick={() => onSave(draft)} className="rounded bg-sky-600 px-4 py-2 text-white">{state.saving ? '保存中…' : '保存'}</button></div>
  </div></div>;
}
