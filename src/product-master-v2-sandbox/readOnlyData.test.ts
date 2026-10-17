import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSandboxCards,loadSandboxSampleSession,parseSandboxSampleSession} from './readOnlyData';
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const card={id:'1',masterId:'2',masterNo:'M001',fabricId:'3',fabricNo:'F001',
 cardNo:'M001-F001',description:'测试面料',composition:'棉',weightValue:100,weightUnit:'gsm',
 widthValue:150,qrPayload:'TEST_SAMPLE_QR_0123456789',isActive:true,needsReprint:false,reprintRevision:'1'};
const session={session:{id:'42',customerReference:'CUS-TEST',status:'open'},total:1,selectedCardCount:1,limit:50,offset:0,
 items:[{id:'99',productId:'123',current:{productNo:'P003',patternNo:'M001',colorwayNo:1,
 fabricNo:'F001',fabricName:'织物',composition:null,weightValue:null,weightUnit:null,widthCm:null},
 sources:[{cardId:'1',cardNo:'M001-F001',retired:false,firstScanEventId:'2'}]}]};
test('sample card read-only list calls current V2 private GET; reuses proven page parser',async()=>{
 const calls:Array<{path:string;init?:RequestInit}>=[];
 const api=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({path:String(input),init});
  return response({items:[card],total:1,limit:50,offset:0});
 }) as typeof fetch;
 const page=await loadSandboxCards(api,'M001');
 assert.equal(page.items[0].cardNo,'M001-F001');
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/v2/sample-cards?query=M001&limit=50&offset=0');
 assert.equal(calls[0].init?.method,undefined);
 await assert.rejects(()=>loadSandboxCards(api,'\u0000bad'));
 assert.equal(calls.length,1);
});

test('sandbox sample selection history refuses IDs/path/query injection BEFORE calling HTTP',async()=>{
 let called=0;
 const api=(async(input:RequestInfo|URL)=>{called++;return response(session)}) as typeof fetch;
 for(const id of ['','0','-1','2/../documents','1?x=y','123a','01',
  '18446744073709551616','http://evil.example','1%2forders','1\n2']){
  await assert.rejects(()=>loadSandboxSampleSession(api,id));
 }
 assert.equal(called,0);
 const result=await loadSandboxSampleSession(api,'42');
 assert.equal(result.session.customerReference,'CUS-TEST');
 assert.equal(result.items[0].sources[0].cardNo,'M001-F001');
 assert.equal(called,1);
});

test('malformed, stale or sensitive/incorrect session response fails closed',async()=>{
 for(const value of [null,{},[],{...session,session:{...session.session,id:'43'}},
  {...session,total:-1},{...session,selectedCardCount:2.2},
  {...session,items:[{...session.items[0],current:{...session.items[0].current,productNo:7}}]},
  {...session,items:[{...session.items[0],sources:[{...session.items[0].sources[0],cardNo:4}]}]},
  {...session,items:[...session.items[0].sources,...session.items]},
  {...session,items:[session.items[0],session.items[0]]}]){
  assert.throws(()=>parseSandboxSampleSession(value,'42'));
 }
 for(const status of [401,403,404,409,503]){
  const api=(async()=>response({error:'Denied'},status)) as typeof fetch;
  await assert.rejects(()=>loadSandboxSampleSession(api,'42'));
 }
});

test('session results are bounded; closed sessions remain read-only; response has stable pagination',async()=>{
 const closed={...session,session:{...session.session,status:'closed'}};
 const x=parseSandboxSampleSession(closed,'42');
 assert.equal(x.session.status,'closed');
 assert.equal(x.total,1);
 for(const bad of [{...session,limit:101},{...session,offset:-1},
  {...session,items:Array.from({length:51},()=>session.items[0])},
  {...session,session:{...session.session,customerReference:'x'.repeat(161)}}]){
  assert.throws(()=>parseSandboxSampleSession(bad,'42'));
 }
});
