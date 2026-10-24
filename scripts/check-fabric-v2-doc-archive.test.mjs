import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const checker=fileURLToPath(new URL('./check-fabric-v2-doc-archive.mjs',import.meta.url));
test('archive gate accepts a verified, superseded historical note with transferred obligations',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-doc-archive-'));
 try {
  const root=path.join(parent,'project'),vault=path.join(parent,'private-backup');
  const source='docs/retrospectives/development/obsolete.md';
  const replacement='docs/retrospectives/README.md';
  const evidence='docs/product-master/product-master-v2-progress.md';
  const sourceText='# Obsolete\nHistorical details\n';
  const put=(rel,data)=>{const f=path.join(root,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data);};
  put(source,sourceText);put(replacement,'# Current\nAuthorized users must be checked again\n');
  put(evidence,'# Progress\nFormal API remains unmounted\n');
  fs.mkdirSync(vault,{recursive:true});
  const archived=path.join(vault,'obsolete.md');fs.writeFileSync(archived,sourceText);
  const sha256=createHash('sha256').update(sourceText).digest('hex');
  const entry={source,replacement,reason:'superseded',evidence,
   evidence_phrase:'Formal API remains unmounted',unique_information_reviewed:true,
   open_gates_reviewed:true,retained_facts:[{file:replacement,phrase:'Authorized users must be checked again'}],
   pending_gates:[{file:evidence,phrase:'Formal API remains unmounted'}],
   archive_copy:archived,sha256};
  const plan={format:'fabric-v2-doc-archive-plan-v1',entries:[entry]};
  const planPath=path.join(parent,'review.json');
  const run=()=>{fs.writeFileSync(planPath,JSON.stringify(plan));return spawnSync(process.execPath,[checker,planPath],{cwd:root,encoding:'utf8'});};
  let r=run();assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/PASS/);
  put('docs/index.md','[old](retrospectives/development/obsolete.md)\n');
  r=run();assert.equal(r.status,2,'linked notes must not be removed');assert.match(r.stdout,/FAIL/);
  put('docs/index.md','# No obsolete links\n');
  fs.writeFileSync(archived,'wrong copy');
  r=run();assert.equal(r.status,2,'bad backup must be refused');
  fs.writeFileSync(archived,sourceText);
  plan.entries[0].open_gates_reviewed=false;
  r=run();assert.equal(r.status,2,'unreviewed gates must block removal');
  plan.entries[0].open_gates_reviewed=true;
  plan.entries[0].reason='fully_accepted';
  r=run();assert.equal(r.status,2,'fully accepted cannot retain an open gate');
  plan.entries[0].reason='superseded';
  plan.entries[0].archive_copy=path.join(root,'docs','backup.md');
  r=run();assert.equal(r.status,2,'archive must be outside project');
  plan.entries[0].archive_copy=archived;
  plan.entries[0].reason='fully_accepted';
  plan.entries[0].pending_gates=[];
  plan.entries[0].acceptance_confirmed=true;
  r=run();assert.equal(r.status,0,'fully accepted with verified evidence and no open Gates is archivable');
  plan.entries[0].acceptance_confirmed=false;
  r=run();assert.equal(r.status,2,'acceptance cannot be silently inferred');
  plan.entries[0].reason='superseded';
  plan.entries[0].pending_gates=[{file:evidence,phrase:'Formal API remains unmounted'}];
  plan.entries[0].acceptance_confirmed=false;
  plan.entries[0].source='docs/product-master/product-master-v2-requirements.md';
  put(plan.entries[0].source,sourceText);
  r=run();assert.equal(r.status,2,'business requirements cannot be archived by this tool');
  for(const candidate of ['docs/superpowers/plans/2026-10-23-completed-task.md','docs/superpowers/specs/2026-10-23-approved-design.md','docs/superpowers/plans/current.md']){
   plan.entries[0].source=candidate;plan.entries[0].reason='superseded';
   put(candidate,sourceText);
   r=run();
   assert.equal(r.status,candidate.includes('/plans/2026-')?0:2,'only dated execution plans may enter the same evidence gate: '+candidate+' '+r.stdout);
  }
  for(const candidate of ['docs/operations/2026-10-21-release-result.md','docs/maintenance/2026-10-24-old-audit.md','docs/ui-design/pilot-2026-10-21-result.md','docs/ui-design/product-positioning-2026-10-21.md','docs/ui-design/wechat-card-share-2026-10-21.md','docs/ui-design/one-pass-ui-review-2026-10-21.md']){
   plan.entries[0].source=candidate;put(candidate,sourceText);r=run();
   const normative=/product-positioning|wechat-card-share|one-pass-ui-review/.test(candidate);
   assert.equal(r.status,normative?2:0,'dated process notes share the evidence gate; current UI rules stay protected: '+candidate+' '+r.stdout);
  }
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
