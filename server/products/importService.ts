import type { PlannedImage, PlannedIssue, PlannedProduct } from '../../scripts/product-import/normalize';
import type { AtomicImportedProduct, ImportBatchSummary, ProductImportBatch, ProductImportRepository } from './importTypes';

export interface ProductImportImageIngestor {
  ingest(image: PlannedImage, principalId: string): Promise<{ assetId: string; originMetadata?: Record<string, string | number>; issues?: PlannedIssue[] }>;
}
export interface ApplyProductResult { planKey: string; productId?: number; status: 'applied' | 'skipped' | 'failed'; errorCode?: string; }

export class ProductImportService {
  constructor(private readonly repository: ProductImportRepository, private readonly images: ProductImportImageIngestor) {}

  async applyProduct(batch: ProductImportBatch, product: PlannedProduct, principalId: string): Promise<ApplyProductResult> {
    const existing = await Promise.all(product.sources.map((source) => this.repository.getSourceResult(batch.id, source.sheet, source.rowNumber)));
    if (existing.every((result) => result?.status === 'applied')) {
      return { planKey: product.planKey, productId: existing.find((result) => result?.productId)?.productId, status: 'skipped' };
    }
    try {
      const importedImages: AtomicImportedProduct['images'] = [];
      const issues = [...product.issues];
      for (const image of product.images) {
        try {
          const ingested = await this.images.ingest(image, principalId);
          importedImages.push({ assetId: ingested.assetId, role: image.role, sortOrder: importedImages.filter((item) => item.role === image.role).length, sourceRef: `${product.sources[0]?.sheet ?? batch.sheetName}!${image.cell}`, originMetadata: ingested.originMetadata });
          if (ingested.issues) issues.push(...ingested.issues);
        } catch {
          issues.push({ code: 'IMAGE_REFERENCE_MISSING', fieldName: 'images', message: '图片无法解析或导入', sourceRef: `${product.sources[0]?.sheet ?? batch.sheetName}!${image.cell}`, severity: 'warning' });
        }
      }
      if (!importedImages.some((image) => image.role === 'pattern_original') && !issues.some((issue) => issue.code === 'MISSING_PATTERN_ORIGINAL')) {
        issues.push({ code: 'MISSING_PATTERN_ORIGINAL', fieldName: 'images', message: '缺少花型原图', sourceRef: `${product.sources[0]?.sheet ?? batch.sheetName}!${product.sources[0]?.rowNumber ?? 0}`, severity: 'warning' });
      }
      const created = await this.repository.applyImportedProduct({
        batchId: batch.id, planKey: product.planKey, fields: product.fields, patternTagIds: [],
        sources: product.sources, images: importedImages, issues, principalId,
      });
      return { planKey: product.planKey, productId: created.productId, status: 'applied' };
    } catch (error) {
      const errorCode = stableErrorCode(error);
      await this.repository.recordProductFailure(batch.id, product.planKey, errorCode);
      return { planKey: product.planKey, status: 'failed', errorCode };
    }
  }

  async applyPlan(batch: ProductImportBatch, products: PlannedProduct[], principalId: string): Promise<ImportBatchSummary> {
    let succeeded = 0; let failed = 0; let skipped = 0;
    for (const product of products) {
      const result = await this.applyProduct(batch, product, principalId);
      if (result.status === 'applied') succeeded += 1;
      else if (result.status === 'skipped') skipped += 1;
      else failed += 1;
    }
    const summary: ImportBatchSummary = { succeeded, failed, skipped, status: failed > 0 ? 'partial' : 'completed' };
    await this.repository.finishBatch(batch.id, summary);
    return summary;
  }

  async rollbackBatch(batchId: number): Promise<void> {
    const blockers = await this.repository.rollbackBatch(batchId);
    if (blockers.length) {
      const error = Object.assign(new Error(`ROLLBACK_BLOCKED: ${blockers.map((item) => `${item.productId}:${item.reason}`).join(',')}`), { code: 'ROLLBACK_BLOCKED', blockers });
      throw error;
    }
  }
}

function stableErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return String((error as { code: string }).code).slice(0, 64);
  }
  return 'IMPORT_PRODUCT_FAILED';
}
