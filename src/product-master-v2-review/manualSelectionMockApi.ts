import type {SelectionCard} from '../../server/customer-samples/sessionCardSearch';
import type {SampleSessionPage} from '../../server/customer-samples/sessionRead';
import {SelectionHttpError} from '../components/product-master-v2/sampleSelectionClient';

/** Memory-only review transport; unknown requests never fall back to network. */
export function createManualSelectionReviewApi(delay=200){
 const card=(id:string,cardNo:string,fabricName:string,ids:string[],colorwayStart=1):SelectionCard=>({id,cardNo,fabricName,composition:'棉 55% / 麻 45%',weightValue:'180',weightUnit:'gsm',widthCm:'145',
  products:ids.map((id,index)=>({id,productNo:cardNo.replace('-',`-${index+colorwayStart}-`),colorwayNo:index+colorwayStart,
   patternNo:cardNo.split('-')[0]+'-'+(index+colorwayStart),patternImageAssetId:index%2?'eeeeeeee-5555-4555-8555-555555555555':'dddddddd-4444-4444-8444-444444444444'}))});
 const cards=[{...card('12','0012-F018','真丝斜纹',['81','86']),composition:'真丝 100%',weightValue:'18'},card('13','0012-F019','棉麻平纹',['82','85']),
  ...Array.from({length:21},(_,i)=>card(String(100+i),`00${20+i}-F030`,'演示府绸',[String(200+i)]))];
 const selected=new Map<string,{id:string;removed:boolean;cardId:string;scanned:boolean}>([['81',{id:'61',removed:false,cardId:'12',scanned:true}]]);
 const chosenCards=new Set(['12']);let next=62,failure:''|'search'|'add'|'read'='';
 let access:'authorized'|'logged_out'|'revoked'='authorized';
 const json=(body:unknown,status=200)=>Response.json(body,{status});
 const page=(sessionId:string,limit:number,offset:number):SampleSessionPage=>{
  const all=[...selected].filter(([,x])=>!x.removed);
  return {session:{id:sessionId,customerReference:'演示客户 A（非真实资料）',status:sessionId==='52'?'closed':'open'},total:all.length,selectedCardCount:chosenCards.size,limit,offset,
   items:all.slice(offset,offset+limit).map(([productId,item])=>{
    const c=cards.find(x=>x.id===item.cardId)!,p=c.products.find(x=>x.id===productId)!;
    return {id:item.id,productId,current:{productNo:p.productNo,patternNo:c.cardNo.split('-')[0],colorwayNo:p.colorwayNo,fabricNo:c.cardNo.split('-')[1],
     fabricName:c.fabricName,composition:c.composition,weightValue:c.weightValue,weightUnit:c.weightUnit,widthCm:c.widthCm},
     sources:[{cardId:c.id,cardNo:c.cardNo,retired:false,firstScanEventId:item.scanned?'42':null,...(item.scanned?{}:{firstManualEventId:'84'})}]};
   })};
 };
 const apiFetch:typeof fetch=async(input,init)=>{
  if(delay)await new Promise(r=>setTimeout(r,delay));
  if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
  const url=new URL(input instanceof Request?input.url:String(input),'http://127.0.0.1'),method=init?.method??'GET';
  const match=/^\/api\/v2\/customer-samples\/sessions\/(51|52)(?:\/(cards|items\/manual|items\/[1-9]\d*))?$/.exec(url.pathname);
  if(!match)return json({error:'无此演示接口'},404);
  if(access!=='authorized')return json({error:'模拟选样访问失效'},access==='logged_out'?401:404);
  const [,sessionId,target]=match,operation=target==='cards'?'search':target==='items/manual'?'add':'read';
  if(failure===operation){failure='';return json({error:'模拟请求失败'},503);}
  if(target==='cards'&&method==='GET'){
   const q=(url.searchParams.get('query')??'').toLowerCase(),limit=Number(url.searchParams.get('limit')??20),offset=Number(url.searchParams.get('offset')??0);
   const found=cards.filter(c=>[c.cardNo,c.fabricName].some(x=>x.toLowerCase().includes(q)));
   return json({items:found.slice(offset,offset+limit),total:found.length,limit,offset});
  }
  if(!target&&method==='GET')return json(page(sessionId,Number(url.searchParams.get('limit')??20),Number(url.searchParams.get('offset')??0)));
  if(sessionId==='52')return json({error:'已结束'},409);
  if(target==='items/manual'&&method==='POST'){
   let body:Record<string,unknown>;try{body=JSON.parse(String(init?.body));}catch{return json({error:'非法请求'},400);}
   if(!body||Object.keys(body).some(k=>!['cardId','productIds'].includes(k))||typeof body.cardId!=='string')return json({error:'非法请求'},400);
   const card=cards.find(c=>c.id===body.cardId);if(!card)return json({error:'色卡不可选'},409);
   const ids=body.productIds===undefined?card.products.map(p=>p.id):body.productIds;
   if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!card.products.some(p=>p.id===id)))return json({error:'配色不可选'},409);
   const items=ids.map((productId:string)=>{
    const existing=selected.get(productId),action=existing?(existing.removed?'restored':'already_selected'):'added';
    if(existing)existing.removed=false;else selected.set(productId,{id:String(next++),removed:false,cardId:card.id,scanned:false});
    return {productId,itemId:selected.get(productId)!.id,action};
   });chosenCards.add(card.id);return json({sessionId,cardId:card.id,items});
  }
  if(target?.startsWith('items/')&&method==='DELETE'){
   const item=[...selected.values()].find(x=>x.id===target.slice(6));if(!item)return json({},404);
   item.removed=true;return new Response(null,{status:204});
  }
  return json({},404);
 };
 return {apiFetch,setAccess:(value:typeof access)=>{access=value;},failNext:(operation:'search'|'add'|'read')=>{failure=operation;},
  scan:async()=>{if(access!=='authorized')throw new SelectionHttpError(access==='logged_out'?401:404);const item=selected.get('81')!;item.removed=false;item.scanned=true;},
  updateLatest:()=>{cards[1].fabricName='棉麻平纹（资料已更新）';}};
}
