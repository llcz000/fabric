import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createFrontendStaticRouter} from './frontendStatic';
test('production serves frontend assets but never backend bundle, maps or arbitrary review files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fabric-v2-static-'));await mkdir(path.join(root,'assets'));
 for(const name of ['index.html','server.cjs','server.cjs.map','product-master-v2-review.html','assets/app.js'])await writeFile(path.join(root,name),'fixture');
 const app=express();app.use(createFrontendStaticRouter(root));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  for(const name of ['/','/index.html','/assets/app.js'])assert.equal((await fetch(base+name)).status,200);
  for(const name of ['/server.cjs','/server.cjs.map','/product-master-v2-review.html','/assets/app.js.map','/%73erver.cjs','/p/'+'a'.repeat(43)])assert.equal((await fetch(base+name)).status,404,name);
  assert.match((await fetch(base)).headers.get('cache-control')??'',/no-store/);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('fabric-v2-static-'));await rm(root,{recursive:true,force:true});}
});
test('opt-in public pattern SPA serves only canonical share paths and still protects backend files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fabric-v2-static-'));await writeFile(path.join(root,'index.html'),'public shell');
 const app=express();app.use(createFrontendStaticRouter(root,{allowPatternShare:true}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const base='http://127.0.0.1:'+(server.address() as {port:number}).port;const page=await fetch(base+'/p/'+'a'.repeat(43));assert.equal(page.status,200);assert.equal(await page.text(),'public shell');assert.match(page.headers.get('cache-control')??'',/no-store/);assert.equal((await fetch(base+'/p/server.cjs')).status,404);}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
