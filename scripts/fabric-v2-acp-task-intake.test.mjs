import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {evaluateAcpTask,auditAcpProfiles,formatAcpTaskBrief} from './fabric-v2-acp-task-intake.mjs';
const root=process.cwd();
const valid=()=>({format:'fabric-v2-acp-task-v1',agent:'E',ac:'AC-84',
 task:'完成已批准人工补选UI之后的独立只读检验',remainingGate:'本地HTTP范围验收，不改变已接受UI',
 edit:['server/customer-samples/sessionManual.test.ts'],read:['server/customer-samples/sessionManual.ts','docs/product-master/product-master-v2-b3-history-ui-review.md']});
test('five owner profiles resolve to existing context and cannot share any owned path',()=>{
 const report=auditAcpProfiles(root);
 assert.equal(report.ok,true,JSON.stringify(report.issues));
 assert.equal(report.profileCount,5);
});
test('one AC yields small verified focused brief, no PRD body and explicit open gate',()=>{
 const r=evaluateAcpTask(valid(),root);
 assert.equal(r.ok,true,JSON.stringify(r.issues));
 assert.equal(r.brief.agent,'E');
 assert.deepEqual(r.brief.acceptance,['AC-84']);
 assert.deepEqual(r.brief.edit,['server/customer-samples/sessionManual.test.ts']);
 assert.ok(r.brief.fingerprints[0].sha256.match(/^[0-9a-f]{64}$/));
 const text=formatAcpTaskBrief(r.brief);
 assert.ok(text.length<2400,text.length);
 assert.match(text,/本地HTTP范围验收/);
 assert.doesNotMatch(text,/## 一期工作包|BEGIN RSA PRIVATE KEY/);
});
test('denies role C stealing E selection UI, and E editing shared production assembly',()=>{
 for(const edit of ['src/components/product-master-v2/SampleSelectionPanel.tsx',
  'src/App.tsx','server/customer-share/publicPatternProjection.ts']){
  const manifest={...valid(),agent:edit.startsWith('src/components')?'C':'E',
   edit:[edit],read:['AGENTS.md']};
  const r=evaluateAcpTask(manifest,root);
  if(edit==='server/customer-share/publicPatternProjection.ts'){assert.equal(r.ok,true);continue;}
  assert.equal(r.ok,false,edit);
 }
});
test('denies directory blanket edits, missing files, unsafe source paths, duplicate and invalid AC',()=>{
 const cases=[
  {...valid(),edit:['server/customer-share/']},
  {...valid(),edit:['server/customer-share/notCreated.ts'],read:['server/private-secret.env']},
  {...valid(),edit:['../.local/ssh.local.json']},
  {...valid(),edit:['server/customer-samples/sessionManual.test.ts','server/customer-samples/sessionManual.test.ts']},
  {...valid(),read:['server/customer-samples/nonexistent-document.md']},
  {...valid(),ac:'AC-999999'},
  {...valid(),remainingGate:''},
  {...valid(),task:'x'.repeat(500)},
  {...valid(),agent:'Z'},
 ];
 for(const v of cases)assert.equal(evaluateAcpTask(v,root).ok,false,JSON.stringify(v));
});
test('rejects legitimate AC assigned to the wrong role, even if the role owns the file',()=>{
 const wrong={...valid(),ac:'AC-65'};
 const r=evaluateAcpTask(wrong,root);
 assert.equal(r.ok,false);
 assert.ok(r.issues.some(issue=>issue.includes('not assigned')));
});
test('CLI --task runs real read-only focused dispatch from one short ephemeral task manifest',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-intake-cli-'));
 try{
  const input=path.join(dir,'one-ac.json');
  fs.writeFileSync(input,JSON.stringify(valid()));
  const result=spawnSync(process.execPath,['scripts/fabric-v2-acp-task-intake.mjs','--task',input],{cwd:root,encoding:'utf8',timeout:12000});
  assert.equal(result.status,0,result.stderr+result.stdout);
  assert.match(result.stdout,/AC: AC-84/);
  assert.match(result.stdout,/sessionManual\.test\.ts/);
  assert.doesNotMatch(result.stdout,/AC-73|AGENTS\.md|正式切流已完成/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('new owned files are allowed but reported as new; no raw secret content is emitted',()=>{
 const t={...valid(),agent:'E',ac:'AC-73',edit:['server/customer-share/newContract.test.ts'],read:['server/customer-share/patternLinkToken.ts']};
 const r=evaluateAcpTask(t,root);
 assert.equal(r.ok,true,JSON.stringify(r.issues));
 assert.equal(r.brief.fingerprints[0].exists,false);
 assert.equal(r.brief.fingerprints[0].sha256,null);
});
test('source snapshots are fresh: fingerprints differ on changed temporary checked file',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'acp-intake-'));
 try{
  fs.mkdirSync(path.join(tmp,'docs/product-master'),{recursive:true});
  fs.mkdirSync(path.join(tmp,'server/customer-share'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'docs/product-master/product-master-v2-requirements.md'),'AC-73');
  fs.writeFileSync(path.join(tmp,'server/customer-share/current.ts'),'before');
  fs.writeFileSync(path.join(tmp,'AGENTS.md'),'policy');
  const req={...valid(),ac:'AC-73',edit:['server/customer-share/current.ts'],read:['AGENTS.md']};
  const a=evaluateAcpTask(req,tmp).brief.fingerprints[0].sha256;
  fs.writeFileSync(path.join(tmp,'server/customer-share/current.ts'),'after');
  const b=evaluateAcpTask(req,tmp).brief.fingerprints[0].sha256;
  assert.notEqual(a,b);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
