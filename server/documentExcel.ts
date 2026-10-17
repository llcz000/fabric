import ExcelJS from 'exceljs';

import type { CompanyImageRole } from './image-assets/types';
import { buildBackendDocumentPrintModel } from './documentPrintAdapter';

export interface DocumentWorkbookInput {
  order: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  company: Record<string, unknown>;
  images?: Partial<Record<CompanyImageRole, { body: Buffer; mime: 'image/png' | 'image/jpeg' }>>;
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

export function buildDocumentWorkbook(input: DocumentWorkbookInput): ExcelJS.Workbook {
  const { order, items, company, images = {} } = input;
  const model = buildBackendDocumentPrintModel(order, items, company);
  const columns = model.columns;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('打印单据');
  const lastColumn = columns.length;
  const lastColumnLetter = sheet.getColumn(lastColumn).letter;
  const splitColumn = Math.floor(lastColumn / 2);

  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.excelWidth; });
  sheet.properties.defaultRowHeight = 18;
  sheet.views = [{ showGridLines: false }];

  sheet.mergeCells(1, 1, 2, 2);
  sheet.mergeCells(1, 3, 1, lastColumn);
  sheet.mergeCells(2, 3, 2, lastColumn);
  styledCell(sheet.getCell(1, 3), model.companyName, 18, true, 'right');
  styledCell(sheet.getCell(2, 3), model.companyLines.join('\n'), 10, false, 'right');
  sheet.getRow(1).height = 27;
  sheet.getRow(2).height = 32;

  sheet.mergeCells(3, 1, 3, lastColumn);
  styledCell(sheet.getCell(3, 1), model.title, 16, true, 'center');
  sheet.getRow(3).height = 28;

  sheet.mergeCells(4, 1, 4, splitColumn);
  sheet.mergeCells(4, splitColumn + 1, 4, lastColumn);
  styledCell(sheet.getCell(4, 1), `NO：${model.docNo}`, 11, false, 'left');
  styledCell(sheet.getCell(4, splitColumn + 1), `日期：${model.dateText}`, 11, false, 'right');
  sheet.mergeCells(5, 1, 5, lastColumn);
  styledCell(sheet.getCell(5, 1), `收货单位：${model.customerName}`, 11, false, 'left');

  const headerRowNumber = 6;
  const headerRow = sheet.getRow(headerRowNumber);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    styledCell(cell, column.label, 10, true, 'center');
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = THIN_BORDER;
  });
  headerRow.height = 25;

  model.rows.forEach((values, itemIndex) => {
    const row = sheet.getRow(headerRowNumber + 1 + itemIndex);
    row.height = 32;
    values.forEach((value, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      styledCell(cell, value, 10, false, 'center');
      cell.alignment = { ...cell.alignment, wrapText: true, shrinkToFit: false };
      cell.border = THIN_BORDER;
    });
  });

  const summaryRow = headerRowNumber + 1 + model.rows.length;
  model.summaries.forEach((summary, index) => addSummaryRow(sheet, summaryRow + index, lastColumn, summary.left, summary.right ?? ''));

  const termsRow = summaryRow + model.summaries.length;
  sheet.mergeCells(termsRow, 1, termsRow, lastColumn);
  styledCell(sheet.getCell(termsRow, 1), `备注条款：${model.terms}`, 10, false, 'left');
  sheet.getCell(termsRow, 1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  sheet.getCell(termsRow, 1).border = THIN_BORDER;
  sheet.getRow(termsRow).height = 32;

  const footerRow = termsRow + 1;
  const qrStartColumn = Math.max(3, lastColumn - 3);
  sheet.mergeCells(footerRow, 1, footerRow, qrStartColumn - 1);
  styledCell(sheet.getCell(footerRow, 1), `开单人签字：${model.signature.issuer}`, 11, false, 'left');
  sheet.mergeCells(footerRow + 1, 1, footerRow + 1, qrStartColumn - 1);
  styledCell(sheet.getCell(footerRow + 1, 1), `收货人签字：${model.signature.receiver}    电话：${model.signature.phone}`, 11, false, 'left');
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
