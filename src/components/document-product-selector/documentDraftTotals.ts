import {DocType,type DocumentData} from '../../types';
import {calculateLineAmounts,calculateDocumentTotals} from '../../../server/order-v2/calculations';
import {salesPieceDraft} from './SalesPieceInputs';
import {parseDocumentNumber} from './DocumentNumberInput';
export function documentDraftTotals(draft:DocumentData,depositText:string){
 const type=draft.type===DocType.SALES?'bulk':draft.type;
 const deposit=type==='sample'?0:parseDocumentNumber(depositText,type==='deposit'?'定金比例':'定金金额',type==='deposit'?100:999999999.99);
 const lines=draft.items.map((item,index)=>{
  const sale=item as typeof item&{rollNo?:string;deductionMeters?:number};
  const pieces=type==='bulk'?salesPieceDraft((sale.rollNo??'').split(/[,，\s]+/)):null;
  if(pieces?.error)throw Error('第'+(index+1)+'行：'+pieces.error);
  const line={meters:parseDocumentNumber(item.meters,'第'+(index+1)+'行：米数'),unitPrice:parseDocumentNumber(item.price,'第'+(index+1)+'行：单价'),
   ...(type==='bulk'?{deductionMeters:parseDocumentNumber(sale.deductionMeters??0,'第'+(index+1)+'行：扣损米数'),pieceMeters:pieces?.rollNo?pieces.rollNo.split(', ').map(Number):null}:{})};
  return {...line,amount:calculateLineAmounts(type,line).amount};
 });
 return calculateDocumentTotals(type,lines,deposit);
}
