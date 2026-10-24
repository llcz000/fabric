import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createFrontendStaticRouter} from './frontendStatic';
test('production serves frontend assets but never backend bundle, maps or arbitrary review files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fabric-v2-static-'));await mkdir(path.join(root,'assets'));
 for(const name of ['index.html','favicon.svg','favicon-6dc80a36.svg','server.cjs','server.cjs.map','product-master-v2-review.html','assets/app.js'])await writeFile(path.join(root,name),'fixture');
 const app=express();app.use(createFrontendStaticRouter(root));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  for(const name of ['/','/index.html','/favicon.svg','/favicon-6dc80a36.svg','/assets/app.js'])assert.equal((await fetch(base+name)).status,200);
  for(const name of ['/server.cjs','/server.cjs.map','/product-master-v2-review.html','/assets/app.js.map','/favicon-anything.svg','/favicon-123.svg','/favicon-AAAAAAAA.svg','/%73erver.cjs','/p/'+'a'.repeat(43)])assert.equal((await fetch(base+name)).status,404,name);
  assert.match((await fetch(base)).headers.get('cache-control')??'',/no-store/);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('fabric-v2-static-'));await rm(root,{recursive:true,force:true});}
});
test('opt-in public pattern SPA serves only canonical share paths and still protects backend files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fabric-v2-static-'));await writeFile(path.join(root,'index.html'),'public shell');
 const app=express();app.use(createFrontendStaticRouter(root,{allowPatternShare:true}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const base='http://127.0.0.1:'+(server.address() as {port:number}).port;const page=await fetch(base+'/p/'+'a'.repeat(43));assert.equal(page.status,200);assert.equal(await page.text(),'public shell');assert.match(page.headers.get('cache-control')??'',/no-store/);assert.equal((await fetch(base+'/p/server.cjs')).status,404);}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
test('product share SPA is independently gated and accepts only canonical single product links',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fabric-v2-static-'));await writeFile(path.join(root,'index.html'),'product shell');
 const app=express();app.use('/on',createFrontendStaticRouter(root,{allowProductShare:true}));app.use('/off',createFrontendStaticRouter(root));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const base='http://127.0.0.1:'+(server.address() as {port:number}).port;const p='/s/'+'a'.repeat(43);
  assert.equal((await fetch(base+'/on'+p)).status,200);assert.equal((await fetch(base+'/off'+p)).status,404);
  assert.equal((await fetch(base+'/on/s/server.cjs')).status,404);assert.equal((await fetch(base+'/on/p/'+'a'.repeat(43))).status,404);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

test('card share SPA is independently gated and keeps all other internal files private',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fabric-v2-static-'));await writeFile(path.join(root,'index.html'),'card shell');
 const app=express();app.use('/on',createFrontendStaticRouter(root,{allowCardShare:true}));app.use('/off',createFrontendStaticRouter(root));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const base='http://127.0.0.1:'+(server.address() as {port:number}).port;assert.equal((await fetch(base+'/on/c/'+'a'.repeat(43))).status,200);assert.equal((await fetch(base+'/off/c/'+'a'.repeat(43))).status,404);for(const p of ['/c/server.cjs','/server.cjs','/.env'])assert.equal((await fetch(base+'/on'+p)).status,404);}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
