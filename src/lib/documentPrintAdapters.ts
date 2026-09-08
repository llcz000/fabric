import type { CompanyProfile, DocumentData, SalesItem } from '../types';
import { buildDocumentPrintModel, parseRollValues, type DocumentPrintModel } from './documentPrintModel';

export function buildFrontendDocumentPrintModel(document: DocumentData, company: CompanyProfile): DocumentPrintModel {
  return buildDocumentPrintModel({
    type: document.type,
    docNo: document.docNo,
    date: document.date,
    customerName: document.customerName,
    companyName: company.name,
    companyAddress: company.address,
    companyPhone: company.phone,
    defaultTerms: company.defaultTerms,
    depositTerms: company.depositTerms,
    terms: document.terms,
    issuer: document.issuer,
    receiver: document.receiver,
    receiverPhone: document.bottomPhone,
    receiverAddress: document.receiverAddress,
    totalMeters: document.totalMeters,
    totalPieces: document.totalRolls,
    totalAmount: document.totalAmount,
    receivableAmount: document.receivableAmount,
    deposit: document.deposit ?? 0,
    deductionMeters: document.deductionMeters ?? 0,
    items: document.items.map((item) => ({
      itemNo: item.itemNo, colorNo: item.colorNo, productName: item.productName,
      composition: 'composition' in item ? item.composition : '', weight: 'weight' in item ? item.weight : '',
      width: 'width' in item ? item.width : '', meters: item.meters, unitPrice: item.price, amount: item.amount,
      remark: item.remark, rollValues: parseRollValues((item as SalesItem).rollNo, item.meters),
      deductionMeters: (item as SalesItem).deductionMeters ?? 0,
    })),
  });
}
