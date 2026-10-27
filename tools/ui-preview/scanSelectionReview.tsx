import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import {SampleBusinessWorkspaceV2} from '../../src/components/product-master-v2/SampleBusinessWorkspaceV2';
import {V2Shell} from '../../src/components/product-master-v2/V2Shell';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
import {emptyCustomerProfile} from '../../src/components/customers/customerModel';
const initialToken='SCAN_FIXTURE_FIRST_CARD_TOKEN_12345',secondToken='SCAN_FIXTURE_SECOND_CARD_TOKEN_12345';
const profile={...emptyCustomerProfile(),displayName:'林女士',brands:['云间服饰'],contacts:[{name:'林女士',phone:null,wechat:null}]};
const customer={id:'2',profile,canEdit:true,archived:false,ownerUserId:'1',rowVersion:'1',canManageAccess:false,access:[]};
const products=(master:string,count:number,start:number)=>Array.from({length:count},(_,i)=>({id:String(start+i),productNo:master+'-'+(i+1)+'-F018',patternNo:master+'-'+(i+1),colorwayNo:i+1,patternImageAssetId:'dddddddd-4444-4444-8444-'+String(start+i).padStart(12,'0')}));
const cards=[{id:'12',cardNo:'G0886-F018',fabricName:'轻薄印花雪纺',composition:'聚酯纤维 100%',weightValue:'80',weightUnit:'gsm',widthCm:'145',products:products('G0886',6,100)},{id:'13',cardNo:'G0626-F018',fabricName:'轻薄印花雪纺',composition:'聚酯纤维 100%',weightValue:'80',weightUnit:'gsm',widthCm:'145',products:products('G0626',3,200)}];
const state={known:new Set<string>(),selected:new Set<string>(),removed:new Set<string>(),writes:[] as string[],failNext:false,loseNextResponse:false,deny:false,denyStatus:403,failSearch:false,failCustomerSearch:false,failExport:false,customerName:profile.displayName,created:false,leaveGuard:null as (()=>boolean|Promise<boolean>)|null,deferLegacy:false,legacyRelease:null as (()=>void)|null};
type Group={session:{id:string;customerReference:string;status:'open';canManage:boolean;createdAt:string;createdOn:string};known:Set<string>;selected:Set<string>;removed:Set<string>};
const groups:Group[]=[];
function newGroup(name:string,initial=false){const group:Group={session:{id:String(11+groups.length),customerReference:name,status:'open',canManage:true,createdAt:initial?'2026-10-25T01:30:00.000Z':'2026-10-26T07:30:00.000Z',createdOn:initial?'2026-10-25':'2026-10-26'},known:new Set(),selected:new Set(),removed:new Set()};groups.push(group);state.created=true;state.customerName=name;state.known=group.known;state.selected=group.selected;state.removed=group.removed;return group;}
if(location.search.includes('directory')){const initial=newGroup(profile.displayName,true);initial.known.add('12');cards[0].products.forEach(p=>initial.selected.add(p.id));}
Object.assign(window,{scanSelectionFixture:{state,groups,initialToken,secondToken}});
const response=(body:unknown,status=200)=>Response.json(body,{status});
const fakeFetch:typeof fetch=async(input,init)=>{
 const url=new URL(String(input),location.href),path=url.pathname,body=init?.body?JSON.parse(String(init.body)):{};
 if(state.deny)return response({},state.denyStatus);
 if(init?.method&&init.method!=='GET'){state.writes.push(path);if(state.failNext){state.failNext=false;return response({},503);}}
 const group=groups.find(g=>g.session.id===(body.sessionId??path.match(/\/sessions\/(\d+)/)?.[1]))??groups.at(-1);
 const card=cards.find(c=>c.id===body.cardId);
 if(path.endsWith('/capability'))return response({enabled:!location.search.includes('legacy')});
 if(path.endsWith('/customers')){if(state.failCustomerSearch){state.failCustomerSearch=false;return response({},503);}const query=url.searchParams.get('query')??'';const list=profile.displayName.includes(query)||profile.brands.some(b=>b.includes(query))?[customer]:[];return response({items:list,total:list.length,limit:20,offset:0});}
 if(path.endsWith('/with-sample-session')){const g=newGroup(body.profile?.displayName??profile.displayName);return response({customer,session:g.session});}
 if(path.endsWith('/resolve'))return response({id:'12',masterId:'41',masterNo:'G0886',fabricId:'23',fabricNo:'F018',cardNo:'G0886-F018',description:'轻薄印花雪纺',composition:'聚酯纤维 100%',weightValue:80,weightUnit:'gsm',widthValue:145,qrPayload:body.cardToken,isActive:true},location.search.includes('invalidCard')?404:200);
 if(path.endsWith('/scan')&&group){const c=body.cardToken===initialToken?cards[0]:body.cardToken===secondToken?cards[1]:null;if(!c)return response({},404);group.known.add(c.id);const added=c.products.filter(p=>!group.selected.has(p.id)&&!group.removed.has(p.id)).map(p=>p.id);added.forEach(id=>group.selected.add(id));return response({cardId:c.id,resolvedProductIds:c.products.map(p=>p.id),addedProductIds:added,alreadySelectedProductIds:c.products.filter(p=>group.selected.has(p.id)&&!added.includes(p.id)).map(p=>p.id),selectedCardCount:group.known.size});}
 if(path.endsWith('/items/manual')&&card&&group){group.known.add(card.id);const ids:string[]=body.productIds??card.products.map(p=>p.id);const items=ids.map(id=>({productId:id,itemId:id,action:group.selected.has(id)?'already_selected':group.removed.has(id)?'restored':'added'}));ids.forEach(id=>{group.selected.add(id);group.removed.delete(id);});return response({sessionId:group.session.id,cardId:card.id,items});}
 if(path.endsWith('/cards/remove')&&group){for(const c of cards.filter(c=>body.cardIds.includes(c.id)))for(const p of c.products){group.selected.delete(p.id);group.removed.add(p.id);}return response({sessionId:group.session.id,removedCount:0});}
 if(init?.method==='DELETE'&&path.includes('/items/')&&group){const id=path.split('/').pop()!;group.selected.delete(id);group.removed.add(id);if(state.loseNextResponse){state.loseNextResponse=false;throw Error('Simulated lost response');}return response({});}
 if(path.endsWith('/cards')){if(state.failSearch&&url.searchParams.get('query')){state.failSearch=false;return response({},503);}const list=cards.filter(c=>url.searchParams.get('selected')==='true'?group?.known.has(c.id):c.cardNo.includes(url.searchParams.get('query')??''));return response({items:list,total:list.length,limit:20,offset:0});}
 if(path.endsWith('/cards/export.xlsx')&&group){if(state.failExport){state.failExport=false;return response({},503);}const ids=cards.filter(c=>group.known.has(c.id)&&c.products.some(p=>group.selected.has(p.id))).map(c=>c.id);return fetch('/__fixtures__/sample-cards.xlsx?ids='+ids.join(','));}
 if(path.endsWith('/followups')&&group)return response({sessionId:group.session.id,items:[],total:0,limit:20,offset:0});
 if(init?.method==='DELETE'&&/\/sessions\/\d+$/.test(path)&&group){groups.splice(groups.indexOf(group),1);return response({id:group.session.id,deleted:true});}
 if(/\/sessions\/\d+$/.test(path)&&group){const all=cards.flatMap(c=>c.products.filter(p=>group.selected.has(p.id)).map(p=>({id:p.id,productId:p.id,current:{productNo:p.productNo,patternNo:p.patternNo.split('-')[0],colorwayNo:p.colorwayNo,patternImageAssetId:p.patternImageAssetId,fabricNo:'F018',fabricName:c.fabricName,composition:c.composition,weightValue:c.weightValue,weightUnit:c.weightUnit,widthCm:c.widthCm},sources:[{cardId:c.id,cardNo:c.cardNo,retired:false,firstScanEventId:'1'}]}))),limit=Number(url.searchParams.get('limit')??100),offset=Number(url.searchParams.get('offset')??0);return response({session:group.session,items:all.slice(offset,offset+limit),total:all.length,selectedCardCount:cards.filter(c=>c.products.some(p=>group.selected.has(p.id))).length,limit,offset});}
 if(path.endsWith('/sessions')&&init?.method==='POST'){if(state.deferLegacy)await new Promise<void>(resolve=>{state.legacyRelease=resolve;});return response(newGroup(body.customerReference).session);}
 if(path.endsWith('/sessions')){const query=url.searchParams.get('query')??'',list=groups.filter(g=>g.session.customerReference.includes(query)).slice().reverse().map(g=>({...g.session,selectedProductCount:g.selected.size,selectedCardCount:cards.filter(c=>c.products.some(p=>g.selected.has(p.id))).length}));return response({items:list,total:list.length,limit:20,offset:0});}
 if(path.endsWith('/access-urls'))return response({results:body.requests.map((r:{assetId:string;variant:string})=>({...r,url:'https://fabric-scan-fixture.invalid/'+r.assetId+'.svg'}))});
 return response({},404);
};
const thumbnails=async(ids:string[])=>new Map(ids.map((id,index)=>{
 const color=['#ede5df','#d9e7ec','#e9dce8','#e3e8d8','#ebd6d2','#e6e1ef'][index%6];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="${color}"/><g fill="none" stroke="#6f7c70" stroke-width="2" opacity=".65"><path d="M10 180Q95 90 55 0M100 180Q120 90 170 0M0 60Q90 95 180 30"/></g><g fill="#ae7286" opacity=".7">${[0,1,2,3,4].map(i=>`<ellipse cx="${30+i*31}" cy="${25+(i%3)*48}" rx="17" ry="12" transform="rotate(${i*32} ${30+i*31} ${25+(i%3)*48})"/>`).join('')}</g></svg>`;
 return [id,'data:image/svg+xml,'+encodeURIComponent(svg)];
}));
createRoot(document.getElementById('root')!).render(<React.StrictMode><V2Shell actor={{id:'1',username:'preview',displayName:'预览业务员',role:'sales'}} view="samples" onNavigate={()=>{}} onLogout={()=>{}}><ConfirmProvider><SampleBusinessWorkspaceV2 onRegisterLeaveGuard={guard=>{state.leaveGuard=guard;}} apiFetch={fakeFetch} resolveImages={thumbnails} initialCardToken={location.search.includes('directory')?undefined:initialToken}/></ConfirmProvider></V2Shell></React.StrictMode>);
