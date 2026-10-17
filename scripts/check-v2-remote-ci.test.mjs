import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {verifyReviewWorkflow,findMissingTrackedDocLinks} from './check-v2-remote-ci.mjs';

const workflow=readFileSync(new URL('../.github/workflows/fabric-v2-review-build.yml',import.meta.url),'utf8');
test('review workflow runs locked install, offline checks and artifact-only build without deployment',()=>{
 assert.equal(verifyReviewWorkflow(workflow),true);
});
test('no production environment/secrets/write token, SSH or startup can sneak into review CI',()=>{
 for(const malicious of [
  workflow.replace('contents: read','contents: write'),
  workflow.replace(/jobs:\r?\n/,'jobs:\n  deploy:\n    environment: production\n'),
  workflow.replace('npm run build','ssh user@prod deployment'),
  workflow.replace('npm ci','npm install'),
  workflow.replace('persist-credentials: false','persist-credentials: true'),
  workflow.replace('!dist/**/*.map','dist/**/*.map'),
  workflow+'\n  schedule:\n    - cron: "0 0 * * *"\n'
 ])assert.throws(()=>verifyReviewWorkflow(malicious));
});

// A local working tree can contain ignored skills that disappear on Actions checkout.
test('every relative link from committed docs is also committed, not merely present locally',()=>{
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean));
 assert.deepEqual(findMissingTrackedDocLinks(root,tracked),[]);
});
test('detects ignored but locally present documentation target in a fresh-checkout preflight',()=>{
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean));
 tracked.delete('.agents/skills/fabric-ui-design/SKILL.md');
 const missing=findMissingTrackedDocLinks(root,tracked);
 assert(missing.some(x=>x.includes('.agents/skills/fabric-ui-design/SKILL.md')));
});

test('review CI verifies patched dependency baseline and publishes live read-only audit risk',()=>{
 assert.match(workflow,/run: node --test scripts\/check-fabric-v2-dependency-baseline\.test\.mjs scripts\/report-fabric-v2-dependency-audit\.test\.mjs/);
 assert.match(workflow,/npm audit --omit=dev --json/);
 assert.match(workflow,/report-fabric-v2-dependency-audit\.mjs/);
 assert.match(workflow,/\$result.*-gt 1/);
});


test('COS 3 actual SDK verification remains mandatory even if the audit report is green',()=>{
 assert.match(workflow,/run: node --test scripts\/check-fabric-v2-cos-sdk-v3\.test\.mjs/);
 assert.throws(()=>verifyReviewWorkflow(
  workflow.replace('node --test scripts/check-fabric-v2-cos-sdk-v3.test.mjs','node -e "console.log(42)"'),
 ));
});
test('OUTPUT-01 browser QA script syntax stays in CI without starting browser or using production data',()=>{
 assert.match(workflow,/run: node --check scripts\/document-output-browser-qa\.mjs/);
 assert.throws(()=>verifyReviewWorkflow(
  workflow.replace('node --check scripts/document-output-browser-qa.mjs','node --check scripts/no-output-qa.mjs'),
 ));
});
