import type { ProductImageRole, ProductIssueCode, ProductIssueStatus } from './types';

export const FACT_ISSUE_CODES = [
  'MISSING_PRODUCT_NAME',
  'MISSING_COMPOSITION',
  'MISSING_WEIGHT',
  'MISSING_WIDTH',
  'MISSING_PATTERN_ORIGINAL',
  'IMAGE_UNCLASSIFIED',
] as const satisfies readonly ProductIssueCode[];

export interface ProductIssueFactsInput {
  productName: string;
  composition: string;
  weight: string;
  width: string;
  images: Array<{ role: ProductImageRole }>;
}

export interface ReconciledProductIssue {
  id?: number;
  productImageAssetId?: number;
  code: ProductIssueCode;
  severity: 'info' | 'warning' | 'error';
  fieldName: string;
  message: string;
  sourceRef: string;
  status: ProductIssueStatus;
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
}

export function reconcileProductIssues(
  input: ProductIssueFactsInput,
  existing: readonly ReconciledProductIssue[],
): ReconciledProductIssue[] {
  const desired = deriveFacts(input);
  const desiredByKey = new Map(desired.map((issue) => [issueKey(issue), issue]));
  const reconciled: ReconciledProductIssue[] = [];
  const managed = new Set<ProductIssueCode>(FACT_ISSUE_CODES);

  for (const issue of existing) {
    if (!managed.has(issue.code)) {
      reconciled.push({ ...issue });
      continue;
    }
    const fact = desiredByKey.get(issueKey(issue));
    if (!fact) {
      reconciled.push({ ...issue, status: issue.status === 'open' ? 'resolved' : issue.status });
      continue;
    }
    desiredByKey.delete(issueKey(issue));
    reconciled.push({
      ...issue,
      severity: fact.severity,
      message: fact.message,
      status: issue.status === 'ignored' ? 'ignored' : 'open',
    });
  }

  for (const issue of desiredByKey.values()) reconciled.push(issue);
  return reconciled.sort((left, right) => issueKey(left).localeCompare(issueKey(right)));
}

function deriveFacts(input: ProductIssueFactsInput): ReconciledProductIssue[] {
  const issues: ReconciledProductIssue[] = [];
  addMissing(issues, input.productName, 'MISSING_PRODUCT_NAME', 'productName', '产品名称缺失');
  addMissing(issues, input.composition, 'MISSING_COMPOSITION', 'composition', '成分缺失');
  addMissing(issues, input.weight, 'MISSING_WEIGHT', 'weight', '克重缺失');
  addMissing(issues, input.width, 'MISSING_WIDTH', 'width', '门幅缺失');
  if (!input.images.some((image) => image.role === 'pattern_original')) {
    issues.push(fact('MISSING_PATTERN_ORIGINAL', 'images', '缺少花型原图'));
  }
  if (input.images.some((image) => image.role === 'unclassified')) {
    issues.push(fact('IMAGE_UNCLASSIFIED', 'images', '存在待分类图片'));
  }
  return issues;
}

function addMissing(
  issues: ReconciledProductIssue[],
  value: string,
  code: ProductIssueCode,
  fieldName: string,
  message: string,
): void {
  if (!value.trim()) issues.push(fact(code, fieldName, message));
}

function fact(code: ProductIssueCode, fieldName: string, message: string): ReconciledProductIssue {
  return { code, severity: 'warning', fieldName, message, sourceRef: '', status: 'open' };
}

function issueKey(issue: Pick<ReconciledProductIssue, 'code' | 'fieldName' | 'sourceRef'>): string {
  return `${issue.code}|${issue.fieldName}|${issue.sourceRef}`;
}
