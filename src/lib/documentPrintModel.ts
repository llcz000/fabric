export type DocumentPrintType = 'sample' | 'deposit' | 'sales';

export interface DocumentPrintItemInput {
  itemNo: string;
  colorNo: string;
  productName: string;
  composition?: string;
  weight?: string;
  width?: string;
  meters: number;
  unitPrice: number;
  amount: number;
  remark?: string;
  rollValues: number[];
  deductionMeters?: number;
}

export interface DocumentPrintInput {
  type: string;
  docNo: string;
  date: string;
  customerName: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  defaultTerms: string;
  depositTerms: string;
  terms: string;
  issuer: string;
  receiver: string;
  receiverPhone: string;
  receiverAddress: string;
  totalMeters: number;
  totalPieces: number;
  totalAmount: number;
  receivableAmount: number;
  deposit: number;
  deductionMeters: number;
  items: DocumentPrintItemInput[];
}

export interface DocumentPrintColumn {
  key: string;
  label: string;
  excelWidth: number;
  webFraction: number;
}

export interface DocumentPrintSummary {
  left: string;
  right?: string;
}

export interface DocumentPrintModel {
  type: DocumentPrintType;
  title: string;
  companyName: string;
  companyLines: [string, string];
  docNo: string;
  dateText: string;
  customerName: string;
  columns: DocumentPrintColumn[];
  rows: string[][];
  summaries: DocumentPrintSummary[];
  terms: string;
  signature: { issuer: string; receiver: string; phone: string; receiverAddress: string };
}

const SAMPLE_COLUMNS: DocumentPrintColumn[] = [
  column('itemNo', '货号', 11, 1.2), column('colorNo', '色号', 10, 1), column('productName', '品名', 13, 1),
  column('composition', '成分', 15, 1.15), column('weight', '克重', 7.5, 0.85), column('width', '门幅(cm)', 8.5, 1.05),
  column('meters', '米数(米)', 8.5, 1), column('unitPrice', '单价(元)', 8.5, 1.05), column('amount', '金额(元)', 10.5, 1.2),
  column('remark', '备注', 10, 0.75),
];

const DEPOSIT_COLUMNS: DocumentPrintColumn[] = [
  column('itemNo', '货号', 15, 1), column('colorNo', '色号', 14, 1), column('productName', '品名', 18, 1),
  column('meters', '米数(米)', 14, 1), column('unitPrice', '单价(元)', 14, 1), column('amount', '金额(元)', 16, 1.1),
];

export function normalizeDocumentPrintType(value: unknown): DocumentPrintType {
  if (value === 'deposit') return 'deposit';
  if (value === 'sales' || value === 'bulk') return 'sales';
  return 'sample';
}

export function parseRollValues(value: unknown, fallbackMeters = 0): number[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) values = value;
  else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      values = Array.isArray(parsed) ? parsed : value.split(/[,，\s]+/);
    } catch {
      values = value.split(/[,，\s]+/);
    }
  }
  const numbers = values.map(Number).filter((number) => Number.isFinite(number) && number > 0);
  return numbers.length ? numbers : fallbackMeters > 0 ? [fallbackMeters] : [];
}

export function buildDocumentPrintModel(input: DocumentPrintInput): DocumentPrintModel {
  const type = normalizeDocumentPrintType(input.type);
  const hasDeduction = type === 'sales' && (input.deductionMeters > 0 || input.items.some((item) => (item.deductionMeters ?? 0) > 0));
  const columns = type === 'sample' ? SAMPLE_COLUMNS : type === 'deposit' ? DEPOSIT_COLUMNS : salesColumns(hasDeduction);
  const rows = input.items.flatMap((item) => buildRows(type, item, hasDeduction));
  const total = money(input.totalAmount);
  const receivable = money(input.receivableAmount);
  const totalUpper = numberToChineseCapital(input.totalAmount);
  const receivableUpper = numberToChineseCapital(input.receivableAmount);

  let summaries: DocumentPrintSummary[];
  if (type === 'deposit') {
    const depositAmount = input.totalAmount * input.deposit / 100;
    summaries = [
      { left: `合计米数：${fixed(input.totalMeters)}`, right: `合计金额：${total}（大写：${totalUpper}）` },
      { left: `定金金额：${trimNumber(input.deposit)}%  ${money(depositAmount)}（大写：${numberToChineseCapital(depositAmount)}）` },
    ];
  } else if (type === 'sales') {
    const deduction = input.deductionMeters > 0 ? `    扣损合计：${fixed(input.deductionMeters)} 米` : '';
    summaries = [
      { left: `总匹数：${input.totalPieces} 匹    总计米数：${fixed(input.totalMeters)} 米${deduction}`, right: `合计金额：${total}（大写：${totalUpper}）` },
      { left: `预收订金：${money(input.deposit)}（大写：${numberToChineseCapital(input.deposit)}）`, right: `应付款：${receivable}（大写：${receivableUpper}）` },
    ];
  } else {
    summaries = [
      { left: `总计数（米）：${fixed(input.totalMeters)}`, right: `合计金额：${total}（大写：${totalUpper}）` },
      { left: `实发总匹数：${input.totalPieces} 匹`, right: `应收金额：${receivable}（大写：${receivableUpper}）` },
    ];
  }

  return {
    type,
    title: type === 'deposit' ? '定金单' : type === 'sales' ? '销售发货码单' : '样布码单',
    companyName: input.companyName,
    companyLines: [`地址：${input.companyAddress}`, `电话：${input.companyPhone}`],
    docNo: input.docNo,
    dateText: formatDateChinese(input.date),
    customerName: input.customerName,
    columns,
    rows,
    summaries,
    terms: input.terms || (type === 'deposit' ? input.depositTerms : input.defaultTerms) || '无备注条款。',
    signature: { issuer: input.issuer, receiver: input.receiver, phone: input.receiverPhone, receiverAddress: input.receiverAddress },
  };
}

function buildRows(type: DocumentPrintType, item: DocumentPrintItemInput, hasDeduction: boolean): string[][] {
  if (type === 'sample') return [[item.itemNo, item.colorNo || '-', item.productName, item.composition || '-', item.weight || '-', item.width || '-', fixed(item.meters), money(item.unitPrice), money(item.amount), item.remark || '']];
  if (type === 'deposit') return [[item.itemNo, item.colorNo || '-', item.productName, fixed(item.meters), money(item.unitPrice), money(item.amount)]];
  const rolls = item.rollValues.length ? item.rollValues : parseRollValues([], item.meters);
  const chunks = Math.max(1, Math.ceil(rolls.length / 10));
  return Array.from({ length: chunks }, (_, index) => {
    const first = index === 0;
    const rollCells = Array.from({ length: 10 }, (__, rollIndex) => {
      const value = rolls[index * 10 + rollIndex];
      return value === undefined ? '' : value.toFixed(1);
    });
    return [
      first ? item.itemNo : '', first ? item.colorNo || '-' : '', first ? item.productName : '', ...rollCells,
      first ? String(rolls.length) : '', first ? fixed(item.meters) : '',
      ...(hasDeduction ? [first ? fixed(item.deductionMeters ?? 0) : ''] : []),
      first ? money(item.unitPrice) : '', first ? money(item.amount) : '',
    ];
  });
}

function salesColumns(hasDeduction: boolean): DocumentPrintColumn[] {
  return [
    column('itemNo', '货号', 9, 1.25), column('colorNo', '色号', 8, 1.1), column('productName', '品名', 11, 1.3),
    ...Array.from({ length: 10 }, (_, index) => column(`roll${index + 1}`, String(index + 1), 4, 0.72)),
    column('pieceCount', '匹数', 6, 0.9), column('meters', '米数(米)', 8, 1.05),
    ...(hasDeduction ? [column('deduction', '扣损(米)', 7, 0.95)] : []),
    column('unitPrice', '单价(元)', 8, 1.05), column('amount', '金额(元)', 10, 1.25),
  ];
}

function column(key: string, label: string, excelWidth: number, webFraction: number): DocumentPrintColumn {
  return { key, label, excelWidth, webFraction };
}

function fixed(value: number): string { return Number(value || 0).toFixed(2); }
function money(value: number): string { return `¥${fixed(value)}`; }
function trimNumber(value: number): string { return Number(value || 0).toString(); }

function formatDateChinese(value: string): string {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : value;
}

export function numberToChineseCapital(value: number): string {
  const units = ['', '拾', '佰', '仟'];
  const sections = ['', '万', '亿', '兆'];
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const totalFen = Math.max(0, Math.round(Number(value || 0) * 100));
  const integer = Math.floor(totalFen / 100);
  let remaining = integer;
  let sectionIndex = 0;
  let result = '';
  let pendingZero = false;
  while (remaining > 0) {
    const section = remaining % 10000;
    if (section === 0) pendingZero = result.length > 0;
    else {
      let sectionText = '';
      let sectionValue = section;
      let zero = false;
      for (let index = 0; index < 4; index++) {
        const digit = sectionValue % 10;
        if (digit === 0) zero = sectionText.length > 0;
        else {
          sectionText = `${zero ? digits[0] : ''}${digits[digit]}${units[index]}${sectionText}`;
          zero = false;
        }
        sectionValue = Math.floor(sectionValue / 10);
      }
      result = `${pendingZero ? digits[0] : ''}${sectionText}${sections[sectionIndex]}${result}`;
      pendingZero = section < 1000;
    }
    remaining = Math.floor(remaining / 10000);
    sectionIndex++;
  }
  if (!result) result = digits[0];
  const jiao = Math.floor((totalFen % 100) / 10);
  const fen = totalFen % 10;
  const fraction = jiao === 0 && fen === 0
    ? '整'
    : `${jiao > 0 ? `${digits[jiao]}角` : fen > 0 ? '零' : ''}${fen > 0 ? `${digits[fen]}分` : ''}`;
  return `${result}元${fraction}`;
}
