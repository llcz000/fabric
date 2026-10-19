import assert from 'node:assert/strict';
import test from 'node:test';
import {createSampleOperationsClient,shipmentInput,followupInput} from './sampleOperationsModel';
const progress={sessionId:'41',selectedProducts:2,shippedProducts:1,pendingProducts:1,shippedQuantity:7};
test('operations transport uses private V2 routes, preserves abort and rejects wrong session/unsafe identities',async()=>{
 const calls:{url:string;init:RequestInit|undefined}[]=[];
 let data:unknown=progress;
 const api=createSampleOperationsClient(async(url,init)=>{calls.push({url:String(url),init});return Response.json(data);});
 const signal=new AbortController().signal;assert.deepEqual(await api.progress('41',signal),progress);assert.equal(calls[0].init?.signal,signal);
 data={...progress,sessionId:'42'};await assert.rejects(api.progress('41'));
 await assert.rejects(api.progress('../42'));assert.equal(calls.length,2);
});
test('shipment input only includes checked current products with positive whole quantities and actual local time',()=>{
 const result=shipmentInput('41','2026-10-17T12:30','顺丰','SF1',{'8':'2','9':''},['8','9']);
 assert.deepEqual(result.items,[{productId:'8',quantity:2}]);assert.equal(new Date(result.shippedAt).getTime(),new Date('2026-10-17T12:30').getTime());
 for(const quantities of [{'8':'1e2'},{'8':'0'},{'8':'1.5'},{'99':'2'},{'8':''},{'8':'9007199254740992'}])assert.throws(()=>shipmentInput('41','2026-10-17T12:30','','',quantities,['8']));
});
test('followup input retains unknown/false confirmation, enforces result, date ordering and current product links',()=>{
 const input={contactedOn:'2026-10-17',customerConfirmed:'unknown',feedback:' 反馈 ',outcome:' 继续沟通 ',nextAction:'寄布',nextFollowupOn:'2026-10-18',productIds:['8']};
 assert.equal(followupInput('41',input,['8']).customerConfirmed,null);
 assert.equal(followupInput('41',{...input,customerConfirmed:'no'},['8']).customerConfirmed,false);
 assert.throws(()=>followupInput('41',{...input,nextFollowupOn:'2026-10-16'},['8']));
 assert.throws(()=>followupInput('41',{...input,productIds:['9']},['8']));
 assert.throws(()=>followupInput('41',{...input,outcome:''},['8']));
});
test('history parsing preserves removed product IDs as historical facts, rejects mixed sessions and unauthorized results',async()=>{
 let response=Response.json({sessionId:'41',total:1,limit:20,offset:0,items:[{id:'71',actorUserId:'6',shippedAt:'2026-10-17T10:00:00.000Z',carrier:null,trackingNo:null,items:[{productId:'99',quantity:3}]}]});
 const api=createSampleOperationsClient(async()=>response);
 assert.equal((await api.history('41','shipments',0)).items[0].id,'71');
 response=Response.json({...progress,sessionId:'42'});await assert.rejects(api.history('41','shipments',0));
 response=Response.json({error:'secret'},{status:403});await assert.rejects(api.progress('41'),(error:unknown)=>(error as {status:number}).status===403&&!String(error).includes('secret'));
});

test('directory accepts a date-only creation date and legacy absence, rejects invalid dates',async()=>{
 let createdOn:unknown='2026-10-18';
 const api=createSampleOperationsClient(async()=>Response.json({total:1,limit:20,offset:0,items:[{id:'41',customerReference:'客户甲',status:'open',...(createdOn===undefined?{}:{createdOn})}]}));
 assert.equal((await api.directory('')).items[0].createdOn,'2026-10-18');createdOn=undefined;await api.directory('');
 for(const bad of ['2026-02-30','2026-10-18T12:30:00.000Z',123,null]){createdOn=bad;await assert.rejects(api.directory(''));}
});
