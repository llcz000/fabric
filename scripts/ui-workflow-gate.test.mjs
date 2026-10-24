import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {activeWorkspace,preflight,uiSourceHash,verify} from './ui-workflow-gate.mjs';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const {active}=activeWorkspace();
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel=file=>path.relative(active,file).replaceAll('\\','/');

function png(width=30,height=30){
 const crc=bytes=>{
  let c=0xffffffff;
  for(const byte of bytes){c^=byte;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;}
  return (c^0xffffffff)>>>0;
 };
 const chunk=(tag,data)=>{
  const label=Buffer.from(tag),size=Buffer.alloc(4),tail=Buffer.alloc(4);
  size.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([label,data])));
  return Buffer.concat([size,label,data,tail]);
 };
 const ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 const scan=Buffer.alloc(height*(width*4+1));
 const random=randomBytes(width*height*4);
 for(let row=0;row<height;row++)random.copy(scan,row*(width*4+1)+1,row*width*4,(row+1)*width*4);
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
test('startup checks authoritative rules and accepts synced active workspace without writing',()=>{
 const check=preflight({root,active});
 assert.equal(check.status,'pass');assert.equal(check.writes,0);
 assert.equal(activeWorkspace().pointer.currentRelease.id,JSON.parse(fs.readFileSync(path.join(active,'docs/project/fabric-v2-active-workspace.json'),'utf8')).currentRelease.id);
 assert(check.canonicalFiles>=15);
 assert.equal(check.uiRulesSha256.length,64);
});
test('scoped UI evidence cannot pass with stale code, manifest, visual FAIL or browser errors',()=>{
 const folder=fs.mkdtempSync(path.join(active,'artifacts','ui-workflow-test-'));
 const releaseId='ui-fixture-'+randomBytes(6).toString('hex');
 const releaseDir=path.join(active,'artifacts','releases',releaseId);
 try{
  const candidate=path.join(folder,'source-manifest.json');
  const paths=['src/components/document-product-selector/V2DocumentWorkspace.tsx'];
  fs.mkdirSync(path.join(releaseDir,'package'),{recursive:true});
  fs.writeFileSync(path.join(releaseDir,'package','source-manifest.json'),JSON.stringify({files:[{path:paths[0],sha256:'old'}]}));
  fs.writeFileSync(candidate,JSON.stringify({files:[{path:paths[0],sha256:'new'}]}));
  const shots=['desktop.png','mobile.png'].map((name,i)=>{const file=path.join(folder,name);fs.writeFileSync(file,png(i?360:1200,30));return {path:rel(file),sha256:sha(file)};});
  const browser=path.join(folder,'browser.json');
  fs.writeFileSync(browser,JSON.stringify({checks:['modal','empty','keyboard'],errors:[]}));
  const engineering=path.join(folder,'engineering.log');
  fs.writeFileSync(engineering,'PASS targeted test\nPASS frontend build\n');
  const reportPath=path.join(folder,'review.json'),pointer={sourceManifest:rel(candidate),currentRelease:{id:releaseId}};
  const record={
   version:1,page:'新建单据',reviewer:'test automation',uiRulesSha256:preflight({root,active}).uiRulesSha256,
   candidateManifestSha256:sha(candidate),changedUiFiles:paths,uiSourceSha256:uiSourceHash(active,paths),
   visual:{status:'pass',desktopViewport:'1440x900',narrowViewport:'360x780',screenshots:shots},
   interaction:{status:'pass',browserEvidence:rel(browser),browserSha256:sha(browser)},
   engineering:{status:'pass',evidence:[{path:rel(engineering),sha256:sha(engineering)}]},
   userAcceptance:'pending',production:'not-deployed',releaseReady:false,unverified:[]
  };
  const write=()=>fs.writeFileSync(reportPath,JSON.stringify(record));
  write();
  const good=verify({root,active,pointer,reportPath:rel(reportPath)});
  assert.equal(good.status,'pass');
  assert.equal(good.userAcceptance,'pending');
  assert.equal(good.releaseReady,false,'tool cannot impersonate user acceptance');
  record.visual.status='pending';write();
  assert.throws(()=>verify({root,active,pointer,reportPath:rel(reportPath)}),/visual review/);
  record.visual.status='pass';record.uiSourceSha256='0'.repeat(64);write();
  assert.throws(()=>verify({root,active,pointer,reportPath:rel(reportPath)}),/UI code changed/);
  record.uiSourceSha256=uiSourceHash(active,paths);write();
  fs.writeFileSync(browser,JSON.stringify({checks:['modal'],errors:['page crashed']}));
  assert.throws(()=>verify({root,active,pointer,reportPath:rel(reportPath)}),/browser evidence/);
  fs.writeFileSync(browser,JSON.stringify({checks:['modal'],errors:[]}));
  record.interaction.browserSha256=sha(browser);write();
  record.userAcceptance='accepted';write();
  assert.throws(()=>verify({root,active,pointer,reportPath:rel(reportPath)}),/cannot attest user acceptance/);
  record.userAcceptance='pending';write();
  fs.writeFileSync(candidate,JSON.stringify({files:[{path:paths[0],sha256:'tampered'}]}));
  assert.throws(()=>verify({root,active,pointer,reportPath:rel(reportPath)}),/different source manifest/);
 }finally{fs.rmSync(folder,{recursive:true,force:true});fs.rmSync(releaseDir,{recursive:true,force:true});}
});
