import {readSampleCardScanToken} from '../../lib/sampleCardScanLink';
import type {PatternMasterItem,PatternVersionItem,PatternPage} from './patternModel';
import {fetchPatternPage,fetchMasterColorways,initialPatternFilters} from './patternModel';
import type {FabricCatalogItem,FabricCatalogPage} from './fabricModel';
import {fetchFabricCatalog,emptyFabricFilters} from './fabricModel';
export interface SampleCard{
 id:string;masterId:string;masterNo:string;fabricId:string;fabricNo:string;
 cardNo:string;description:string;composition:string|null;weightValue:number|null;
 weightUnit:'gsm'|'mm'|null;widthValue:number|null;qrPayload:string;scanUrl?:string;isActive:boolean;
 needsReprint?:boolean;reprintRevision?:string;
}
export interface SampleCardPage{items:SampleCard[];total:number;limit:number;offset:number}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
function parseCard(raw:unknown):SampleCard{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('色卡资料格式错误');
 const c=raw as SampleCard;
 if(!id(c.id)||!id(c.masterId)||!id(c.fabricId)||
  typeof c.masterNo!=='string'||!c.masterNo||typeof c.fabricNo!=='string'||!c.fabricNo||
  c.cardNo!==c.masterNo+'-'+c.fabricNo||typeof c.description!=='string'||
  !(c.composition===null||typeof c.composition==='string')||
  !(c.weightValue===null&&c.weightUnit===null||positive(c.weightValue)&&(c.weightUnit==='gsm'||c.weightUnit==='mm'))||
  !(c.widthValue===null||positive(c.widthValue))||
  typeof c.qrPayload!=='string'||!c.qrPayload||typeof c.isActive!=='boolean'||
  c.scanUrl!==undefined&&readSampleCardScanToken(c.scanUrl)!==c.qrPayload||
  c.needsReprint!==undefined&&typeof c.needsReprint!=='boolean'||
  c.reprintRevision!==undefined&&(typeof c.reprintRevision!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(c.reprintRevision)||BigInt(c.reprintRevision)>18446744073709551615n))throw Error('色卡行资料无效');
 return c;
}
export function parseSampleCardPage(raw:unknown):SampleCardPage{
 const p=raw as SampleCardPage;
 if(!p||typeof p!=='object'||!Array.isArray(p.items)||!Number.isSafeInteger(p.total)||p.total<0||
  !Number.isSafeInteger(p.limit)||p.limit<1||p.limit>100||!Number.isSafeInteger(p.offset)||p.offset<0||p.items.length>p.limit)
  throw Error('色卡分页资料无效');
 p.items.forEach(parseCard);return p;
}
export async function resolveScannedSampleCard(apiFetch:typeof fetch,token:string,signal?:AbortSignal):Promise<SampleCard>{
 if(readSampleCardScanToken(token)!==token)throw Error('色卡编码无效');
 const response=await apiFetch('/api/v2/sample-cards/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardToken:token}),signal,cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'请登录后查看色卡':response.status===404?'色卡已停用、删除或不可用':'色卡读取失败，请重试');
 const card=parseCard(await response.json());if(card.qrPayload!==token||!card.isActive)throw Error('色卡已失效，请重新扫码');
 return card;
}
async function checked(response:Response):Promise<Response>{
 if(response.status===409){
  const data=await response.clone().json().catch(()=>null);
  if(data?.error==='Card has products'&&Number.isSafeInteger(data.productCount)&&data.productCount>0)
   throw Error('当前色卡关联 '+data.productCount+' 个产品，请先处理关联产品；可通过查看花型核对。');
 }
 if(!response.ok)throw Error(response.status===401?'登录已失效，请重新登录。':
  response.status===403?'没有色卡管理权限。':response.status===409?'主数据状态已改变，请重新选择。':'色卡请求失败（HTTP '+response.status+'）');
 return response;
}
export async function fetchSampleCardPage(apiFetch:typeof fetch,query='',offset=0,limit=50,signal?:AbortSignal,needsReprint=false):Promise<SampleCardPage>{
 if(typeof query!=='string'||query.trim().length>100||/[\p{Cc}\p{Cf}]/u.test(query)||!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('色卡查询条件无效');
 const params=new URLSearchParams({query:query.trim(),limit:String(limit),offset:String(offset)});
 if(needsReprint)params.set('needsReprint','true');
 return parseSampleCardPage(await (await checked(await apiFetch('/api/v2/sample-cards?'+params,{signal}))).json());
}
export async function createSampleCard(apiFetch:typeof fetch,master:Pick<PatternMasterItem,'id'|'isActive'>|null,fabric:Pick<FabricCatalogItem,'id'|'isActive'>|null):Promise<{card:SampleCard;created:boolean}>{
 if(!master||!fabric||!master.isActive||!fabric.isActive||!id(master.id)||!id(fabric.id))throw Error('请明确选择有效母版和面料');
 const raw=await (await checked(await apiFetch('/api/v2/sample-cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({masterId:master.id,fabricId:fabric.id})}))).json();
 if(!raw||typeof raw.created!=='boolean')throw Error('建卡响应错误');
 const card=parseCard(raw.card);
 if(card.masterId!==master.id||card.fabricId!==fabric.id)throw Error('建卡身份不一致');
 return {card,created:raw.created};
}
export async function exportSampleCards(apiFetch:typeof fetch,cardIds:readonly string[]):Promise<Blob>{
 if(!cardIds.length||cardIds.length>1000||cardIds.some(x=>!id(x))||new Set(cardIds).size!==cardIds.length)throw Error('请勾选有效色卡');
 const response=await checked(await apiFetch('/api/v2/sample-cards/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardIds:[...cardIds]})}));
 if(!response.headers.get('Content-Type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))throw Error('导出文件格式错误');
 return response.blob();
}
/** A business delete archives the card permanently; existing QR must never resolve again. */
export async function retireSampleCard(apiFetch:typeof fetch,cardId:string):Promise<{id:string;retired:true}>{
 if(!id(cardId))throw Error('色卡编号无效');
 const data=await (await checked(await apiFetch('/api/v2/sample-cards/'+cardId,{method:'DELETE'}))).json();
 if(!data||data.id!==cardId||data.retired!==true)throw Error('删除色卡响应无效');
 return data as {id:string;retired:true};
}
export async function confirmSampleCardReprinted(apiFetch:typeof fetch,card:SampleCard):Promise<{id:string;reprintRevision:string;needsReprint:false}>{
 const expectedRevision=card.reprintRevision;
 if(!id(card.id)||card.needsReprint!==true||typeof expectedRevision!=='string'||
  !/^(0|[1-9][0-9]{0,19})$/.test(expectedRevision)||BigInt(expectedRevision)>18446744073709551615n)
  throw Error('色卡待打印状态已过期，请刷新');
 const raw=await (await checked(await apiFetch('/api/v2/sample-cards/'+card.id+'/confirm-reprinted',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision})
 }))).json();
 if(!raw||raw.id!==card.id||raw.reprintRevision!==expectedRevision||raw.needsReprint!==false)
  throw Error('标记已重新打印响应无效');
 return {id:card.id,reprintRevision:expectedRevision,needsReprint:false};
}
export function toggleCardSelection(ids:readonly string[],value:string,selected:boolean):string[]{
 return selected?(ids.includes(value)?[...ids]:[...ids,value]):ids.filter(x=>x!==value);
}
export function setPageSelection(ids:readonly string[],rows:readonly SampleCard[],selected:boolean):string[]{
 return rows.reduce((next,row)=>toggleCardSelection(next,row.id,selected),[...ids]);
}
export function fetchCardMasters(apiFetch:typeof fetch,query:string,offset=0){
 return fetchPatternPage(apiFetch,{...initialPatternFilters,number:query,offset,limit:20});
}
export function fetchCardFabrics(apiFetch:typeof fetch,query:string,offset=0){
 return fetchFabricCatalog(apiFetch,{...emptyFabricFilters,query,offset,limit:20});
}
export interface SampleCardDraftServices{
 searchMasters(query:string,offset:number):Promise<PatternPage>;
 searchFabrics(query:string,offset:number):Promise<FabricCatalogPage>;
 loadVersions(master:PatternMasterItem):Promise<PatternVersionItem[]>;
}
export interface SampleCardDraft{
 masterText:string;fabricText:string;master:PatternMasterItem|null;fabric:FabricCatalogItem|null;
 versions:PatternVersionItem[];masterPage:PatternPage;fabricPage:FabricCatalogPage;
 masterLoading:boolean;fabricLoading:boolean;versionsLoading:boolean;
 masterError:string;fabricError:string;versionsError:string;createdCard:SampleCard|null;
}
const emptyPage=()=>({items:[],total:0,offset:0,limit:20});
/** Controller shared by React and behavioral tests. Every edit invalidates binding before the request. */
export class SampleCardDraftController{
 state:SampleCardDraft={masterText:'',fabricText:'',master:null,fabric:null,versions:[],
  masterPage:emptyPage(),fabricPage:emptyPage(),masterLoading:false,fabricLoading:false,versionsLoading:false,
  masterError:'',fabricError:'',versionsError:'',createdCard:null};
 private epochs={master:0,fabric:0,versions:0};
 private listeners=new Set<()=>void>();
 constructor(private services:SampleCardDraftServices){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private change(patch:Partial<SampleCardDraft>){this.state={...this.state,...patch};this.listeners.forEach(x=>x());}
 get cardNo(){return this.state.master&&this.state.fabric?this.state.master.masterNo+'-'+this.state.fabric.fabricNo:'';}
 dispose(){this.epochs.master++;this.epochs.fabric++;this.epochs.versions++;this.listeners.clear();}
 async edit(kind:'master'|'fabric',text:string){
  if(kind==='master'){this.epochs.versions++;this.change({masterText:text,master:null,versions:[],versionsLoading:false,versionsError:'',createdCard:null,masterPage:emptyPage()});}
  else this.change({fabricText:text,fabric:null,createdCard:null,fabricPage:emptyPage()});
  await this.search(kind,0,false);
 }
 private async search(kind:'master'|'fabric',offset:number,append:boolean){
  const epoch=++this.epochs[kind],query=this.state[kind+'Text' as 'masterText'|'fabricText'];
  this.change(kind==='master'?{masterLoading:true,masterError:''}:{fabricLoading:true,fabricError:''});
  try{
   if(kind==='master'){
    const p=await this.services.searchMasters(query,offset);
    if(epoch===this.epochs.master)this.change({masterPage:{...p,items:append?[...this.state.masterPage.items,...p.items]:p.items},masterLoading:false});
   }else{
    const p=await this.services.searchFabrics(query,offset);
    if(epoch===this.epochs.fabric)this.change({fabricPage:{...p,items:append?[...this.state.fabricPage.items,...p.items]:p.items},fabricLoading:false});
   }
  }catch(e){
   if(epoch!==this.epochs[kind])return;
   const message=e instanceof Error?e.message:'检索失败，请重试';
   this.change(kind==='master'?{masterLoading:false,masterError:message}:{fabricLoading:false,fabricError:message});
  }
 }
 async loadMore(kind:'master'|'fabric'){
  const p=kind==='master'?this.state.masterPage:this.state.fabricPage;
  if(this.state[kind+'Loading' as 'masterLoading'|'fabricLoading']||p.offset+p.limit>=p.total)return;
  await this.search(kind,p.offset+p.limit,true);
 }
 async selectMaster(master:PatternMasterItem){
  if(!master.isActive)return;
  this.epochs.master++;const epoch=++this.epochs.versions;
  this.change({master,masterText:master.masterNo,masterPage:emptyPage(),masterLoading:false,
   versions:[],versionsLoading:true,versionsError:'',createdCard:null});
  try{
   const versions=await this.services.loadVersions(master);
   if(epoch===this.epochs.versions&&this.state.master?.id===master.id)this.change({versions,versionsLoading:false});
  }catch(e){
   if(epoch===this.epochs.versions)this.change({versionsLoading:false,versionsError:e instanceof Error?e.message:'配色校对资料加载失败'});
  }
 }
 selectFabric(fabric:FabricCatalogItem){
  if(!fabric.isActive)return;this.epochs.fabric++;
  this.change({fabric,fabricText:fabric.fabricNo,fabricPage:emptyPage(),fabricLoading:false,createdCard:null});
 }
 setCreated(card:SampleCard){
  if(card.masterId!==this.state.master?.id||card.fabricId!==this.state.fabric?.id)throw Error('色卡与当前选择不一致');
  this.change({createdCard:card});
 }
}
export function makeSampleCardDraftController(apiFetch:typeof fetch){
 return new SampleCardDraftController({
  searchMasters:(q,o)=>fetchCardMasters(apiFetch,q,o),searchFabrics:(q,o)=>fetchCardFabrics(apiFetch,q,o),
  loadVersions:async m=>(await fetchMasterColorways(apiFetch,m)).items
 });
}
