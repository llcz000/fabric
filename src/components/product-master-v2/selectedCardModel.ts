import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';
export type SelectedItem=SampleSessionPage['items'][number];
export interface SelectedCardRow{id:string;cardNo:string;retired:boolean;items:SelectedItem[]}
/** Small serial batches limit signing/DB fan-out. Asset failures must not blank healthy siblings. */
export async function resolveSelectionThumbnails(ids:string[],resolve:(ids:string[],signal?:AbortSignal)=>Promise<Map<string,string>>,signal:AbortSignal){
 const urls=new Map<string,string>(),failed=new Set<string>();
 async function batch(part:string[],retry=true):Promise<void>{
  signal.throwIfAborted();
  try{const result=await resolve(part,signal);signal.throwIfAborted();for(const id of part){const url=result.get(id);if(url)urls.set(id,url);else failed.add(id);}}
  catch(error){
   signal.throwIfAborted();const status=(error as {status?:number})?.status;
   if(status===401)throw error;
   if([403,404,409,422].includes(status)&&part.length>1){const half=Math.ceil(part.length/2);await batch(part.slice(0,half));await batch(part.slice(half));}
   else if(retry&&(status===undefined||status===429||status>=500))await batch(part,false);
   else for(const id of part)failed.add(id);
  }
 }
 const unique=[...new Set(ids)];for(let i=0;i<unique.length;i+=20)await batch(unique.slice(i,i+20));
 return {urls,failed};
}
/** Keep stable card identities, never merge different fabrics or a recreated physical card. */
export function groupSelectedCards(items:SelectedItem[]):SelectedCardRow[]{
 const groups=new Map<string,SelectedCardRow>();
 for(const item of items){
  // One product has one removal identity; retain all source history on the tile.
  const source=item.current.currentCardId!==undefined?(item.sources.find(s=>s.cardId===item.current.currentCardId)??(item.current.currentCardId?{cardId:item.current.currentCardId,cardNo:item.current.currentCardNo??item.current.patternNo+'-'+item.current.fabricNo,retired:false}:undefined)):(item.sources.find(s=>!s.retired)??item.sources[0]);
  const id=source?.cardId??'unlinked:'+item.current.patternNo+':'+item.current.fabricNo;
  let group=groups.get(id);if(!group){group={id,cardNo:source?.cardNo??'来源色卡缺失',retired:source?.retired??true,items:[]};groups.set(id,group);}
  group.items.push(item);
 }
 return [...groups.values()].map(group=>({...group,items:group.items.sort((a,b)=>a.current.colorwayNo-b.current.colorwayNo||a.id.localeCompare(b.id))}));
}
/** Read existing paginated API completely before card-level pagination, detecting partial/drifting results. */
export async function loadCompleteSelection(load:(id:string,limit:number,offset:number)=>Promise<SampleSessionPage>,sessionId:string):Promise<SampleSessionPage>{
 const first=await load(sessionId,100,0),items=[...first.items];
 if(first.session.id!==sessionId||first.offset!==0||first.limit<1)throw Error('选样已变更，请重新读取');
 for(let offset=first.limit;offset<first.total;){
  const next=await load(sessionId,100,offset);
  if(next.session.id!==sessionId||next.total!==first.total||next.selectedCardCount!==first.selectedCardCount||next.offset!==offset||next.limit<1||!next.items.length)throw Error('选样已变更，请重新读取');
  items.push(...next.items);offset+=next.limit;
 }
 if(items.length!==first.total||new Set(items.map(i=>i.id)).size!==items.length||new Set(items.map(i=>i.productId)).size!==items.length)throw Error('选样已变更，请重新读取');
 return {...first,items,offset:0,limit:Math.max(100,items.length)};
}
