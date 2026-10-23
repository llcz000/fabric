/** Isolated review only. All cards live in this closure; catalogFetch is the existing memory API.
 * No production server, database, COS or scanner authorization is connected here.
 */
import {fetchCardMasters,fetchCardFabrics,type SampleCard} from '../components/product-master-v2/sampleCardModel';
import type {FabricCatalogItem,FabricCatalogPage} from '../components/product-master-v2/fabricModel';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function opaquePayload(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
async function findCandidate<T extends {id:string}>(load:(offset:number)=>Promise<{items:T[];total:number;limit:number;offset:number}>,id:string){
 for(let offset=0;offset<=1000000;){
  const page=await load(offset),found=page.items.find(item=>item.id===id);if(found)return found;
  if(page.offset+page.limit>=page.total)return undefined;offset=page.offset+page.limit;
 }
 return undefined;
}
/** Mirror the real backend's live JOIN of card identity with current fabric specs.
 * The card's opaque QR / master+fabric identity is never rewritten. Include
 * inactive fabrics: deactivating one must not discard an existing card.
 */
async function currentCards(catalogFetch:typeof fetch,cards:readonly SampleCard[]):Promise<SampleCard[]>{
 if(!cards.length)return [];
 const remaining=new Set(cards.map(card=>card.fabricId));
 const fabrics=new Map<string,FabricCatalogItem>();
 for(let offset=0;remaining.size&&offset<=1000000;){
  const response=await catalogFetch('/api/v2/fabrics/catalog?includeInactive=true&limit=100&offset='+offset);
  if(!response.ok)throw Error('Sample-card linked fabrics unavailable');
  const page=await response.json() as FabricCatalogPage;
  if(!page||!Array.isArray(page.items)||!Number.isSafeInteger(page.limit)||page.limit<1||
   !Number.isSafeInteger(page.total)||page.total<0)throw Error('Sample-card linked fabric page unavailable');
  for(const fabric of page.items)if(remaining.delete(fabric.id))fabrics.set(fabric.id,fabric);
  if(offset+page.limit>=page.total)break;
  offset+=page.limit;
 }
 if(remaining.size)throw Error('Sample-card linked fabric missing');
 return cards.map(card=>{
  const fabric=fabrics.get(card.fabricId)!;
  return {...card,description:fabric.fabricName,composition:fabric.composition,
   weightValue:fabric.weightValue,weightUnit:fabric.weightUnit,widthValue:fabric.widthValue};
 });
}
async function workbookResponse(cards:readonly SampleCard[]){
 // Vite resolves ExcelJS's browser entry; load the workbook writer only when exporting.
 const {default:ExcelJS}=await import('exceljs'),workbook=new ExcelJS.Workbook();
 const sheet=workbook.addWorksheet('Sample Cards');
 sheet.addRow(['色卡编号','品名','成分','克重','门幅','二维码']);
 cards.forEach(card=>sheet.addRow([card.cardNo,card.description,card.composition??'',
  card.weightValue===null||card.weightUnit===null?'':card.weightValue+' '+card.weightUnit,
  card.widthValue===null?'':card.widthValue+' cm',card.qrPayload]));
 sheet.columns.forEach((column,index)=>{column.width=[24,32,40,18,18,64][index];column.numFmt='@';});
 sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
 const bytes=await workbook.xlsx.writeBuffer();
 return new Response(new Uint8Array(bytes),{headers:{
  'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'Content-Disposition':'attachment; filename="sample-cards.xlsx"'
 }});
}
/** The phase-one permission switch is intentionally absent from this management role contract. */
export function composeSampleCardReviewFetch(catalogFetch:typeof fetch,role:()=>string|null=()=> 'sales'):typeof fetch{
 const cards:SampleCard[]=[];const retired=new Set<string>();let nextId=1;
 return async(input,init)=>{
  const request=input instanceof Request?input:null;
  const url=new URL(request?request.url:String(input),'http://127.0.0.1'),path=url.pathname;
  const method=(init?.method??request?.method??'GET').toUpperCase();
  // Review-only reference guard: a card protects its parent identities even
  // before the first product is created. Keep status-only updates legal.
  const parent=/^\/api\/v2\/(pattern-masters|fabrics)\/([1-9]\d*)$/.exec(path);
  if(parent&&(method==='PATCH'||method==='DELETE')){
   const key=parent[1]==='pattern-masters'?'masterId':'fabricId';
   const current=cards.find(card=>card[key]===parent[2]);
   if(current){
    if(method==='DELETE')return json({error:'Referenced by sample card'},409);
    const text=init?.body!==undefined?String(init.body):request?await request.clone().text():'';
    let patch:unknown;
    try{patch=JSON.parse(text);}catch{return json({error:'Invalid JSON'},400);}
    const field=key==='masterId'?'masterNo':'fabricNo';
    if(object(patch)&&Object.hasOwn(patch,field)&&patch[field]!==current[field])
     return json({error:'Referenced identity cannot change'},409);
   }
   if(method==='PATCH'&&key==='fabricId'){
    const linked=cards.filter(c=>c.fabricId===parent[2]&&!retired.has(c.id));
    const previous=linked.length?(await currentCards(catalogFetch,[linked[0]]))[0]:null;
    const response=await catalogFetch(input,init);
    if(previous&&response.ok){
     const after=(await currentCards(catalogFetch,[linked[0]]))[0];
     const printedFields=['description','composition','weightValue','weightUnit','widthValue'] as const;
     if(printedFields.some(field=>previous[field]!==after[field]))for(const card of linked){
      card.reprintRevision=String(BigInt(card.reprintRevision??'0')+1n);
      card.needsReprint=true;
     }
    }
    return response;
   }
   return catalogFetch(input,init);
  }
  const cardRoute=/^\/api\/v2\/sample-cards\/([1-9][0-9]*)(\/confirm-reprinted)?$/.exec(path);
  if(path!=='/api/v2/sample-cards'&&path!=='/api/v2/sample-cards/export'&&!cardRoute)return catalogFetch(input,init);
  if(init?.signal?.aborted||request?.signal.aborted)throw new DOMException('Aborted','AbortError');
  const currentRole=role();
  if(currentRole===null)return json({error:'Login required'},401);
  if(currentRole!=='admin'&&currentRole!=='sales')return json({error:'Sample-card management denied'},403);
  if(cardRoute){
   const id=cardRoute[1],card=cards.find(c=>c.id===id&&!retired.has(id));
   if(!card)return json({error:'Card unavailable'},404);
   if(!cardRoute[2]&&method==='DELETE'){
    retired.add(id);return json({id,retired:true});
   }
   if(cardRoute[2]&&method==='POST'){
    let body:unknown;
    try{body=JSON.parse(init?.body!==undefined?String(init.body):request?await request.text():'');}
    catch{return json({error:'Invalid JSON'},400);}
    if(!object(body)||!exactKeys(body,['expectedRevision'])||typeof body.expectedRevision!=='string'||
     !/^(0|[1-9][0-9]{0,19})$/.test(body.expectedRevision))return json({error:'Invalid revision'},400);
    if(body.expectedRevision!==(card.reprintRevision??'0'))return json({error:'Print revision conflict'},409);
    card.needsReprint=false;return json({id,reprintRevision:card.reprintRevision??'0',needsReprint:false});
   }
   return json({error:'Unsupported method'},405);
  }
  if(path==='/api/v2/sample-cards'&&method==='GET'){
   const query=url.searchParams.get('query')??'',limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('offset')??0);
   if(query.trim().length>100||/[\p{Cc}\p{Cf}]/u.test(query)||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)return json({error:'Invalid query'},400);
   const pending=url.searchParams.get('needsReprint');
   if(pending!==null&&pending!=='true'&&pending!=='false')return json({error:'Invalid reprint filter'},400);
   const text=query.trim().toLowerCase(),matched=cards.filter(card=>!retired.has(card.id)&&
    (pending!=='true'||card.needsReprint===true)&&
    [card.cardNo,card.masterNo,card.fabricNo].some(number=>number.toLowerCase().includes(text)));
   const page=await currentCards(catalogFetch,matched.slice(offset,offset+limit));
   return json({items:page,total:matched.length,limit,offset});
  }
  if(method!=='POST')return json({error:'Unsupported method'},405);
  let body:unknown;
  try{body=JSON.parse(init?.body!==undefined?String(init.body):request?await request.text():'');}catch{return json({error:'Invalid JSON'},400);}
  if(!object(body))return json({error:'Invalid body'},400);
  if(path==='/api/v2/sample-cards/export'){
   if(!exactKeys(body,['cardIds'])||!Array.isArray(body.cardIds)||!body.cardIds.length||body.cardIds.length>1000||body.cardIds.some(id=>!validId(id))||new Set(body.cardIds).size!==body.cardIds.length)return json({error:'Invalid selection'},400);
   const selected=body.cardIds.map(id=>cards.find(card=>card.id===id&&!retired.has(card.id)));
   if(selected.some(card=>!card))return json({error:'Unknown selection'},400);
   return workbookResponse(await currentCards(catalogFetch,selected as SampleCard[]));
  }
  if(!exactKeys(body,['masterId','fabricId'])||!validId(body.masterId)||!validId(body.fabricId))return json({error:'Invalid identity'},400);
  const [master,fabric]=await Promise.all([
   findCandidate(offset=>fetchCardMasters(catalogFetch,'',offset),body.masterId),
   findCandidate(offset=>fetchCardFabrics(catalogFetch,'',offset),body.fabricId)
  ]);
  if(!master?.isActive||!fabric?.isActive)return json({error:'Unknown or inactive identity'},409);
  // Search after awaited catalog lookup. In this single JS realm, check+insert is atomic.
  const existing=cards.find(card=>!retired.has(card.id)&&card.masterId===master.id&&card.fabricId===fabric.id);
  if(existing)return json({card:(await currentCards(catalogFetch,[existing]))[0],created:false});
  const card:SampleCard={id:String(nextId++),masterId:master.id,masterNo:master.masterNo,
   fabricId:fabric.id,fabricNo:fabric.fabricNo,cardNo:master.masterNo+'-'+fabric.fabricNo,
   description:fabric.fabricName,composition:fabric.composition,weightValue:fabric.weightValue,
   weightUnit:fabric.weightUnit,widthValue:fabric.widthValue,qrPayload:opaquePayload(),isActive:true,
   reprintRevision:'0',needsReprint:false};
  cards.push(card);return json({card,created:true},201);
 };
}
