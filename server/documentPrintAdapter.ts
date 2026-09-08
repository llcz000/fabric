import { buildDocumentPrintModel, parseRollValues, type DocumentPrintModel } from '../src/lib/documentPrintModel';

export function buildBackendDocumentPrintModel(
  order: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  company: Record<string, unknown>,
): DocumentPrintModel {
  const type = String(order.template_type ?? 'sample');
  const totalAmount = number(order.total_amount);
  const deposit = number(order.deposit);
  const receivableAmount = type === 'deposit' ? totalAmount * (1 - deposit / 100) : type === 'bulk' || type === 'sales' ? totalAmount - deposit : totalAmount;
  return buildDocumentPrintModel({
    type,
    docNo: text(order.order_no), date: text(order.order_date), customerName: text(order.receiving_unit),
    companyName: text(company.company_name), companyAddress: text(company.address), companyPhone: text(company.phone),
    defaultTerms: text(company.default_terms), depositTerms: text(company.deposit_terms), terms: text(order.terms),
    issuer: text(order.sign_person), receiver: text(order.receiver), receiverPhone: text(order.receiver_phone), receiverAddress: text(order.receiver_address),
    totalMeters: number(order.total_meters), totalPieces: number(order.total_pieces), totalAmount, receivableAmount,
    deposit, deductionMeters: number(order.deduction_meters),
    items: items.map((item) => ({
      itemNo: text(item.product_no), colorNo: text(item.color_no), productName: text(item.product_name),
      composition: text(item.composition), weight: text(item.weight), width: text(item.width), meters: number(item.meters),
      unitPrice: number(item.unit_price), amount: number(item.amount), remark: text(item.remark),
      rollValues: parseRollValues(item.piece_meters, number(item.meters)), deductionMeters: number(item.deduction_meters),
    })),
  });
}

function text(value: unknown): string { return String(value ?? ''); }
function number(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
