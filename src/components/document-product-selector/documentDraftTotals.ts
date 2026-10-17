import {DocType,type DocumentData} from '../../types';
import {calculateLineAmounts,calculateDocumentTotals} from '../../../server/order-v2/calculations';
import {salesPieceDraft} from './SalesPieceInputs';
export function documentDraftTotals(draft:DocumentData,depositText:string){
 const type=draft.type===DocType.SALES?'bulk':draft.type;
 let deposit=0;
 if(type!=='sample'){
  if(!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(depositText.trim()))throw Error('定金输入尚未完成');
  deposit=Number(depositText.trim());
 }
 const lines=draft.items.map(item=>{
  const sale=item as typeof item&{rollNo?:string;deductionMeters?:number};
  const pieces=type==='bulk'?salesPieceDraft((sale.rollNo??'').split(/[,，\s]+/)):null;
  if(pieces?.error)throw Error(pieces.error);
  const line={meters:item.meters,unitPrice:item.price,
   ...(type==='bulk'?{deductionMeters:sale.deductionMeters??0,pieceMeters:pieces?.rollNo?pieces.rollNo.split(', ').map(Number):null}:{})};
  return {...line,amount:calculateLineAmounts(type,line).amount};
 });
 return calculateDocumentTotals(type,lines,deposit);
}
