import assert from 'node:assert/strict';
import test from 'node:test';
import {Router} from 'express';
import {createV2ProductionHttpApp} from './v2ProductionHttp';
test('production HTTP serves explicit V2 mode, rejects legacy API, and health fails when SQL probe fails',async()=>{
 const routes=Router();routes.get('/example',(_req,res)=>res.status(401).json({error:'Unauthorized'}));
 let healthy=true;const app=createV2ProductionHttpApp(routes,async()=>healthy);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  assert.deepEqual(await(await fetch(base+'/api/runtime')).json(),{mode:'v2'});
  assert.equal((await fetch(base+'/api/orders')).status,410);
  assert.equal((await fetch(base+'/api/v2/example')).status,401);
  assert.equal((await(await fetch(base+'/api/health')).json()).storage,'mysql');
  healthy=false;const failed=await fetch(base+'/api/health');assert.equal(failed.status,503);assert.equal((await failed.json()).storage,'unavailable');
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('1000 sequential image imports do not exhaust login/list capacity; public quota remains isolated',async()=>{
 const routes=Router(),extras=Router();let imported=0;
 routes.post('/pattern-catalog/import',(_req,res)=>{imported++;res.json({saved:true});});
 routes.get('/pattern-catalog',(_req,res)=>res.json({total:imported}));
 routes.post('/access/login',(_req,res)=>res.json({authenticated:true}));
 extras.post('/api/image-assets/upload-sessions',(_req,res)=>res.status(201).json({sessionId:'test'}));
 extras.post('/api/image-assets/upload-sessions/test/finalize',(_req,res)=>res.json({status:'processing'}));
 extras.get('/api/image-assets/test',(_req,res)=>res.json({status:'ready'}));
 extras.get('/api/public/test',(_req,res)=>res.json({public:true}));
 const app=createV2ProductionHttpApp(routes,async()=>true,extras);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const request=async(path:string,method='GET',expected=200)=>{
  const response=await fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+path,{method});
  await response.text();assert.equal(response.status,expected,path);
 };
 try{
  for(let i=0;i<1000;i++){
   await request('/api/image-assets/upload-sessions','POST',201);
   await request('/api/image-assets/upload-sessions/test/finalize','POST');
   await request('/api/image-assets/test');
   await request('/api/v2/pattern-catalog/import','POST');
  }
  assert.equal(imported,1000);
  await request('/api/v2/access/login','POST');await request('/api/v2/pattern-catalog');
  for(let i=0;i<1000;i++)await request('/api/public/test');
  await request('/api/public/test','GET',429);
  await request('/api/v2/access/login','POST');await request('/api/v2/pattern-catalog');
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
