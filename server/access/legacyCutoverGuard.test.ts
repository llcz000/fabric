import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import {createLegacyCutoverGuard,resolveLegacyCutoverMode} from './legacyCutoverGuard';

test('P2-3b legacy is the only default; typos fail startup instead of silently opening legacy',()=>{
 assert.equal(resolveLegacyCutoverMode(undefined),'legacy');
 assert.equal(resolveLegacyCutoverMode('legacy'),'legacy');
 assert.equal(resolveLegacyCutoverMode('deny_legacy'),'deny_legacy');
 for(const bad of ['', 'DENY_LEGACY','true','enabled','v2','deny','legacy '])
  assert.throws(()=>resolveLegacyCutoverMode(bad),/Invalid legacy cutover/);
});
async function server(mode:'legacy'|'deny_legacy', fn:(base:string,count:()=>number)=>Promise<void>){
 const app=express();let hits=0;
 app.use(createLegacyCutoverGuard(mode));
 app.get('/api/health',(_,res)=>{hits++;res.json({status:'ok'})});
 app.post('/api/login',(_,res)=>{hits++;res.json({token:'legacy'})});
 app.get('/api/orders',(_,res)=>{hits++;res.json([{owner:null,private:'legacy'}])});
 app.get('/api/orders/:id',(_,res)=>{hits++;res.json({owner:null,private:'legacy'})});
 app.put('/api/orders/:id',(_,res)=>{hits++;res.send('updated')});
 app.delete('/api/orders/:id',(_,res)=>{hits++;res.send('deleted')});
 app.get('/api/export_template/:id',(_,res)=>{hits++;res.send('export leaked')});
 app.get('/api/inventory/ledger',(_,res)=>{hits++;res.send('all inventory')});
 app.post('/api/products/batch-delete',(_,res)=>{hits++;res.send('product deleted')});
 app.get('/api/company',(_,res)=>{hits++;res.send('company secrets')});
 app.get('/api/proxy-image',(_,res)=>{hits++;res.send('legacy image')});
 app.get('/api/image-assets/signed',(_,res)=>{hits++;res.send('legacy asset')});
 app.get('/uploads/private.png',(_,res)=>{hits++;res.send('legacy image bytes')});
 app.get('/api/v2/documents',(_,res)=>{hits++;res.status(401).json({error:'v2 bearer required'})});
 app.post('/api/v2/auth/login',(_,res)=>{hits++;res.status(400).json({error:'V2 login delegated'})});
 app.get('/assets/index-123.js',(_,res)=>{hits++;res.send('frontend js')});
 const http=await new Promise<ReturnType<typeof app.listen>>(resolve=>{
  const s=app.listen(0,'127.0.0.1',()=>resolve(s));
 });
 const address=http.address();assert(address&&typeof address!=='string');
 try{await fn('http://127.0.0.1:'+address.port,()=>hits);}finally{
  await new Promise<void>((resolve,reject)=>http.close(e=>e?reject(e):resolve()));
 }
}
test('P2-3b deny mode rejects ALL legacy orders, exports, stock, products, uploads, company and old login BEFORE handlers',async()=>{
 await server('deny_legacy',async(base,hits)=>{
  const paths=[
   ['GET','/api/orders'],['GET','/api/orders?per_page=100'],['GET','/api/orders/1'],
   ['PUT','/api/orders/1'],['DELETE','/api/orders/1'],['POST','/api/login'],
   ['GET','/api/export_template/1'],['GET','/api/inventory/ledger'],
   ['POST','/api/products/batch-delete'],['GET','/api/company'],
   ['GET','/api/proxy-image?url=https://example.com'],
   ['GET','/api/image-assets/signed'],['GET','/uploads/private.png'],
   ['GET','/api/v2evil/documents'],['GET','/api/v2%2forders'],
   ['GET','/api/v2/../orders'],['GET','/api/v2/%2e%2e/orders'],
   ['POST','/api/health'],
   ['GET','/api/unknown'],['GET','/template/sensitive.json']
  ] as const;
  for(const [method,path] of paths){
   const res=await fetch(base+path,{method,redirect:'manual'});
   assert.equal(res.status,410,method+' '+path);
   assert.equal(res.headers.get('cache-control'),'no-store');
  }
  // Fetch canonicalizes backslashes before sending; exercise raw request path.
  const rawBackslash=await new Promise<number>((resolve,reject)=>{
   const u=new URL(base);
   const r=http.request({hostname:u.hostname,port:Number(u.port),method:'GET',path:'/api/v2\\\\orders'},res=>{
    res.resume();res.on('end',()=>resolve(res.statusCode??0));
   });r.on('error',reject);r.end();
  });
  assert.equal(rawBackslash,410);
  // Audit every direct route declaration currently present in the real
  // server, so adding a new legacy API cannot silently escape this gate.
  const source=readFileSync('server.ts','utf8');
  const existing=[...source.matchAll(/app\.(get|post|put|delete|patch)\('([^']+)'/g)]
   .map(m=>({method:m[1].toUpperCase(),path:m[2]}))
   .filter(x=>x.path.startsWith('/api/')&&x.path!=='/api/health');
  assert(existing.length>=25,'Server route audit must discover the old API');
  for(const route of existing){
   const path=route.path.replace(/:[A-Za-z][A-Za-z0-9_]*/g,'17');
   const response=await fetch(base+path,{method:route.method,redirect:'manual'});
   assert.equal(response.status,410,'Old declaration must be gated: '+route.method+' '+path);
  }
  assert.equal(hits(),0,'legacy router handlers never called');
  const health=await fetch(base+'/api/health');assert.equal(health.status,200);
  const v2=await fetch(base+'/api/v2/documents');assert.equal(v2.status,401,'new route authorization remains mandatory');
  assert.equal((await fetch(base+'/api/v2/auth/login',{method:'POST'})).status,400);
  assert.equal((await fetch(base+'/assets/index-123.js')).status,200);
  assert.equal(hits(),4);
 });
});
test('P2-3b legacy mode is behavior preserving, does not consume requests or suppress old login',async()=>{
 await server('legacy',async(base,hits)=>{
  assert.equal((await fetch(base+'/api/orders')).status,200);
  assert.equal((await fetch(base+'/api/login',{method:'POST'})).status,200);
  assert.equal((await fetch(base+'/uploads/private.png')).status,200);
  assert.equal(hits(),3);
 });
});
test('P2-3b cutover guard is structurally mounted before global parser, uploads and all legacy routes',()=>{
 const source=readFileSync('server.ts','utf8');
 const gate=source.indexOf('app.use(createLegacyCutoverGuard(');
 assert(gate>0,'server must mount cutover early');
 for(const anchor of ['app.use(exceptImageAssetApi(','app.use(\'/uploads\'','app.use(\'/api/image-assets\'',
  'app.get(\'/api/orders\'','app.get(\'/api/export_template/:id\'','app.post(\'/api/products/batch-delete\'']){
   const at=source.indexOf(anchor);
   assert(at>gate,anchor+' must appear after cutover guard');
 }
});
