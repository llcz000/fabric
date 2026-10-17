import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('workspace freshness gate accepts exact baseline and refuses stale or missing source',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-v2-freshness-'));
 try{
  const snapshot=path.join(temp,'baseline'),workspace=path.join(temp,'workspace');
  fs.mkdirSync(snapshot);fs.mkdirSync(workspace);
  const data=Buffer.from('export const version=2;');
  const e={file:'src/example.ts',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  for(const base of [snapshot,workspace]){
   fs.mkdirSync(path.join(base,'src'));
   fs.writeFileSync(path.join(base,e.file),data);
  }
  fs.writeFileSync(path.join(snapshot,'manifest.json'),JSON.stringify({format:'fabric-v2-safe-source-v1',count:1,entries:[e]}));
  const verify=()=>spawnSync(process.execPath,['scripts/fabric-v2-workspace-freshness.mjs',snapshot,workspace],{cwd:process.cwd(),encoding:'utf8'});
  let r=verify();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"matched":1/);
  fs.writeFileSync(path.join(workspace,e.file),'export const version=1;');
  r=verify();assert.equal(r.status,2);assert.match(r.stdout,/"changed":1/);
  fs.unlinkSync(path.join(workspace,e.file));
  r=verify();assert.equal(r.status,2);assert.match(r.stdout,/"missing":1/);
  fs.writeFileSync(path.join(workspace,e.file),data);
  fs.writeFileSync(path.join(workspace,'src','new-feature.ts'),'new agent work');
  r=verify();assert.equal(r.status,2,'an old snapshot cannot silently accept a newer workspace with added source');
  assert.match(r.stdout,/"extra":1/);
  fs.unlinkSync(path.join(workspace,'src','new-feature.ts'));
  fs.writeFileSync(path.join(workspace,'src','.env'),'CREDENTIALS=DO_NOT_COPY');
  r=verify();assert.equal(r.status,2,'sensitive extra files cannot pass dispatch freshness');
  fs.unlinkSync(path.join(workspace,'src','.env'));
  fs.writeFileSync(path.join(workspace,'.env'),'must be denied');
  r=verify();assert.equal(r.status,2,'an untracked root config cannot escape strict agent preflight');
  fs.unlinkSync(path.join(workspace,'.env'));
  fs.writeFileSync(path.join(workspace,'.fabric-acp-workspace.json'),'preparation metadata placeholder');
  r=verify();assert.equal(r.status,0,'trusted preparation metadata must not block identical isolated source');
  fs.unlinkSync(path.join(workspace,'.fabric-acp-workspace.json'));

  // --main (source checkout) may legitimately contain files outside the source-only
  // baseline allowlist. Agent workspaces must still remain strictly source-only.
  const script=path.resolve(process.cwd(),'scripts/fabric-v2-workspace-freshness.mjs');
  fs.writeFileSync(path.join(workspace,'src','inspection.py'),'print(1)');
  r=verify();assert.equal(r.status,2,'agent cannot carry non-baseline scripts');
  const mainLike=spawnSync(process.execPath,[script,snapshot,workspace,'--main'],{cwd:workspace,encoding:'utf8'});
  assert.equal(mainLike.status,0,mainLike.stdout+mainLike.stderr);
  assert.match(mainLike.stdout,/"extra":0/);
  fs.writeFileSync(path.join(workspace,'src','new-feature.ts'),'new');
  const newMain=spawnSync(process.execPath,[script,snapshot,workspace,'--main'],{cwd:workspace,encoding:'utf8'});
  assert.equal(newMain.status,2,'new eligible source in main must require a new baseline');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
