import assert from 'node:assert/strict';
import test from 'node:test';
import {searchManualCards,createManualSelectionAction} from './manualSelectionModel';
import {SelectionHttpError} from './sampleSelectionClient';
const card={id:'44',cardNo:'0012-F018',fabricName:'真丝',composition:null,weightValue:null,weightUnit:null,widthCm:null,
 products:[{id:'8',productNo:'0012-1-F018',colorwayNo:1,patternNo:'0012-1',patternImageAssetId:null},{id:'9',productNo:'0012-2-F018',colorwayNo:2,patternNo:'0012-2',patternImageAssetId:null}]};
const receipt={sessionId:'51',cardId:'44',items:[{productId:'8',itemId:'61',action:'added' as const}]};
test('manual search is session-scoped card search and preserves server pagination, never calls product catalog',async()=>{
 let request='';
 const result=await searchManualCards(async(url,init)=>{request=String(url);assert.equal(init?.cache,'no-store');
  return Response.json({items:[card],total:25,limit:20,offset:20});},{sessionId:'51',query:' 0012 ',offset:20});
 const url=new URL(request,'http://localhost');assert.equal(url.pathname,'/api/v2/customer-samples/sessions/51/cards');
 assert.equal(url.searchParams.get('query'),'0012');assert.equal(url.searchParams.get('offset'),'20');assert.equal(result.items[0].cardNo,'0012-F018');
});
test('card action submits selected IDs with the source card and serializes until latest list reloads',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);const calls:unknown[]=[];
 const add=createManualSelectionAction({sessionId:'51',isOpen:()=>true,addManual:async(...args)=>{calls.push(args);await gate;return receipt;},reload:async()=>{calls.push('reload');}});
 const pending=add(card,['8']);await assert.rejects(add(card,['9']),/处理中/);
 assert.deepEqual(calls,[['51','44',['8']]]);release();assert.deepEqual(await pending,receipt);assert.equal(calls.at(-1),'reload');
});
test('whole-card action omits subset; explicit empty/foreign subsets and closed sessions never write',async()=>{
 let open=false;const calls:unknown[]=[];
 const add=createManualSelectionAction({sessionId:'51',isOpen:()=>open,addManual:async(...args)=>{calls.push(args);return receipt;},reload:async()=>{}});
 await assert.rejects(add(card),/已结束/);open=true;
 await assert.rejects(add(card,[]),/配色/);await assert.rejects(add(card,['99']),/配色/);assert.equal(calls.length,0);
 await add(card);assert.deepEqual(calls,[['51','44',undefined]]);
});
test('search preserves authorization and successful write with failed reload reports recovery path',async()=>{
 await assert.rejects(searchManualCards(async()=>new Response(null,{status:403}),{sessionId:'51',query:'',offset:0}),(e:unknown)=>e instanceof SelectionHttpError&&e.status===403);
 const add=createManualSelectionAction({sessionId:'51',isOpen:()=>true,addManual:async()=>receipt,reload:async()=>{throw Error('offline');}});
 await assert.rejects(add(card,['8']),/已处理.*刷新失败/);
});
