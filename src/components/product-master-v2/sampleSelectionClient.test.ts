import assert from 'node:assert/strict';
import test from 'node:test';
import {createSampleSelectionClient,createV2SelectionFetch,selectionAccessRevoked,SelectionHttpError} from './sampleSelectionClient';
const payload={session:{id:'51',customerReference:'客户A',status:'open'},total:0,selectedCardCount:0,limit:20,offset:0,items:[]};

test('V2 selection fetch uses the latest injected session and preserves private JSON requests',async()=>{
 let token:string|null='a'.repeat(64);const calls:{input:RequestInfo|URL;init?:RequestInit}[]=[];
 const transport:typeof fetch=async(input,init)=>{calls.push({input,init});return Response.json({});};
 const api=createV2SelectionFetch(transport,()=>token);
 const abort=new AbortController();
 await api('/api/v2/products?productNo=0012',{signal:abort.signal,headers:{Accept:'application/json'}});
 token='b'.repeat(64);
 await api('/api/v2/customer-samples/sessions/51/items/manual',{method:'POST',body:'{"productId":"81"}',headers:{'Content-Type':'application/json',Authorization:'Bearer old-legacy-token'}});
 assert.deepEqual(calls.map(x=>new Headers(x.init?.headers).get('Authorization')),['Bearer '+'a'.repeat(64),'Bearer '+'b'.repeat(64)]);
 assert.equal(calls[0].init?.signal,abort.signal);
 assert.equal(new Headers(calls[0].init?.headers).get('Accept'),'application/json');
 assert.equal(new Headers(calls[1].init?.headers).get('Content-Type'),'application/json');
 assert.equal(calls[1].init?.method,'POST');assert.equal(calls[1].init?.body,'{"productId":"81"}');
 assert(calls.every(x=>x.init?.cache==='no-store'&&x.init.credentials==='omit'&&x.init.redirect==='error'));
});

test('V2 selection fetch never sends missing/legacy tokens or authorizes a foreign or legacy endpoint',async()=>{
 let calls=0,token:string|null=null;
 const api=createV2SelectionFetch(async()=>{calls++;return Response.json({});},()=>token);
 for(const value of [null,'','eyJ.legacy.jwt','invalid']){
  token=value;await assert.rejects(api('/api/v2/products'),(e:unknown)=>e instanceof SelectionHttpError&&e.status===401);
 }
 token='a'.repeat(64);
 for(const url of ['https://example.com/api/v2/products','//example.com/api/v2/products','/api/products','/api/v2/../../api/products','/api/v2/\\products'])
  await assert.rejects(api(url),/private V2/);
 assert.equal(calls,0);
});
test('B3 logout, revoked grant and not-found clear any sensitive cached selection',()=>{
 for(const n of [401,403,404])assert.equal(selectionAccessRevoked(new SelectionHttpError(n)),true);
 for(const n of [400,409,503])assert.equal(selectionAccessRevoked(new SelectionHttpError(n)),false);
 assert.equal(selectionAccessRevoked(new Error('network')),false);
});
test('B3 selection adapter reads live private API with pagination and removes one item',async()=>{
 const calls:{url:string;method:string}[]=[];
 const api=createSampleSelectionClient(async(url,init)=>{
  calls.push({url:String(url),method:init?.method??'GET'});
  return new Response(init?.method==='DELETE'?null:JSON.stringify(payload),{status:init?.method==='DELETE'?204:200});
 });
 assert.equal((await api.load('51',20,0)).session.id,'51');
 await api.remove('51','61');
 assert.deepEqual(calls,[{url:'/api/v2/customer-samples/sessions/51?limit=20&offset=0',method:'GET'},
  {url:'/api/v2/customer-samples/sessions/51/items/61',method:'DELETE'}]);
});
test('AC-84 client adapter submits a card and optional subset, checks the receipt and rejects cross-card IDs',async()=>{
 const calls:{url:string;body:unknown;method:string}[]=[];
 const api=createSampleSelectionClient(async(url,init)=>{
  calls.push({url:String(url),method:init?.method??'GET',body:init?.body});
  return Response.json({sessionId:'51',cardId:'44',items:[{productId:'8',itemId:'61',action:'added'}]});
 });
 assert.deepEqual(await api.addManual('51','44',['8']),{sessionId:'51',cardId:'44',items:[{productId:'8',itemId:'61',action:'added'}]});
 assert.deepEqual(calls,[{url:'/api/v2/customer-samples/sessions/51/items/manual',method:'POST',body:JSON.stringify({cardId:'44',productIds:['8']})}]);
 await assert.rejects(api.addManual('51','0'),/Invalid/);assert.equal(calls.length,1);
 const bad=createSampleSelectionClient(async()=>Response.json({sessionId:'51',cardId:'44',items:[{productId:'99',itemId:'61',action:'added'}]}));
 await assert.rejects(bad.addManual('51','44',['8']),/Invalid/);
 const revoked=createSampleSelectionClient(async()=>new Response('{}',{status:403}));
 await assert.rejects(revoked.addManual('51','8'),(error:unknown)=>selectionAccessRevoked(error));
});
test('B3 selection adapter validates identities and hides failed unauthorized reads',async()=>{
 const missing=createSampleSelectionClient(async()=>new Response('Not found',{status:404}));
 await assert.rejects(missing.load('51',20,0),(e:unknown)=>(e as {status?:number}).status===404);
 const wrong=createSampleSelectionClient(async()=>new Response(JSON.stringify({...payload,session:{...payload.session,id:'88'}}),{status:200}));
 await assert.rejects(wrong.load('51',20,0),/Invalid/);
 await assert.rejects(wrong.remove('invalid','61'),/Invalid/);
});
