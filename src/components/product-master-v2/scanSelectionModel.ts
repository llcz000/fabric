import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';
import {createSampleSelectionClient} from './sampleSelectionClient';
import {searchManualCards,type SelectionCard} from './manualSelectionModel';
export type ScanSelectionCard=SelectionCard&{retired?:boolean};
export interface ScanSelectionData{session:SampleSessionPage['session'];items:SampleSessionPage['items'];cards:ScanSelectionCard[]}
/** Fetch every selected item and every previously added card; pagination must not drop colorways. */
export async function loadScanSelection(apiFetch:typeof fetch,sessionId:string,signal?:AbortSignal):Promise<ScanSelectionData>{
 const api=createSampleSelectionClient(apiFetch),first=await api.load(sessionId,100,0,signal);
 const items=[...first.items];
 for(let offset=first.limit;offset<first.total;offset+=100){
  const next=await api.load(sessionId,100,offset,signal);if(next.total!==first.total)throw Error('选样已变更，请重新读取');items.push(...next.items);
 }
 if(items.length!==first.total||new Set(items.map(i=>i.productId)).size!==items.length)throw Error('选样已变更，请重新读取');
 const cards:ScanSelectionCard[]=[];
 for(let offset=0;;offset+=20){
  const page=await searchManualCards(apiFetch,{sessionId,query:'',offset,selected:true},signal);cards.push(...page.items);
  if(offset+page.limit>=page.total)break;
 }
 // Retired cards and unavailable historical products remain visible, without allowing restoration.
 for(const item of items)for(const source of item.sources){
  let card=cards.find(c=>c.id===source.cardId);
  if(!card){const p=item.current;card={id:source.cardId,cardNo:source.cardNo,retired:true,fabricName:p.fabricName,composition:p.composition,weightValue:p.weightValue,weightUnit:p.weightUnit,widthCm:p.widthCm,products:[]};cards.push(card);}
  if(!card.products.some(p=>p.id===item.productId))card.products.push({id:item.productId,productNo:item.current.productNo,patternNo:item.current.patternNo+'-'+item.current.colorwayNo,colorwayNo:item.current.colorwayNo,patternImageAssetId:item.current.patternImageAssetId??null});
 }
 return {session:first.session,items,cards};
}
export function scanFabricDescription(card:SelectionCard){
 return [card.fabricName,card.composition,card.weightValue===null?null:card.weightValue+' '+card.weightUnit,card.widthCm===null?null:card.widthCm+' cm'].filter(Boolean).join(' · ');
}
