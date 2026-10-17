import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import test from 'node:test';

// npm ci on GitHub tests actual production modules. A Windows local worktree
// shares legacy node_modules, so smoke tests use an ignored isolated prefix.
const root=process.env.FABRIC_PATCHED_RUNTIME_TEST_ROOT || resolve(fileURLToPath(new URL('..',import.meta.url)));
const load=createRequire(join(root,'fabric-patched-runtime-smoke.cjs'));
const multer=load('multer');
const express=load('express');
const sharp=load('sharp');
const mysql2=load('mysql2');

test('patched runtime matches audited lock and preserves key public APIs',()=>{
 for(const [name,version] of Object.entries({
  'multer':'2.4.0','sharp':'0.35.5','express':'4.22.3','mysql2':'3.24.6'
 })){
  // sharp intentionally hides package.json behind an exports boundary.
  assert.equal(JSON.parse(readFileSync(join(root,'node_modules',name,'package.json'),'utf8')).version,version,name+' installed');
 }
 assert.equal(typeof multer.memoryStorage,'function');
 assert.equal(typeof multer.MulterError,'function');
 assert.equal(typeof sharp,'function');
 assert.equal(typeof mysql2.escape,'function');
 assert.equal(mysql2.escape('a\'b'),"'a\\'b'");
});

test('patched multer accepts a bounded in-memory upload and rejects excess bytes',async()=>{
 const app=express();
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5,files:1,fields:0}});
 app.post('/upload',upload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'missing file'});
  res.json({size:req.file.size,content:req.file.buffer.toString('utf8'),fieldname:req.file.fieldname});
 });
 app.use((err,_req,res,_next)=>res.status(413).json({code:err?.code||'UNKNOWN'}));
 const server=await new Promise((resolve,reject)=>{
  const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.once('error',reject);
 });
 try{
  const url='http://127.0.0.1:'+server.address().port+'/upload';
  const body=new FormData();body.set('file',new Blob(['a123'],{type:'text/plain'}),'safe.txt');
  const ok=await fetch(url,{method:'POST',body});
  assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{size:4,content:'a123',fieldname:'file'});
  const huge=new FormData();huge.set('file',new Blob(['abcdef'],{type:'text/plain'}),'too-big.txt');
  const blocked=await fetch(url,{method:'POST',body:huge});
  assert.equal(blocked.status,413);assert.deepEqual(await blocked.json(),{code:'LIMIT_FILE_SIZE'});
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('patched sharp creates a real PNG and safely rejects invalid image data',async()=>{
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2" fill="navy"/></svg>');
 const png=await sharp(svg,{limitInputPixels:500}).png().toBuffer();
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 const size=await sharp(png).metadata();
 assert.equal(size.width,4);assert.equal(size.height,2);
 await assert.rejects(()=>sharp(Buffer.from('this is not an image')).png().toBuffer());
});
