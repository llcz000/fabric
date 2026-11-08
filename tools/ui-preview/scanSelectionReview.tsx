import React from 'react';
import {sampleContactChoices} from '../../src/lib/sampleContactChoices';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import {SampleBusinessWorkspaceV2} from '../../src/components/product-master-v2/SampleBusinessWorkspaceV2';
import {V2Shell} from '../../src/components/product-master-v2/V2Shell';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
import {ToastProvider} from '../../src/components/ui/Toast';
import {emptyCustomerProfile} from '../../src/components/customers/customerModel';
import {resolveImageUrls} from '../../src/components/product-master-v2/catalogModel';
import {useV2Navigation} from '../../src/components/product-master-v2/useV2Navigation';
import {readV2Route} from '../../src/components/product-master-v2/v2Navigation';
const initialToken='SCAN_FIXTURE_FIRST_CARD_TOKEN_12345',secondToken='SCAN_FIXTURE_SECOND_CARD_TOKEN_12345';
const profile={...emptyCustomerProfile(),displayName:'林女士',brands:['云间服饰'],contacts:[{name:'林女士',phone:null,wechat:null}]};
const multiContacts=location.search.includes('multiContacts');
if(multiContacts){profile.displayName='云间服饰';profile.contacts=[{name:'陈女士',phone:null,wechat:null},{name:'王先生',phone:null,wechat:null}];}
const customer={id:'2',profile,canEdit:true,archived:false,ownerUserId:'1',rowVersion:'1',canManageAccess:false,access:[]};
const products=(master:string,count:number,start:number)=>Array.from({length:count},(_,i)=>({id:String(start+i),productNo:master+'-'+(i+1)+'-F018',patternNo:master+'-'+(i+1),colorwayNo:i+1,patternImageAssetId:'dddddddd-4444-4444-8444-'+String(start+i).padStart(12,'0')}));
const cards=[{id:'12',cardNo:'G0886-F018',fabricName:'轻薄印花雪纺',composition:'聚酯纤维 100%',weightValue:'80',weightUnit:'gsm',widthCm:'145',products:products('G0886',6,100)},{id:'13',cardNo:'G0626-F018',fabricName:'轻薄印花雪纺',composition:'聚酯纤维 100%',weightValue:'80',weightUnit:'gsm',widthCm:'145',products:products('G0626',3,200)}];
const state={known:new Set<string>(),selected:new Set<string>(),removed:new Set<string>(),writes:[] as string[],batchRequests:[] as string[][],failNext:false,loseNextResponse:false,deny:false,denyStatus:403,failSearch:false,failCustomerSearch:false,failExport:false,customerName:profile.displayName,created:false,leaveGuard:null as (()=>boolean|Promise<boolean>)|null,deferLegacy:false,legacyRelease:null as (()=>void)|null};
type Group={session:{id:string;customerReference:string;contactName:string|null;customerId?:string;linkVersion:string;status:'open';canManage:boolean;createdAt:string;createdOn:string};known:Set<string>;selected:Set<string>;removed:Set<string>};
const groups:Group[]=[];
function newGroup(name:string,initial=false){const group:Group={session:{id:String(11+groups.length),customerReference:name,contactName:null,customerId:customer.id,linkVersion:'1',status:'open',canManage:true,createdAt:initial?'2026-10-25T01:30:00.000Z':'2026-10-26T07:30:00.000Z',createdOn:initial?'2026-10-25':'2026-10-26'},known:new Set(),selected:new Set(),removed:new Set()};groups.push(group);state.created=true;state.customerName=name;state.known=group.known;state.selected=group.selected;state.removed=group.removed;return group;}
if(location.search.includes('directory')){const initial=newGroup(profile.displayName,true);initial.known.add('12');cards[0].products.forEach(p=>initial.selected.add(p.id));}
if(location.search.includes('batch')){const next=newGroup('王女士');next.known.add('13');next.selected.add(cards[1].products[0].id);}
if(location.search.includes('manyCards'))for(let i=0;i<24;i++){const c={...cards[0],id:String(30+i),cardNo:'G'+(9000+i)+'-F018',products:products('G'+(9000+i),1,400+i)};cards.push(c);groups[0].known.add(c.id);c.products.forEach(p=>groups[0].selected.add(p.id));}
const imageRequests:string[][]=[];let failedImageBatch=false;
Object.assign(window,{sampleImageRequests:imageRequests});
Object.assign(window,{scanSelectionFixture:{state,groups,initialToken,secondToken,addOtherFabric(){cards.push({...cards[0],id:'14',cardNo:'G0886-F025',fabricName:'真丝',products:products('G0886',2,300).map(p=>({...p,productNo:p.productNo.replace('F018','F025')}))});}}});
const reviewedItems=new Set<string>();let reviewSnapshot="a".repeat(64),reviewDrifted=false;
const cardReview=(sessionId=groups.at(-1)?.session.id??'11')=>({sessionId,snapshot:reviewSnapshot,canUpdate:!location.search.includes('reviewReadOnly'),totalProducts:6,cardCount:1,issues:location.search.includes('reviewIssues')?cards[0].products.slice(0,2).filter(p=>!reviewedItems.has(p.id)).map(p=>({itemId:p.id,productNo:p.productNo,oldCards:[{cardId:'2',cardNo:'G0886-F001',retired:true}],currentCard:location.search.includes('reviewBlocked')?null:{id:'12',cardNo:'G0886-F018',description:'轻薄印花雪纺'},reason:location.search.includes('reviewBlocked')?'当前无有效色卡，请处理产品或色卡资料':'来源色卡与当前产品关联不一致',canUpdate:!location.search.includes('reviewBlocked')&&!location.search.includes('reviewReadOnly')})):[]});
const response=(body:unknown,status=200)=>Response.json(body,{status});
const fakeFetch:typeof fetch=async(input,init)=>{
 const url=new URL(String(input),location.href),path=url.pathname,body=init?.body?JSON.parse(String(init.body)):{};
 if(state.deny)return response({},state.denyStatus);
 if(/\/sessions\/\d+$/.test(path)&&(!groups.some(g=>path.endsWith('/'+g.session.id))||location.search.includes('denyDetails')))return response({},location.search.includes('denyDetails')?403:404);
 if(init?.method&&init.method!=='GET'){state.writes.push(path);if(state.failNext){state.failNext=false;return response({},503);}}
 const group=groups.find(g=>g.session.id===(body.sessionId??path.match(/\/sessions\/(\d+)/)?.[1]))??groups.at(-1);
 const card=cards.find(c=>c.id===body.cardId);
 if(path.endsWith('/capability'))return response({enabled:!location.search.includes('legacy')});
 if(path.endsWith('/customers')){if(state.failCustomerSearch){state.failCustomerSearch=false;return response({},503);}const query=url.searchParams.get('query')??'';const list=profile.displayName.includes(query)||profile.brands.some(b=>b.includes(query))?[customer]:[];return response({items:list,total:list.length,limit:20,offset:0});}
 if(path.endsWith('/with-sample-session')){const g=newGroup(body.profile?.displayName??profile.displayName);if(multiContacts)g.session.contactName=sampleContactChoices(profile.contacts).find(choice=>choice.index===body.contactChoice?.index)?.name??null;return response({customer,session:g.session});}
 if(path.endsWith('/contact')&&group){
  const choices=sampleContactChoices(profile.contacts);
  if(init?.method==='PATCH'){
   if(body.expectedLinkVersion!==group.session.linkVersion)return response({},409);
   group.session.contactName=choices.find(choice=>choice.index===body.contactChoice?.index)?.name??null;
   group.session.linkVersion=String(Number(group.session.linkVersion)+1);
   return response({contactName:group.session.contactName,linkVersion:group.session.linkVersion});
  }
  return response({contactName:group.session.contactName,linkVersion:group.session.linkVersion,customerVersion:customer.rowVersion,choices});
 }
 if(path.endsWith('/resolve')){const c=body.cardToken===initialToken?cards[0]:body.cardToken===secondToken?cards[1]:null;return response(c?{id:c.id,masterId:'41',masterNo:c.cardNo.split('-')[0],fabricId:'23',fabricNo:'F018',cardNo:c.cardNo,description:c.fabricName,composition:c.composition,weightValue:80,weightUnit:'gsm',widthValue:145,qrPayload:body.cardToken,isActive:true}:{},location.search.includes('invalidCard')||!c?404:200);}
 if(path.endsWith('/scan')&&group){const c=body.cardToken===initialToken?cards[0]:body.cardToken===secondToken?cards[1]:null;if(!c)return response({},404);group.known.add(c.id);const added=c.products.filter(p=>!group.selected.has(p.id)&&!group.removed.has(p.id)).map(p=>p.id);added.forEach(id=>group.selected.add(id));return response({cardId:c.id,resolvedProductIds:c.products.map(p=>p.id),addedProductIds:added,alreadySelectedProductIds:c.products.filter(p=>group.selected.has(p.id)&&!added.includes(p.id)).map(p=>p.id),selectedCardCount:group.known.size});}
 if(path.endsWith('/items/manual')&&card&&group){group.known.add(card.id);const ids:string[]=body.productIds??card.products.map(p=>p.id);const items=ids.map(id=>({productId:id,itemId:id,action:group.selected.has(id)?'already_selected':group.removed.has(id)?'restored':'added'}));ids.forEach(id=>{group.selected.add(id);group.removed.delete(id);});return response({sessionId:group.session.id,cardId:card.id,items});}
 if(path.endsWith('/items/remove')&&group){const ids:string[]=body.itemIds;ids.forEach(id=>{group.selected.delete(id);group.removed.add(id);});return response({sessionId:group.session.id,removedCount:ids.length});}
 if(path.endsWith('/cards/remove')&&group){for(const c of cards.filter(c=>body.cardIds.includes(c.id)))for(const p of c.products){group.selected.delete(p.id);group.removed.add(p.id);}return response({sessionId:group.session.id,removedCount:0});}
 if(init?.method==='DELETE'&&path.includes('/items/')&&group){const id=path.split('/').pop()!;group.selected.delete(id);group.removed.add(id);if(state.loseNextResponse){state.loseNextResponse=false;throw Error('Simulated lost response');}return response({});}
 if(path.endsWith('/cards/review')){if(init?.method==='POST'){if(location.search.includes('reviewReadOnly'))return response({},403);if(location.search.includes('reviewDrift')&&!reviewDrifted){reviewDrifted=true;reviewSnapshot='b'.repeat(64);}if(body.snapshot!==reviewSnapshot)return response({review:cardReview(group?.session.id)},409);for(const id of body.itemIds)reviewedItems.add(id);}return response(cardReview(group?.session.id));}
 if(path.endsWith('/cards')){if(state.failSearch&&url.searchParams.get('query')){state.failSearch=false;return response({},503);}const list=cards.filter(c=>url.searchParams.get('selected')==='true'?group?.known.has(c.id):c.cardNo.includes(url.searchParams.get('query')??''));return response({items:list,total:list.length,limit:20,offset:0});}
 if(path.endsWith('/sessions/preparation')){
  const control=state as typeof state&{deferSummary?:boolean;releaseSummary?:()=>void};
  if(control.deferSummary)await new Promise<void>(resolve=>{control.releaseSummary=resolve;});
  const selectedGroups=groups.filter(g=>body.sessionIds.includes(g.session.id));
  const blocked=selectedGroups.find(g=>cardReview(g.session.id).issues.length);
  if(blocked)return response({error:'BATCH_SELECTION_BLOCKED',sessionId:blocked.session.id,reason:'review'},409);
  return response({rows:cards.flatMap(c=>c.products.flatMap(p=>{
   const matching=selectedGroups.filter(g=>g.selected.has(p.id)),seen=new Set<string>(),recipients=matching.filter(g=>{const key=JSON.stringify([g.session.customerId??g.session.id,g.session.contactName]);if(seen.has(key))return false;seen.add(key);return true;}).map(g=>({customerName:g.session.customerReference,contactName:g.session.contactName}));
   return recipients.length?[{productId:p.id,cardId:c.id,cardNo:c.cardNo,patternNo:p.patternNo,patternImageAssetId:p.patternImageAssetId,quantity:recipients.length,recipients}]:[];
  }))});
 }
 if(path.endsWith('/cards/batch-export.xlsx')){
  state.batchRequests.push(body.sessionIds);
  if(body.sessionIds.includes('11')&&cardReview('11').issues.length)return response({error:'BATCH_SELECTION_BLOCKED',sessionId:'11',reason:'review'},409);
  return fetch('/__fixtures__/sample-cards.xlsx?ids=12,13');
 }
 if(path.endsWith('/cards/export.xlsx')&&group){if(cardReview().issues.length)return response({error:'CARD_REVIEW_REQUIRED',review:cardReview()},409);if(state.failExport){state.failExport=false;return response({},503);}const ids=cards.filter(c=>group.known.has(c.id)&&c.products.some(p=>group.selected.has(p.id))).map(c=>c.id);return fetch('/__fixtures__/sample-cards.xlsx?ids='+ids.join(','));}
 if(path.endsWith('/followups')&&group)return response({sessionId:group.session.id,items:[],total:0,limit:20,offset:0});
 if(init?.method==='DELETE'&&/\/sessions\/\d+$/.test(path)&&group){groups.splice(groups.indexOf(group),1);return response({id:group.session.id,deleted:true});}
 if(/\/sessions\/\d+$/.test(path)&&group){const all=cards.flatMap(c=>c.products.filter(p=>group.selected.has(p.id)).map(p=>({id:p.id,productId:p.id,current:{productNo:p.productNo,patternNo:p.patternNo.split('-')[0],colorwayNo:p.colorwayNo,patternImageAssetId:p.patternImageAssetId,fabricNo:c.cardNo.split('-').at(-1),fabricName:c.fabricName,composition:c.composition,weightValue:c.weightValue,weightUnit:c.weightUnit,widthCm:c.widthCm},sources:[{cardId:c.id,cardNo:c.cardNo,retired:false,firstScanEventId:'1'}]}))),limit=Number(url.searchParams.get('limit')??100),offset=Number(url.searchParams.get('offset')??0);return response({session:group.session,items:all.slice(offset,offset+limit),total:all.length,selectedCardCount:cards.filter(c=>c.products.some(p=>group.selected.has(p.id))).length,limit,offset});}
 if(path.endsWith('/sessions')&&init?.method==='POST'){if(state.deferLegacy)await new Promise<void>(resolve=>{state.legacyRelease=resolve;});return response(newGroup(body.customerReference).session);}
 if(path.endsWith('/sessions')){const query=url.searchParams.get('query')??'',list=groups.filter(g=>g.session.customerReference.includes(query)||g.session.contactName?.includes(query)).slice().reverse().map(g=>({...g.session,selectedProductCount:g.selected.size,selectedCardCount:cards.filter(c=>c.products.some(p=>g.selected.has(p.id))).length}));return response({items:list,total:list.length,limit:20,offset:0});}
 if(path.endsWith('/access-urls')){
  const ids=body.requests.map((r:{assetId:string})=>r.assetId);imageRequests.push(ids);
  if(location.search.includes('badAsset')&&ids.includes(cards[0].products[0].patternImageAssetId))return response({},404);
  if(location.search.includes('failImagesOnce')&&!failedImageBatch){failedImageBatch=true;return response({},503);}
  return response({results:body.requests.map((r:{assetId:string;variant:string})=>({...r,url:'https://fabric-scan-fixture.invalid/'+r.assetId+'.svg?signature='+imageRequests.length}))});
 }
 return response({},404);
};
const thumbnails=async(ids:string[])=>new Map(ids.map((id,index)=>{
 const color=['#ede5df','#d9e7ec','#e9dce8','#e3e8d8','#ebd6d2','#e6e1ef'][index%6];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="${color}"/><g fill="none" stroke="#6f7c70" stroke-width="2" opacity=".65"><path d="M10 180Q95 90 55 0M100 180Q120 90 170 0M0 60Q90 95 180 30"/></g><g fill="#ae7286" opacity=".7">${[0,1,2,3,4].map(i=>`<ellipse cx="${30+i*31}" cy="${25+(i%3)*48}" rx="17" ry="12" transform="rotate(${i*32} ${30+i*31} ${25+(i%3)*48})"/>`).join('')}</g></svg>`;
 return [id,'data:image/svg+xml,'+encodeURIComponent(svg)];
}));
const fixtureActor={id:'1',username:'preview',displayName:'预览业务员',role:'sales' as const};
const networkThumbnails=(ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal)=>resolveImageUrls(fakeFetch,ids,variant,signal);
function ReviewWorkspace(){
 const navigation=useV2Navigation(fixtureActor,0);
 return <SampleBusinessWorkspaceV2 sessionId={readV2Route(location.hash).params.get('sessionId')??undefined} onSessionRouteChange={sessionId=>navigation.navigate('samples',sessionId?{sessionId}:{})} onRegisterLeaveGuard={guard=>{state.leaveGuard=guard;navigation.registerSampleLeaveGuard(guard);}} apiFetch={fakeFetch} resolveImages={location.search.includes('networkImages')?networkThumbnails:thumbnails} initialCardToken={location.search.includes('directory')?undefined:initialToken}/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><V2Shell actor={fixtureActor} view="samples" onNavigate={()=>{}} onLogout={()=>{}}><ToastProvider><ConfirmProvider><ReviewWorkspace/></ConfirmProvider></ToastProvider></V2Shell></React.StrictMode>);
