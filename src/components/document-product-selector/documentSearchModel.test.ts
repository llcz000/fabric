import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySearchFilters,documentSearchParams,createDocumentSearchController,loadMatchingItems,type DocumentSearchState} from './documentSearchModel';
const page={total:1,limit:20,offset:0,items:[{id:'47',orderNo:'XS047',date:'2026-10-16',receivingUnit:'客户A',type:'bulk',
 totalMeters:30,totalPieces:3,totalAmount:600,settled:false}]};
const totals={matchingLineCount:1,metersTotal:10,amountTotal:200,piecesTotal:1};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test('query model sends all filters to V2 only, resets/controls server paging and drops irrelevant deposit settlement',()=>{
 const params=documentSearchParams({...emptySearchFilters(),customer:' 客户A ',productNo:'P_%',colorNo:'2',productName:'棉',type:'bulk',from:'2026-10-01',to:'2026-10-16',settled:'false'},20,20);
 assert.deepEqual(Object.fromEntries(params),{customer:'客户A',productNo:'P_%',colorNo:'2',productName:'棉',type:'bulk',from:'2026-10-01',to:'2026-10-16',settled:'false',limit:'20',offset:'20'});
 assert(!documentSearchParams({...emptySearchFilters(),type:'deposit',settled:'true'}).has('settled'));
 assert.throws(()=>documentSearchParams({...emptySearchFilters(),from:'2026-10-17',to:'2026-10-01'}),/日期/);
 assert.throws(()=>documentSearchParams({...emptySearchFilters(),from:'2026-02-31'}),/日期/);
});
test('query controller pairs server list and all-match totals, never totals the current page client-side',async()=>{
 const calls:string[]=[];let state:DocumentSearchState;
 const api=(async(input)=>{const url=String(input);calls.push(url);return json(url.includes('matching-totals')?totals:page);}) as typeof fetch;
 const controller=createDocumentSearchController(api,value=>{state=value;});
 await controller.search({...emptySearchFilters(),productNo:'P1'});
 assert.equal(state!.page?.items[0].totalAmount,600);assert.equal(state!.totals?.amountTotal,200);
 assert.deepEqual(calls,['/api/v2/documents?productNo=P1&limit=20&offset=0','/api/v2/documents/matching-totals?productNo=P1&limit=20&offset=0']);
 controller.dispose();
});
test('query controller ignores stale searches and cannot repopulate after permission loss or disposal',async()=>{
 const requests:{resolve:(r:Response)=>void;signal:AbortSignal}[]=[];let state:DocumentSearchState;
 const api=((_input,init)=>new Promise<Response>(resolve=>requests.push({resolve,signal:init!.signal as AbortSignal}))) as typeof fetch;
 const controller=createDocumentSearchController(api,value=>{state=value;});
 const old=controller.search(emptySearchFilters());
 const fresh=controller.search({...emptySearchFilters(),customer:'新客户'});
 assert(requests[0].signal.aborted);
 requests[2].resolve(json({...page,items:[{...page.items[0],receivingUnit:'新客户'}]}));requests[3].resolve(json(totals));
 await fresh;assert.equal(state!.page?.items[0].receivingUnit,'新客户');
 requests[0].resolve(json({},403));requests[1].resolve(json(totals));await old;
 assert.equal(state!.page?.items[0].receivingUnit,'新客户','stale denial must not erase a newer authorized search');
 const pending=controller.search(emptySearchFilters());controller.revoke('当前账号没有查看权限');
 requests[4].resolve(json(page));requests[5].resolve(json(totals));await pending;
 assert.equal(state!.page,null);assert.equal(state!.totals,null);assert.equal(state!.loading,false);
 const disposed=controller.search(emptySearchFilters());controller.dispose();
 requests[6].resolve(json(page));requests[7].resolve(json(totals));await disposed;assert.equal(state!.page,null);
});
test('failed/forbidden or malformed response clears report rather than showing a partial list',async()=>{
 for(const response of [json({},401),json({},403),json({},503),json({items:'bad'})]){
  let state:DocumentSearchState;
  const api=(async(input)=>String(input).includes('matching-totals')?json(totals):response) as typeof fetch;
  await createDocumentSearchController(api,value=>{state=value;}).search(emptySearchFilters());
  assert.equal(state!.page,null);assert.equal(state!.totals,null);assert(state!.error);assert.equal(state!.loading,false);
 }
});
test('matching detail request preserves filters/pagination and no private legacy fallback',async()=>{
 let requested='';
 const api=(async(input)=>{requested=String(input);return json({orderId:'47',total:1,limit:20,offset:20,
  items:[{id:'2',productNo:'P1',colorNo:'2',productName:'棉',meters:10,amount:200,pieces:1}]});}) as typeof fetch;
 const result=await loadMatchingItems(api,'47',{...emptySearchFilters(),productNo:'P1'},20,new AbortController().signal);
 assert.equal(requested,'/api/v2/documents/47/matching-items?productNo=P1&limit=20&offset=20');
 assert.equal(result.items[0].meters,10);
 await assert.rejects(loadMatchingItems(api,'../47',emptySearchFilters(),0,new AbortController().signal));
});
