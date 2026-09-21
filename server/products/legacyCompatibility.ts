import type { ProductImageRole } from './types';

export interface LegacyProductImageRow {
  id: number;
  sortOrder?: number;
  sort_order?: number;
  role?: string;
  isPrimary?: boolean;
  is_primary?: boolean | number;
  [key: string]: unknown;
}

export interface LegacyRoleAssignment {
  legacyImageId: number;
  role: ProductImageRole;
  sortOrder: number;
  isPrimary: boolean;
}

const FORMAL = new Set<ProductImageRole>(['pattern_original', 'fabric_display', 'detail', 'ai_effect', 'unclassified']);
const ROLE_ORDER: ProductImageRole[] = ['pattern_original', 'fabric_display', 'detail', 'ai_effect', 'unclassified'];

export function planLegacyRoles(rows: LegacyProductImageRow[]): LegacyRoleAssignment[] {
  const sorted = [...rows].sort((left, right) => order(left) - order(right) || left.id - right.id);
  const existingPattern = sorted.find((row) => row.role === 'pattern_original');
  const primaryId = existingPattern?.id ?? sorted[0]?.id;
  const normalized = sorted.map((row) => ({
    legacyImageId: row.id,
    role: row.id === primaryId ? 'pattern_original' as const : normalizeRole(row.role),
  }));
  const offsets = new Map<ProductImageRole, number>();
  return ROLE_ORDER.flatMap((role) => normalized.filter((item) => item.role === role).map((item) => {
    const sortOrder = offsets.get(role) ?? 0;
    offsets.set(role, sortOrder + 1);
    return { ...item, sortOrder, isPrimary: role === 'pattern_original' };
  }));
}

export function mapLegacyProductImages(productId: number, rows: LegacyProductImageRow[]) {
  return planLegacyRoles(rows).map((image) => ({
    source: 'legacy' as const,
    ...image,
    contentUrl: `/api/products/${productId}/images/${image.legacyImageId}`,
  }));
}

function normalizeRole(value: unknown): ProductImageRole {
  if (value === 'gallery' || value === 'swatch' || !FORMAL.has(value as ProductImageRole)) return 'unclassified';
  return value as ProductImageRole;
}

function order(row: LegacyProductImageRow): number {
  return Number(row.sortOrder ?? row.sort_order ?? 0);
}
