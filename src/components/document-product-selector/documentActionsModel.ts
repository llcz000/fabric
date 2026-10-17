import {DocType,type DocumentData} from '../../types';
/** New trade, new row identities; saved source/product snapshots are never edited by copying. */
export function copyV2Draft(source:DocumentData,date:string):DocumentData{
 const copy=structuredClone(source);
 return {...copy,id:'new',docNo:'',date,settled:false,deposit:source.type===DocType.DEPOSIT?source.deposit:0,
  createdAt:'',updatedAt:'',items:copy.items.map((item,index)=>({...item,id:'copy-'+index}))};
}
