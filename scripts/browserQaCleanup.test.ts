import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {cleanupQaBrowser} from './browserQaCleanup.mjs';

test('QA cleanup waits for its child to close and removes only the owned profile',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-qa-owner-'));
 try{
  const profile=path.join(root,'tmp/card-selection-edge-owned'),keep=path.join(root,'tmp/keep');
  fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(keep);fs.writeFileSync(path.join(keep,'evidence.txt'),'keep');
  const browser=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true});
  await new Promise<void>((resolve,reject)=>{browser.once('spawn',resolve);browser.once('error',reject);});
  let closed=false;browser.once('close',()=>{closed=true;});
  await cleanupQaBrowser({root,profile,browser});
  assert(closed);assert(!fs.existsSync(profile));assert.equal(fs.readFileSync(path.join(keep,'evidence.txt'),'utf8'),'keep');
  await cleanupQaBrowser({root,profile});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('QA cleanup rejects paths outside the temporary profile whitelist',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-qa-boundary-'));
 try{
  for(const profile of [root,path.join(root,'tmp'),path.join(root,'src'),path.join(root,'tmp/keep')]){
   await assert.rejects(cleanupQaBrowser({root,profile}),/Unsafe QA profile/);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('QA cleanup refuses a temporary parent junction leading outside the workspace',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-qa-link-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-qa-outside-'));
 try{
  const target=path.join(outside,'card-selection-edge-owned');fs.mkdirSync(target);
  fs.symlinkSync(outside,path.join(root,'tmp'),'junction');
  await assert.rejects(cleanupQaBrowser({root,profile:path.join(root,'tmp/card-selection-edge-owned')}),/Unsafe QA profile/);
  assert(fs.existsSync(target));
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
