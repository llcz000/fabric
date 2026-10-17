import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {loadConfigFromFile} from 'vite';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const file=resolve(root,'scripts/vite-v2-sandbox.config.ts');
const ack='I_ACKNOWLEDGE_SANDBOX';

test('isolated V2 frontend startup is opt-in, unlike legacy default Vite config',async()=>{
 const prev=process.env.FABRIC_V2_SANDBOX_FRONTEND;
 try{
  delete process.env.FABRIC_V2_SANDBOX_FRONTEND;
  await assert.rejects(()=>loadConfigFromFile({command:'serve',mode:'development'},file,root));
  const source=readFileSync(resolve(root,'vite.config.ts'),'utf8');
  assert.doesNotMatch(source,/v2-sandbox|FABRIC_V2_SANDBOX_FRONTEND/);
  assert.doesNotMatch(readFileSync(resolve(root,'src/App.tsx'),'utf8'),/product-master-v2-sandbox/);
  assert.doesNotMatch(readFileSync(resolve(root,'server.ts'),'utf8'),/vite-v2-sandbox|product-master-v2-sandbox/);
 }finally{
  if(prev===undefined)delete process.env.FABRIC_V2_SANDBOX_FRONTEND;
  else process.env.FABRIC_V2_SANDBOX_FRONTEND=prev;
 }
});

test('opted-in Vite sandbox uses loopback-only proxy, isolated build and no legacy endpoints',async()=>{
 const prev=process.env.FABRIC_V2_SANDBOX_FRONTEND;
 try{
  process.env.FABRIC_V2_SANDBOX_FRONTEND=ack;
  const loaded=await loadConfigFromFile({command:'serve',mode:'development'},file,root);
  assert(loaded?.config);
  const cfg=loaded.config;
  assert.equal(cfg.server?.host,'127.0.0.1');
  assert.equal(cfg.server?.port,4455);
  assert.equal(cfg.server?.strictPort,true);
  assert.deepEqual(Object.keys(cfg.server?.proxy??{}),['/api/v2']);
  assert.equal(cfg.server?.proxy?.['/api/v2']?.target,'http://127.0.0.1:3456');
  assert.equal(cfg.build?.outDir,'tmp/v2-sandbox-frontend-dist');
  assert.equal(cfg.build?.rollupOptions?.input?.sandbox,resolve(root,'product-master-v2-sandbox.html'));
 }finally{
  if(prev===undefined)delete process.env.FABRIC_V2_SANDBOX_FRONTEND;
  else process.env.FABRIC_V2_SANDBOX_FRONTEND=prev;
 }
});
