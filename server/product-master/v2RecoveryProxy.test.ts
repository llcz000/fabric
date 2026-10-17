import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createV2RecoveryProxy,recoveryRequestAllowed} from './v2RecoveryProxy';
test('recovery permits business reads and session/read-signature POST only, never legacy or disguised writes',()=>{
 for(const [method,url] of [['GET','/'],['GET','/api/v2/documents?customer=%E6%A3%89'],['POST','/api/v2/access/login'],['POST','/api/v2/access/logout'],['POST','/api/image-assets/access-urls']])assert(recoveryRequestAllowed(method,url));
 for(const [method,url] of [['POST','/api/v2/documents'],['DELETE','/api/v2/documents/1'],['PATCH','/api/company'],['GET','/api/orders'],['GET','/server.cjs'],['GET','/assets/x.js.map'],['POST','/api/v2/access/%6cogin'],['POST','/api/v2/access/../documents'],['GET','//outside.invalid']])assert(!recoveryRequestAllowed(method,url),method+' '+url);
});
test('recovery verifies upstream V2 identity, blocks writes before forwarding, and shows a read-only banner',async()=>{
 let writes=0;const upstream=express();upstream.get('/api/runtime',(_req,res)=>res.json({mode:'v2'}));upstream.get('/api/health',(_req,res)=>res.json({storage:'mysql',mode:'v2'}));upstream.get('/',(_req,res)=>res.type('html').send('<html><body><div id="root"></div></body></html>'));upstream.post('/api/v2/documents',(_req,res)=>{writes++;res.json({});});
 const source=upstream.listen(0,'127.0.0.1');await new Promise<void>(r=>source.once('listening',r));
 const app=await createV2RecoveryProxy('http://127.0.0.1:'+(source.address() as {port:number}).port);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  assert.equal((await fetch(base+'/api/v2/documents',{method:'POST',body:'{}'})).status,503);assert.equal(writes,0);
  assert.match(await(await fetch(base)).text(),/只读恢复模式/);assert.equal((await(await fetch(base+'/api/runtime')).json()).readOnly,true);
  await assert.rejects(createV2RecoveryProxy('https://outside.invalid'));
 }finally{server.closeAllConnections();source.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>source.close(()=>r()))]);}
});
