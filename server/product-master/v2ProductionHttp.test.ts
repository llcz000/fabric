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
