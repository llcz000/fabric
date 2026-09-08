import ExcelJS from 'exceljs';

import type { CompanyImageRole } from './image-assets/types';

export interface DocumentWorkbookInput {
  order: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  company: Record<string, unknown>;
  images?: Partial<Record<CompanyImageRole, { body: Buffer; mime: 'image/png' | 'image/jpeg' }>>;
}

interface ColumnDefinition {
  header: string;
  width: number;
  value(item: Record<string, unknown>): unknown;
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

const SAMPLE_COLUMNS: ColumnDefinition[] = [
  { header: '货号', width: 11, value: (item) => item.product_no ?? '' },
  { header: '色号', width: 10, value: (item) => item.color_no ?? '' },
  { header: '品名', width: 13, value: (item) => item.product_name ?? '' },
  { header: '成分', width: 15, value: (item) => item.composition ?? '' },
  { header: '克重', width: 7.5, value: (item) => item.weight ?? '' },
  { header: '门幅(cm)', width: 8.5, value: (item) => item.width ?? '' },
  { header: '米数(米)', width: 8.5, value: (item) => item.meters ?? 0 },
  { header: '单价(元)', width: 8.5, value: (item) => item.unit_price ?? 0 },
  { header: '金额(元)', width: 10.5, value: (item) => item.amount ?? 0 },
  { header: '备注', width: 10, value: (item) => item.remark ?? '' },
];

const SALES_COLUMNS: ColumnDefinition[] = [
  { header: '货号', width: 10, value: (item) => item.product_no ?? '' },
  { header: '色号', width: 9, value: (item) => item.color_no ?? '' },
  { header: '品名', width: 13, value: (item) => item.product_name ?? '' },
  { header: '匹号/箱号', width: 12, value: (item) => pieceNumbers(item.piece_meters) },
  { header: '门幅(cm)', width: 8, value: (item) => item.width ?? '' },
  { header: '米数(米)', width: 8, value: (item) => item.meters ?? 0 },
  { header: '扣损(米)', width: 8, value: (item) => item.deduction_meters ?? 0 },
  { header: '单价(元)', width: 8, value: (item) => item.unit_price ?? 0 },
  { header: '金额(元)', width: 10, value: (item) => item.amount ?? 0 },
  { header: '备注', width: 10, value: (item) => item.remark ?? '' },
];

const DEPOSIT_COLUMNS: ColumnDefinition[] = [
  { header: '货号', width: 13, value: (item) => item.product_no ?? '' },
  { header: '色号', width: 12, value: (item) => item.color_no ?? '' },
  { header: '品名', width: 16, value: (item) => item.product_name ?? '' },
  { header: '米数(米)', width: 11, value: (item) => item.meters ?? 0 },
  { header: '单价(元)', width: 11, value: (item) => item.unit_price ?? 0 },
  { header: '金额(元)', width: 13, value: (item) => item.amount ?? 0 },
  { header: '备注', width: 14, value: (item) => item.remark ?? '' },
];

export function buildDocumentWorkbook(input: DocumentWorkbookInput): ExcelJS.Workbook {
  const { order, items, company, images = {} } = input;
  const type = String(order.template_type ?? 'sample');
  const columns = type === 'deposit' ? DEPOSIT_COLUMNS : type === 'sales' ? SALES_COLUMNS : SAMPLE_COLUMNS;
  const title = type === 'deposit' ? '定金单' : type === 'sales' ? '销售发货码单' : '样布码单';
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('打印单据');
  const lastColumn = columns.length;
  const lastColumnLetter = sheet.getColumn(lastColumn).letter;
  const splitColumn = Math.floor(lastColumn / 2);

  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  sheet.properties.defaultRowHeight = 18;
  sheet.views = [{ showGridLines: false }];

  sheet.mergeCells(1, 1, 2, 2);
  sheet.mergeCells(1, 3, 1, lastColumn);
  sheet.mergeCells(2, 3, 2, lastColumn);
  styledCell(sheet.getCell(1, 3), company.company_name ?? '', 18, true, 'right');
  styledCell(sheet.getCell(2, 3), `地址：${company.address ?? ''}\n电话：${company.phone ?? ''}`, 10, false, 'right');
  sheet.getRow(1).height = 27;
  sheet.getRow(2).height = 32;

  sheet.mergeCells(3, 1, 3, lastColumn);
  styledCell(sheet.getCell(3, 1), title, 16, true, 'center');
  sheet.getRow(3).height = 28;

  sheet.mergeCells(4, 1, 4, splitColumn);
  sheet.mergeCells(4, splitColumn + 1, 4, lastColumn);
  styledCell(sheet.getCell(4, 1), `NO：${order.order_no ?? ''}`, 11, false, 'left');
  styledCell(sheet.getCell(4, splitColumn + 1), `日期：${String(order.order_date ?? '').slice(0, 10)}`, 11, false, 'right');
  sheet.mergeCells(5, 1, 5, lastColumn);
  styledCell(sheet.getCell(5, 1), `收货单位：${order.receiving_unit ?? ''}`, 11, false, 'left');

  const headerRowNumber = 6;
  const headerRow = sheet.getRow(headerRowNumber);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    styledCell(cell, column.header, 10, true, 'center');
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = THIN_BORDER;
  });
  headerRow.height = 25;

  items.forEach((item, itemIndex) => {
    const row = sheet.getRow(headerRowNumber + 1 + itemIndex);
    row.height = 32;
    columns.forEach((column, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      styledCell(cell, column.value(item), 10, false, 'center');
      cell.alignment = { ...cell.alignment, wrapText: true, shrinkToFit: false };
      cell.border = THIN_BORDER;
      if ([6, 7, 8].includes(columnIndex)) cell.numFmt = '0.00';
    });
  });

  const summaryRow = headerRowNumber + 1 + items.length;
  addSummaryRow(sheet, summaryRow, lastColumn, `总计数（米）：${numberText(order.total_meters)}`, `合计金额：¥${numberText(order.total_amount)}`);
  addSummaryRow(sheet, summaryRow + 1, lastColumn, `实发总匹数：${Number(order.total_pieces ?? 0)} 匹`, `应收金额：¥${numberText(order.receivable_amount ?? order.total_amount)}`);

  const termsRow = summaryRow + 2;
  sheet.mergeCells(termsRow, 1, termsRow, lastColumn);
  styledCell(sheet.getCell(termsRow, 1), `备注条款：${company.default_terms ?? ''}`, 10, false, 'left');
  sheet.getCell(termsRow, 1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  sheet.getCell(termsRow, 1).border = THIN_BORDER;
  sheet.getRow(termsRow).height = 32;

  const footerRow = termsRow + 1;
  const qrStartColumn = Math.max(3, lastColumn - 3);
  sheet.mergeCells(footerRow, 1, footerRow, qrStartColumn - 1);
  styledCell(sheet.getCell(footerRow, 1), `开单人签字：${order.sign_person ?? ''}`, 11, false, 'left');
  sheet.mergeCells(footerRow + 1, 1, footerRow + 1, qrStartColumn - 1);
  styledCell(sheet.getCell(footerRow + 1, 1), `收货人签字：${order.receiver ?? ''}    电话：${order.receiver_phone ?? ''}`, 11, false, 'left');
  for (let rowNumber = footerRow; rowNumber <= footerRow + 3; rowNumber++) sheet.getRow(rowNumber).height = 20;

  addCompanyImage(workbook, sheet, images.brand_logo, { col: 0.15, row: 0.2 }, { width: 105, height: 34 });
  addCompanyImage(workbook, sheet, images.wechat_qr, { col: qrStartColumn - 1, row: footerRow - 1 }, { width: 60, height: 60 });
  addCompanyImage(workbook, sheet, images.alipay_qr, { col: lastColumn - 2, row: footerRow - 1 }, { width: 60, height: 60 });
  sheet.mergeCells(footerRow + 3, qrStartColumn, footerRow + 3, qrStartColumn + 1);
  styledCell(sheet.getCell(footerRow + 3, qrStartColumn), '微信收款', 9, false, 'center');
  sheet.mergeCells(footerRow + 3, lastColumn - 1, footerRow + 3, lastColumn);
  styledCell(sheet.getCell(footerRow + 3, lastColumn - 1), '支付宝收款', 9, false, 'center');

  const printEndRow = footerRow + 3;
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: false,
    scale: 100,
    horizontalCentered: true,
    verticalCentered: true,
    showGridLines: false,
    printArea: `A1:${lastColumnLetter}${printEndRow}`,
    margins: { left: 0.56, right: 0.56, top: 0.25, bottom: 0.25, header: 0, footer: 0 },
  };
  sheet.headerFooter = { oddHeader: '', oddFooter: '', evenHeader: '', evenFooter: '', firstHeader: '', firstFooter: '' };
  return workbook;
}

function styledCell(cell: ExcelJS.Cell, value: unknown, size: number, bold: boolean, horizontal: ExcelJS.Alignment['horizontal']): void {
  cell.value = value as ExcelJS.CellValue;
  cell.font = { name: '宋体', size, bold };
  cell.alignment = { vertical: 'middle', horizontal, wrapText: true };
}

function addSummaryRow(sheet: ExcelJS.Worksheet, rowNumber: number, lastColumn: number, left: string, right: string): void {
  const half = Math.floor(lastColumn / 2);
  sheet.mergeCells(rowNumber, 1, rowNumber, half);
  sheet.mergeCells(rowNumber, half + 1, rowNumber, lastColumn);
  for (const [column, value] of [[1, left], [half + 1, right]] as const) {
    const cell = sheet.getCell(rowNumber, column);
    styledCell(cell, value, 10, true, 'left');
    cell.border = THIN_BORDER;
  }
  for (let column = 1; column <= lastColumn; column++) sheet.getCell(rowNumber, column).border = THIN_BORDER;
  sheet.getRow(rowNumber).height = 24;
}

function addCompanyImage(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  image: { body: Buffer; mime: 'image/png' | 'image/jpeg' } | undefined,
  tl: { col: number; row: number },
  ext: { width: number; height: number },
): void {
  if (!image) return;
  const imageId = workbook.addImage({ buffer: image.body, extension: image.mime === 'image/jpeg' ? 'jpeg' : 'png' });
  sheet.addImage(imageId, { tl, ext, editAs: 'oneCell' });
}

function numberText(value: unknown): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function pieceNumbers(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value !== 'string') return String(value ?? '');
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join(', ') : value;
  } catch {
    return value;
  }
}
